"""Task 234 regression tests for general-knowledge routing and provider telemetry."""
from __future__ import annotations

import logging
import sys
from types import SimpleNamespace

import httpx
import pytest

from src.agents import investigation, model_gateway, responder, understanding
from tests.test_rev_investigation import NOW, ORG, USER, workspace_db


def test_what_is_shopify_is_routed_to_knowledge_without_classification_model(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("clear general definition should not call the intent model")

    monkeypatch.setattr(understanding, "understand", forbidden)
    routed = investigation.route_message(
        "What is Shopify?",
        {"last_investigation": {"intent": "revenue_investigation"}},
        {"store_count": 1},
        correlation_id="request-234",
    )

    assert routed["classification"]["intent"] == investigation.INTENT_KNOWLEDGE
    assert routed["source"] == "deterministic_knowledge"
    assert routed["gate"] != "tools"
    assert routed["understanding"]["requires_store_data"] is False
    assert routed["understanding"]["response_mode"] == "direct_answer"


def test_general_definition_runtime_does_not_dispatch_shopify_evidence_tools(monkeypatch):
    def forbidden_tool(*args, **kwargs):
        raise AssertionError("general knowledge must not dispatch a store tool")

    monkeypatch.setattr(understanding, "understand", forbidden_tool)
    monkeypatch.setattr(investigation, "run_tool", forbidden_tool)
    monkeypatch.setattr(
        responder, "compose_knowledge",
        lambda *args, **kwargs: "Shopify is an ecommerce platform.",
    )

    result = investigation.run_investigation(
        ORG, USER, "What is Shopify?", db=workspace_db(), now=NOW, persist=False,
        context_payload={"correlation_id": "request-234"},
    )

    assert result["success"] is True
    assert result["response_type"] == "chat"
    assert result["text"] == "Shopify is an ecommerce platform."
    assert result["understanding"]["intent"] == "knowledge"
    assert result["understanding"]["gate"] != "tools"
    assert result["investigation"]["tools_used"] == []
    assert result["evidence"]["items"] == []
    assert result["orchestration"]["selected_specialists"] == []
    assert result["orchestration"]["execution_records"] == []


def test_store_metric_definition_is_not_captured_by_general_knowledge_fast_path(monkeypatch):
    monkeypatch.setattr(
        understanding, "understand",
        lambda *args, **kwargs: understanding._safe_fallback("What is my revenue?", [], "test"),
    )
    routed = investigation.route_message("What is my revenue?", {}, {"store_count": 1})

    assert routed["source"] != "deterministic_knowledge"
    assert routed["classification"]["intent"] == investigation.INTENT_REVENUE
    assert routed["gate"] == "tools"


def _anthropic_module(messages_create):
    class FakeAnthropic:
        def __init__(self, **kwargs):
            assert kwargs["api_key"] == "test-secret"
            self.messages = SimpleNamespace(create=messages_create)

    return SimpleNamespace(Anthropic=FakeAnthropic)


def test_anthropic_model_selection_and_logs_are_correlated_and_prompt_safe(monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="rev.model_gateway")
    requests = []

    def create(**kwargs):
        requests.append(kwargs)
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text="Shopify is an ecommerce platform.")],
            stop_reason="end_turn",
        )

    monkeypatch.setitem(sys.modules, "anthropic", _anthropic_module(create))
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-secret")
    monkeypatch.setenv("ANTHROPIC_DEEP_MODEL", "claude-test-model")

    result = model_gateway.generate(
        "private merchant prompt", role="deep", correlation_id="request-234")

    assert result == "Shopify is an ecommerce platform."
    assert requests[0]["model"] == "claude-test-model"
    assert "provider=anthropic model=claude-test-model" in caplog.text
    assert "correlation_id=request-234" in caplog.text
    assert "private merchant prompt" not in caplog.text
    assert "test-secret" not in caplog.text


@pytest.mark.parametrize(
    "failure,expected_status,expected_category",
    [
        (type("RateLimitError", (Exception,), {"status_code": 429}), 429, "rate_limited"),
        (type("UnauthorizedError", (Exception,), {"status_code": 401}), 401, "authorization_failed"),
        (httpx.ReadTimeout, "timeout_budget_exhausted", "timeout"),
        (httpx.ConnectError, "network", "connection_failed"),
    ],
)
def test_anthropic_failures_are_normalized_without_provider_payload(
    monkeypatch, caplog, failure, expected_status, expected_category,
):
    def create(**kwargs):
        if isinstance(failure, type) and issubclass(failure, httpx.HTTPError):
            raise failure("private merchant prompt; api_key=test-secret")
        raise failure("private merchant prompt; api_key=test-secret")

    monkeypatch.setitem(sys.modules, "anthropic", _anthropic_module(create))
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-secret")

    with pytest.raises(model_gateway.ModelProviderError) as caught:
        model_gateway.generate("private merchant prompt", correlation_id="request-234")

    assert caught.value.status == expected_status
    assert caught.value.category == expected_category
    assert "private merchant prompt" not in str(caught.value)
    assert "test-secret" not in caplog.text
    assert "private merchant prompt" not in caplog.text
    assert expected_category in caplog.text
