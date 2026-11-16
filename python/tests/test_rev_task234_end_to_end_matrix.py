"""48 named Rev end-to-end regressions across answer, continuity and orchestration paths.

These synthetic fixtures enter production routers/runtimes and assert merchant-visible
payloads plus tool/provider/persistence side effects. They make no live provider calls.
"""
from __future__ import annotations

import json
import sys
from datetime import timedelta
from types import SimpleNamespace

import pytest

from src.agents import investigation, model_gateway, understanding
from src.intelligence.evidence import period
from src.intelligence.question_orchestration import (
    build_investigation_plan, execute_orchestrated_specialists,
    reconcile_orchestration, record_domain_evidence_execution,
    validate_orchestration,
)
from src.intelligence.epistemics import CLAIM_CONTRACT_VERSION
from tests.test_rev_investigation import NOW, ORG, USER, workspace_db

GENERAL = [
    ("G01", "What is Shopify?"),
    ("G02", "Define average order value."),
    ("G03", "Explain customer lifetime value."),
    ("G04", "Meaning of conversion rate."),
    ("G05", "What is gross margin?"),
    ("G06", "Explain abandoned checkout."),
    ("G07", "What is inventory turnover?"),
    ("G08", "Define refund rate."),
]
ADVISORY = [
    ("A01", "How can I improve checkout completion?"),
    ("A02", "How can I reduce cart abandonment?"),
    ("A03", "How can I grow repeat purchases?"),
    ("A04", "How can I increase average order value?"),
    ("A05", "How can I avoid refund spikes?"),
    ("A06", "How can I improve inventory turnover?"),
    ("A07", "How can I improve product conversion?"),
    ("A08", "How can I reduce customer churn?"),
]
INVESTIGATIONS = [
    ("I01", "How much revenue did I make yesterday?", investigation.INTENT_REVENUE),
    ("I02", "How many orders did we place last week?", investigation.INTENT_REVENUE),
    ("I03", "What is my checkout abandonment rate this month?", investigation.INTENT_CHECKOUT),
    ("I04", "How many customers bought twice in our store?", investigation.INTENT_CUSTOMERS),
    ("I05", "Which products are out of stock in my store?", investigation.INTENT_PRODUCTS),
    ("I06", "What refunds did we record last month?", investigation.INTENT_REFUNDS),
    ("I07", "What should I fix first in my store?", investigation.INTENT_FINDINGS),
    ("I08", "Is my Shopify sync working?", investigation.INTENT_COVERAGE),
]
CONTINUITY = [
    ("C01", "Why?", "inherit"),
    ("C02", "Continue", "inherit"),
    ("C03", "What about last week?", "inherit"),
    ("C04", "That's wrong", "correct"),
    ("C05", "Anyway, what is Shopify?", "knowledge"),
    ("C06", "Thanks", "social"),
    ("C07", "What about checkout?", "modelled_followup"),
    ("C08", "Change of subject: define AOV", "knowledge"),
]
PROVIDER_FAILURES = [
    ("P01", "missing_key"),
    ("P02", "auth_permanent"),
    ("P03", "unknown_model_permanent"),
    ("P04", "same_provider_transient_recovery"),
    ("P05", "explicit_cross_provider_recovery"),
    ("P06", "no_implicit_cross_provider_transfer"),
    ("P07", "grounding_compatibility"),
    ("P08", "bounded_exhaustion"),
]
ORCHESTRATION = [
    ("O01", "revenue", ["revenue"]),
    ("O02", "checkout", ["checkout"]),
    ("O03", "integration", ["integration"]),
    ("O04", "operational", ["operational"]),
    ("O05", "retention", ["retention"]),
    ("O06", "revenue_checkout", ["revenue", "checkout"]),
    ("O07", "three_domains", ["revenue", "checkout", "operational"]),
    ("O08", "bounded_specialist_retry", ["revenue"]),
]
SCENARIO_IDS = [case[0] for group in (GENERAL, ADVISORY, INVESTIGATIONS, CONTINUITY,
                                      PROVIDER_FAILURES, ORCHESTRATION) for case in group]

GENERAL_ANSWERS = {
    "G01": "Shopify is a commerce platform for operating an online store, including product catalogs, checkout, orders, and related administration workflows.",
    "G02": "Average order value is a sales measure divided by the corresponding order count. The sales definition, reporting period, currency, and order scope must match.",
    "G03": "Customer lifetime value estimates value associated with a customer over a defined relationship or observation window. Revenue-based lifetime value is not profit without cost and margin inputs.",
    "G04": "Conversion rate is the share of eligible visitors or sessions that complete a defined action, such as a purchase. State the numerator, denominator, attribution method, and period.",
    "G05": "Gross margin is net sales minus cost of goods sold, divided by net sales. Revenue records alone cannot establish it without valid product-cost inputs.",
    "G06": "An abandoned checkout is a checkout record not linked to a completed order in the available data. It does not prove a permanently lost sale or establish why the shopper left.",
    "G07": "Inventory turnover compares cost of goods sold with average inventory over a defined period. It needs a consistent cost basis and is not simply a unit count.",
    "G08": "Refund rate is the proportion of orders or sales refunded under a stated denominator and time window. The method and currency should be explicit.",
}
ADVISORY_ANSWERS = {
    "A01": "Make payment, delivery costs, and form steps clear before checkout, then test one change at a time against a defined completion measure.",
    "A02": "Review where shoppers leave, make total costs and delivery timing visible early, and test one change at a time. These are general ideas, not a diagnosis of your store.",
    "A03": "Make post-purchase service reliable, offer relevant replenishment or complementary products, and measure repeat behavior over a consistent cohort window.",
    "A04": "Consider relevant bundles or complementary products, but monitor contribution after discounts and costs rather than order value alone.",
    "A05": "Group refund reasons, review product descriptions and fulfillment issues, and avoid treating a short-lived increase as a trend without a fair comparison window.",
    "A06": "Use demand-aware replenishment and review stockout and excess-stock patterns by SKU. Turnover comparisons need a consistent period and cost basis.",
    "A07": "Improve product information and navigation, then test a focused change against a defined conversion denominator. Do not infer a cause without shopper evidence.",
    "A08": "Track repeat purchasing by cohort, identify where customers stop returning, and test service or re-engagement changes while respecting consent and measurement limits.",
}


def _fake_narrative_provider(monkeypatch, answer):
    """Fake only the external model boundary; keep Rev routing/composition live."""
    calls = []
    def generate(prompt, **kwargs):
        from src.intelligence.trace_context import correlation_id_var, execution_id_var
        call = {"prompt": prompt, **kwargs,
                "effective_correlation_id": kwargs.get("correlation_id") or correlation_id_var.get(),
                "effective_execution_id": kwargs.get("execution_id") or execution_id_var.get()}
        calls.append(call)
        return answer(prompt, kwargs) if callable(answer) else answer
    monkeypatch.setattr(model_gateway, "generate", generate)
    return calls


def _understanding(intent: str, *, requires_store: bool = False, domains=None):
    return understanding.Understanding(
        intent=intent, goal="answer the synthetic test question",
        requires_store_data=requires_store, requires_web=False, requires_action=False,
        response_mode="explanation", domains=list(domains or []), confidence=.95,
    )


def _with_no_provider_narrative(monkeypatch):
    monkeypatch.setenv("REV_NARRATIVE_LLM", "false")


def test_rev_acceptance_inventory_is_exactly_48_unique_named_scenarios():
    assert len(SCENARIO_IDS) == 48
    assert len(set(SCENARIO_IDS)) == 48


@pytest.mark.parametrize("case_id,message", GENERAL, ids=[case[0] for case in GENERAL])
def test_general_knowledge_scenario_has_an_answer_and_no_evidence_side_effects(case_id, message, monkeypatch):
    answer = GENERAL_ANSWERS[case_id]
    provider_calls = _fake_narrative_provider(monkeypatch, answer)
    tool_calls = []
    def forbidden_classifier(*args, **kwargs):
        raise AssertionError("a clear context-free definition must be routed deterministically")
    def track_tool(*args, **kwargs):
        tool_calls.append(args[0])
        raise AssertionError("general knowledge must not dispatch a store tool")
    monkeypatch.setattr(understanding, "understand", forbidden_classifier)
    monkeypatch.setattr(investigation, "run_tool", track_tool)
    correlation_id = "11111111-1111-4111-8111-111111111111"
    execution_id = "22222222-2222-4222-8222-222222222222"
    db = workspace_db()
    result = investigation.run_investigation(
        ORG, USER, message, db=db, now=NOW, persist=False,
        context_payload={"correlation_id": correlation_id, "execution_id": execution_id},
    )
    assert result["success"] is True and result["text"] == answer
    assert result["response_type"] == "chat"
    assert result["understanding"]["intent"] == investigation.INTENT_KNOWLEDGE
    assert result["understanding"]["source"] == "deterministic_knowledge"
    assert result["investigation"]["tools_used"] == [] and result["evidence"]["items"] == []
    assert result["orchestration"]["selected_specialists"] == []
    assert result["orchestration"]["execution_records"] == [] and tool_calls == []
    assert result["correlation_id"] == correlation_id and result["execution_id"] == execution_id
    assert len(provider_calls) == 1
    assert provider_calls[0]["role"] == "deep" and message in provider_calls[0]["prompt"]
    assert provider_calls[0]["correlation_id"] == correlation_id
    assert not any(statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))
                   for statement, _params in db.statements)


@pytest.mark.parametrize("case_id,message", ADVISORY, ids=[case[0] for case in ADVISORY])
def test_advisory_scenario_uses_real_composer_but_never_reuses_store_evidence(case_id, message, monkeypatch):
    answer = ADVISORY_ANSWERS[case_id]
    provider_calls = _fake_narrative_provider(monkeypatch, answer)
    tool_calls = []
    monkeypatch.setattr(understanding, "understand", lambda *a, **k: _understanding("strategy"))
    monkeypatch.setattr(investigation, "run_tool", lambda *a, **k: tool_calls.append(a[0]))
    prior = {"last_investigation": {"intent": investigation.INTENT_REVENUE,
                                   "start": "2026-10-01T00:00:00Z", "end": "2026-10-08T00:00:00Z",
                                   "period": {"start": "2026-10-01T00:00:00Z", "end": "2026-10-08T00:00:00Z"}}}
    correlation_id = "33333333-3333-4333-8333-333333333333"
    db = workspace_db()
    result = investigation.run_investigation(
        ORG, USER, message, conversation_id="77777777-7777-4777-8777-777777777777",
        db=db, now=NOW, persist=False,
        context_payload={"correlation_id": correlation_id,
                         "conversation_context": {"context_window": json.dumps(prior)}},
    )
    assert result["success"] is True and result["text"] == answer
    assert result["response_type"] == "chat"
    assert result["understanding"]["intent"] == "strategy"
    assert result["investigation"]["tools_used"] == [] and result["evidence"]["items"] == []
    assert result["orchestration"]["selected_specialists"] == []
    assert result["orchestration"]["execution_records"] == [] and tool_calls == []
    assert len(provider_calls) == 1
    assert message in provider_calls[0]["prompt"]
    assert "CONVERSATION CONTEXT (for continuity, not an authority source)" in provider_calls[0]["prompt"]
    assert provider_calls[0]["correlation_id"] == correlation_id
    assert not any(statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))
                   for statement, _params in db.statements)


def test_provider_exhaustion_in_general_knowledge_runtime_is_typed_and_never_returns_success(monkeypatch, caplog):
    error = model_gateway.ModelProviderError(
        "anthropic", "missing_key", category="provider_unavailable",
        attempts=2, fallback_used=True,
    )
    def exhausted(*_args, **_kwargs):
        raise error
    monkeypatch.setattr(model_gateway, "generate", exhausted)
    tools = []
    monkeypatch.setattr(investigation, "run_tool", lambda *args, **kwargs: tools.append(args[0]))
    db = workspace_db()
    correlation_id = "88888888-8888-4888-8888-888888888888"
    execution_id = "99999999-9999-4999-8999-999999999999"
    with pytest.raises(model_gateway.ModelProviderError) as caught:
        investigation.run_investigation(
            ORG, USER, "What is Shopify?", db=db, now=NOW, persist=False,
            context_payload={"correlation_id": correlation_id, "execution_id": execution_id},
        )
    assert caught.value is error
    assert caught.value.failure["category"] == "provider_unavailable"
    assert caught.value.failure["retryable"] is True
    assert caught.value.correlation_id == correlation_id
    assert caught.value.execution_id == execution_id
    assert tools == [], "general knowledge must fail before store retrieval rather than return unrelated prose"
    assert "private prompt" not in caplog.text
    assert not any(statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))
                   for statement, _params in db.statements)


@pytest.mark.parametrize("case_id,message,expected_intent", INVESTIGATIONS,
                         ids=[case[0] for case in INVESTIGATIONS])
def test_investigation_scenario_retrieves_scoped_evidence_and_composes_valid_output(
    case_id, message, expected_intent, monkeypatch,
):
    _with_no_provider_narrative(monkeypatch)
    real_run_tool = investigation.run_tool
    calls = []
    def tracked_tool(tool, organization_id, db, params=None, *, now=None):
        calls.append({"tool": tool, "organization_id": organization_id, "params": dict(params or {})})
        return real_run_tool(tool, organization_id, db, params, now=now)
    monkeypatch.setattr(investigation, "run_tool", tracked_tool)
    db = workspace_db()
    result = investigation.run_investigation(
        ORG, USER, message, db=db, now=NOW, persist=False,
        context_payload={"correlation_id": "33333333-3333-4333-8333-333333333333",
                         "execution_id": "44444444-4444-4444-8444-444444444444"},
    )
    expected_tool = {
        "I01": "revenue_observations", "I02": "revenue_observations",
        "I03": "checkout_observations", "I04": "customer_observations",
        "I05": "product_observations", "I06": "refund_observations",
        "I07": "findings", "I08": "data_coverage",
    }[case_id]
    assert result["success"] is True and result["read_only"] is True
    assert result["investigation"]["intent"] == expected_intent
    assert expected_tool in {call["tool"] for call in calls}
    assert set(result["investigation"]["tools_used"]) == {call["tool"] for call in calls}
    assert all(call["organization_id"] == ORG for call in calls)
    assert all(call["params"].get("start") and call["params"].get("end")
               for call in calls if call["tool"] != "store_health")
    assert result["evidence"]["items"]
    assert result["evidence"]["validation"]["valid"] is True
    assert result["text"].strip() and result["response"]["sections"]
    assert result["execution_id"] == "44444444-4444-4444-8444-444444444444"
    assert result["investigation_outcome"]["outcome"] in {
        "success", "partial_success", "insufficient_evidence", "insufficient_history",
        "retrieval_failed", "integration_disconnected", "permission_insufficient",
        "unsupported_capability",
    }
    assert not any(statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))
                   for statement, _params in db.statements)


def _prior_context_window():
    prior_period = {
        "start": "2026-10-01T00:00:00Z", "end": "2026-10-08T00:00:00Z",
        "label": "Prior measured week", "timezone": "UTC",
    }
    claim = {
        "contract_version": CLAIM_CONTRACT_VERSION, "claim_id": "prior-revenue-claim",
        "classification": "verified_fact", "causal_status": "observed",
        "text": "Recorded revenue was USD 30.31.", "metric": "recorded_order_value",
        "value": 30.31, "unit": "currency", "currency": "USD",
        "period": prior_period, "evidence_ids": ["prior-evidence"],
        "organization_id": ORG, "store_ids": ["store-a1"],
        "source_investigation": "prior-investigation",
    }
    return {
        "last_investigation": {
            "id": "prior-investigation", "intent": investigation.INTENT_REVENUE,
            "status": "complete", "period": prior_period,
        },
        "last_claims": [claim],
    }


@pytest.mark.parametrize("case_id,message,expected", CONTINUITY, ids=[case[0] for case in CONTINUITY])
def test_continuity_scenario_preserves_or_resets_only_the_intended_context(case_id, message, expected, monkeypatch):
    _with_no_provider_narrative(monkeypatch)
    context_payload = {"conversation_context": {"context_window": json.dumps(_prior_context_window())}}
    expected_answer = None
    if case_id in {"C05", "C08"}:
        final_answer = GENERAL_ANSWERS["G01" if case_id == "C05" else "G02"]
        expected_answer = final_answer
        def answer(prompt, _kwargs):
            if "understanding layer of rev" in prompt.lower():
                return json.dumps({
                    "intent": "knowledge", "goal": "explain the general commerce concept",
                    "requires_store_data": False, "requires_web": False,
                    "requires_action": False, "response_mode": "explanation",
                    "entities": {}, "domains": [], "urgency": "low", "confidence": 0.95,
                })
            return final_answer
    elif case_id == "C06":
        answer = "You're welcome."
    elif case_id == "C04":
        answer = "Thanks for flagging that. I will check the earlier figure again."
    else:
        answer = None
    provider_calls = _fake_narrative_provider(monkeypatch, answer) if answer is not None else []
    real_run_tool = investigation.run_tool
    calls = []
    def tracked_tool(tool, organization_id, db, params=None, *, now=None):
        calls.append({"tool": tool, "organization_id": organization_id, "params": dict(params or {})})
        return real_run_tool(tool, organization_id, db, params, now=now)
    monkeypatch.setattr(investigation, "run_tool", tracked_tool)
    correlation_id = "44444444-4444-4444-8444-444444444444"
    execution_id = "55555555-5555-4555-8555-555555555555"
    db = workspace_db()
    result = investigation.run_investigation(
        ORG, USER, message, conversation_id="77777777-7777-4777-8777-777777777777",
        db=db, now=NOW, persist=False,
        context_payload={**context_payload, "correlation_id": correlation_id,
                         "execution_id": execution_id},
    )

    assert result["correlation_id"] == correlation_id and result["execution_id"] == execution_id
    if expected in {"inherit", "correct", "modelled_followup"}:
        if case_id != "C04":
            assert result["investigation"]["intent"] == investigation.INTENT_REVENUE
            assert "revenue_observations" in {call["tool"] for call in calls}
            assert result["evidence"]["validation"]["valid"] is True
        if case_id in {"C01", "C02"}:
            assert result["investigation"]["period"]["start"] == "2026-10-01T00:00:00Z"
            assert result["investigation"]["period"]["end"] == "2026-10-08T00:00:00Z"
        if case_id == "C03":
            assert result["investigation"]["period"]["label"] == "Previous calendar week"
        if case_id == "C04":
            assert "superseded" in result["text"].lower()
            assert result["corrections"]["superseded"]["superseded"] is True
            assert any("UPDATE merchant_memories" in statement
                       for statement, _params in db.statements)
            assert calls == [], "a correction retracts old context without launching another evidence query"
        if case_id == "C07":
            assert result["question_understanding"]["required_domains"] == ["revenue", "checkout"]
            assert "checkout_observations" in {call["tool"] for call in calls}
            assert "revenue_observations" in {call["tool"] for call in calls}
    elif expected == "knowledge":
        assert result["response_type"] == "chat"
        assert result["understanding"]["intent"] == investigation.INTENT_KNOWLEDGE
        assert result["orchestration"]["execution_records"] == []
        assert calls == [] and result["evidence"]["items"] == []
        assert result["text"] == expected_answer
        assert any(call.get("role") == "deep" for call in provider_calls)
    else:
        assert expected == "social"
        assert result["response_type"] == "chat"
        assert result["text"] == answer and len(provider_calls) == 1
        assert calls == [] and result["evidence"]["items"] == []
    if provider_calls:
        assert all(call["effective_correlation_id"] == correlation_id for call in provider_calls)
        assert any(message in call["prompt"] for call in provider_calls)
    assert not any(statement.lstrip().upper().startswith(("INSERT", "DELETE"))
                   for statement, _params in db.statements)
    if case_id != "C04":
        assert not any(statement.lstrip().upper().startswith("UPDATE")
                       for statement, _params in db.statements)


def _fake_anthropic(monkeypatch, behavior):
    calls = []
    def create(**kwargs):
        calls.append(kwargs)
        return behavior(kwargs, len(calls))
    class FakeClient:
        def __init__(self, **kwargs):
            self.messages = SimpleNamespace(create=create)
    monkeypatch.setitem(sys.modules, "anthropic", SimpleNamespace(Anthropic=FakeClient))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test-key")
    return calls


def _fake_gemini(monkeypatch, behavior):
    calls = []
    class FakeHTTP:
        def __init__(self, **kwargs): self.timeout = kwargs["timeout"]
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def post(self, url, **kwargs):
            calls.append((url, kwargs, self.timeout))
            return behavior(url, kwargs, len(calls))
    monkeypatch.setattr(model_gateway.httpx, "Client", FakeHTTP)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-test-key")
    return calls


def _anthropic_error(status):
    error = RuntimeError("must never expose private user prompt")
    error.status_code = status
    return error


@pytest.mark.parametrize("case_id,policy", PROVIDER_FAILURES, ids=[case[0] for case in PROVIDER_FAILURES])
def test_provider_failure_scenario_obeys_privacy_retry_and_task_contract(case_id, policy, monkeypatch, caplog):
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("AI_FALLBACK_PROVIDERS", raising=False)
    monkeypatch.delenv("ANTHROPIC_FALLBACK_MODEL", raising=False)
    gemini_calls = []
    anthro_calls = []

    if policy == "missing_key":
        monkeypatch.setenv("GEMINI_API_KEY", "gemini-test-key")
        with pytest.raises(model_gateway.ModelProviderError) as caught:
            model_gateway.generate("private prompt")
        assert caught.value.category == "provider_unavailable" and gemini_calls == []
    elif policy in {"auth_permanent", "unknown_model_permanent"}:
        status = 401 if policy == "auth_permanent" else 404
        monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test-key")
        monkeypatch.setenv("GEMINI_API_KEY", "gemini-test-key")
        monkeypatch.setenv("AI_FALLBACK_PROVIDERS", "gemini")
        _fake_anthropic(monkeypatch, lambda _request, _n: (_ for _ in ()).throw(_anthropic_error(status)))
        with pytest.raises(model_gateway.ModelProviderError) as caught:
            model_gateway.generate("private prompt")
        assert caught.value.category == ("authorization_failed" if status == 401 else "invalid_request")
        assert caught.value.attempts == 1 and caught.value.fallback_used is False
    elif policy == "same_provider_transient_recovery":
        monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test-key")
        monkeypatch.setenv("ANTHROPIC_FALLBACK_MODEL", "claude-fallback-test")
        def primary(request, number):
            if number == 1: raise _anthropic_error(503)
            return SimpleNamespace(content=[SimpleNamespace(type="text", text="Recovered")], stop_reason="end_turn")
        calls = _fake_anthropic(monkeypatch, primary)
        assert model_gateway.generate("private prompt") == "Recovered"
        assert len(calls) == 2 and calls[1]["model"] == "claude-fallback-test"
    elif policy == "explicit_cross_provider_recovery":
        monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test-key")
        monkeypatch.setenv("GEMINI_API_KEY", "gemini-test-key")
        monkeypatch.setenv("AI_FALLBACK_PROVIDERS", "gemini")
        calls = _fake_anthropic(monkeypatch, lambda _request, _n: (_ for _ in ()).throw(_anthropic_error(503)))
        gemini_calls = _fake_gemini(monkeypatch, lambda *_: SimpleNamespace(status_code=200, json=lambda: {
            "candidates": [{"content": {"parts": [{"text": "Recovered"}]}}]}))
        assert model_gateway.generate("private prompt") == "Recovered"
        assert len(calls) == len(gemini_calls) == 1
    elif policy == "no_implicit_cross_provider_transfer":
        monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test-key")
        monkeypatch.setenv("GEMINI_API_KEY", "gemini-test-key")
        calls = _fake_anthropic(monkeypatch, lambda _request, _n: (_ for _ in ()).throw(_anthropic_error(503)))
        with pytest.raises(model_gateway.ModelProviderError):
            model_gateway.generate("private prompt")
        assert len(calls) == 1 and gemini_calls == []
    elif policy == "grounding_compatibility":
        monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test-key")
        monkeypatch.setenv("GEMINI_API_KEY", "gemini-test-key")
        monkeypatch.setenv("AI_FALLBACK_PROVIDERS", "gemini")
        anthro_calls = _fake_anthropic(monkeypatch, lambda request, _n: (_ for _ in ()).throw(AssertionError("ungrounded provider called")))
        gemini_calls = _fake_gemini(monkeypatch, lambda *_: SimpleNamespace(status_code=200, json=lambda: {
            "candidates": [{"content": {"parts": [{"text": "Verified result"}]},
                            "groundingMetadata": {"groundingChunks": []}}]}))
        answer = model_gateway.generate("current market guidance", web_search=True)
        assert "Verified result" in answer and anthro_calls == []
        assert gemini_calls[0][1]["json"]["tools"] == [{"google_search": {}}]
    else:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test-key")
        monkeypatch.setenv("GEMINI_API_KEY", "gemini-test-key")
        monkeypatch.setenv("AI_FALLBACK_PROVIDERS", "gemini")
        _fake_anthropic(monkeypatch, lambda _request, _n: (_ for _ in ()).throw(_anthropic_error(503)))
        gemini_calls = _fake_gemini(monkeypatch, lambda *_: SimpleNamespace(status_code=503))
        with pytest.raises(model_gateway.ModelProviderError) as caught:
            model_gateway.generate("private prompt", timeout=3)
        assert caught.value.category == "provider_unavailable"
        assert caught.value.attempts == 2 and caught.value.fallback_used is True
        assert len(gemini_calls) == 1 and gemini_calls[0][2].read <= 1.6
    assert "private prompt" not in caplog.text
    assert "anthropic-test-key" not in caplog.text and "gemini-test-key" not in caplog.text


def _orchestration_plan(domains, *, available=None, intent=None):
    window = period(NOW - timedelta(days=7), NOW, timezone_label="UTC")
    tools = available or {
        "store_health", "integration_health", "data_coverage", "revenue_observations",
        "order_observations", "checkout_observations", "customer_observations",
        "product_observations", "inventory_observations", "refund_observations", "findings",
    }
    intent = intent or {
        "revenue": "revenue_investigation", "checkout": "checkout_investigation",
        "integration": "data_coverage", "operational": "product_investigation",
        "retention": "customer_retention",
    }[domains[0]]
    return build_investigation_plan(
        message="Synthetic merchant question", intent=intent,
        understanding={"required_domains": domains, "primary_intent": intent},
        investigation_id="55555555-5555-4555-8555-555555555555",
        organization_id=ORG, store_ids=["66666666-6666-4666-8666-666666666666"],
        period=window, available_tools=tools,
    )


@pytest.mark.parametrize("case_id,plan_kind,domains", ORCHESTRATION,
                         ids=[case[0] for case in ORCHESTRATION])
def test_orchestration_scenario_executes_only_selected_domains_and_reconciles(case_id, plan_kind, domains):
    plan = _orchestration_plan(domains)
    assert plan["tenant"]["organization_id"] == ORG
    assert plan["tenant"]["store_ids"] == ["66666666-6666-4666-8666-666666666666"]
    assert plan["question_understanding"]["required_domains"] == domains
    assert [task["domain"] for task in plan["tasks"]] == domains
    assert len(plan["tools"]) == len(set(plan["tools"]))
    assert plan["overall_deadline_ms"] > 0 and plan["max_transient_retries"] <= 1
    selected = list(plan["selected_specialists"])
    calls_by_specialist = {}
    def execute(**kwargs):
        name = kwargs["selected"][0]
        calls_by_specialist[name] = calls_by_specialist.get(name, 0) + 1
        if plan_kind == "bounded_specialist_retry" and calls_by_specialist[name] == 1:
            raise ConnectionError("synthetic transient specialist error")
        return [{"status": "success", "execution_id": f"synthetic-{case_id}-{name}",
                 "investigation_id": kwargs["investigation_id"],
                 "specialist": {"name": name}, "evidence_references": [],
                 "verified_facts": [], "calculated_findings": [], "hypotheses": []}]

    specialist_results = execute_orchestrated_specialists(
        plan, period=plan["period"], items=[], tools={}, executor=execute,
    )
    assert set(calls_by_specialist) == set(selected)
    if plan_kind == "bounded_specialist_retry":
        assert selected == ["revenue"] and calls_by_specialist == {"revenue": 2}
        assert next(task for task in plan["tasks"] if task["specialist"] == "revenue")["attempts"] == 2
    else:
        assert all(attempts == 1 for attempts in calls_by_specialist.values())
    assert len(specialist_results) == len(selected)
    assert all(result["status"] == "success" for result in specialist_results)

    # Domain-only tasks are closed from synthetic successful evidence-tool
    # outcomes, then specialist outputs are reconciled by the production code.
    domain_tools = {tool: SimpleNamespace(status="available") for tool in plan["tools"]}
    record_domain_evidence_execution(plan, domain_tools)
    reconcile_orchestration(plan, specialist_results, [], finalize=True)
    assert plan["state"] == "completed"
    assert {record["domain"] for record in plan["execution_records"]} == set(domains)
    assert all(record["status"] == "completed" for record in plan["execution_records"])
    assert plan["reconciliation"]["hypotheses_promoted_to_facts"] == 0
    assert validate_orchestration(plan, organization_id=ORG, evidence_ids=set()) == []


def test_orchestration_permanent_specialist_failure_is_not_retried_or_promoted():
    plan = _orchestration_plan(["revenue"])
    calls = []
    def permanent_failure(**_kwargs):
        calls.append("revenue")
        raise ValueError("private prompt and provider payload must not be retained")
    results = execute_orchestrated_specialists(
        plan, period=plan["period"], items=[], tools={}, executor=permanent_failure,
    )
    assert calls == ["revenue"], "permanent specialist failure must not consume the transient retry"
    assert len(results) == 1 and results[0]["status"] == "error"
    assert results[0]["diagnostics"] == {
        "error_class": "ValueError", "read_only": True, "retry_eligible": False,
    }
    assert results[0]["verified_facts"] == [] and results[0]["calculated_findings"] == []
    assert "private prompt" not in json.dumps(results)
    reconcile_orchestration(plan, results, [], finalize=True)
    assert plan["state"] == "partial_success"
    assert "revenue_specialist_failed" in plan["reconciliation"]["unresolved"]
    assert plan["reconciliation"]["hypotheses_promoted_to_facts"] == 0
