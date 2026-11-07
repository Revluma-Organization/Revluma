"""Task 210: adaptive answer structure & confidence through the REAL pipeline.

Runs ``run_investigation`` with the FakeDB harness and asserts the full
contract: A–H response profiles, composable sections (never empty, never a
forced template), claim-specific evidence-derived confidence (re-derived
independently from the payload's own evidence), the separate coverage
representation, meta follow-ups answered from recorded claims without
re-investigation, and backward compatibility of the legacy response keys.
"""
import json
from datetime import datetime, timedelta, timezone

import pytest

import src.agents.investigation as investigation
from src.intelligence.response_adaptation import (
    ADAPTATION_CONTRACT_VERSION,
    CONFIDENCE_CATEGORIES,
    RESPONSE_ELEMENTS,
    derive_claim_confidence,
    response_confidence_category,
)
from tests.test_rev_investigation import (
    NOW, ORG, USER, CONV,
    REVENUE_AGGREGATE_PATTERN, order_fixture, workspace_db,
)
from tests.test_rev_investigation_scenarios import comparison_revenue_db


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    monkeypatch.setenv("REV_NARRATIVE_LLM", "false")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


def direct_db():
    return workspace_db()


def context_payload_for(result):
    """Rebuild the bounded context window Node would send on the next turn."""
    return {"conversation_context": {
        "summary": result.get("investigation", {}).get("question"),
        "context_window": {
            "rev_context_version": "1",
            "last_investigation": {
                "id": result["investigation"]["id"],
                "intent": result["investigation"]["intent"],
                "status": result["investigation"]["status"],
                "period": result["investigation"]["period"],
                "evidence_ids": [i["id"] for i in result["evidence"]["items"]][:20],
                "currencies": sorted(result["evidence"].get("by_currency") or {}),
                "segment": None,
                "order_query": {},
                "question": result["investigation"].get("question"),
                "outcome": result.get("investigation_outcome"),
            },
            "last_claims": [c for c in (result.get("claims") or [])
                            if isinstance(c, dict)][:10],
            "unresolved": result.get("unknowns", [])[:5],
        },
    }}


def assert_no_numbers(node, path=""):
    """Recursively assert a structure carries no numeric values."""
    if isinstance(node, dict):
        for key, value in node.items():
            assert not (isinstance(value, (int, float)) and not isinstance(value, bool)), \
                f"numeric value at {path}.{key}: {value!r}"
            assert_no_numbers(value, f"{path}.{key}")
    elif isinstance(node, list):
        for i, value in enumerate(node):
            assert_no_numbers(value, f"{path}[{i}]")


def assert_confidence_contract(result):
    """The new response.confidence contract (shared by every test)."""
    confidence = result["response"]["confidence"]
    assert "score" not in confidence, "fabricated numeric score must be gone"
    assert confidence["category"] in CONFIDENCE_CATEGORIES
    assert isinstance(confidence["claims"], dict)
    for claim_id, entry in confidence["claims"].items():
        assert entry["category"] in CONFIDENCE_CATEGORIES
        assert isinstance(entry["basis"], list)
        assert all(isinstance(r, str) for r in entry["basis"])
        assert isinstance(entry["limitations"], list)
    coverage = confidence["coverage"]
    for key in ("window", "coverage", "freshness", "currency_comparable",
                "certified", "limits"):
        assert key in coverage
    assert isinstance(coverage["currency_comparable"], bool)
    assert isinstance(coverage["certified"], bool)
    communication = confidence["communication"]
    assert isinstance(communication, str) and communication.strip()
    import re
    assert not re.search(r"\d+(\.\d+)?\s*%", communication)
    assert_no_numbers(confidence)


def assert_sections_contract(result):
    sections = result["response"]["sections"]
    assert isinstance(sections, list)
    seen = set()
    for section in sections:
        assert section["id"] in RESPONSE_ELEMENTS
        assert section["id"] not in seen, "duplicate element"
        seen.add(section["id"])
        assert section["label"].strip()
        # no section may render empty
        assert isinstance(section["text"], str) and section["text"].strip(), \
            f"empty section {section['id']}"


# ── adaptive structure (matrix 1–12, end-to-end) ────────────────────────────

def test_direct_question_gets_direct_profile_and_minimal_sections():
    result = investigation.run_investigation(
        ORG, USER, "How many orders did I get yesterday?",
        db=direct_db(), now=NOW, persist=False)
    profile = result["response_profile"]
    assert profile["response_intent"] == "direct_factual"
    assert profile["explanation_depth"] == "concise"
    sections = [s["id"] for s in result["response"]["sections"]]
    assert "direct_answer" in sections
    assert sections[0] == "direct_answer"
    # no report skeleton for a simple question
    for element in ("situation", "implication", "alternatives",
                    "suggested_investigation", "period_comparison"):
        assert element not in sections
    assert len(sections) <= 3
    assert_sections_contract(result)
    assert_confidence_contract(result)


def test_overview_gets_the_fuller_structure():
    result = investigation.run_investigation(
        ORG, USER, "How is my store doing?",
        db=direct_db(), now=NOW, persist=False)
    profile = result["response_profile"]
    assert profile["response_intent"] in ("multi_domain", "investigation")
    assert profile["complexity"] in ("moderate", "complex")
    sections = [s["id"] for s in result["response"]["sections"]]
    assert "evidence" in sections
    assert "situation" in sections or "direct_answer" in sections
    if "follow_up" in sections:
        assert sections[-1] == "follow_up"
    assert_sections_contract(result)
    assert_confidence_contract(result)


def test_comparison_keeps_period_comparison_before_evidence():
    result = investigation.run_investigation(
        ORG, USER, "Why did my revenue drop this month?",
        db=comparison_revenue_db(), now=NOW, persist=False)
    profile = result["response_profile"]
    assert profile["response_intent"] in ("comparative", "explanation")
    sections = [s["id"] for s in result["response"]["sections"]]
    if result["evidence"]["comparison_items"] or result["comparison_facts"]:
        assert "period_comparison" in sections
        assert sections.index("period_comparison") < sections.index("evidence")
    assert_sections_contract(result)
    assert_confidence_contract(result)


def test_no_section_is_ever_empty_across_profiles():
    for db, message in (
        (direct_db(), "How many orders did I get yesterday?"),
        (comparison_revenue_db(), "Why did my revenue drop this month?"),
        (direct_db(), "How is my store doing?"),
    ):
        result = investigation.run_investigation(
            ORG, USER, message, db=db, now=NOW, persist=False)
        assert_sections_contract(result)


def test_legacy_response_keys_remain_for_existing_consumers():
    result = investigation.run_investigation(
        ORG, USER, "Why did my revenue drop this month?",
        db=comparison_revenue_db(), now=NOW, persist=False)
    response = result["response"]
    for key in ("situation", "insight", "implication", "recommendation",
                "actions", "warnings"):
        assert key in response
    for key in ("situation", "insight", "implication", "recommendation"):
        assert isinstance(response[key], str)
    assert isinstance(response["actions"], list)
    assert isinstance(response["warnings"], list)


def disconnected_db():
    """No installed store: every domain is genuinely unavailable."""
    db = workspace_db()
    db.routes = [
        (p, [] if (("status" in p and "last_synced_at" in p)
                   or p == "FROM stores s WHERE"
                   or p == "intelligence_order_coverage") else r)
        for p, r in db.routes
    ]
    return db


def test_gap_answer_communicates_limitation_and_standing():
    # Order data unavailable while the store itself is healthy: the answer
    # must be a limited standing that names the gap — never a speculative
    # conclusion, never a fabricated confidence number.
    db = workspace_db(fail=(REVENUE_AGGREGATE_PATTERN,
                            "COUNT(*) AS order_count",
                            "COUNT(DISTINCT o.customer_id)",
                            "WITH ranked", "FROM events",
                            "FROM order_items oi", "completed_count"))
    result = investigation.run_investigation(
        ORG, USER, "Why did my revenue fall this week?",
        db=db, now=NOW, persist=False)
    assert result["investigation"]["status"] == "partial"
    profile = result["response_profile"]
    assert profile["explanation_depth"] in ("concise", "standard")
    sections = [s["id"] for s in result["response"]["sections"]]
    assert "confidence" in sections
    assert "limitations" in sections
    # never a speculative conclusion section
    for element in ("implication", "alternatives", "recommendation"):
        assert element not in sections
    assert_confidence_contract(result)
    assert result["response"]["confidence"]["category"] in (
        "limited", "insufficient")
    assert result["response"]["confidence"]["coverage"]["coverage"] in (
        "partial", "unknown", "no_data")


def test_disconnected_store_stays_fail_closed_before_adaptation():
    # The genuine insufficient case: no installed store. The Task 207
    # fail-closed early return answers "I can't see a connected store yet" —
    # no profile, no sections, no numbers invented.
    result = investigation.run_investigation(
        ORG, USER, "Why did my revenue fall this week?",
        db=disconnected_db(), now=NOW, persist=False)
    assert result["investigation_outcome"]["outcome"] not in (
        "success", "partial_success")
    assert result["response"] is None
    assert "response_profile" not in result
    text = result["text"].lower()
    assert "can't see a connected store" in text or "cannot see" in text
    import re
    assert not re.search(r"\d+(\.\d+)?\s*%", text)


# ── confidence integrity (matrix 13–22, end-to-end) ─────────────────────────

def test_every_claim_confidence_rederives_from_payload_evidence():
    result = investigation.run_investigation(
        ORG, USER, "Why did my revenue drop this month?",
        db=comparison_revenue_db(), now=NOW, persist=True,
        conversation_id=CONV)
    items_by_id = {i["id"]: i for i in
                   result["evidence"]["items"] + result["evidence"]["comparison_items"]}
    claims = result["claims"]
    assert claims, "scenario must record claims"
    for claim in claims:
        assert isinstance(claim.get("confidence"), dict), claim["claim_id"]
        recorded = claim["confidence"]
        probe = {k: v for k, v in claim.items() if k != "confidence"}
        red = derive_claim_confidence(probe, items_by_id)
        assert recorded["category"] == red["category"], claim["claim_id"]
        assert recorded["basis"] == red["basis"], claim["claim_id"]
    # the response map agrees with the claims
    for claim in claims:
        assert result["response"]["confidence"]["claims"][claim["claim_id"]] \
            == claim["confidence"]
    # the response category is the worst load-bearing claim
    assert result["response"]["confidence"]["category"] == \
        response_confidence_category(claims, items_by_id)


def test_hypothesis_claims_are_never_high_in_the_payload():
    result = investigation.run_investigation(
        ORG, USER, "Why did my revenue drop this month?",
        db=comparison_revenue_db(), now=NOW, persist=False)
    for claim in result["claims"]:
        if claim.get("classification") == "hypothesis":
            assert claim["confidence"]["category"] in ("limited", "insufficient")
            assert "hypothesis_unverified" in claim["confidence"]["basis"]


def test_no_numeric_confidence_anywhere_in_the_response():
    result = investigation.run_investigation(
        ORG, USER, "Why did my revenue drop this month?",
        db=comparison_revenue_db(), now=NOW, persist=False)
    assert_no_numbers(result["response"]["confidence"])
    for claim in result["claims"]:
        assert_no_numbers(claim["confidence"])


def test_coverage_represented_separately_with_real_fields():
    result = investigation.run_investigation(
        ORG, USER, "How is my store doing?",
        db=direct_db(), now=NOW, persist=False)
    coverage = result["response"]["confidence"]["coverage"]
    assert coverage["window"]["label"]
    assert coverage["coverage"] in ("complete", "partial", "unknown", "no_data")
    assert coverage["freshness"]
    # coverage is not a confidence category and not a number
    assert coverage["coverage"] not in CONFIDENCE_CATEGORIES or \
        coverage["coverage"] == "no_data"


def test_persisted_claims_carry_their_confidence():
    db = comparison_revenue_db()
    investigation.run_investigation(
        ORG, USER, "Why did my revenue drop this month?",
        db=db, now=NOW, persist=True, conversation_id=CONV)
    updates = [(sql, params) for sql, params in db.statements
               if "context_window" in sql and "UPDATE" in sql.upper()]
    assert updates, "context window was not persisted"
    window = json.loads(updates[-1][1]["context"])
    claims = window.get("last_claims") or []
    assert claims, "no claims persisted"
    for claim in claims:
        assert isinstance(claim.get("confidence"), dict)
        assert claim["confidence"]["category"] in CONFIDENCE_CATEGORIES


# ── conversation follow-ups (matrix 29–36, end-to-end) ──────────────────────

def turn_one():
    return investigation.run_investigation(
        ORG, USER, "Why did my revenue drop this month?",
        db=comparison_revenue_db(), now=NOW, persist=True,
        conversation_id=CONV)


def test_explain_the_second_point_answers_from_recorded_claims():
    first = turn_one()
    claims = first["claims"]
    assert len(claims) >= 2, "scenario needs two recorded claims"
    second_value = str(claims[1].get("value"))
    result = investigation.run_investigation(
        ORG, USER, "Can you explain the second point?",
        db=direct_db(), now=NOW, persist=True, conversation_id=CONV,
        context_payload=context_payload_for(first))
    # no re-investigation: the tools list is empty
    assert result["investigation"]["tools_used"] == []
    assert result["investigation"]["context_used"].get("meta_followup") \
        == "ordinal_reference"
    assert result["response_mode"] == "insight"
    # the referenced claim is restated, value and confidence intact
    assert len(result["claims"]) == 1
    restated = result["claims"][0]
    assert restated["restated"] is True
    assert restated["source_investigation"] == first["investigation"]["id"]
    assert second_value in result["text"]
    # confidence is the RECORDED one, unchanged
    assert restated["confidence"]["category"] == claims[1]["confidence"]["category"]
    profile = result["response_profile"]
    assert profile["response_intent"] == "explanation"
    assert_sections_contract(result)
    assert_confidence_contract(result)


def test_make_it_simpler_keeps_the_figures_and_says_so():
    first = turn_one()
    # The restatement must keep each top claim's verified prose verbatim —
    # same figures, no re-estimate.
    top_text = [c.get("text") for c in first["claims"][:3] if c.get("text")]
    assert top_text
    result = investigation.run_investigation(
        ORG, USER, "Make it simpler",
        db=direct_db(), now=NOW, persist=True, conversation_id=CONV,
        context_payload=context_payload_for(first))
    assert result["investigation"]["tools_used"] == []
    assert result["investigation"]["context_used"].get("meta_followup") \
        == "simplification"
    for prose in top_text:
        assert prose in result["text"]
    assert "not re-estimating" in result["text"]
    assert result["response_profile"]["explanation_depth"] == "concise"
    assert_confidence_contract(result)


def test_are_you_sure_restates_standing_without_reinvestigating():
    first = turn_one()
    result = investigation.run_investigation(
        ORG, USER, "Are you sure?",
        db=direct_db(), now=NOW, persist=True, conversation_id=CONV,
        context_payload=context_payload_for(first))
    assert result["investigation"]["tools_used"] == []
    assert result["investigation"]["context_used"].get("meta_followup") \
        == "verification"
    # every restated claim keeps its value and its recorded standing
    for claim in result["claims"]:
        original = next(c for c in first["claims"]
                        if c["claim_id"] == claim["claim_id"])
        assert claim["value"] == original["value"]
        assert claim["confidence"]["category"] == original["confidence"]["category"]
    assert "how strongly" in result["text"].lower()
    assert_confidence_contract(result)


def test_a_challenged_figure_still_goes_to_correction_not_verification():
    first = turn_one()
    result = investigation.run_investigation(
        ORG, USER, "Are you sure? That's wrong.",
        db=direct_db(), now=NOW, persist=True, conversation_id=CONV,
        context_payload=context_payload_for(first))
    assert result.get("corrections"), \
        "an explicit challenge must retract the claim, not verify it"
    assert result["investigation"]["context_used"].get("meta_followup") is None


def test_meta_followup_without_a_previous_claim_routes_normally():
    result = investigation.run_investigation(
        ORG, USER, "Explain the second point.",
        db=direct_db(), now=NOW, persist=False)
    assert result["investigation"]["context_used"].get("meta_followup") is None
    # no recorded claim means no restated-claim answer was fabricated
    assert all(not c.get("restated") for c in result.get("claims", []))


# ── contract invariants (matrix 37–45, end-to-end) ──────────────────────────

def test_response_profile_contract_and_vocabulary():
    result = investigation.run_investigation(
        ORG, USER, "Why did my revenue drop this month?",
        db=comparison_revenue_db(), now=NOW, persist=False)
    profile = result["response_profile"]
    assert profile["contract_version"] == ADAPTATION_CONTRACT_VERSION
    from src.intelligence.response_adaptation import (
        RESPONSE_INTENTS, COMPLEXITIES, EXPLANATION_DEPTHS)
    assert profile["response_intent"] in RESPONSE_INTENTS
    assert profile["complexity"] in COMPLEXITIES
    assert profile["explanation_depth"] in EXPLANATION_DEPTHS
    assert profile["confidence_communication"] in (
        "implicit", "inline", "explicit")
    assert isinstance(profile["reason"], str) and profile["reason"]


def test_sse_final_event_carries_the_adapted_contract():
    events = list(investigation.stream_investigation(
        ORG, USER, "Why did my revenue drop this month?",
        db=comparison_revenue_db(), now=NOW, conversation_id=CONV))
    final = next(e for e in events if e["event"] == "final")
    data = final["data"]
    assert data["response_profile"]["contract_version"] == ADAPTATION_CONTRACT_VERSION
    assert data["response"]["confidence"]["category"] in CONFIDENCE_CATEGORIES
    assert "score" not in data["response"]["confidence"]
    assert data["response"]["sections"]
