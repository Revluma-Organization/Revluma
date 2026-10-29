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


def test_gemini_25_disables_thinking_for_short_responses(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    requests = []
    class FakeClient:
        def __init__(self, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def post(self, url, **kwargs):
            requests.append(kwargs["json"])
            return SimpleNamespace(status_code=200, json=lambda: {
                "candidates": [{"content": {"parts": [{"text": "Hello!"}]}}]})
    monkeypatch.setattr(model_gateway.httpx, "Client", FakeClient)
    monkeypatch.setattr(model_gateway, "GEMINI_FAST_MODEL", "gemini-2.5-flash-lite")
    assert model_gateway.generate("hello", max_tokens=100) == "Hello!"
    assert requests[0]["generationConfig"]["thinkingConfig"]["thinkingBudget"] == 0


def test_gemini_web_research_uses_grounding_sources(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    requests = []
    class FakeClient:
        def __init__(self, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def post(self, url, **kwargs):
            requests.append(kwargs["json"])
            return SimpleNamespace(status_code=200, json=lambda: {
                "candidates": [{"content": {"parts": [{"text": "Recent update."}]},
                    "groundingMetadata": {"groundingChunks": [
                        {"web": {"uri": "https://example.org/source"}}]}}]})
    monkeypatch.setattr(model_gateway.httpx, "Client", FakeClient)
    assert "https://example.org/source" in model_gateway.generate("research", web_search=True)
    assert requests[0]["tools"] == [{"google_search": {}}]


def test_gemini_network_timeout_reports_safe_error_type(monkeypatch, caplog):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-only-secret")
    class FakeClient:
        def __init__(self, **kwargs):
            assert 0 < kwargs["timeout"] <= 30.0
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def post(self, *args, **kwargs):
            raise model_gateway.httpx.ReadTimeout("timed out")
    monkeypatch.setattr(model_gateway.httpx, "Client", FakeClient)
    with pytest.raises(model_gateway.ModelProviderError) as error:
        model_gateway.generate("private merchant prompt")
    assert error.value.status == "network"
    assert "ReadTimeout" in caplog.text
    assert "test-only-secret" not in caplog.text
    assert "private merchant prompt" not in caplog.text


def test_transient_gemini_503_fails_over_to_approved_gemini_model(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    monkeypatch.setenv("GEMINI_FALLBACK_MODEL", "gemini-2.5-flash-lite")
    monkeypatch.setattr(model_gateway, "GEMINI_FAST_MODEL", "gemini-3.5-flash-lite")
    requests = []
    class FakeClient:
        def __init__(self, **kwargs):
            self.timeout = kwargs["timeout"]
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def post(self, url, **kwargs):
            requests.append((url, self.timeout))
            if len(requests) == 1:
                return SimpleNamespace(status_code=503)
            return SimpleNamespace(status_code=200, json=lambda: {
                "candidates": [{"content": {"parts": [{"text": "Safe answer"}]}}]})
    monkeypatch.setattr(model_gateway.httpx, "Client", FakeClient)
    assert model_gateway.generate("private merchant question", timeout=10) == "Safe answer"
    assert "gemini-3.5-flash-lite" in requests[0][0]
    assert "gemini-2.5-flash-lite" in requests[1][0]
    assert requests[0][1] <= 5.1
    assert all("generativelanguage.googleapis.com" in url for url, _ in requests)


def test_gemini_timeout_fails_over_without_cross_provider(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    monkeypatch.setattr(model_gateway, "GEMINI_FAST_MODEL", "gemini-3.5-flash-lite")
    attempts = []
    class FakeClient:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def post(self, url, **kwargs):
            attempts.append(url)
            if len(attempts) == 1:
                raise model_gateway.httpx.ReadTimeout("provider stalled")
            return SimpleNamespace(status_code=200, json=lambda: {
                "candidates": [{"content": {"parts": [{"text": "Recovered"}]}}]})
    monkeypatch.setattr(model_gateway.httpx, "Client", FakeClient)
    assert model_gateway.generate("private merchant question", timeout=10) == "Recovered"
    assert len(attempts) == 2


def test_gemini_auth_failure_never_retries_or_leaks(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    monkeypatch.setattr(model_gateway, "GEMINI_FAST_MODEL", "gemini-3.5-flash-lite")
    attempts = []
    class FakeClient:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def post(self, url, **kwargs):
            attempts.append(url)
            return SimpleNamespace(status_code=403)
    monkeypatch.setattr(model_gateway.httpx, "Client", FakeClient)
    with pytest.raises(model_gateway.ModelProviderError) as exc:
        model_gateway.generate("secret merchant content")
    assert exc.value.status == 403
    assert len(attempts) == 1
    assert "secret merchant content" not in str(exc.value)


def test_retired_primary_model_404_fails_over_to_configured_gemini(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    monkeypatch.setenv("GEMINI_FALLBACK_MODEL", "gemini-2.5-flash")
    monkeypatch.setattr(model_gateway, "GEMINI_FAST_MODEL", "retired-model")
    calls = []
    class FakeClient:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def post(self, url, **kwargs):
            calls.append(url)
            if len(calls) == 1:
                return SimpleNamespace(status_code=404)
            return SimpleNamespace(status_code=200, json=lambda: {
                "candidates": [{"content": {"parts": [{"text": "Recovered"}]}}]})
    monkeypatch.setattr(model_gateway.httpx, "Client", FakeClient)
    assert model_gateway.generate("merchant question", timeout=10) == "Recovered"
    assert "retired-model" in calls[0]
    assert "gemini-2.5-flash" in calls[1]
