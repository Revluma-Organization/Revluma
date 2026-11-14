"""Regression coverage for the retained /orchestrate compatibility path."""
from __future__ import annotations

import pytest

from src.agents import orchestrator
from src.agents.model_gateway import ModelProviderError
from src.intelligence.operational_metrics import reset_for_tests, snapshot
from src.intelligence.trace_context import correlation_id_var, execution_id_var

CORRELATION = "11111111-1111-4111-8111-111111111111"
EXECUTION = "22222222-2222-4222-8222-222222222222"


def test_orchestrator_preserves_trace_through_legacy_runtime_and_reports_metadata(monkeypatch):
    reset_for_tests()
    seen = {}

    def fake_run(*args, **kwargs):
        seen["trace"] = (correlation_id_var.get(), execution_id_var.get())
        seen["payload"] = kwargs["context_payload"]
        return orchestrator.OrchestrationResult(
            success=True, conversation_id="33333333-3333-4333-8333-333333333333",
            message_id="44444444-4444-4444-8444-444444444444",
            response_type="chat", intent="knowledge", text="A concise answer.",
        )

    monkeypatch.setattr(orchestrator, "_run", fake_run)
    result = orchestrator.orchestrate(
        "55555555-5555-4555-8555-555555555555",
        "66666666-6666-4666-8666-666666666666",
        "What does this term mean?", None, object(),
        context_payload={}, correlation_id=CORRELATION, execution_id=EXECUTION,
    )

    payload = result.to_dict()
    assert seen["trace"] == (CORRELATION, EXECUTION)
    assert seen["payload"]["correlation_id"] == CORRELATION
    assert seen["payload"]["execution_id"] == EXECUTION
    assert payload["correlation_id"] == CORRELATION
    assert payload["execution_id"] == EXECUTION
    assert payload["execution_metadata"]["outcome"] == "success"
    counters = snapshot()["counters"]
    assert any(c["name"] == "rev_requests_total" and c["labels"]["outcome"] == "success" for c in counters)
    assert any(c["name"] == "rev_general_questions_total" for c in counters)


def test_legacy_orchestrator_propagates_typed_provider_failure_with_trace_and_retryability(monkeypatch):
    reset_for_tests()
    error = ModelProviderError("anthropic", 401)
    def fail(*args, **kwargs):
        raise error
    monkeypatch.setattr(orchestrator, "_run", fail)

    with pytest.raises(ModelProviderError) as caught:
        orchestrator.orchestrate(
            "55555555-5555-4555-8555-555555555555",
            "66666666-6666-4666-8666-666666666666",
            "private question", None, object(),
            context_payload={}, correlation_id=CORRELATION, execution_id=EXECUTION,
        )
    assert caught.value.category == "authorization_failed"
    assert caught.value.failure["retryable"] is False
    assert caught.value.failure["execution_id"] == EXECUTION
    assert caught.value.correlation_id == CORRELATION
    assert any(c["name"] == "rev_requests_total" and c["labels"]["outcome"] == "failure"
               for c in snapshot()["counters"])


def test_orchestrator_failure_has_recoverable_safe_reference_and_failure_metrics(monkeypatch):
    reset_for_tests()
    def fail(*args, **kwargs):
        raise RuntimeError("secret customer prompt must not leak")
    monkeypatch.setattr(orchestrator, "_run", fail)

    result = orchestrator.orchestrate(
        "55555555-5555-4555-8555-555555555555",
        "66666666-6666-4666-8666-666666666666",
        "private question", None, object(),
        context_payload={}, correlation_id=CORRELATION, execution_id=EXECUTION,
    )
    payload = result.to_dict()
    assert payload["success"] is False
    assert payload["execution_id"] == EXECUTION
    assert EXECUTION in payload["text"]
    assert "secret customer prompt" not in str(payload)
    assert payload["execution_metadata"]["outcome"] == "failure"
    assert any(c["name"] == "rev_requests_total" and c["labels"]["outcome"] == "failure"
               for c in snapshot()["counters"])
