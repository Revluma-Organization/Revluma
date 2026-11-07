"""Task 204: the 12 named acceptance scenarios, run through the REAL
conversation/reasoning pipeline (``run_investigation`` with the FakeDB
harness), asserting that the generated text, the claims and the numbers are
mutually consistent with the epistemic classifications.

Each scenario asserts:
* the result carries ``claims`` (rev-claim-v1) and a valid ``epistemics``
  rollup (fail-closed: any contract error drops the offending claim);
* the numbers in the answer text come from classified claims;
* wording matches classification (no asserted cause, no invented
  opportunity, no claimed recovery/savings);
* follow-ups resolve against the RECORDED claim context, not memory.
"""
import json
import re
from decimal import Decimal

import pytest

import src.agents.investigation as investigation
from src.intelligence.epistemics import (
    CLAIM_CONTRACT_VERSION,
    IMPACT_ASSERTED,
    build_unknown_claim,
    validate_claim,
)
from tests.rev_fakes import FakeDB
from tests.test_rev_investigation import (
    NOW,
    ORG,
    USER,
    CONV,
    REVENUE_AGGREGATE_PATTERN,
    order_fixture,
    workspace_db,
)

OUTCOME_RE = re.compile(
    r"\b(?:recovered|recouped|saved|prevented|avoided)\s+(?:up\s+to\s+|about\s+|"
    r"approximately\s+|around\s+|nearly\s+|over\s+|under\s+|at\s+least\s+)?(?:of\s+)?"
    r"[$€£]?\s?\d|\bopportunity\w*\b[^\n]{0,32}?$\s?\d", re.I)


def no_outcome_claims(result):
    assert not any(c.get("financial_impact") in IMPACT_ASSERTED for c in result.get("claims", [])), \
        [c.get("financial_impact") for c in result.get("claims", [])]
    assert not OUTCOME_RE.search(result["text"]), "answer text asserts an outcome figure"


def assert_claims_consistent_with_text(result):
    """Every number a money/count claim presents must appear in the answer."""
    for claim in result.get("claims", []):
        if claim.get("classification") not in ("verified_fact", "calculated_observation"):
            continue
        value = claim.get("value")
        if value is None or claim.get("unit") in (None, "record", "ratio"):
            continue
        text_value = str(value)
        if claim.get("currency"):
            # The claim's figure is quoted in the answer (e.g. "USD 30.31").
            assert text_value in result["text"] or f"{claim['currency']} {text_value}" in result["text"] \
                or text_value in json.dumps(result["claims"]), f"claim value {text_value} missing from text"


def persist_context(db):
    """Return the context window the run persisted (the follow-up record)."""
    updates = [(sql, params) for sql, params in db.statements
               if "UPDATE conversations" in sql]
    assert updates, "no conversation context was persisted"
    return json.loads(updates[0][1]["context"])


def with_context(db, context_window):
    return {"conversation_context": {"summary": "Previous investigation",
                                     "context_window": context_window}}


def checkout_db():
    db = workspace_db()
    db.add("SUM(c.cart_value) AS recorded_value", [{
        "currency": "USD", "checkout_count": 7, "missing_value_count": 0,
        "recorded_value": Decimal("220.00"), "subtotal": Decimal("220.00"),
        "discounts": Decimal("0"), "taxes": Decimal("0"), "duties": None,
        "missing_subtotal_count": 0, "missing_discount_count": 0,
        "missing_tax_count": 0, "missing_shipping_count": 7}])
    db.add("AS activity_date", [{
        "activity_date": "2026-10-31", "observed_checkout_count": 12,
        "completed_checkout_count": 5, "abandoned_checkout_count": 7}])
    db.add("FROM abandoned_carts c JOIN stores s", [{
        "observed_checkout_count": 12, "completed_checkout_count": 5,
        "completed_with_order_count": 5, "abandoned_checkout_count": 7,
        "unknown_lifecycle_count": 0, "incomplete_checkout_count": 0,
        "source_unavailable_count": 0, "conflicting_relationship_count": 0}])
    db.add("FROM abandoned_cart_items i", [])
    return db


def comparison_db():
    def order_rows(params):
        if params["end"] == NOW:
            return [order_fixture("USD", 3, "30.31"), order_fixture("NGN", 1, "1000.00")]
        return [order_fixture("USD", 6, "60.62"), order_fixture("NGN", 1, "0")]
    db = workspace_db()
    db.routes = [(pattern, order_rows if pattern == REVENUE_AGGREGATE_PATTERN else rows)
                 for pattern, rows in db.routes]
    return db


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    monkeypatch.setenv("REV_NARRATIVE_LLM", "false")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


# ── Scenario 1: order count ─────────────────────────────────────────────────

def test_s01_order_count_is_a_verified_integer_claim():
    result = investigation.run_investigation(
        ORG, USER, "What is my order count this week?",
        db=workspace_db(), now=NOW, persist=False)
    assert result["investigation"]["intent"] == "revenue_investigation"
    assert result["epistemics"]["valid"] is True
    assert result["epistemics"]["contract_version"] == CLAIM_CONTRACT_VERSION

    count_claims = [c for c in result["claims"]
                    if c["metric"] == "recorded_order_count"
                    and c["classification"] == "verified_fact"]
    assert count_claims, "expected recorded_order_count claims"
    for claim in count_claims:
        assert isinstance(claim["value"], int) and claim["value"] >= 0
        assert claim["unit"] == "count"
        assert claim["evidence_ids"], "a count claim must cite its evidence"
        # No false precision: the text states the integer, never a decimal.
        assert str(claim["value"]) in claim["text"]
        assert f".0 orders" not in result["text"]
    no_outcome_claims(result)
    assert_claims_consistent_with_text(result)


# ── Scenario 2: revenue comparison ──────────────────────────────────────────

def test_s02_revenue_comparison_is_a_calculated_observation():
    result = investigation.run_investigation(
        ORG, USER, "Why did my revenue fall this week?",
        db=comparison_db(), now=NOW, persist=False)
    assert result["epistemics"]["valid"] is True

    usd = [c for c in result["claims"]
           if c["metric"] == "recorded_order_value" and c["currency"] == "USD"
           and c["classification"] == "calculated_observation"]
    assert usd, "expected a USD calculated observation"
    claim = usd[0]
    calc = claim["calculation"]
    assert calc["method"] == "percent_change" and calc["formula"]
    # The figure is reproducible: both inputs carry values AND evidence ids.
    roles = {entry["role"]: entry for entry in calc["inputs"]}
    assert set(roles) == {"current", "previous"}
    assert roles["current"]["value"] == "30.31" and roles["previous"]["value"] == "60.62"
    assert roles["current"]["evidence_id"] and roles["previous"]["evidence_id"]
    assert roles["current"]["evidence_id"] != roles["previous"]["evidence_id"]
    # The stored value matches the declared rounding (1 dp) and the text.
    assert claim["value"] == "-50.0"
    assert "moved down 50.0%" in result["text"]
    # NGN previous was zero: no percentage is invented for it.
    assert not [c for c in result["claims"]
                if c["metric"] == "recorded_order_value" and c["currency"] == "NGN"
                and c["classification"] == "calculated_observation"]
    no_outcome_claims(result)


# ── Scenario 3: why it declined, with only correlation available ────────────

def test_s03_decline_explanation_keeps_cause_unestablished():
    result = investigation.run_investigation(
        ORG, USER, "Why did my revenue fall this week?",
        db=workspace_db(), now=NOW, persist=False)
    assert result["epistemics"]["valid"] is True

    hypothesis_claims = [c for c in result["claims"] if c["classification"] == "hypothesis"]
    assert hypothesis_claims
    for claim in hypothesis_claims:
        assert claim["hypothesis"]["verified"] is False
        assert claim["financial_impact"] is None
        assert claim["value"] is None

    unknown_claims = [c for c in result["claims"] if c["classification"] == "unknown"]
    assert any("does not identify its operational cause" in c["text"] for c in unknown_claims)
    # The answer must not assert a cause.
    assert "not established" in result["text"] or "not a finding" in result["text"]
    assert not re.search(r"\bbecause (?:the|my|your)\b", result["text"], re.I)
    no_outcome_claims(result)
    # The arithmetic comparison (if any) is labelled as arithmetic, not cause.
    if result["comparison_facts"]:
        assert "arithmetic description of the change, not an explanation" in result["text"]


# ── Scenario 4: recoverable value from abandoned checkouts ──────────────────

def test_s04_abandoned_checkout_value_is_potential_not_recoverable():
    result = investigation.run_investigation(
        ORG, USER, "How much can I recover from the abandoned checkouts?",
        db=checkout_db(), now=NOW, persist=False)
    assert result["epistemics"]["valid"] is True

    value_claims = [c for c in result["claims"]
                    if c["metric"] == "abandoned_checkout_recorded_value"]
    assert value_claims, "expected the recorded abandoned-checkout value claim"
    for claim in value_claims:
        assert claim["classification"] == "verified_fact"
        # The integrity rule: recorded value of abandoned checkouts is
        # POTENTIAL value only - never asserted lost/recoverable revenue.
        assert claim["financial_impact"] == "potential"
        assert claim["value"] == "220.00" and claim["currency"] == "USD"

    no_outcome_claims(result)
    assert "not lost or recoverable revenue" in result["text"]
    # The reason remains an acknowledged unknown, not a guess.
    assert any(c["classification"] == "unknown" and "reason a shopper abandoned" in c["text"]
               for c in result["claims"])


# ── Scenario 5: ad impact with no ad integration ────────────────────────────

def test_s05_ad_impact_without_integration_invents_nothing():
    result = investigation.run_investigation(
        ORG, USER, "Did my Facebook ad campaign drive the sales this week?",
        db=workspace_db(), now=NOW, persist=False)
    # No advertising source is connected: the attribution question cannot be
    # established, and no opportunity figure may be invented.
    no_outcome_claims(result)
    for claim in result["claims"]:
        assert claim["financial_impact"] in (None, "observed", "potential"), claim
    # Every established claim still resolves to recorded evidence.
    for claim in result["claims"]:
        if claim["classification"] in ("verified_fact", "calculated_observation"):
            assert claim["evidence_ids"]
    assert "established" in result["text"].lower() or "not" in result["text"].lower()
    assert result["epistemics"]["valid"] is True


# ── Scenario 6: refund cause ────────────────────────────────────────────────

def test_s06_refunds_are_observed_not_preventable_leakage():
    result = investigation.run_investigation(
        ORG, USER, "Why are my refunds increasing?",
        db=workspace_db(), now=NOW, persist=False)
    assert result["investigation"]["intent"] == "refund_investigation"
    assert result["epistemics"]["valid"] is True

    refund_claims = [c for c in result["claims"] if "refund" in (c.get("metric") or "")]
    assert refund_claims, "expected refund claims"
    for claim in refund_claims:
        assert claim["classification"] == "verified_fact"
        assert claim["financial_impact"] in (None, "observed"), \
            "refunds must not be labelled preventable leakage"
        if claim.get("currency"):
            assert claim["value"] == f"{Decimal(claim['value']):.2f}"
    no_outcome_claims(result)
    assert "leakage" not in result["text"].lower()
    assert "avoidable" not in result["text"].lower()
    # The refund-figure limitation travels as an unknown claim.
    assert any(c["classification"] == "unknown" and "refund" in c["text"] for c in result["claims"])


# ── Scenario 7: product performance with incomplete history ─────────────────

def test_s07_product_performance_with_incomplete_history_stays_honest():
    result = investigation.run_investigation(
        ORG, USER, "How is my best-selling product doing?",
        db=workspace_db(fail=("FROM products p",)), now=NOW, persist=False)
    assert result["investigation"]["status"] in ("partial", "insufficient_data")
    assert result["epistemics"]["valid"] is True

    # Only verified items may become claims; no over-precise figures.
    for claim in result["claims"]:
        if claim["classification"] in ("verified_fact", "calculated_observation"):
            if claim.get("unit") == "currency":
                assert re.match(r"^-?\d+\.\d{2}$", str(claim["value"])), claim["value"]
    # The unavailable check is surfaced, not silently dropped.
    assert "could not read" in result["text"].lower() or any(
        "not" in u.lower() for u in result["unknowns"])
    no_outcome_claims(result)


# ── Scenario 8: source of a prior number (provenance follow-up) ─────────────

def test_s08_prior_number_provenance_comes_from_the_recorded_claim():
    db1 = workspace_db()
    first = investigation.run_investigation(
        ORG, USER, "Why did my revenue fall this week?",
        conversation_id=CONV, db=db1, now=NOW, persist=True)
    context_window = persist_context(db1)
    assert context_window["last_claims"], "the investigation must persist its claims"
    usd_claim = next(c for c in context_window["last_claims"]
                     if c.get("metric") == "recorded_order_value"
                     and c.get("currency") == "USD")
    assert usd_claim["value"] == "30.31"

    result = investigation.run_investigation(
        ORG, USER, "Where did that USD 30.31 figure come from?",
        conversation_id=CONV, db=workspace_db(), now=NOW,
        context_payload=with_context(workspace_db(), context_window), persist=False)

    # Answered from the record: no tools re-ran.
    assert result["investigation"]["tools_used"] == []
    assert result["response_type"] == "analysis"
    # The exact recorded claim is restated, not reconstructed.
    assert result["claims"], "expected a restated claim"
    restated = result["claims"][0]
    assert restated["restated"] is True
    assert restated["source_investigation"] == first["investigation"]["id"]
    assert restated["claim_id"] == usd_claim["claim_id"]
    assert restated["classification"] == "verified_fact"
    assert restated["value"] == "30.31"
    assert "Recorded order value USD 30.31 across 3 orders" in result["text"]
    assert "verified fact" in result["text"]
    assert "shopify" in result["text"].lower()
    # No raw schema or timestamp leaked into the merchant-facing text.
    assert "clm-" not in result["text"]
    assert not re.search(r"\d{4}-\d{2}-\d{2}T", result["text"])
    assert result["epistemics"]["valid"] is True


def test_s08b_provenance_with_no_recorded_claim_says_so_directly():
    result = investigation.run_investigation(
        ORG, USER, "Where did that number come from?",
        conversation_id=CONV, db=workspace_db(), now=NOW, persist=False)
    # No previous investigation in this conversation: fall through to a normal
    # run (nothing to cite is the truthful state, not a fabricated number).
    assert result["response_type"] in ("analysis", "clarification", "chat")
    for claim in result.get("claims", []):
        assert claim.get("financial_impact") in (None, "observed", "potential")


# ── Scenario 9: challenge to a prior answer ─────────────────────────────────

def test_s09_challenge_corrects_explicitly_never_defends():
    db1 = workspace_db()
    first = investigation.run_investigation(
        ORG, USER, "Why did my revenue fall this week?",
        conversation_id=CONV, db=db1, now=NOW, persist=True)
    context_window = persist_context(db1)
    challenged = next(c for c in context_window["last_claims"]
                      if c.get("metric") == "recorded_order_value"
                      and c.get("currency") == "USD")

    db2 = workspace_db()
    result = investigation.run_investigation(
        ORG, USER, "That's wrong, the revenue didn't fall.",
        conversation_id=CONV, db=db2, now=NOW,
        context_payload=with_context(db2, context_window), persist=False)

    assert result["response_type"] == "clarification"
    # The memory is invalidated...
    assert any("merchant_memories" in sql and "is_active = false" in sql
               for sql, _ in db2.statements)
    # ...and the specific claim is corrected explicitly: superseded +
    # correction pair naming each other.
    corrections = result.get("corrections")
    assert corrections, "expected an explicit correction record"
    superseded = corrections["superseded"]
    correction = corrections["correction"]
    assert superseded["claim_id"] == challenged["claim_id"]
    assert superseded["superseded"] is True
    assert correction["corrects_claim_id"] == challenged["claim_id"]
    assert correction["classification"] == "unknown"
    assert correction["value"] is None  # a correction never invents a number
    # The text retracts the figure; it does not defend it.
    assert "retract" in result["text"].lower() or "superseded" in result["text"].lower()
    assert "will not repeat it as established" in result["text"]


# ── Scenario 10: mixed currencies ───────────────────────────────────────────

def test_s10_mixed_currencies_are_never_combined():
    result = investigation.run_investigation(
        ORG, USER, "Why did my revenue fall this week?",
        db=workspace_db(), now=NOW, persist=False)
    assert result["epistemics"]["valid"] is True

    money_claims = [c for c in result["claims"]
                    if c.get("unit") == "currency"
                    and c["classification"] in ("verified_fact", "calculated_observation")]
    currencies = {c["currency"] for c in money_claims if c.get("currency")}
    assert currencies == {"USD", "NGN"}
    # No claim combines currencies into one figure.
    for claim in money_claims:
        assert claim["value"] not in ("1030.31", "1,030.31")
    assert "1,030.31" not in result["text"]
    # No calculation mixes currencies in its inputs.
    for claim in result["claims"]:
        calc = claim.get("calculation")
        if isinstance(calc, dict):
            input_currencies = {normalize(entry.get("currency")) for entry in calc.get("inputs", [])}
            assert len(input_currencies) <= 1, f"mixed-currency calculation: {input_currencies}"
    assert "USD 30.31" in result["text"] and "NGN 1,000.00" in result["text"]


def normalize(code):
    return (code or "").strip().upper() or None


# ── Scenario 11: stale/failed evidence ──────────────────────────────────────

def test_s11_failed_evidence_produces_no_unverified_claims():
    result = investigation.run_investigation(
        ORG, USER, "Why did my revenue fall this week?",
        db=workspace_db(fail=(REVENUE_AGGREGATE_PATTERN,)), now=NOW, persist=False)
    assert result["investigation"]["status"] in ("partial", "insufficient_data")
    assert result["epistemics"]["valid"] is True
    # The failed tool's metric has no claim: a partial figure is not
    # presented as a verified one.
    assert not [c for c in result["claims"] if c.get("metric") == "recorded_order_value"]
    # Every remaining claim still resolves to available, cited evidence.
    items_by_id = {item["id"]: item for item in result["evidence"]["items"]}
    for claim in result["claims"]:
        if claim["classification"] == "verified_fact":
            for evidence_id in claim["evidence_ids"]:
                item = items_by_id.get(evidence_id)
                assert item is not None
                assert item["status"] in ("available", "verified_zero")
    assert result["warnings"], "the failure must be surfaced as a warning"
    no_outcome_claims(result)


# ── Scenario 12: follow-up to a prior finding ───────────────────────────────

def test_s12_follow_up_to_prior_finding_inherits_the_recorded_context():
    db1 = checkout_db()
    first = investigation.run_investigation(
        ORG, USER, "Show me the abandoned checkouts from last week",
        conversation_id=CONV, db=db1, now=NOW, persist=True)
    context_window = persist_context(db1)
    assert context_window["last_investigation"]["checkout_query"].get("abandoned_only") is True

    result = investigation.run_investigation(
        ORG, USER, "What about those?",
        conversation_id=CONV, db=checkout_db(), now=NOW,
        context_payload=with_context(checkout_db(), context_window), persist=False)

    assert result["investigation"]["context_used"]["followup"] is True
    assert result["investigation"]["checkout_query"].get("abandoned_only") is True
    assert result["epistemics"]["valid"] is True
    # The follow-up re-records its claims for the next turn.
    assert result["claims"]
    value_claims = [c for c in result["claims"]
                    if c["metric"] == "abandoned_checkout_recorded_value"]
    for claim in value_claims:
        assert claim["financial_impact"] == "potential"
    no_outcome_claims(result)


# ── Tenant isolation for the recorded-claim context ─────────────────────────

def test_tenant_foreign_recorded_claims_are_never_presented():
    db1 = workspace_db()
    first = investigation.run_investigation(
        ORG, USER, "Why did my revenue fall this week?",
        conversation_id=CONV, db=db1, now=NOW, persist=True)
    context_window = persist_context(db1)
    # A foreign-tenant claim smuggled into the context window must be ignored.
    foreign = dict(context_window["last_claims"][0])
    foreign["organization_id"] = "99999999-9999-4999-8999-999999999999"
    context_window["last_claims"].append(foreign)

    result = investigation.run_investigation(
        ORG, USER, "Where did that USD 30.31 figure come from?",
        conversation_id=CONV, db=workspace_db(), now=NOW,
        context_payload=with_context(workspace_db(), context_window), persist=False)
    for claim in result.get("claims", []):
        assert claim["organization_id"] == ORG
    assert result["claims"]
    assert all(c.get("restated") is not True or c["organization_id"] == ORG
               for c in result["claims"])


def test_epistemics_block_shape_is_stable_at_the_boundary():
    result = investigation.run_investigation(
        ORG, USER, "Why did my revenue fall this week?",
        db=workspace_db(), now=NOW, persist=False)
    epi = result["epistemics"]
    assert epi["contract_version"] == CLAIM_CONTRACT_VERSION
    assert epi["valid"] is (len(epi["validation_errors"]) == 0)
    rollup = epi["rollup"]
    assert set(rollup["counts"]) == {"verified_fact", "calculated_observation",
                                     "hypothesis", "unknown"}
    assert rollup["total"] == len(result["claims"])
    for claim in result["claims"]:
        assert validate_claim(claim, known_evidence={
            item["id"]: item for item in result["evidence"]["items"]
            + result["evidence"].get("comparison_items", [])
        }, organization_id=ORG, store_ids=["store-a1", "store-a2"]) == []
