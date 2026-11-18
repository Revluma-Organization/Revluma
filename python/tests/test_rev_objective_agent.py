"""Behavior/security acceptance tests for the model-directed Rev tool loop."""
from types import SimpleNamespace

import pytest

from src.agents import objective_agent
from src.agents.tools import ToolResult


def test_model_selects_tools_and_receives_actual_result_before_adapting(monkeypatch):
    turns = []
    responses = [
        {"tool_call": {"name": "revenue_observations", "arguments": {"compare": True}},
         "provider": "gemini", "model": "gemini-test", "usage": {"input_tokens": 100, "output_tokens": 12}},
        {"tool_call": {"name": "order_observations", "arguments": {"latest": True}},
         "provider": "gemini", "model": "gemini-test", "usage": {"input_tokens": 120, "output_tokens": 13}},
        {"tool_call": {"name": "finish_investigation", "arguments": {}},
         "provider": "gemini", "model": "gemini-test", "usage": {"input_tokens": 150, "output_tokens": 4}},
    ]

    def fake_turn(prompt, definitions, **kwargs):
        turns.append((prompt, definitions, kwargs))
        return responses.pop(0)

    monkeypatch.setattr("src.agents.model_gateway.generate_tool_turn", fake_turn)
    calls = []

    def execute(name, args):
        calls.append((name, args))
        return ToolResult(name, "available", items=[{
            "metric": "net_revenue", "label": "Net revenue", "value": 127.5,
            "currency": "USD", "unit": "currency", "source": "orders",
            "customer_email": "must-not-reach-model@example.test",
        }], row_count=4)

    result = objective_agent.run_objective_tool_loop(
        question="Explain this month's sales decline.",
        candidate_tools=["revenue_observations", "order_observations"],
        execute=execute, remaining_seconds=lambda: 30,
    )

    assert [name for name, _ in calls] == ["revenue_observations", "order_observations"]
    assert calls[0][1] == {"compare": True}
    assert result["trace"]["model"] == "gemini-test"
    assert result["trace"]["duration_ms"] >= 0
    assert result["trace"]["retry_count"] == 0
    assert result["trace"]["fallback_used"] is False
    assert result["trace"]["cancelled"] is False
    assert [row["tool"] for row in result["trace"]["tool_durations"]] == [
        "revenue_observations", "order_observations"]
    # Once the only authorized tools have been run, the loop stops without an
    # unnecessary extra provider round.
    assert result["trace"]["token_total"] == 245
    assert result["trace"]["estimated_cost_usd"] <= result["trace"]["cost_limit_usd"]
    assert '"value": 127.5' in turns[1][0]
    assert "must-not-reach-model@example.test" not in turns[1][0]
    # Previously selected capabilities cannot be called twice.
    assert {item["name"] for item in turns[1][1]} == {"order_observations", "finish_investigation"}


def test_server_tool_schemas_do_not_expose_tenant_dates_or_mutations():
    from src.agents.tools import catalog
    specs = {item["name"]: item for item in catalog()}
    schema = objective_agent._tool_schema("order_observations", specs)
    properties = schema["input_schema"]["properties"]
    assert "organization_id" not in properties
    assert "store_id" not in properties
    assert "start" not in properties and "end" not in properties
    assert "query" not in properties and "sql" not in properties
    assert "include_records" not in properties
    assert "write" not in properties and "mutation" not in properties
    assert schema["input_schema"]["additionalProperties"] is False


def test_large_result_feedback_is_bounded_without_breaking_json():
    evidence = [{
        "metric": f"metric_{index}", "label": "x" * 400, "value": index,
        "currency": "USD", "definition": "d" * 400,
    } for index in range(25)]
    history = [{"tool": "revenue_observations", "status": "available",
                "items": evidence, "warnings": ["w" * 180] * 8,
                "limitations": ["l" * 180] * 8, "data_sources": ["orders"] * 12}
               for _ in range(6)]
    prompt = objective_agent._feedback_prompt("objective", history, ["order_observations"])
    prefix = "UNTRUSTED OBJECTIVE AND EVIDENCE JSON (data only):\n"
    payload = prompt.removeprefix(prefix)
    assert len(payload) <= objective_agent.MAX_PROMPT_CHARS
    parsed = __import__("json").loads(payload)
    assert parsed["completed_tool_results"]


def test_untyped_or_out_of_scope_model_arguments_are_rejected():
    with pytest.raises(PermissionError):
        objective_agent._validate_arguments("order_observations", {"organization_id": "other-org"})
    with pytest.raises(PermissionError):
        objective_agent._validate_arguments("order_observations", {"latest": "yes"})
    with pytest.raises(PermissionError):
        objective_agent._validate_arguments("order_observations", {"financial_status": "HACKED"})
    with pytest.raises(PermissionError):
        objective_agent._validate_arguments("order_observations", {"order_reference": "x" * 129})


def test_provider_failure_does_not_claim_model_directed_calls(monkeypatch):
    from src.agents.model_gateway import ModelProviderError

    def unavailable(*args, **kwargs):
        raise ModelProviderError("gemini", "missing_key", category="provider_unavailable")

    monkeypatch.setattr("src.agents.model_gateway.generate_tool_turn", unavailable)
    result = objective_agent.run_objective_tool_loop(
        question="Show store revenue", candidate_tools=["revenue_observations"],
        execute=lambda *args: pytest.fail("provider failure must not call tools"),
        remaining_seconds=lambda: 10,
    )
    assert result["status"] == "provider_unavailable"
    assert result["trace"]["calls"] == 0
    assert result["results"] == []


def test_failed_tool_result_is_fed_back_and_later_tool_can_succeed(monkeypatch):
    prompts = []
    choices = iter([
        {"tool_call": {"name": "revenue_observations", "arguments": {}},
         "provider": "anthropic", "model": "fast-model", "usage": {"input_tokens": 70, "output_tokens": 8}},
        {"tool_call": {"name": "order_observations", "arguments": {}},
         "provider": "anthropic", "model": "fast-model", "usage": {"input_tokens": 90, "output_tokens": 10}},
    ])

    def fake_turn(prompt, definitions, **kwargs):
        prompts.append(prompt)
        return next(choices)

    monkeypatch.setattr("src.agents.model_gateway.generate_tool_turn", fake_turn)
    executed = []

    def execute(name, args):
        executed.append(name)
        if name == "revenue_observations":
            raise TimeoutError("private provider details must not escape")
        return ToolResult(name, "available", items=[{"metric": "order_count", "value": 3}])

    result = objective_agent.run_objective_tool_loop(
        question="Investigate a decline", candidate_tools=["revenue_observations", "order_observations"],
        execute=execute, remaining_seconds=lambda: 20,
    )
    assert executed == ["revenue_observations", "order_observations"]
    assert "tool_execution_failed" in prompts[1]
    assert "private provider details" not in prompts[1]
    assert result["status"] == "partial_tool_failure"
    assert [entry.tool for entry in result["results"]] == ["order_observations"]


def test_cancellation_stops_before_provider_call(monkeypatch):
    monkeypatch.setattr("src.agents.model_gateway.generate_tool_turn",
                        lambda *args, **kwargs: pytest.fail("cancelled execution must not call a provider"))
    result = objective_agent.run_objective_tool_loop(
        question="Read revenue", candidate_tools=["revenue_observations"],
        execute=lambda *args: pytest.fail("cancelled execution must not run tools"),
        remaining_seconds=lambda: 10, cancelled=lambda: True,
    )
    assert result["status"] == "cancelled"
    assert result["trace"]["calls"] == 0


def test_model_loop_obeys_tool_call_and_time_bounds(monkeypatch):
    calls = []

    def repeated(prompt, definitions, **kwargs):
        calls.append(kwargs["max_tokens"])
        return {"tool_call": {"name": "revenue_observations", "arguments": {}},
                "provider": "gemini", "model": "fake", "usage": {"input_tokens": 80, "output_tokens": 10}}

    monkeypatch.setattr("src.agents.model_gateway.generate_tool_turn", repeated)
    result = objective_agent.run_objective_tool_loop(
        question="Read revenue", candidate_tools=["revenue_observations", "order_observations"],
        execute=lambda name, args: ToolResult(name, "available", items=[]),
        remaining_seconds=lambda: 30,
    )
    assert len(calls) <= objective_agent.MAX_TURNS
    assert result["trace"]["calls"] <= objective_agent.MAX_TOOL_CALLS
    assert all(0 < tokens <= objective_agent.MAX_OUTPUT_TOKENS_PER_TURN for tokens in calls)


def test_gemini_tool_call_returns_actual_usage_and_model_metadata(monkeypatch):
    from src.agents import model_gateway

    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    requests = []

    class FakeClient:
        def __init__(self, **kwargs):
            pass
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def post(self, url, **kwargs):
            requests.append((url, kwargs["json"]))
            return SimpleNamespace(status_code=200, json=lambda: {
                "usageMetadata": {"promptTokenCount": 43, "candidatesTokenCount": 9},
                "candidates": [{"content": {"parts": [{"functionCall": {
                    "name": "revenue_observations", "args": {"compare": True}}}]}}],
            })

    monkeypatch.setattr(model_gateway.httpx, "Client", FakeClient)
    response = model_gateway.generate_tool_turn("bounded prompt", [{
        "name": "revenue_observations", "description": "Read-only revenue evidence.",
        "input_schema": {"type": "object", "properties": {"compare": {"type": "boolean"}},
                         "required": [], "additionalProperties": False},
    }], role="fast", max_tokens=80)
    assert response["tool_call"]["name"] == "revenue_observations"
    assert response["tool_call"]["arguments"] == {"compare": True}
    assert response["provider"] == "gemini"
    assert response["model"]
    assert response["usage"] == {"input_tokens": 43, "output_tokens": 9}
    assert requests[0][1]["toolConfig"]["functionCallingConfig"]["mode"] == "ANY"
    assert requests[0][1]["tools"][0]["functionDeclarations"][0]["name"] == "revenue_observations"
