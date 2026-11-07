"""Task 207 adversarial integration/history/capability/continuity coverage."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from src.agents import investigation
from src.agents.investigation import run_investigation, stream_investigation
from src.agents.tools import ToolResult
from src.intelligence.investigation_outcomes import (
    OUTCOMES, base_outcome, capability_decision, derive_outcome,
    history_assessment, validate_outcome,
)
from tests.test_rev_investigation import NOW, ORG, USER, workspace_db, order_fixture


def outcome(result):
    value = result["investigation_outcome"]
    assert validate_outcome(value, organization_id=ORG) == []
    assert not any(token in result["text"].lower() for token in ("traceback", "access token", "database_url"))
    return value


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    monkeypatch.setenv("REV_NARRATIVE_LLM", "false")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


@pytest.mark.parametrize("message, code, category", [
    ("How did my Facebook ads perform?", "advertising_integration", "unsupported_external_data"),
    ("What was my competitor's private revenue?", "web_analytics_integration", "unsupported_external_data"),
    ("Prove what definitively caused the sales decline", "definitive_causation", "unsupported_request"),
    ("Guarantee the revenue I will recover", "guarantee", "unsupported_request"),
    ("Forecast my exact future sales", "forecast", "unsupported_prediction"),
    ("Analyze Stripe payouts and disputes", "payment_provider", "unsupported_external_data"),
    ("What is the capital of France?", "out_of_domain", "out_of_domain"),
    ("What is photosynthesis?", "out_of_domain", "out_of_domain"),
])
def test_unsupported_questions_are_honest_and_have_no_store_claims(message, code, category):
    result = run_investigation(ORG, USER, message, db=workspace_db(), now=NOW, persist=False)
    state = outcome(result)
    assert state["outcome"] in {"unsupported_capability", "unsupported_question"}
    assert state["capability"]["code"] == code
    assert state["capability"]["category"] == category
    assert state["retry"]["eligible"] is False
    assert result["facts"] == [] and result["claims"] == []
    assert result["read_only"] is True and result["executed_actions"] == []


@pytest.mark.parametrize("message", [
    "Fix my pricing", "Send recovery emails to my customers", "Change my product inventory",
    "Launch an advertising campaign", "Refund this customer order", "Apply this discount",
])
def test_write_requests_are_refused_with_typed_outcome(message):
    result = run_investigation(ORG, USER, message, db=workspace_db(), now=NOW, persist=False)
    state = outcome(result)
    assert state["outcome"] == "unsupported_capability"
    assert state["capability"]["category"] == "unsupported_action"
    assert result["executed_actions"] == [] and "can't" in result["text"].lower()


def test_ambiguous_period_asks_one_question_without_tools(monkeypatch):
    called = []
    monkeypatch.setattr(investigation, "run_tool", lambda *a, **k: called.append(a))
    result = run_investigation(ORG, USER, "Compare this month with last time", db=workspace_db(), now=NOW, persist=False)
    assert outcome(result)["outcome"] == "ambiguous_question"
    assert result["response_type"] == "clarification"
    assert result["text"].strip().endswith("?") and called == []


def test_new_question_after_unsupported_is_not_trapped_by_context():
    # Capability decisions are made afresh, not cached as permanent store state.
    assert capability_decision("Forecast next week's sales")["code"] == "forecast"
    result = run_investigation(ORG, USER, "How much revenue did my store record this week?", db=workspace_db(), now=NOW, persist=False)
    assert outcome(result)["outcome"] in {"success", "partial_success", "insufficient_coverage"}
    assert result["investigation"]["tools_used"]


def test_disconnected_store_is_not_a_zero_result(monkeypatch):
    disconnected = ToolResult("store_health", "available", items=[{
        "id": "connected", "metric": "connected_store_count", "value": 0, "status": "available",
    }], warnings=[])
    monkeypatch.setattr(investigation, "run_tool", lambda *a, **k: disconnected)
    result = run_investigation(ORG, USER, "How much revenue did I make?", db=workspace_db(), now=NOW, persist=False)
    assert outcome(result)["outcome"] == "integration_disconnected"
    assert "0" not in result["text"]
    assert outcome(result)["retry"]["eligible"] is False


def test_store_database_failure_is_not_disconnection(monkeypatch):
    failed = ToolResult("store_health", "unavailable", items=[], warnings=["store_query_failed"])
    monkeypatch.setattr(investigation, "run_tool", lambda *a, **k: failed)
    result = run_investigation(ORG, USER, "How much revenue did I make?", db=workspace_db(), now=NOW, persist=False)
    assert outcome(result)["outcome"] == "retrieval_failed"
    assert outcome(result)["retry"]["eligible"] is True


def test_partial_failure_keeps_independent_revenue_evidence(monkeypatch):
    real = investigation.run_tool
    def flaky(tool, *args, **kwargs):
        if tool == "inventory_observations": raise TimeoutError("private socket detail")
        return real(tool, *args, **kwargs)
    monkeypatch.setattr(investigation, "run_tool", flaky)
    result = run_investigation(ORG, USER, "Investigate my products and revenue", db=workspace_db(), now=NOW, persist=False)
    state = outcome(result)
    assert state["outcome"] == "partial_success"
    assert "inventory" in state["unavailable_domains"]
    assert state["answerability"]["can_answer"]
    assert state["retry"]["eligible"] is True
    assert "private socket detail" not in result["text"]


def test_permanent_tool_authorization_failure_is_not_retryable(monkeypatch):
    real = investigation.run_tool
    def denied(tool, *args, **kwargs):
        if tool == "inventory_observations": raise investigation.ToolAuthorizationError("denied")
        return real(tool, *args, **kwargs)
    monkeypatch.setattr(investigation, "run_tool", denied)
    result = run_investigation(ORG, USER, "Investigate my products", db=workspace_db(), now=NOW, persist=False)
    state = outcome(result)
    assert state["retry"]["eligible"] is False
    assert any(d["state"] == "permission_insufficient" for d in state["retrieval"]["diagnostics"])


def test_json_and_sse_share_the_same_typed_unsupported_result():
    args = dict(organization_id=ORG, user_id=USER, message="Forecast exact future traffic", now=NOW, persist=False)
    direct = run_investigation(db=workspace_db(), **args)
    events = list(stream_investigation(ORG, USER, args["message"], db=workspace_db(), now=NOW))
    final = next(e["data"] for e in events if e["event"] == "final")
    assert final["investigation_outcome"]["outcome"] == direct["investigation_outcome"]["outcome"] == "unsupported_capability"
    assert final["investigation_outcome"]["diagnostic_reference"] != direct["investigation_outcome"]["diagnostic_reference"]


# Integration taxonomy: derived from authoritative integration diagnostics, not
# from the presence or absence of order rows.
def _integration(state="healthy", sync_state="succeeded", failure=None, authorization="healthy"):
    return {"overall_status": state, "components": {"authorization": authorization}, "stores": [{
        "store_id": "store-a1", "connection": {"state": "authentication_invalid" if state == "attention_required" else state},
        "synchronization": {"orders": {"state": sync_state, "failure_class": failure, "stale": sync_state == "stale", "retry_count": 0}},
    }]}


def _derived(integration, tool_status="unavailable", error=None):
    tr = ToolResult("integration_health", "partial", diagnostics={"integration": integration})
    revenue = ToolResult("revenue_observations", tool_status, items=[])
    return derive_outcome(
        investigation_id="11111111-1111-4111-8111-111111111111", question="q", intent="revenue_investigation",
        organization_id=ORG, store_ids=["store-a1"], tools=["integration_health", "revenue_observations"],
        tool_results={"integration_health": tr, "revenue_observations": revenue},
        tool_failures={"revenue_observations": error or {"outcome": "retrieval_failed", "retry_eligible": False}},
        items=[], period={"start": NOW.isoformat(), "end": (NOW + timedelta(days=1)).isoformat()},
        comparison=None, overall_status="insufficient_data")


@pytest.mark.parametrize("integration, expected, retry", [
    (_integration("disconnected"), "integration_disconnected", False),
    (_integration("revoked"), "integration_disconnected", False),
    (_integration("attention_required"), "authorization_expired", False),
    (_integration("unauthorized", authorization="failed"), "permission_insufficient", False),
    (_integration("verification_pending", "running"), "sync_in_progress", False),
    (_integration("degraded", "stale"), "sync_stale", False),
    (_integration("partially_operational", "failed", "network"), "sync_failed", True),
    (_integration("partially_operational", "failed", "rate_limit"), "sync_failed", True),
    (_integration("partially_operational", "failed", "shopify_api"), "sync_failed", True),
    (_integration("partially_operational", "failed", "database"), "sync_failed", True),
])
def test_integration_failure_taxonomy_and_retry_eligibility(integration, expected, retry):
    state = _derived(integration)
    assert state["outcome"] == expected
    assert state["retry"]["eligible"] is retry
    assert state["retry"]["starts_sync"] is False and state["retry"]["deduplicates_sync"] is True


def test_unsupported_shopify_resource_does_not_retry():
    state = _derived(_integration(), tool_status="unsupported")
    assert state["outcome"] == "source_unavailable"
    assert state["retry"]["eligible"] is False


# History and comparison coverage.
def _coverage_item(start, end, status="complete", value=1):
    return {"id": "ev", "status": "available", "value": value, "currency": "USD",
            "period": {"timezone": "Africa/Lagos"},
            "coverage": {"source": "intelligence_order_coverage", "status": status,
                         "complete": status == "complete", "coverage_start": start.isoformat(),
                         "coverage_end": end.isoformat()}}


def test_requested_period_predating_certified_history():
    items = [_coverage_item(NOW - timedelta(days=10), NOW)]
    state = history_assessment(items, {"start": (NOW - timedelta(days=60)).isoformat(), "end": NOW.isoformat()})
    assert state["state"] == "insufficient_history"
    assert state["available_start"] == (NOW - timedelta(days=10)).isoformat()


def test_current_period_remains_answerable_with_limited_history():
    items = [_coverage_item(NOW - timedelta(days=10), NOW + timedelta(days=1))]
    state = history_assessment(items, {"start": (NOW - timedelta(days=7)).isoformat(), "end": NOW.isoformat()},
                               {"status": "insufficient_history"})
    assert state["state"] == "verified"
    assert state["comparison_eligibility"] == "insufficient_history"


@pytest.mark.parametrize("coverage, expected", [
    ([], "unknown"),
    ([_coverage_item(NOW - timedelta(days=20), NOW, "partial")], "incomplete"),
    ([_coverage_item(NOW - timedelta(days=20), NOW, "complete", 0)], "verified"),
])
def test_history_unknown_incomplete_and_verified_zero_stay_distinct(coverage, expected):
    state = history_assessment(coverage, {"start": (NOW - timedelta(days=7)).isoformat(), "end": NOW.isoformat()})
    assert state["state"] == expected


def test_incomplete_comparison_is_ineligible_without_fabricated_percentage():
    state = history_assessment([_coverage_item(NOW - timedelta(days=30), NOW)],
                               {"start": (NOW - timedelta(days=7)).isoformat(), "end": NOW.isoformat()},
                               {"status": "partial"})
    assert state["comparison_eligibility"] == "ineligible"
    assert "percent" not in str(state)


def test_narrower_period_inside_certified_window_is_supported():
    items = [_coverage_item(NOW - timedelta(days=30), NOW)]
    wide = history_assessment(items, {"start": (NOW - timedelta(days=90)).isoformat(), "end": NOW.isoformat()})
    narrow = history_assessment(items, {"start": (NOW - timedelta(days=7)).isoformat(), "end": NOW.isoformat()})
    assert wide["state"] == "insufficient_history" and narrow["state"] == "verified"


def test_retry_preserves_original_question_period_and_missing_domain():
    db = workspace_db()
    real = investigation.run_tool
    monkeypatch = pytest.MonkeyPatch()
    def flaky(tool, *args, **kwargs):
        if tool == "inventory_observations": raise TimeoutError("timeout")
        return real(tool, *args, **kwargs)
    monkeypatch.setattr(investigation, "run_tool", flaky)
    try:
        result = run_investigation(ORG, USER, "Why did my products sell less from 2026-10-01 to 2026-10-15?",
                                   conversation_id="33333333-3333-3333-3333-333333333333",
                                   db=db, now=NOW, persist=True)
    finally:
        monkeypatch.undo()
    writes = [params for sql, params in db.statements if "SET context_window" in sql]
    assert writes
    import json
    context = json.loads(writes[-1]["context"])
    previous = context["last_investigation"]
    assert previous["question"].startswith("Why did my products")
    assert previous["period"]["label"] == "2026-10-01 to 2026-10-15"
    assert "inventory" in previous["outcome"]["unavailable_domains"]
    assert previous["outcome"]["retry"]["eligible"] is True
    assert previous["outcome"]["retry"]["starts_sync"] is False


def test_followup_re_evaluates_current_state_instead_of_trusting_reconnection_claim(monkeypatch):
    supplied = {"conversation_context": {"context_window": {
        "last_investigation": {"intent": "product_investigation", "period": {
            "start": (NOW - timedelta(days=7)).isoformat(), "end": NOW.isoformat(), "label": "original"}},
    }}}
    calls = []
    real = investigation.run_tool
    def recording(tool, *args, **kwargs):
        calls.append(tool)
        return real(tool, *args, **kwargs)
    monkeypatch.setattr(investigation, "run_tool", recording)
    result = run_investigation(ORG, USER, "I reconnected Shopify. Continue the investigation",
                               conversation_id="33333333-3333-3333-3333-333333333333",
                               db=workspace_db(), now=NOW, persist=False, context_payload=supplied)
    # The words do not restore anything: authoritative health and all required
    # sources are queried again in this turn.
    assert "integration_health" in calls and "product_observations" in calls
    assert outcome(result)["integration"]["state"] != "not_evaluated"


def test_narrower_followup_period_replaces_original_period_without_losing_intent():
    supplied = {"conversation_context": {"context_window": {
        "last_investigation": {"intent": "revenue_investigation", "period": {
            "start": (NOW - timedelta(days=90)).isoformat(), "end": NOW.isoformat(), "label": "original"}},
    }}}
    result = run_investigation(ORG, USER, "Instead, use last 7 days",
                               conversation_id="33333333-3333-3333-3333-333333333333",
                               db=workspace_db(), now=NOW, persist=False, context_payload=supplied)
    assert result["investigation"]["intent"] == "revenue_investigation"
    assert result["investigation"]["period"]["label"] == "Last 7 days (rolling)"


def test_outcome_rejects_tenant_mismatch_and_sensitive_fields():
    state = base_outcome(outcome="internal_error", investigation_id="id", question="q", intent="revenue", organization_id=ORG)
    state["access_token"] = "secret"
    assert "outcome_sensitive_field" in validate_outcome(state, organization_id=ORG)
    del state["access_token"]
    assert "outcome_tenant_mismatch" in validate_outcome(state, organization_id="other")
    assert set(OUTCOMES) >= {"success", "partial_success", "unsupported_question", "internal_error"}
