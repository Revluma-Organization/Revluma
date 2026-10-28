"""Provider switching tests without sending merchant data to external services."""
import os
from types import SimpleNamespace

import pytest

from src.agents import model_gateway


def test_gemini_routes_text_to_configured_model(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    calls = []

    class FakeClient:
        def __init__(self, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def post(self, url, **kwargs):
            calls.append((url, kwargs))
            return SimpleNamespace(
                status_code=200,
                json=lambda: {"candidates": [{"content": {
                    "parts": [{"text": "Verified evidence is unavailable."}]
                }}]},
            )

    monkeypatch.setattr(model_gateway.httpx, "Client", FakeClient)
    assert model_gateway.generate("What is verified?", role="deep") == "Verified evidence is unavailable."
    assert "gemini" in calls[0][0]
    assert calls[0][1]["headers"]["x-goog-api-key"] == "test-only"


def test_gemini_quota_failure_does_not_fallback_to_anthropic(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    class FakeClient:
        def __init__(self, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def post(self, *args, **kwargs):
            return SimpleNamespace(status_code=429)
    monkeypatch.setattr(model_gateway.httpx, "Client", FakeClient)
    with pytest.raises(model_gateway.ModelProviderError) as error:
        model_gateway.generate("private merchant message")
    assert error.value.status == 429
    assert "private merchant message" not in str(error.value)


def test_unknown_provider_fails_closed(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "unknown")
    with pytest.raises(model_gateway.ModelProviderError):
        model_gateway.generate("hello")
