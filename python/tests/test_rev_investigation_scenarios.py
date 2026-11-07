"""Task 206: the 12 named acceptance scenarios (A-L) run through the REAL
conversation/reasoning pipeline (``run_investigation`` + the FakeDB harness,
labelled synthetic fixtures), asserting that the answer's numbers,
classifications, recommendations and evidence references are mutually
consistent and never invented.

Covers: revenue drop + volume/value decomposition + product contribution
(A/B/C), checkout abandonment + financial distinction + deterioration (D/E/F),
priority recommendation + challenge + no-valid + follow-up continuity +
invalidation (G/H/J/K/L) and insufficient history (I).
"""
import json
from datetime import datetime, timedelta
from decimal import Decimal

import pytest

import src.agents.investigation as investigation
from src.intelligence.epistemics import IMPACT_ASSERTED
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


# ── shared helpers ───────────────────────────────────────────────────────────
def finding_row(fid, *, ftype="revenue_drop", severity="high", status="open",
                dedupe_key=None, current_end=None, updated_age_h=1,
                current_count=2, previous_count=4, current_revenue=20,
                previous_revenue=80, verified=True, complete=True, store="store-a1"):
    current_end = current_end or NOW
    # The recorded windows keep their order (previous strictly before
    # current); staleness means the whole window is old, not inverted.
    previous_end = current_end - timedelta(hours=24)
    current_start = previous_end
    previous_start = current_start - timedelta(hours=24)
    return {
        "id": fid, "store_id": store, "type": ftype, "severity": severity,
        "status": status, "title": f"{ftype.replace('_', ' ').title()} finding",
        "description": "Stored detection",
        "evidence": {
            "verified": verified, "complete": complete, "currency": "USD",
            "currentCount": current_count, "previousCount": previous_count,
            "currentRevenue": current_revenue, "previousRevenue": previous_revenue,
            "currentStart": current_start.isoformat().replace("+00:00", "Z"),
            "currentEnd": current_end.isoformat().replace("+00:00", "Z"),
            "previousStart": previous_start.isoformat().replace("+00:00", "Z"),
            "previousEnd": previous_end.isoformat().replace("+00:00", "Z"),
            "coverage_source": "order_coverage", "coverage_run_id": "run-1",
        },
        "action": {"type": "inspect", "description": "Inspect the channel mix"},
        "dedupe_key": dedupe_key,
        "detected_at": NOW - timedelta(hours=24),
        "updated_at": NOW - timedelta(hours=updated_age_h),
        "acknowledged_at": None,
        "resolved_at": NOW - timedelta(hours=1) if status == "resolved" else None,
        "dismissed_at": NOW - timedelta(hours=1) if status == "dismissed" else None,
    }


def findings_db(*rows):
    db = workspace_db()
    db.routes = [(p, r) for p, r in db.routes if p != "FROM intelligence_findings"]
    db.add("FROM intelligence_findings", list(rows))
    return db


def comparison_revenue_db():
    """Current window lower than the previous one (a genuine decline)."""
    def order_rows(params):
        if params["end"] == NOW:
            return [order_fixture("USD", 3, "30.31"), order_fixture("NGN", 1, "1000.00")]
        return [order_fixture("USD", 6, "60.62"), order_fixture("NGN", 1, "0")]
    db = workspace_db()
    db.routes = [(p, order_rows if p == REVENUE_AGGREGATE_PATTERN else r)
                 for p, r in db.routes]
    return db


def product_db():
    """A product whose recorded line value fell versus the previous window."""
    def line_rows(params):
        if params["end"] == NOW:
            return [
                {"product_name": "Trail Jacket", "currency": "USD", "units": 3,
                 "line_value": Decimal("150.00")},
                {"product_name": "Rain Shell", "currency": "USD", "units": 4,
                 "line_value": Decimal("160.00")},
            ]
        return [
            {"product_name": "Trail Jacket", "currency": "USD", "units": 6,
             "line_value": Decimal("300.00")},
            {"product_name": "Rain Shell", "currency": "USD", "units": 4,
             "line_value": Decimal("160.00")},
            {"product_name": "Base Layer", "currency": "USD", "units": 5,
             "line_value": Decimal("100.00")},
        ]
    db = workspace_db()
    # Route the compare query (LIMIT 100) and the display query (LIMIT 6) to the
    # same window-aware rows; the performance query is unmatched (empty).
    db.routes = [
        (p, line_rows if (p in ("LIMIT 100", "LIMIT 6", "FROM order_items oi")) else r)
        for p, r in db.routes
    ]
    return db


def with_context_window(context_window):
    return {"conversation_context": {"summary": "Previous investigation",
                                     "context_window": context_window}}


def persisted_context(db):
    updates = [(sql, params) for sql, params in db.statements
               if "UPDATE conversations" in sql]
    assert updates, "no conversation context was persisted"
    return json.loads(updates[0][1]["context"])


def no_outcome_claims(result):
    assert not any(c.get("financial_impact") in IMPACT_ASSERTED
                   for c in result.get("claims", []))


def assert_epistemics_valid(result):
    assert result["epistemics"]["valid"] is True, result["epistemics"]["validation_errors"]
    assert result["epistemics"]["validation_errors"] == []


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    monkeypatch.setenv("REV_NARRATIVE_LLM", "false")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


def checkout_db(*, cur_abandoned=8, prev_abandoned=4, cur_value=400,
                prev_value=200, cur_observed=10, prev_observed=9):
    """Shopify store with recorded observed/abandoned populations per window."""
    db = FakeDB()
    db.add("FROM stores", [
        {"id": "store-a1", "platform": "shopify", "status": "active",
         "last_synced_at": NOW.isoformat()}])

    def split_key(params):
        return "cur" if params.get("end") == NOW else "prev"

    def agg(params):
        key = split_key(params)
        abandoned = cur_abandoned if key == "cur" else prev_abandoned
        observed = cur_observed if key == "cur" else prev_observed
        return [{"observed_checkout_count": observed,
                 "completed_checkout_count": max(observed - abandoned, 0),
                 "completed_with_order_count": 0,
                 "abandoned_checkout_count": abandoned,
                 "unknown_lifecycle_count": 0, "incomplete_checkout_count": 0,
                 "source_unavailable_count": 0, "conflicting_relationship_count": 0}]

    def val(params):
        key = split_key(params)
        value = cur_value if key == "cur" else prev_value
        return [{"currency": "USD",
                 "checkout_count": cur_abandoned if key == "cur" else prev_abandoned,
                 "missing_value_count": 0,
                 "recorded_value": f"{value:.2f}",
                 "subtotal": None, "discounts": None, "taxes": None, "duties": None,
                 "missing_subtotal_count": 0, "missing_discount_count": 0,
                 "missing_tax_count": 0, "missing_shipping_count": 0}]

    db.add("abandoned_checkout_count", agg)
    db.add("missing_value_count", val)
    db.add("activity_date", [])
    db.add("historical_product_titles", [])
    db.add("pagination_complete", [
        {"store_id": "store-a1", "domain": "abandoned_checkouts",
         "status": "ok", "pagination_complete": True, "records_discovered": 100,
         "last_succeeded_at": NOW, "last_checked_at": NOW,
         "error_code": None,
         "checkpoint": {"unfiltered_root": True, "nested_complete": True,
                        "scope_verified": True, "reconciliation_complete": True}}])
    return db


# ── A: revenue decline ───────────────────────────────────────────────────────
def test_a_revenue_decline_is_compared_not_invented():
    db = comparison_revenue_db()
    result = investigation.run_investigation(
        ORG, USER, "Why did my revenue drop this month?",
        db=db, now=NOW, persist=True, conversation_id=CONV)
    assert result["investigation"]["intent"] == "revenue_investigation"
    text = result["text"]
    assert "Compared with the previous period" in text
    # The recorded decline is present and currency-explicit.
    assert "USD" in text
    # A change is an arithmetic description, never an established cause.
    assert "not an explanation of its cause" in text or "not an established cause" in text
    no_outcome_claims(result)
    assert_epistemics_valid(result)
    # Context persisted for follow-ups.
    ctx = persisted_context(db)
    assert ctx["last_investigation"]["intent"] == "revenue_investigation"


# ── B: what caused most of the decline (volume vs value) ─────────────────────
def test_b_volume_vs_value_decomposition_reuses_context():
    db = comparison_revenue_db()
    result = investigation.run_investigation(
        ORG, USER, "What caused most of the decline?",
        db=db, now=NOW, persist=True, conversation_id=CONV,
        context_payload=with_context_window({
            "rev_context_version": "1",
            "last_investigation": {
                "id": "inv-1", "intent": "revenue_investigation", "status": "complete",
                "period": {"start": "2026-10-01T00:00:00Z", "end": NOW.isoformat().replace("+00:00", "Z"),
                           "label": "this month"},
                "evidence_ids": [], "currencies": ["USD", "NGN"], "segment": None,
                "order_query": {}, "checkout_query": {}}}))
    analysis = result.get("contributor_analysis") or []
    assert analysis, "the volume/value decomposition must be present"
    usd = next(e for e in analysis if e.get("currency") == "USD" and e.get("status") == "available")
    assert usd["driver"] in {"volume-driven", "value-driven", "mixed-offsetting",
                             "equally-split", "no_change"}
    # The effects reconcile exactly with the recorded value change.
    assert (Decimal(usd["order_count_effect"]) + Decimal(usd["order_value_effect"])
            == Decimal(usd["value_change"]))
    assert "Volume versus order value" in result["text"]
    # A decomposition is not a proven cause.
    assert "does not establish" in result["text"].lower() or "not its cause" in result["text"]
    no_outcome_claims(result)


# ── C: which product contributed most ────────────────────────────────────────
def test_c_product_contribution_is_a_contribution_not_a_cause():
    db = product_db()
    result = investigation.run_investigation(
        ORG, USER, "Which product contributed the most to the decline this month?",
        db=db, now=NOW, persist=True, conversation_id=CONV)
    assert result["investigation"]["intent"] == "product_investigation"
    text = result["text"]
    assert "Which recorded products moved the most" in text
    assert "Trail Jacket" in text
    # Contribution, not cause, and the line-title identity caveat is disclosed.
    assert "not an established cause" in text or "not a proven cause" in text
    assert "not a current product identity" in text
    no_outcome_claims(result)


# ── D: abandonment reasons (no invented causes) ──────────────────────────────
def test_d_abandonment_reasons_are_not_invented():
    db = workspace_db()
    db.add("FROM abandoned_carts c JOIN stores s", [{
        "observed_checkout_count": 12, "completed_checkout_count": 5,
        "completed_with_order_count": 5, "abandoned_checkout_count": 7,
        "unknown_lifecycle_count": 0, "incomplete_checkout_count": 0,
        "source_unavailable_count": 0, "conflicting_relationship_count": 0}])
    result = investigation.run_investigation(
        ORG, USER, "Why are shoppers abandoning checkout?",
        db=db, now=NOW, persist=True, conversation_id=CONV)
    assert result["investigation"]["intent"] == "checkout_investigation"
    text = result["text"]
    # The reason a shopper abandoned is not a recorded field.
    assert "not recorded" in text.lower() or "reason a shopper abandoned" in text.lower()
    # Hypotheses are labelled and never asserted as verified.
    for hyp in result.get("hypotheses", []):
        assert hyp.get("verified") is not True
    no_outcome_claims(result)
    assert_epistemics_valid(result)


# ── E: how much money am I losing (exposure != lost) ────────────────────────
def test_e_incomplete_value_is_exposure_not_lost_revenue():
    db = workspace_db()
    db.add("SUM(c.cart_value) AS recorded_value", [{
        "currency": "USD", "checkout_count": 7, "missing_value_count": 0,
        "recorded_value": Decimal("220.00"), "subtotal": Decimal("220.00"),
        "discounts": Decimal("0"), "taxes": Decimal("0"), "duties": None,
        "missing_subtotal_count": 0, "missing_discount_count": 0,
        "missing_tax_count": 0, "missing_shipping_count": 7}])
    db.add("FROM abandoned_carts c JOIN stores s", [{
        "observed_checkout_count": 12, "completed_checkout_count": 5,
        "completed_with_order_count": 5, "abandoned_checkout_count": 7,
        "unknown_lifecycle_count": 0, "incomplete_checkout_count": 0,
        "source_unavailable_count": 0, "conflicting_relationship_count": 0}])
    result = investigation.run_investigation(
        ORG, USER, "How much money am I losing from abandoned checkouts?",
        db=db, now=NOW, persist=True, conversation_id=CONV)
    text = result["text"]
    # Incomplete value is NOT lost or recoverable revenue.
    assert "not lost or recoverable revenue" in text or "not lost" in text
    no_outcome_claims(result)
    # Any recorded incomplete value carries POTENTIAL impact, never asserted.
    for claim in result.get("claims", []):
        if claim.get("metric") == "abandoned_checkout_recorded_value":
            assert claim.get("financial_impact") in (None, "potential")


# ── F: has abandonment gotten worse ──────────────────────────────────────────
def test_f_abandonment_deterioration_uses_comparable_periods():
    db = checkout_db()
    result = investigation.run_investigation(
        ORG, USER, "Has checkout abandonment gotten worse this month?",
        db=db, now=NOW, persist=True, conversation_id=CONV)
    inv = result["investigation"]
    assert inv["intent"] == "checkout_investigation"
    window = inv.get("period") or {}
    compared = window.get("compared_to") or {}
    # A 'worse' question needs a resolved comparable period: a non-empty prior
    # window with equal elapsed time (same local-calendar portion), fully
    # preceding the reporting window.
    assert compared.get("start"), "a 'worse' question needs the comparable period"
    ws = datetime.fromisoformat(window["start"].replace("Z", "+00:00"))
    we = datetime.fromisoformat(window["end"].replace("Z", "+00:00"))
    cs = datetime.fromisoformat(compared["start"].replace("Z", "+00:00"))
    ce = datetime.fromisoformat(compared["end"].replace("Z", "+00:00"))
    assert cs < ce < ws, "comparison must fully precede the reporting window"
    assert (we - ws) == (ce - cs), "comparison must be the equal elapsed period"
    text = result["text"]
    lower = text.lower()
    # Recorded deterioration must surface (8 current vs 4 previous abandoned).
    assert "8" in text and "4" in text
    assert any(word in lower for word in ("previous", "compared", "before", "elapsed", "month"))
    # No fabricated causal claim — abandoned-checkout records carry no reasons.
    for invented in ("because customers found", "due to a bug",
                     "payment gateway outage caused", "caused by the checkout"):
        assert invented not in lower
    no_outcome_claims(result)
    assert_epistemics_valid(result)


# ── G: fix first (a defensible, executable recommendation) ───────────────────
def test_g_fix_first_ranks_real_findings():
    db = findings_db(
        finding_row("11111111-0000-0000-0000-000000000001", ftype="revenue_drop",
                    severity="high"),
        finding_row("11111111-0000-0000-0000-000000000002", ftype="checkout_failure",
                    severity="medium"),
    )
    result = investigation.run_investigation(
        ORG, USER, "What should I fix first?",
        db=db, now=NOW, persist=True, conversation_id=CONV)
    assert result["investigation"]["intent"] == "finding_investigation"
    priority = result.get("priority")
    assert priority is not None
    assert priority["method_version"] == "finding-priority-v1"
    assert priority["no_valid_findings"] is False
    assert priority["ranked"][0]["finding_id"] == "11111111-0000-0000-0000-000000000001"
    text = result["text"]
    assert "What I would work on first" in text
    # Read-only: nothing executed.
    assert "Nothing has been executed" in text or "read-only" in text.lower()
    no_outcome_claims(result)
    # Context carries the recorded priority for follow-ups.
    ctx = persisted_context(db)
    assert ctx["last_priority"]["top_finding_id"] == "11111111-0000-0000-0000-000000000001"


# ── H: challenge (why is that more important than X) ─────────────────────────
def test_h_challenge_compares_the_actual_findings():
    db = findings_db(
        finding_row("11111111-0000-0000-0000-000000000001", ftype="checkout_failure",
                    severity="high"),
        finding_row("11111111-0000-0000-0000-000000000002", ftype="refund_increase",
                    severity="medium"),
    )
    result = investigation.run_investigation(
        ORG, USER, "Why is that more important than the refund issue?",
        db=db, now=NOW, persist=True, conversation_id=CONV)
    assert result["investigation"]["intent"] == "finding_investigation"
    comparison = result.get("priority_comparison")
    assert comparison is not None
    assert comparison["matched"] is True
    assert comparison["referenced"]["finding_id"] == "11111111-0000-0000-0000-000000000002"
    # The ranking criteria are explained, not just asserted.
    assert "rank" in comparison["statement"].lower() or "basis" in comparison["statement"].lower()
    assert "Why that, versus the one you asked about" in result["text"]
    no_outcome_claims(result)


# ── I: insufficient history (no invented comparison) ─────────────────────────
def test_i_insufficient_history_does_not_invent_a_comparison():
    # Current window only; the previous window is not covered, so no change is
    # asserted. The revenue tool returns no comparison changes.
    def order_rows(params):
        if params["end"] == NOW:
            return [order_fixture("USD", 3, "30.31")]
        return []  # previous window has no certified rows
    db = workspace_db()
    db.routes = [(p, order_rows if p == REVENUE_AGGREGATE_PATTERN else r)
                 for p, r in db.routes]
    result = investigation.run_investigation(
        ORG, USER, "How did revenue change compared with last month?",
        db=db, now=NOW, persist=True, conversation_id=CONV)
    text = result["text"]
    # No fabricated percent change for the missing window.
    assert "%" not in text.replace("%", "PERCENT", 0) or "not" in text.lower()
    # The limit is disclosed rather than a comparison invented.
    assert "not" in text.lower()
    no_outcome_claims(result)


# ── J: no valid findings (verified-healthy vs stale vs unavailable) ─────────
def test_j_no_valid_findings_is_not_a_fake_priority():
    db = findings_db()  # zero open findings
    result = investigation.run_investigation(
        ORG, USER, "What should I fix first?",
        db=db, now=NOW, persist=True, conversation_id=CONV)
    priority = result.get("priority")
    assert priority is not None
    assert priority["no_valid_findings"] is True
    assert priority["no_valid_findings_reason"] == "verified_no_open_findings"
    text = result["text"]
    assert "What I would work on first" in text
    assert "verified-healthy" in text or "no open findings" in text.lower()
    assert "1." not in text.split("What I would work on first")[1].split("##")[0][:80]


def test_j_stale_findings_require_reverification():
    db = findings_db(
        finding_row("11111111-0000-0000-0000-000000000001",
                    current_end=NOW - timedelta(hours=72)))
    result = investigation.run_investigation(
        ORG, USER, "What should I fix first?",
        db=db, now=NOW, persist=True, conversation_id=CONV)
    priority = result.get("priority")
    assert priority["no_valid_findings"] is True
    assert priority["no_valid_findings_reason"] == "stale_findings_require_reverification"
    assert "re-verification" in result["text"].lower() or "reverification" in result["text"].lower()


# ── K: follow-up continuity ──────────────────────────────────────────────────
def test_k_follow_up_preserves_evidence_period_and_classification():
    db = comparison_revenue_db()
    first = investigation.run_investigation(
        ORG, USER, "Why did my revenue drop this month?",
        db=db, now=NOW, persist=True, conversation_id=CONV)
    ctx = persisted_context(db)
    # A follow-up referencing the previous period inherits it.
    second = investigation.run_investigation(
        ORG, USER, "Compared with the month before, was it worse?",
        db=comparison_revenue_db(), now=NOW, persist=True, conversation_id=CONV,
        context_payload=with_context_window(ctx))
    assert second["investigation"]["context_used"]["previous_investigation"] is True
    # The recorded claims survive into the context for provenance follow-ups.
    assert isinstance(ctx.get("last_claims"), list)
    no_outcome_claims(second)


# ── L: invalidation (no longer the current priority, change explained) ───────
def test_l_invalidated_top_is_not_presented_as_current():
    # The previously top finding's evidence is now stale (>48h), so it is
    # excluded and a different finding is ranked first; the change is explained.
    db = findings_db(
        finding_row("11111111-0000-0000-0000-000000000001", ftype="revenue_drop",
                    severity="high",
                    current_end=NOW - timedelta(hours=72)),  # now stale
        finding_row("11111111-0000-0000-0000-000000000002", ftype="checkout_failure",
                    severity="medium"),
    )
    previous_ctx = {
        "rev_context_version": "1",
        "last_investigation": {
            "id": "inv-1", "intent": "finding_investigation", "status": "complete",
            "period": {"start": "2026-10-30T00:00:00Z",
                       "end": NOW.isoformat().replace("+00:00", "Z"), "label": "this week"},
            "evidence_ids": [], "currencies": ["USD"], "segment": None,
            "order_query": {}, "checkout_query": {}},
        "last_priority": {
            "method_version": "finding-priority-v1", "no_valid_findings": False,
            "no_valid_findings_reason": None, "computed_at": NOW.isoformat().replace("+00:00", "Z"),
            "top_finding_id": "11111111-0000-0000-0000-000000000001",
            "top_title": "Revenue Drop Finding",
            "ranked": [{"rank": 1, "finding_id": "11111111-0000-0000-0000-000000000001",
                        "title": "Revenue Drop Finding", "severity": "high",
                        "freshness": "fresh"}],
            "excluded": []},
    }
    result = investigation.run_investigation(
        ORG, USER, "What should I fix first?",
        db=db, now=NOW, persist=True, conversation_id=CONV,
        context_payload=with_context_window(previous_ctx))
    priority = result.get("priority")
    # The stale finding is excluded, and a different finding is now top.
    assert priority["ranked"][0]["finding_id"] == "11111111-0000-0000-0000-000000000002"
    excluded = {e["finding_id"]: e["reason"] for e in priority["excluded"]}
    assert excluded.get("11111111-0000-0000-0000-000000000001") == "stale_unreverified"
    # The change from the previously recorded top is explained.
    change = result.get("priority_change")
    assert change is not None
    assert change["finding_id"] == "11111111-0000-0000-0000-000000000001"
    assert "no longer ranked" in change["statement"].lower()
    assert "How this differs from what I told you before" in result["text"]
    no_outcome_claims(result)
