"""Gemini 3+/4 wire compatibility and failure observability.

PROVIDER-MOCKED: requests leave the real gateways through ``httpx.Client`` in
Gemini's REST wire format and the scripted endpoint answers in that format.
These tests prove the request contract (thinking configuration, thought
signature echo, functionResponse ids, no trailing model turn, defaults) and
that a failed provider turn carries content-free diagnostics. They do not
prove live-model behaviour.

Live context (2026-11-19): with ``GEMINI_FAST_MODEL=gemini-3.5-flash-lite``
social turns succeeded but a knowledge turn failed with a provider 4xx and
the failed row persisted no provider, model or failure detail.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from src.agents import agent_gateway, investigation, model_gateway
from src.agents.model_gateway import gemini_generation_config, gemini_thinking_level
from src.intelligence import execution_telemetry
from tests.rev_provider_fakes import understanding
from tests.test_rev_knowledge_agent import provider, stream  # noqa: F401 - fixtures

pytestmark = pytest.mark.provider_mocked

TOOLS = [{"name": "lookup", "description": "Look something up.",
          "input_schema": {"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"]}}]


# ---------------------------------------------------------------------------
# generationConfig per model family
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("model,role,expected_thinking,headroom", [
    ("gemini-2.5-flash", "deep", {"thinkingBudget": 0}, False),
    ("gemini-2.5-flash-lite", "fast", {"thinkingBudget": 0}, False),
    ("gemini-2.5-pro", "deep", None, False),          # cannot disable thinking
    ("gemini-3.5-flash-lite", "fast", {"thinkingLevel": "minimal"}, True),
    ("gemini-3.5-flash-lite", "deep", {"thinkingLevel": "low"}, True),
    ("gemini-3.6-flash", "fast", {"thinkingLevel": "minimal"}, True),
    ("gemini-3.8-flash", "fast", {"thinkingLevel": "low"}, True),     # minimal unsupported
    ("gemini-3.1-pro-preview", "fast", {"thinkingLevel": "low"}, True),
    ("gemini-4-hydrogen", "deep", {"thinkingLevel": "low"}, True),
])
def test_generation_config_matches_model_family(monkeypatch, model, role, expected_thinking, headroom):
    for name in ("GEMINI_FAST_THINKING_LEVEL", "GEMINI_DEEP_THINKING_LEVEL", "GEMINI_THINKING_HEADROOM_TOKENS"):
        monkeypatch.delenv(name, raising=False)
    config = gemini_generation_config(model, 1000, role=role)
    assert config.get("thinkingConfig") == expected_thinking
    # Thinking tokens count against maxOutputTokens on 3+; headroom keeps the
    # answer from being starved. Older families keep the exact limit.
    assert config["maxOutputTokens"] == (1000 + 2048 if headroom else 1000)
    # Deprecated sampling parameters are never sent.
    assert not {"temperature", "topP", "topK", "candidateCount"} & set(config)


def test_thinking_level_is_operator_configurable_and_validated(monkeypatch):
    monkeypatch.setenv("GEMINI_DEEP_THINKING_LEVEL", "medium")
    assert gemini_thinking_level("gemini-3.8-flash", "deep") == "medium"
    monkeypatch.setenv("GEMINI_DEEP_THINKING_LEVEL", "turbo")      # unknown -> safe default
    assert gemini_thinking_level("gemini-3.8-flash", "deep") == "low"
    monkeypatch.setenv("GEMINI_DEEP_THINKING_LEVEL", "minimal")    # unsupported on 4.x -> low
    assert gemini_thinking_level("gemini-4-neon", "deep") == "low"
    assert gemini_thinking_level("gemini-2.5-flash", "deep") is None
    monkeypatch.setenv("GEMINI_THINKING_HEADROOM_TOKENS", "999999")  # bounded
    assert gemini_generation_config("gemini-3.6-flash", 100, role="deep")["maxOutputTokens"] == 100 + 16_384


def test_defaults_do_not_use_the_deprecated_restricted_gemini_2_5_flash():
    source = Path(model_gateway.__file__).read_text()
    deep = re.search(r'GEMINI_MODEL = os\.environ\.get\("GEMINI_MODEL", ""\)\.strip\(\) or "([^"]+)"', source).group(1)
    fast = re.search(r'GEMINI_FAST_MODEL = os\.environ\.get\("GEMINI_FAST_MODEL", ""\)\.strip\(\) or "([^"]+)"', source).group(1)
    assert deep == "gemini-3.6-flash" and fast == "gemini-3.5-flash-lite"
    assert '"gemini-2.5-flash"' not in Path(agent_gateway.__file__).read_text().split("MODEL_PRICES_USD_PER_MTOK")[0]


def test_empty_fallback_env_uses_the_default_fallback(monkeypatch):
    # Hosted env editors often store an empty string; that must not silently
    # disable the same-provider fallback.
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("GEMINI_FALLBACK_MODEL", "")
    monkeypatch.setenv("AI_FALLBACK_PROVIDERS", "")
    monkeypatch.setattr(model_gateway, "GEMINI_MODEL", "gemini-3.6-flash")
    monkeypatch.setattr(model_gateway, "GEMINI_FAST_MODEL", "gemini-3.5-flash-lite")
    attempts = model_gateway._attempts("gemini", "deep", web_search=False)
    assert [model for _, model in attempts][:2] == ["gemini-3.6-flash", "gemini-3.5-flash-lite"]
    agent_attempts = agent_gateway.resolve_attempts("tool_calling", "deep")
    assert [model for _, model in agent_attempts] == ["gemini-3.6-flash", "gemini-3.5-flash-lite"]


def test_default_same_provider_fallback_is_the_other_configured_model(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.delenv("AI_FALLBACK_PROVIDERS", raising=False)
    monkeypatch.delenv("GEMINI_FALLBACK_MODEL", raising=False)
    monkeypatch.setattr(model_gateway, "GEMINI_MODEL", "gemini-3.8-flash")
    monkeypatch.setattr(model_gateway, "GEMINI_FAST_MODEL", "gemini-3.5-flash-lite")
    assert agent_gateway.resolve_attempts("tool_calling", "deep") == [
        ("gemini", "gemini-3.8-flash"), ("gemini", "gemini-3.5-flash-lite")]
    assert model_gateway._attempts("gemini", "fast", web_search=False) == [
        ("gemini", "gemini-3.5-flash-lite"), ("gemini", "gemini-3.8-flash")]
    # An explicit operator choice still wins.
    monkeypatch.setenv("GEMINI_FALLBACK_MODEL", "gemini-3.6-flash")
    assert agent_gateway.resolve_attempts("tool_calling", "deep")[1] == ("gemini", "gemini-3.6-flash")


# ---------------------------------------------------------------------------
# Multi-turn tool use on Gemini 3+: signatures, ids, no trailing model turn
# ---------------------------------------------------------------------------

class _Recorder:
    def __init__(self, replies):
        self.replies = list(replies)
        self.requests: list[tuple[str, dict]] = []

    def install(self, monkeypatch):
        recorder = self

        class _Client:
            def __init__(self, *args, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def post(self, url, headers=None, json=None):  # noqa: A002
                recorder.requests.append((url, json))
                status, body = recorder.replies.pop(0)
                return SimpleNamespace(status_code=status, json=lambda: body)

        monkeypatch.setattr(agent_gateway, "httpx", SimpleNamespace(
            Client=_Client, Timeout=httpx.Timeout, TimeoutException=httpx.TimeoutException,
            HTTPError=httpx.HTTPError))
        monkeypatch.setenv("AI_PROVIDER", "gemini")
        monkeypatch.setenv("GEMINI_API_KEY", "k")
        monkeypatch.delenv("AI_FALLBACK_PROVIDERS", raising=False)
        monkeypatch.setenv("GEMINI_FALLBACK_MODEL", "gemini-3.5-flash-lite")
        monkeypatch.setattr(model_gateway, "GEMINI_MODEL", "gemini-3.8-flash")
        return self


def _ok(parts):
    return 200, {"candidates": [{"content": {"role": "model", "parts": parts}, "finishReason": "STOP"}],
                 "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5}}


def test_second_turn_echoes_thought_signature_and_function_call_id(monkeypatch):
    call_part = {"functionCall": {"id": "fc-7Qx", "name": "lookup", "args": {"q": "cart abandonment"}},
                 "thoughtSignature": "c2lnbmF0dXJlLWJ5dGVz"}
    recorder = _Recorder([_ok([call_part]), _ok([{"text": "Done."}])]).install(monkeypatch)
    user = {"role": "user", "content": [{"type": "text", "text": "q"}]}
    first = agent_gateway.chat(system="s", messages=[user], tools=TOOLS, timeout=10)
    assert first["model"] == "gemini-3.8-flash" and first["tool_calls"][0]["name"] == "lookup"
    first_payload = recorder.requests[0][1]
    assert first_payload["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "low"}
    assert "thinkingBudget" not in json.dumps(first_payload)

    result_block = {"type": "tool_result", "id": first["tool_calls"][0]["id"], "name": "lookup",
                    "content": json.dumps({"ok": True})}
    agent_gateway.chat(system="s", messages=[user, first["assistant"],
                                             {"role": "user", "content": [result_block]}],
                       tools=TOOLS, timeout=10)
    contents = recorder.requests[1][1]["contents"]
    assert contents[1] == {"role": "model", "parts": [call_part]}           # verbatim, signature kept
    response = contents[2]["parts"][0]["functionResponse"]
    assert response == {"name": "lookup", "response": {"ok": True}, "id": "fc-7Qx"}
    assert contents[-1]["role"] == "user"


def test_function_response_has_no_invented_id_when_provider_issued_none():
    messages = [
        {"role": "user", "content": [{"type": "text", "text": "q"}]},
        {"role": "assistant", "content": [{"type": "tool_call", "id": "g0_lookup", "name": "lookup",
                                           "arguments": {"q": "x"}}]},
        {"role": "user", "content": [{"type": "tool_result", "id": "g0_lookup", "name": "lookup",
                                      "content": "{}"}]},
    ]
    contents = agent_gateway._gemini_contents(messages)
    assert "id" not in contents[2]["parts"][0]["functionResponse"]


def test_contents_never_end_with_a_model_turn():
    messages = [{"role": "user", "content": [{"type": "text", "text": "q"}]},
                {"role": "assistant", "content": [{"type": "text", "text": "partial"}]}]
    contents = agent_gateway._gemini_contents(messages)
    assert contents[-1]["role"] == "user"
    assert contents[-1]["parts"] == [{"text": "Continue."}]


def test_thought_parts_are_never_returned_as_answer_text(monkeypatch):
    recorder = _Recorder([_ok([{"text": "private reasoning", "thought": True},
                               {"text": "Visible answer.", "thoughtSignature": "c2ln"}])]).install(monkeypatch)
    result = agent_gateway.chat(system="s", messages=[{"role": "user", "content": [{"type": "text", "text": "q"}]}],
                                tools=TOOLS, timeout=10)
    assert result["text"] == "Visible answer."
    assert recorder.requests


# ---------------------------------------------------------------------------
# Failure observability (content-free)
# ---------------------------------------------------------------------------

def test_failed_attempt_records_status_and_error_type_but_no_message(monkeypatch):
    body = {"error": {"code": 400, "status": "INVALID_ARGUMENT",
                      "message": "Function call is missing a thought_signature for merchant secret-text"}}
    _Recorder([(400, body)]).install(monkeypatch)
    recorder = execution_telemetry.ExecutionRecorder()
    with execution_telemetry.recording(recorder):
        with pytest.raises(model_gateway.ModelProviderError) as caught:
            agent_gateway.chat(system="s", messages=[{"role": "user", "content": [{"type": "text", "text": "q"}]}],
                               tools=TOOLS, timeout=10)
    assert caught.value.category == "invalid_request" and caught.value.attempts == 1   # 4xx never retried
    call = recorder.summary(final_status="failed")["model_calls"][0]
    assert call["http_status"] == 400 and call["provider_error_type"] == "INVALID_ARGUMENT"
    assert call["model"] == "gemini-3.8-flash" and call["purpose"] == "agent_turn"
    diagnostics = investigation.provider_failure_diagnostics(caught.value, recorder.summary(final_status="failed"))
    assert diagnostics["http_status"] == 400 and diagnostics["provider_error_type"] == "INVALID_ARGUMENT"
    assert diagnostics["attempt_log"][0]["model"] == "gemini-3.8-flash"
    assert "secret-text" not in json.dumps(diagnostics) and "thought_signature" not in json.dumps(diagnostics)


def test_stream_error_carries_diagnostics_and_telemetry(monkeypatch, provider, stream):  # noqa: F811
    """A knowledge turn whose provider rejects every answer call is observable."""
    original = provider._respond

    def rejecting(url, payload):
        status, body = original(url, payload)
        kind = provider.requests[-1]["kind"] if provider.requests else ""
        if kind in {"agent_turn", "compose"}:
            return 400, {"error": {"status": "INVALID_ARGUMENT", "message": "merchant text must not leak"}}
        return status, body

    monkeypatch.setattr(provider, "_respond", rejecting)
    provider.understand = lambda message: understanding("knowledge", mode="explanation")
    provider.agent_turns = [lambda view: [provider.call("finish_answer", {})]]
    provider.compose = lambda prompt: "unused"
    error = stream("What is a good cart abandonment rate for ecommerce?", expect="error")
    assert error["code"] == "PROVIDER_FAILURE" and error["retryable"] is False
    diagnostics = error["diagnostics"]
    assert diagnostics["contract_version"] == "rev-provider-failure-diagnostics-v1"
    assert diagnostics["provider"] == "gemini" and diagnostics["category"] == "invalid_request"
    assert diagnostics["http_status"] == 400 and diagnostics["provider_error_type"] == "INVALID_ARGUMENT"
    telemetry = error["telemetry"]
    assert telemetry["final_status"] == "failed"
    failed = [call for call in telemetry["model_calls"] if call["outcome"] != "success"]
    assert failed and all(call.get("http_status") == 400 for call in failed)
    # Both the knowledge agent turn and the composition fallback are visible.
    assert {"agent_turn", "answer_composition"} <= {call["purpose"] for call in failed}
    assert diagnostics["failed_call_purpose"] == "answer_composition"
    assert "merchant text must not leak" not in json.dumps(error)
    assert "cart abandonment" not in json.dumps({"d": diagnostics, "t": telemetry})


def test_conversational_answer_attributes_the_composing_model_and_tokens():
    trace = {"provider": None, "model": None,
             "token_usage": {"input": None, "output": None, "total": None, "scope": "agent_runtime_only"}}
    telemetry = {"model_calls": [
        {"purpose": "understanding", "provider": "gemini", "model": "gemini-3.5-flash-lite", "outcome": "success",
         "input_tokens": 1356, "output_tokens": 57},
        {"purpose": "answer_composition", "provider": "gemini", "model": "gemini-3.5-flash-lite",
         "outcome": "success", "input_tokens": 1020, "output_tokens": 65}],
        "token_usage": {"input": 2376, "output": 122, "total": 2498, "scope": "all_model_calls"}}
    investigation._attribute_answer_model(trace, telemetry)
    assert trace["provider"] == "gemini" and trace["model"] == "gemini-3.5-flash-lite"
    assert trace["model_attribution"] == "answer_composition"
    assert trace["token_usage"]["input"] == 2376 and trace["token_usage"]["scope"] == "all_model_calls"


def test_deterministic_answer_is_not_attributed_to_the_routing_model():
    trace = {"provider": None, "model": None, "token_usage": {"input": None}}
    telemetry = {"model_calls": [{"purpose": "understanding", "provider": "gemini",
                                  "model": "gemini-3.5-flash-lite", "outcome": "success"}],
                 "token_usage": {"input": 400, "output": 50, "total": 450, "scope": "all_model_calls"}}
    investigation._attribute_answer_model(trace, telemetry)
    assert trace["provider"] is None and trace["model"] is None
    assert "model_attribution" not in trace
    # Usage is still honest: the routing call happened and is counted.
    assert trace["token_usage"]["total"] == 450


def test_agent_runtime_attribution_is_preserved():
    trace = {"provider": "gemini", "model": "gemini-3.8-flash",
             "token_usage": {"input": 900, "output": 80, "total": 980, "scope": "agent_runtime_only"}}
    investigation._attribute_answer_model(trace, {"model_calls": [], "token_usage": {"scope": "no_model_calls"}})
    assert trace["model"] == "gemini-3.8-flash" and trace["model_attribution"] == "agent_runtime"
    assert trace["token_usage"]["input"] == 900


def test_knowledge_turn_on_gemini_3_succeeds_end_to_end(provider, stream):  # noqa: F811
    provider.understand = lambda message: understanding("knowledge", mode="explanation")
    seen = {}

    def finish(view):
        seen["model"] = view["model"]
        return [{"functionCall": {"id": "fc-1", "name": "finish_answer", "args": {
            "answer_markdown": "Benchmarks vary by vertical; there is no single universal good rate.",
            "cited_evidence_ids": [], "evidence_sufficiency": "partial"}},
            "thoughtSignature": "c2ln"}]

    provider.agent_turns = [finish]
    provider.compose = lambda prompt: "Benchmarks vary by vertical; there is no single universal good rate."
    final = stream("What is a good cart abandonment rate for ecommerce?")
    trace = final["execution_trace"]
    agent_payloads = [r["payload"] for r in provider.requests if r["kind"] == "agent_turn"]
    assert agent_payloads, provider.kinds()
    assert agent_payloads[0]["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "low"}
    assert seen["model"] == model_gateway.GEMINI_MODEL
    assert trace["provider"] == "gemini" and trace["model"]
    assert trace["token_usage"]["input"] is not None
