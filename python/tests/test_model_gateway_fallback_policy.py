"""Fallback policy tests: explicit provider consent, compatibility and bounded retry."""
from __future__ import annotations

import logging
import sys
from types import SimpleNamespace

import pytest

from src.agents import model_gateway


def _anthropic_sdk(create):
    class FakeAnthropic:
        def __init__(self, **kwargs):
            assert kwargs["api_key"] == "anthropic-secret"
            self.messages = SimpleNamespace(create=create)
    return SimpleNamespace(Anthropic=FakeAnthropic)


def _gemini_client(responder, calls):
    class FakeClient:
        def __init__(self, timeout=None, **kwargs):
            self.timeout = timeout
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def post(self, url, **kwargs):
            calls.append({"url": url, "json": kwargs["json"], "timeout": self.timeout})
            return responder(url, kwargs)
    return FakeClient


def test_anthropic_transient_error_falls_back_only_to_explicit_available_gemini(monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="rev.model_gateway")
    primary_calls = []
    fallback_calls = []

    def fail_primary(**kwargs):
        primary_calls.append(kwargs)
        error = RuntimeError("merchant prompt and secret must not be logged")
        error.status_code = 503
        raise error

    monkeypatch.setitem(sys.modules, "anthropic", _anthropic_sdk(fail_primary))
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-secret")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    monkeypatch.setenv("AI_FALLBACK_PROVIDERS", "gemini")
    monkeypatch.setattr(model_gateway.httpx, "Client", _gemini_client(
        lambda *_: SimpleNamespace(status_code=200, json=lambda: {
            "candidates": [{"content": {"parts": [{"text": "Recovered answer"}]}}]}), fallback_calls))

    answer = model_gateway.generate("private prompt", timeout=4, correlation_id="corr-safe", execution_id="exec-safe")

    assert answer == "Recovered answer"
    assert len(primary_calls) == len(fallback_calls) == 1
    assert primary_calls[0]["messages"][0]["content"][0]["text"] == "private prompt"
    assert fallback_calls[0]["json"]["contents"][0]["parts"][0]["text"] == "private prompt"
    assert fallback_calls[0]["timeout"].read <= 2.1
    assert "private prompt" not in caplog.text
    assert "anthropic-secret" not in caplog.text and "gemini-secret" not in caplog.text
    assert "to_provider=gemini" in caplog.text
    assert "correlation_id=corr-safe" in caplog.text
    assert "execution_id=exec-safe" in caplog.text


def test_permanent_auth_failure_does_not_attempt_configured_fallback(monkeypatch):
    attempts = []
    def deny(**kwargs):
        attempts.append(kwargs)
        error = RuntimeError("private payload")
        error.status_code = 401
        raise error
    monkeypatch.setitem(sys.modules, "anthropic", _anthropic_sdk(deny))
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-secret")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    monkeypatch.setenv("AI_FALLBACK_PROVIDERS", "gemini")

    with pytest.raises(model_gateway.ModelProviderError) as caught:
        model_gateway.generate("secret question")

    assert caught.value.category == "authorization_failed"
    assert caught.value.attempts == 1
    assert not caught.value.fallback_used
    assert len(attempts) == 1


def test_fallback_exhaustion_is_bounded_to_two_attempts_and_preserves_truthful_error(monkeypatch):
    primary_calls = []
    fallback_calls = []
    def unavailable(**kwargs):
        primary_calls.append(kwargs)
        error = RuntimeError("not for logs")
        error.status_code = 503
        raise error
    monkeypatch.setitem(sys.modules, "anthropic", _anthropic_sdk(unavailable))
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-secret")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    monkeypatch.setenv("AI_FALLBACK_PROVIDERS", "gemini")
    monkeypatch.setattr(model_gateway.httpx, "Client", _gemini_client(
        lambda *_: SimpleNamespace(status_code=503), fallback_calls))

    with pytest.raises(model_gateway.ModelProviderError) as caught:
        model_gateway.generate("private question", timeout=4)

    assert len(primary_calls) + len(fallback_calls) == 2
    assert caught.value.attempts == 2
    assert caught.value.fallback_used is True
    assert caught.value.category == "provider_unavailable"


def test_grounded_research_never_uses_task_incompatible_anthropic(monkeypatch):
    primary_calls = []
    fallback_calls = []
    monkeypatch.setitem(sys.modules, "anthropic", _anthropic_sdk(lambda **kw: primary_calls.append(kw)))
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-secret")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    monkeypatch.setenv("AI_FALLBACK_PROVIDERS", "gemini")
    monkeypatch.setattr(model_gateway.httpx, "Client", _gemini_client(
        lambda *_: SimpleNamespace(status_code=200, json=lambda: {
            "candidates": [{"content": {"parts": [{"text": "Fact"}]},
                           "groundingMetadata": {"groundingChunks": []}}]}), fallback_calls))

    answer = model_gateway.generate("recent research", web_search=True)

    assert "Fact" in answer
    assert primary_calls == []
    assert fallback_calls[0]["json"]["tools"] == [{"google_search": {}}]
