import json
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock

from src.agents import orchestrator as orchestrator_module
from src.agents.base_agent import AgentResult
from src.agents.revenue_agent import RevenueAgent
from src.agents.orchestrator import (
    AGENT_OUTPUT_FIELDS,
    _build_context_json,
    _classify_orchestrator_mode,
    _is_ad_evaluation_request,
    _normalize_context_payload,
    _persist_messages,
    _resolve_contradictions,
    _run_specialists,
    _select_relevant_memories,
    _standardize_agent_result,
    _trigger_requires_store_data,
    _validate_analysis_response,
)


def _understanding(**overrides):
    values = {
        "intent": "diagnosis",
        "response_mode": "analysis",
        "requires_action": False,
        "goal": "understand performance",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _result(agent="revenue", recommendations=None):
    return AgentResult(
        agent=agent,
        status="success",
        confidence=0.8,
        facts=[{"metric": "revenue_today", "value": 120.0, "source": "orders"}],
        signals=[],
        diagnosis=[],
        opportunities=[],
        recommendations=recommendations or [],
        data_sources=["orders.total"],
        warnings=[],
    )


def test_seven_orchestrator_modes_are_classified_from_trigger_and_intent():
    assert _classify_orchestrator_mode(_understanding(), "alert", "") == "Analyst"
    assert _classify_orchestrator_mode(_understanding(), "scheduler", "morning") == "Briefing"
    assert _classify_orchestrator_mode(
        _understanding(intent="strategy"), "conversation", "what should I do"
    ) == "Strategist"
    assert _classify_orchestrator_mode(
        _understanding(intent="action", requires_action=True), "conversation", "do it"
    ) == "Operator"
    assert _classify_orchestrator_mode(
        _understanding(intent="knowledge", response_mode="explanation"),
        "conversation",
        "explain this",
    ) == "Teacher"
    assert _classify_orchestrator_mode(
        _understanding(intent="forecast"), "conversation", "what will happen"
    ) == "Forecaster"
    assert _classify_orchestrator_mode(
        _understanding(intent="strategy"), "conversation", "what if prices rise"
    ) == "Simulator"


def test_alert_and_scheduler_triggers_always_require_business_state():
    conversational = _understanding(requires_store_data=False)

    assert _trigger_requires_store_data(conversational, "scheduler") is True
    assert _trigger_requires_store_data(conversational, "alert") is True
    assert _trigger_requires_store_data(conversational, "conversation") is False


def test_explicit_creative_review_routes_only_when_an_image_is_complete():
    understanding = _understanding(
        intent="creative_review",
        domains=["marketing"],
    )

    assert _is_ad_evaluation_request(
        understanding,
        "Review this creative",
        "encoded-image",
        "image/png",
        "conversation",
    )
    assert not _is_ad_evaluation_request(
        understanding,
        "Review this creative",
        "encoded-image",
        None,
        "conversation",
    )
    assert not _is_ad_evaluation_request(
        understanding,
        "Review this creative",
        "encoded-image",
        "image/png",
        "scheduler",
    )
    non_ad_understanding = _understanding(intent="metrics", domains=["revenue"])
    assert not _is_ad_evaluation_request(
        non_ad_understanding,
        "I uploaded a revenue chart",
        "encoded-image",
        "image/png",
        "conversation",
    )


def test_ad_review_image_reaches_ad_agent_and_returns_structured_output(monkeypatch):
    understanding = _understanding(
        intent="creative_review",
        response_mode="explanation",
        requires_store_data=False,
        requires_web=False,
        domains=["marketing"],
        entities={},
        confidence=0.95,
    )
    captured = {}
    evaluation = {
        "composite_score": 0.76,
        "verdict": "Strong",
        "top_priority": "Make the call to action more prominent.",
    }

    monkeypatch.setattr(
        orchestrator_module,
        "_get_or_create_conversation",
        lambda *_args: ("conversation-1", False),
    )
    monkeypatch.setattr(orchestrator_module, "_load_history", lambda *_args: [])
    monkeypatch.setattr(orchestrator_module, "_load_memories", lambda *_args: [])
    monkeypatch.setattr(
        orchestrator_module,
        "understand",
        lambda *_args, **kwargs: captured.update(kwargs) or understanding,
    )
    monkeypatch.setattr(orchestrator_module, "_persist_messages", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        orchestrator_module,
        "evaluate_ad",
        lambda **kwargs: captured.update(kwargs) or SimpleNamespace(
            to_dict=lambda: evaluation
        ),
    )

    result = orchestrator_module._run(
        "organization-1",
        "user-1",
        "Review this ad creative",
        None,
        MagicMock(),
        "correlation-1",
        image_base64="encoded-image",
        image_media_type="image/png",
    )

    assert captured["image_base64"] == "encoded-image"
    assert captured["image_media_type"] == "image/png"
    assert result.response_type == "ad_evaluation"
    assert result.agents_used == ["ad"]
    assert result.ad_evaluation == evaluation
    assert "76% composite score" in result.text


def test_agent_result_is_normalized_to_the_exact_six_field_schema():
    output = _standardize_agent_result(
        _result(recommendations=[{"action": "view_revenue"}])
    )

    assert tuple(output) == AGENT_OUTPUT_FIELDS
    assert output["domain"] == "revenue"
    assert isinstance(output["findings"], str)
    assert output["recommended_action"] == "view_revenue"
    assert output["evidence_references"] == ["orders.total"]
    assert output["contradictions_detected"] == []


def test_revenue_agent_exposes_the_exact_six_field_schema():
    state = SimpleNamespace(revenue_today=None, revenue_yesterday=None)

    output = RevenueAgent().structured_output(state, [], "revenue status")

    assert tuple(output) == AGENT_OUTPUT_FIELDS
    assert output["domain"] == "revenue"
    assert isinstance(output["findings"], str)


def test_revenue_failure_does_not_expose_exception_text(caplog, monkeypatch):
    agent = RevenueAgent()
    monkeypatch.setattr(
        agent,
        "_analyze",
        lambda *_args: (_ for _ in ()).throw(
            RuntimeError("private-customer@example.com")
        ),
    )

    result = agent.analyze(SimpleNamespace(), [], "status")

    assert result.status == "error"
    assert "private-customer@example.com" not in caplog.text
    assert "private-customer@example.com" not in " ".join(result.warnings)


def test_trigger_context_is_bounded_and_removes_sensitive_values():
    payload = {
        "alert_id": "alert-123",
        "metric": "revenue_delta_pct",
        "value": -12.5,
        "api_token": "must-not-leave-the-boundary",
        "email": "private-customer@example.com",
        "nested": {"priority_reason": "Anomaly threshold exceeded"},
    }

    normalized = _normalize_context_payload(payload)

    assert normalized["alert_id"] == "alert-123"
    assert normalized["value"] == -12.5
    assert "api_token" not in normalized
    assert "email" not in normalized
    assert "must-not-leave-the-boundary" not in json.dumps(normalized)
    assert "private-customer@example.com" not in json.dumps(normalized)


def test_relevant_memory_selection_keeps_constraints_and_matches_context():
    memories = [
        {
            "memory_key": "never_recommend_discounts",
            "memory_value": True,
            "memory_type": "user",
            "authority_level": 5,
            "importance": 5,
            "is_active": True,
        },
        {
            "memory_key": "email_recovery_underperformed",
            "memory_value": {"outcome": "underperformed"},
            "memory_type": "strategic",
            "authority_level": 3,
            "importance": 4,
            "is_active": True,
        },
        {
            "memory_key": "warehouse_layout",
            "memory_value": "aisle seven",
            "memory_type": "semantic",
            "authority_level": 2,
            "importance": 2,
            "is_active": True,
        },
    ]

    selected = _select_relevant_memories(
        memories,
        "Why did the email recovery campaign underperform?",
        {"channel": "email"},
        top_k=2,
    )

    assert [memory["memory_key"] for memory in selected] == [
        "never_recommend_discounts",
        "email_recovery_underperformed",
    ]


def test_context_package_contains_safe_trigger_metadata_and_business_state():
    state = SimpleNamespace(to_dict=lambda: {"revenue_today": 240.0})

    context = json.loads(
        _build_context_json(
            state,
            "alert",
            "high",
            {"metric": "revenue_today", "value": 240.0, "password": "hidden"},
        )
    )

    assert context["trigger"] == {
        "type": "alert",
        "priority": "high",
        "payload": {"metric": "revenue_today", "value": 240.0},
    }
    assert context["business_state"]["revenue_today"] == 240.0


def test_specialists_run_concurrently_and_intelligence_is_always_included(monkeypatch):
    barrier = threading.Barrier(3)
    thread_ids = []

    class FakeAgent:
        def __init__(self, name):
            self.name = name

        def analyze(self, _state, _memories, _question):
            thread_ids.append(threading.get_ident())
            barrier.wait(timeout=2)
            return _result(self.name)

    agents = {
        "revenue": FakeAgent("revenue"),
        "retention": FakeAgent("retention"),
        "intelligence": FakeAgent("intelligence"),
    }

    rich, outputs = _run_specialists(
        ["revenue", "retention"],
        SimpleNamespace(),
        [],
        "status",
        agents=agents,
    )

    assert {result.agent for result in rich} == {
        "revenue",
        "retention",
        "intelligence",
    }
    assert len(set(thread_ids)) == 3
    assert all(tuple(output) == AGENT_OUTPUT_FIELDS for output in outputs)


def test_internal_discount_conflict_blocks_the_action():
    result = _result(
        "retention",
        [{"action": "send_discount", "params": {"use_discount": True}}],
    )
    memories = [
        {
            "memory_key": "never_recommend_discounts",
            "memory_value": True,
            "authority_level": 5,
            "is_active": True,
        }
    ]

    resolved, codes, disclosures = _resolve_contradictions([result], memories)

    assert resolved[0].recommendations == []
    assert "INTERNAL_CONSTRAINT_DISCOUNT" in codes
    assert disclosures == []


def test_historical_conflict_adds_a_disclosure():
    result = _result(
        "retention",
        [{"action": "vip_reengagement", "params": {"use_discount": False}}],
    )
    memories = [
        {
            "memory_type": "reflection",
            "memory_key": "failed_action",
            "memory_value": {
                "action": "vip_reengagement",
                "outcome": "underperformed",
            },
            "is_active": True,
        }
    ]

    _resolved, codes, disclosures = _resolve_contradictions([result], memories)

    assert "HISTORICAL_ACTION_UNDERPERFORMED" in codes
    assert any("past" in disclosure.lower() for disclosure in disclosures)


def test_cross_agent_discount_conflict_has_a_resolution_disclosure():
    target = {"customer_id": "customer-1"}
    retention = _result(
        "retention",
        [{"action": "winback", "params": {**target, "use_discount": True}}],
    )
    customer = _result(
        "customer",
        [{"action": "outreach", "params": {**target, "use_discount": False}}],
    )

    _resolved, codes, disclosures = _resolve_contradictions(
        [retention, customer],
        [],
    )

    assert "CROSS_AGENT_DISCOUNT_CONFLICT" in codes
    assert any("higher-confidence" in disclosure for disclosure in disclosures)


def test_response_verifier_rejects_invented_numbers_pii_and_invalid_actions():
    response = {
        "situation": "Revenue is $999 for private@example.com.",
        "insight": "Performance changed.",
        "implication": "Revenue may decline.",
        "recommendation": "Review it.",
        "confidence": {"score": 0.8, "basis": "Current store evidence"},
        "actions": [{"label": "Run", "tool": "invented_tool", "params": {}}],
    }

    errors = _validate_analysis_response(
        response,
        evidence_values={120.0},
        known_entities=set(),
    )

    assert "invented_number" in errors
    assert "pii_detected" in errors
    assert "invalid_action_count" in errors
    assert "invalid_action_tool" in errors


def test_valid_six_part_response_passes_self_verification():
    response = {
        "situation": "Revenue is $120 today.",
        "insight": "Current order evidence supports the result.",
        "implication": "No immediate revenue risk is evident.",
        "recommendation": "Review the revenue detail before acting.",
        "confidence": {"score": 0.8, "basis": "Current store evidence"},
        "actions": [
            {"label": "View revenue", "tool": "view_revenue", "params": {}},
            {"label": "View analytics", "tool": "view_analytics", "params": {}},
        ],
    }

    assert _validate_analysis_response(
        response,
        evidence_values={120.0},
        known_entities=set(),
    ) == []


def test_message_pair_and_conversation_count_commit_atomically():
    db = MagicMock()
    db.execute.return_value.fetchone.return_value = (4,)

    _persist_messages(
        "conversation-1",
        "organization-1",
        "user-1",
        "merchant message",
        json.dumps({"situation": "Verified response"}),
        "analysis",
        ["revenue", "intelligence"],
        db,
        title_hint="Revenue status",
        orchestrator_mode="Analyst",
        confidence_score=0.8,
        business_state_id="state-1",
        correlation_id="correlation-1",
    )

    assert db.execute.call_count == 3
    select_sql = str(db.execute.call_args_list[0].args[0])
    insert_sql = str(db.execute.call_args_list[1].args[0])
    insert_params = db.execute.call_args_list[1].args[1]
    update_sql = str(db.execute.call_args_list[2].args[0])
    assert "FOR UPDATE" in select_sql
    assert "organization_id" in insert_sql
    assert "user_id" in insert_sql
    assert insert_params["seq1"] == 5
    assert insert_params["seq2"] == 6
    assert "message_count = :message_count" in update_sql
    db.commit.assert_called_once()
    db.rollback.assert_not_called()
