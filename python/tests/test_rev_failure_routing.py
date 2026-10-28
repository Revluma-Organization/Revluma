"""Regression tests for Rev's production merchant-evidence routing and safe fallbacks."""
from types import SimpleNamespace

from src.agents.understanding import _safe_fallback
from src.agents import responder

QUESTION = (
    "What do you currently know about my connected store? Tell me which "
    "findings are verified, what evidence supports them, and what information "
    "is still unavailable."
)


def test_merchant_evidence_question_requires_store_analysis():
    u = _safe_fallback(QUESTION, [], "provider unavailable")
    assert u.requires_store_data is True
    assert u.requires_web is False
    assert u.intent == "diagnosis"
    assert u.response_mode == "analysis"


def test_generic_question_remains_conversational():
    u = _safe_fallback("Hello there", [], "provider unavailable")
    assert u.requires_store_data is False
    assert u.response_mode == "conversational"


def test_provider_failure_does_not_return_misleading_small_talk(monkeypatch):
    def unavailable(*args, **kwargs):
        raise RuntimeError("private-customer@example.com")

    monkeypatch.setattr(responder, "_call", unavailable)
    reply = responder.compose_conversational(
        "Please explain what is happening in my store",
        SimpleNamespace(intent="casual", goal="conversation"),
        "", [], True,
    )
    assert "temporarily unable to generate a response" in reply
    assert "What do you want to look at?" not in reply
    assert "private-customer@example.com" not in reply


def test_known_greeting_still_has_safe_fallback():
    u = SimpleNamespace(intent="greeting")
    assert "temporarily unable" in responder._static_conversational("hello", u)


def test_analysis_validator_accepts_zero_optional_actions():
    from src.agents.orchestrator import _validate_analysis_response
    response = {
        "situation": "No verified finding is available in the supplied evidence.",
        "insight": "The available context does not establish complete coverage.",
        "implication": "Store performance cannot be confirmed from this evidence.",
        "recommendation": "Check the latest sync status before relying on metrics.",
        "confidence": {"score": 0.3, "basis": "Limited verified data"},
        "actions": [],
    }
    assert _validate_analysis_response(
        response, evidence_values=set(), known_entities=set()
    ) == []


def test_web_research_does_not_forward_private_history_or_memories(monkeypatch):
    captured = []
    from src.agents import model_gateway
    def fake_generate(prompt, **kwargs):
        captured.append((prompt, kwargs))
        return "Verified public research."
    monkeypatch.setattr(model_gateway, "generate", fake_generate)
    reply = responder.compose_web_research(
        "What is the latest ecommerce trend?",
        SimpleNamespace(intent="research"),
        "PRIVATE ORDER 12345: customer@example.com",
        [{"memory_key": "customer", "memory_value": "private-secret"}],
    )
    assert reply == "Verified public research."
    assert "PRIVATE ORDER" not in captured[0][0]
    assert "customer@example.com" not in captured[0][0]
    assert "private-secret" not in captured[0][0]
    assert captured[0][1]["web_search"] is True
