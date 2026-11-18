"""Behaviour, bounds and security tests for Rev's authoritative agent runtime.

The provider boundary (``agent_gateway.chat``) is synthetic in these tests:
they prove the loop's contract, not live model quality. Live-provider
evidence is reported separately in the production acceptance report.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from src.agents import agent_gateway, rev_agent
from src.agents.model_gateway import ModelProviderError
from src.agents.tools import ToolResult


def _turn(calls=None, *, text="", provider="anthropic", model="claude-sonnet-4-6",
          input_tokens=500, output_tokens=40, attempts=1, fallback_used=False, stop_reason=None):
    calls = calls or []
    return {
        "text": text, "tool_calls": calls,
        "stop_reason": stop_reason or ("tool_use" if calls else "end_turn"),
        "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens},
        "assistant": {"role": "assistant", "content": [{"type": "tool_call", **call} for call in calls]},
        "provider": provider, "model": model, "duration_ms": 3, "attempts": attempts,
        "fallback_used": fallback_used,
    }


def _call(name, arguments=None, call_id=None):
    return {"id": call_id or f"id_{name}", "name": name, "arguments": arguments or {}}


def _revenue_result(value="1250.00", previous="1500.00"):
    return ToolResult("revenue_observations", "available", items=[
        {"id": "ev_rev_current", "metric": "recorded_order_value", "label": "Recorded order value",
         "value": value, "currency": "USD", "unit": "currency", "status": "available", "source": "orders",
         "customer_email": "private-buyer@example.test",
         "definition": "Refund-aware recorded order value."},
        {"id": "ev_orders_current", "metric": "recorded_order_count", "label": "Orders", "value": 25,
         "unit": "count", "status": "available", "source": "orders"},
    ], comparison={"period": {"start": "a", "end": "b"}, "items": [
        {"id": "ev_rev_previous", "metric": "recorded_order_value", "value": previous, "currency": "USD",
         "unit": "currency", "status": "available"},
    ], "changes": [{"metric": "recorded_order_value", "currency": "USD", "previous": previous,
                    "current": value, "percent": "-16.67", "direction": "down", "status": "available",
                    "previous_evidence_id": "ev_rev_previous", "current_evidence_id": "ev_rev_current"}]},
        row_count=2)


class Script:
    """Scripted provider: each entry is a turn dict or a callable(messages)->turn."""

    def __init__(self, *turns):
        self.turns = list(turns)
        self.requests = []

    def __call__(self, **kwargs):
        self.requests.append({"messages": json.loads(json.dumps(kwargs["messages"], default=str)),
                              "tools": [tool["name"] for tool in kwargs["tools"]],
                              "max_tokens": kwargs["max_tokens"], "tool_choice": kwargs["tool_choice"],
                              "timeout": kwargs["timeout"]})
        if not self.turns:
            pytest.fail("provider called more times than scripted")
        turn = self.turns.pop(0)
        if isinstance(turn, Exception):
            raise turn
        return turn(kwargs["messages"]) if callable(turn) else turn


def _run(monkeypatch, script, *, execute=None, exposed=("revenue_observations", "order_observations"),
         remaining=60.0, cancelled=None, budget=None, steps=None):
    monkeypatch.setattr(agent_gateway, "chat", script)
    executed = []

    def default_execute(name, args):
        executed.append((name, args))
        if name == "revenue_observations":
            return _revenue_result()
        return ToolResult(name, "available", items=[{"id": f"ev_{name}", "metric": "count", "value": 7,
                                                     "unit": "count", "status": "available"}])

    result = rev_agent.run_agent(
        objective={"current_question": "Why did revenue fall this month?", "intent": "revenue_investigation"},
        exposed_tools=list(exposed), execute_store_tool=execute or default_execute,
        remaining_seconds=lambda: remaining, cancelled=cancelled, budget=budget,
        on_step=(steps.append if steps is not None else None))
    return result, executed


def test_model_chooses_tool_sees_real_result_and_finishes_with_grounded_answer(monkeypatch):
    def finish(messages):
        feedback = json.loads(messages[-1]["content"][0]["content"])
        current = next(item for item in feedback["items"] if item["metric"] == "recorded_order_value")
        change = feedback["comparison"]["changes"][0]
        return _turn([_call("finish_answer", {
            "answer_markdown": f"Recorded order value is {current['value']} USD, down {change['percent']}%.",
            "cited_evidence_ids": [current["id"], change["id"]], "evidence_sufficiency": "sufficient",
            "hypotheses": ["A product mix shift may be worth checking."], "unknowns": ["Traffic was not reviewed."]})])

    script = Script(_turn([_call("revenue_observations", {"compare": True})]), finish)
    steps = []
    result, executed = _run(monkeypatch, script, steps=steps)

    assert executed == [("revenue_observations", {"compare": True})]
    assert result["status"] == "completed"
    assert result["answer"]["answer_markdown"].startswith("Recorded order value is 1250.00 USD")
    assert "ev_rev_current" in result["answer"]["cited_evidence_ids"]
    trace = result["trace"]
    assert trace["model_directed"] is True
    assert trace["iterations"] == 2 and trace["calls"] == 1
    assert trace["provider"] == "anthropic" and trace["model"] == "claude-sonnet-4-6"
    assert trace["input_tokens"] == 1000 and trace["output_tokens"] == 80 and trace["token_total"] == 1080
    assert 0 < trace["estimated_cost_usd"] < trace["cost_limit_usd"]
    assert trace["stop_reason"] == "model_finished"
    # Native tool-result feedback, PII scrubbed.
    second = script.requests[1]["messages"]
    assert second[-1]["role"] == "user" and second[-1]["content"][0]["type"] == "tool_result"
    assert "private-buyer@example.test" not in json.dumps(second)
    assert script.requests[0]["tool_choice"] == "required"
    assert [step["status"] for step in steps] == ["running", "completed"]
    assert all(isinstance(step["tool"], str) for step in steps)


def test_model_adapts_after_failed_tool_and_failure_detail_is_not_leaked(monkeypatch):
    def execute(name, args):
        if name == "revenue_observations":
            raise TimeoutError("private database host db-internal-7 timed out")
        return ToolResult(name, "available", items=[{"id": "ev_o", "metric": "order_count", "value": 3,
                                                     "unit": "count", "status": "available"}])

    script = Script(
        _turn([_call("revenue_observations")]),
        _turn([_call("order_observations", {"latest": True})]),
        _turn([_call("finish_answer", {"answer_markdown": "Revenue evidence is unavailable; orders are visible.",
                                       "cited_evidence_ids": ["ev_o"], "evidence_sufficiency": "partial"})]))
    steps = []
    result, _ = _run(monkeypatch, script, execute=execute, steps=steps)
    feedback = script.requests[1]["messages"][-1]["content"][0]
    assert feedback["is_error"] is True
    assert "tool_execution_failed" in feedback["content"] and "not zero" in feedback["content"]
    assert "db-internal-7" not in json.dumps(script.requests)
    assert [entry.tool for entry in result["results"]] == ["order_observations"]
    assert result["trace"]["tool_calls"][0]["status"] == "failed"
    assert result["trace"]["tool_calls"][0]["failure_category"] == "timeout"
    assert {"running", "failed", "completed"} <= {step["status"] for step in steps}
    assert result["status"] == "completed"


def test_parallel_calls_execute_with_one_result_per_call(monkeypatch):
    script = Script(
        _turn([_call("revenue_observations", call_id="a"), _call("order_observations", call_id="b")]),
        _turn([_call("finish_answer", {"answer_markdown": "Both sources were reviewed for the period.",
                                       "cited_evidence_ids": ["ev_rev_current"], "evidence_sufficiency": "partial"})]))
    result, executed = _run(monkeypatch, script)
    assert [name for name, _ in executed] == ["revenue_observations", "order_observations"]
    blocks = script.requests[1]["messages"][-1]["content"]
    assert [block["id"] for block in blocks] == ["a", "b"]
    assert result["trace"]["parallel_turns"] == 1


def test_calls_beyond_parallel_limit_are_refused_but_answered(monkeypatch):
    budget = rev_agent.AgentBudget()
    budget.max_parallel_calls = 1
    script = Script(
        _turn([_call("revenue_observations", call_id="a"), _call("order_observations", call_id="b")]),
        _turn([_call("finish_answer", {"answer_markdown": "Only revenue was reviewed in that turn.",
                                       "cited_evidence_ids": [], "evidence_sufficiency": "partial"})]))
    result, executed = _run(monkeypatch, script, budget=budget)
    assert [name for name, _ in executed] == ["revenue_observations"]
    blocks = script.requests[1]["messages"][-1]["content"]
    assert len(blocks) == 2 and blocks[1]["is_error"] and "parallel_call_limit" in blocks[1]["content"]


def test_unexposed_tool_and_tenant_arguments_are_rejected_server_side(monkeypatch):
    script = Script(
        _turn([_call("customer_observations"), _call("order_observations", {"organization_id": "other-org"})]),
        _turn([_call("finish_answer", {"answer_markdown": "No authorised evidence was gathered for this.",
                                       "cited_evidence_ids": [], "evidence_sufficiency": "insufficient"})]))
    result, executed = _run(monkeypatch, script)
    assert executed == []
    blocks = script.requests[1]["messages"][-1]["content"]
    assert "tool_not_available" in blocks[0]["content"]
    assert "invalid_arguments" in blocks[1]["content"]
    statuses = [call["status"] for call in result["trace"]["tool_calls"]]
    assert statuses == ["rejected_unexposed", "rejected_arguments"]


def test_duplicate_call_is_not_re_executed(monkeypatch):
    script = Script(
        _turn([_call("revenue_observations")]),
        _turn([_call("revenue_observations", call_id="again")]),
        _turn([_call("finish_answer", {"answer_markdown": "Revenue evidence was reviewed once.",
                                       "cited_evidence_ids": ["ev_rev_current"], "evidence_sufficiency": "partial"})]))
    result, executed = _run(monkeypatch, script)
    assert len(executed) == 1
    assert result["trace"]["duplicate_calls"] == 1
    assert "duplicate_call" in script.requests[2]["messages"][-1]["content"][0]["content"]


def test_finish_in_same_turn_as_new_evidence_is_deferred(monkeypatch):
    script = Script(
        _turn([_call("revenue_observations", call_id="r"),
               _call("finish_answer", {"answer_markdown": "Premature answer written before evidence.",
                                       "cited_evidence_ids": [], "evidence_sufficiency": "sufficient"}, "f")]),
        _turn([_call("finish_answer", {"answer_markdown": "Answer written after reviewing revenue evidence.",
                                       "cited_evidence_ids": ["ev_rev_current"], "evidence_sufficiency": "partial"})]))
    result, _ = _run(monkeypatch, script)
    assert "finish_deferred" in script.requests[1]["messages"][-1]["content"][1]["content"]
    assert result["answer"]["answer_markdown"].startswith("Answer written after")


def test_unknown_citation_is_returned_to_model_once(monkeypatch):
    script = Script(
        _turn([_call("revenue_observations")]),
        _turn([_call("finish_answer", {"answer_markdown": "Revenue is in the supplied evidence.",
                                       "cited_evidence_ids": ["ev_made_up"], "evidence_sufficiency": "partial"})]),
        _turn([_call("finish_answer", {"answer_markdown": "Revenue is in the supplied evidence.",
                                       "cited_evidence_ids": ["ev_rev_current"], "evidence_sufficiency": "partial"})]))
    result, _ = _run(monkeypatch, script)
    assert "unknown_evidence_ids" in script.requests[2]["messages"][-1]["content"][0]["content"]
    assert result["answer"]["cited_evidence_ids"] == ["ev_rev_current"]


def test_deterministic_calculation_over_evidence_ids(monkeypatch):
    def finish(messages):
        calc = json.loads(messages[-1]["content"][0]["content"])["calculation"]
        return _turn([_call("finish_answer", {"answer_markdown": f"Order value changed by {calc['value']} USD.",
                                              "cited_evidence_ids": [calc["id"]], "evidence_sufficiency": "sufficient"})])

    script = Script(
        _turn([_call("revenue_observations", {"compare": True})]),
        _turn([_call("calculate", {"operation": "difference", "evidence_ids": ["ev_rev_previous", "ev_rev_current"]})]),
        finish)
    result, _ = _run(monkeypatch, script)
    assert result["calculations"][0]["value"] == "-250.00"
    assert result["calculations"][0]["currency"] == "USD"
    assert result["answer"]["answer_markdown"] == "Order value changed by -250.00 USD."
    assert 250.0 in result["ledger_numbers"]


def test_calculator_refuses_missing_zero_division_and_mixed_currency():
    ledger = rev_agent.EvidenceLedger()
    ledger.register_item({"id": "a", "value": "10.00", "currency": "USD", "unit": "currency", "status": "available"}, "t")
    ledger.register_item({"id": "b", "value": None, "currency": "USD", "unit": "currency", "status": "unavailable"}, "t")
    ledger.register_item({"id": "c", "value": "5.00", "currency": "EUR", "unit": "currency", "status": "available"}, "t")
    ledger.register_item({"id": "z", "value": 0, "unit": "count", "status": "available"}, "t")
    ledger.register_item({"id": "n", "value": 4, "unit": "count", "status": "available"}, "t")
    assert ledger.calculate("sum", ["a", "b"], None)["status"] == "not_computable"
    assert "not zero" in ledger.calculate("sum", ["a", "b"], None)["reason"]
    assert ledger.calculate("sum", ["a", "c"], None)["status"] == "not_computable"
    assert ledger.calculate("percent_change", ["z", "n"], None)["status"] == "not_computable"
    assert ledger.calculate("ratio", ["n", "z"], None)["status"] == "not_computable"
    assert ledger.calculate("percent_change", ["a"], None)["status"] == "invalid"
    assert ledger.calculate("sum", ["a", "ghost"], None)["status"] == "invalid"
    share = ledger.calculate("share_of_total", ["n", "n"], None)
    assert share["calculation"]["value"] == "100.00" and share["calculation"]["unit"] == "percent"
    aov = ledger.calculate("ratio", ["a", "n"], "average order value")
    assert aov["calculation"]["value"] == "2.50" and aov["calculation"]["currency"] == "USD"


def test_provider_unavailable_runs_no_tools_and_claims_nothing(monkeypatch):
    script = Script(ModelProviderError("anthropic", "missing_key", category="provider_unavailable"))
    result, executed = _run(monkeypatch, script)
    assert executed == []
    assert result["status"] == "provider_unavailable"
    assert result["trace"]["model_directed"] is False
    assert result["answer"] is None


def test_provider_failure_after_evidence_preserves_partial_results(monkeypatch):
    error = ModelProviderError("anthropic", 503, model="claude-sonnet-4-6", attempts=2, fallback_used=True)
    script = Script(_turn([_call("revenue_observations")]), error)
    result, executed = _run(monkeypatch, script)
    assert len(executed) == 1 and len(result["results"]) == 1
    assert result["status"] == "partial_provider_failure"
    assert result["trace"]["retry_count"] == 1 and result["trace"]["fallback_used"] is True


def test_cancellation_before_start_and_during_provider_turn(monkeypatch):
    script = Script()
    result, executed = _run(monkeypatch, script, cancelled=lambda: True)
    assert result["status"] == "cancelled" and executed == [] and script.requests == []
    script = Script(agent_gateway.AgentCancelled("stop"))
    result, _ = _run(monkeypatch, script)
    assert result["status"] == "cancelled" and result["trace"]["cancelled"] is True


def test_loop_obeys_iteration_tool_and_token_bounds(monkeypatch):
    budget = rev_agent.AgentBudget()
    budget.max_iterations, budget.max_tool_calls = 4, 2

    def keep_calling(messages):
        return _turn([_call("order_observations", {"latest": True, "compare": bool(len(messages) % 2)},
                            call_id=f"c{len(messages)}")])

    script = Script(*([keep_calling] * 4))
    result, executed = _run(monkeypatch, script, budget=budget)
    assert len(script.requests) <= 4
    assert result["trace"]["calls"] <= 2 and len(executed) <= 2
    assert result["status"] == "budget_exhausted"
    assert all(request["max_tokens"] == budget.max_output_tokens_per_turn for request in script.requests)
    # Once the tool budget is spent, only the final-answer tools are offered.
    assert script.requests[-1]["tools"] == ["finish_answer", "request_clarification"]


def test_cost_and_deadline_bounds_stop_the_loop(monkeypatch):
    budget = rev_agent.AgentBudget()
    budget.max_cost_usd = 0.001
    script = Script(_turn([_call("revenue_observations")], input_tokens=50_000, output_tokens=2_000))
    result, _ = _run(monkeypatch, script, budget=budget)
    assert result["status"] == "budget_exhausted" and result["trace"]["stop_reason"] == "max_cost"
    result, _ = _run(monkeypatch, Script(), remaining=2.0)
    assert result["trace"]["stop_reason"] == "deadline"


def test_malformed_outputs_are_bounded(monkeypatch):
    script = Script(_turn([], text=""), _turn([], text=""))
    result, _ = _run(monkeypatch, script)
    assert result["status"] == "malformed_output"
    assert result["trace"]["malformed_outputs"] == 2


def test_clarification_is_a_terminal_model_decision(monkeypatch):
    script = Script(_turn([_call("request_clarification", {"question": "Which store should I look at?"})]))
    result, executed = _run(monkeypatch, script)
    assert executed == []
    assert result["status"] == "clarification_requested"
    assert result["clarification"]["question"] == "Which store should I look at?"


def test_private_data_never_reaches_public_web_query(monkeypatch):
    searched = []
    monkeypatch.setattr(agent_gateway, "web_search", lambda query, **kwargs: (searched.append(query), {
        "status": "ok", "summary": "Public benchmark summary.", "sources": [
            {"url": "https://benchmarks.example.org/aov", "title": "Benchmarks"}],
        "provider": "anthropic", "model": "claude-haiku-4-5-20251001", "usage": {}, "searches": 1})[1])
    script = Script(
        _turn([_call("web_research", {"query": "conversion for mystore.myshopify.com order #10234"})]),
        _turn([_call("web_research", {"query": "average ecommerce conversion rate benchmark 2026"})]),
        _turn([_call("finish_answer", {"answer_markdown": "Public benchmarks are summarised from cited sources.",
                                       "cited_evidence_ids": ["web_1"], "evidence_sufficiency": "partial"})]))
    result, _ = _run(monkeypatch, script, exposed=("revenue_observations", "web_research"))
    assert searched == ["average ecommerce conversion rate benchmark 2026"]
    assert result["web_sources"][0]["url"] == "https://benchmarks.example.org/aov"
    assert result["answer"]["cited_evidence_ids"] == ["web_1"]


def test_exposure_is_objective_filtered_and_excludes_server_gate():
    exposed = rev_agent.select_tool_exposure(
        intent="checkout_investigation",
        plan_tools=["store_health", "integration_health", "data_coverage", "checkout_observations"],
        available={"integration_health", "data_coverage", "checkout_observations", "cart_observations",
                   "order_observations", "findings", "customer_observations", "inventory_observations"})
    assert "store_health" not in exposed
    assert "checkout_observations" in exposed and "cart_observations" in exposed
    assert "inventory_observations" not in exposed and "customer_observations" not in exposed
    assert len(exposed) <= rev_agent.MAX_EXPOSED_EVIDENCE_TOOLS


def test_large_tool_result_feedback_is_bounded_json():
    items = [{"id": f"ev_{i}", "metric": f"m{i}", "label": "x" * 400, "value": i, "unit": "count",
              "status": "available", "definition": "d" * 400} for i in range(25)]
    text = rev_agent._compact_result(ToolResult("product_observations", "available", items=items),
                                     rev_agent.EvidenceLedger(), 4000)
    assert len(text) <= 4000
    assert json.loads(text)["tool"] == "product_observations"


# ---------------------------------------------------------------------------
# Gateway wire format (HTTP boundary synthetic)
# ---------------------------------------------------------------------------

class _FakeClient:
    responses: list = []
    requests: list = []

    def __init__(self, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, url, headers=None, json=None):
        _FakeClient.requests.append({"url": url, "headers": headers, "json": json})
        status, body = _FakeClient.responses.pop(0)
        return SimpleNamespace(status_code=status, json=lambda: body)


@pytest.fixture
def fake_http(monkeypatch):
    _FakeClient.responses, _FakeClient.requests = [], []
    monkeypatch.setattr(agent_gateway.httpx, "Client", _FakeClient)
    monkeypatch.delenv("AI_FALLBACK_PROVIDERS", raising=False)
    monkeypatch.delenv("ANTHROPIC_FALLBACK_MODEL", raising=False)
    return _FakeClient


TOOLS = [{"name": "revenue_observations", "description": "Revenue.",
          "input_schema": {"type": "object", "properties": {"compare": {"type": "boolean"}},
                           "required": [], "additionalProperties": False}}]


def test_anthropic_native_tool_use_round_trip(monkeypatch, fake_http):
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    fake_http.responses.append((200, {
        "content": [{"type": "text", "text": "Checking."},
                    {"type": "tool_use", "id": "toolu_1", "name": "revenue_observations", "input": {"compare": True}}],
        "stop_reason": "tool_use", "usage": {"input_tokens": 321, "output_tokens": 45}}))
    messages = [{"role": "user", "content": [{"type": "text", "text": "objective"}]}]
    response = agent_gateway.chat(system="sys", messages=messages, tools=TOOLS, tool_choice="required")
    request = fake_http.requests[0]
    assert request["url"] == agent_gateway.ANTHROPIC_URL
    assert request["json"]["tool_choice"] == {"type": "any"}
    assert request["json"]["tools"][0]["input_schema"]["properties"] == {"compare": {"type": "boolean"}}
    assert response["tool_calls"] == [{"id": "toolu_1", "name": "revenue_observations", "arguments": {"compare": True}}]
    assert response["usage"] == {"input_tokens": 321, "output_tokens": 45}
    assert response["provider"] == "anthropic" and response["model"] == "claude-sonnet-4-6"
    assert response["fallback_used"] is False and response["attempts"] == 1

    fake_http.responses.append((200, {"content": [{"type": "text", "text": "Done."}], "stop_reason": "end_turn",
                                      "usage": {"input_tokens": 400, "output_tokens": 5}}))
    follow = messages + [response["assistant"], {"role": "user", "content": [
        {"type": "tool_result", "id": "toolu_1", "name": "revenue_observations", "content": "{}"}]}]
    agent_gateway.chat(system="sys", messages=follow, tools=TOOLS)
    wire = fake_http.requests[1]["json"]["messages"]
    assert wire[1]["content"][1] == {"type": "tool_use", "id": "toolu_1", "name": "revenue_observations",
                                     "input": {"compare": True}}
    assert wire[2]["content"][0]["type"] == "tool_result" and wire[2]["content"][0]["tool_use_id"] == "toolu_1"


def test_gemini_native_function_calling_round_trip(monkeypatch, fake_http):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "g-test")
    raw_parts = [{"functionCall": {"name": "revenue_observations", "args": {"compare": True}},
                  "thoughtSignature": "sig"}]
    fake_http.responses.append((200, {"candidates": [{"content": {"parts": raw_parts}, "finishReason": "STOP"}],
                                      "usageMetadata": {"promptTokenCount": 43, "candidatesTokenCount": 9}}))
    messages = [{"role": "user", "content": [{"type": "text", "text": "objective"}]}]
    response = agent_gateway.chat(system="sys", messages=messages, tools=TOOLS, tool_choice="required")
    body = fake_http.requests[0]["json"]
    assert body["toolConfig"]["functionCallingConfig"]["mode"] == "ANY"
    assert body["tools"][0]["functionDeclarations"][0]["parameters"]["type"] == "OBJECT"
    assert "additionalProperties" not in json.dumps(body["tools"])
    assert response["tool_calls"][0]["name"] == "revenue_observations"
    assert response["usage"] == {"input_tokens": 43, "output_tokens": 9}
    fake_http.responses.append((200, {"candidates": [{"content": {"parts": [{"text": "ok"}]}}], "usageMetadata": {}}))
    agent_gateway.chat(system="sys", messages=messages + [response["assistant"], {"role": "user", "content": [
        {"type": "tool_result", "id": response["tool_calls"][0]["id"], "name": "revenue_observations",
         "content": json.dumps({"status": "available"})}]}], tools=TOOLS)
    contents = fake_http.requests[1]["json"]["contents"]
    assert contents[1] == {"role": "model", "parts": raw_parts}  # thought signature preserved
    assert contents[2]["parts"][0]["functionResponse"]["name"] == "revenue_observations"


def test_gateway_records_actual_fallback_model_never_primary(monkeypatch, fake_http):
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("GEMINI_API_KEY", "g-test")
    monkeypatch.setenv("AI_FALLBACK_PROVIDERS", "gemini")
    fake_http.responses.extend([
        (529, {"error": {"type": "overloaded_error", "message": "secret detail"}}),
        (200, {"candidates": [{"content": {"parts": [{"text": "fallback answer"}]}}],
               "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 2}}),
    ])
    response = agent_gateway.chat(system="s", messages=[{"role": "user", "content": [{"type": "text", "text": "q"}]}],
                                  tools=TOOLS)
    assert response["provider"] == "gemini" and response["fallback_used"] is True
    assert response["attempt_log"][0]["provider"] == "anthropic"
    assert response["attempt_log"][0]["outcome"] == "failure"


def test_gateway_does_not_fallback_on_permanent_errors_or_without_authorisation(monkeypatch, fake_http):
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("GEMINI_API_KEY", "g-test")
    fake_http.responses.append((401, {"error": {"type": "authentication_error"}}))
    with pytest.raises(ModelProviderError) as caught:
        agent_gateway.chat(system="s", messages=[{"role": "user", "content": [{"type": "text", "text": "q"}]}],
                           tools=TOOLS)
    assert caught.value.category == "authorization_failed"
    assert len(fake_http.requests) == 1  # no silent cross-provider substitution


def test_gateway_without_keys_reports_unavailable(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("AI_FALLBACK_PROVIDERS", raising=False)
    with pytest.raises(ModelProviderError) as caught:
        agent_gateway.chat(system="s", messages=[{"role": "user", "content": [{"type": "text", "text": "q"}]}],
                           tools=TOOLS)
    assert caught.value.category == "provider_unavailable"
    status = agent_gateway.agent_capability_status()
    assert status["primary_ready"] is False and status["tool_calling"] == []


def test_gateway_cancellation_returns_promptly(monkeypatch):
    import threading
    import time as _time

    release = threading.Event()
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setitem(agent_gateway._CHAT_IMPLEMENTATIONS, "anthropic",
                        lambda *args, **kwargs: (release.wait(5), {})[1])
    flag = {"stop": False}
    threading.Timer(0.2, lambda: flag.update(stop=True)).start()
    started = _time.monotonic()
    with pytest.raises(agent_gateway.AgentCancelled):
        agent_gateway.chat(system="s", messages=[{"role": "user", "content": [{"type": "text", "text": "q"}]}],
                           tools=TOOLS, timeout=10, cancelled=lambda: flag["stop"])
    assert _time.monotonic() - started < 2.0
    release.set()


def test_anthropic_web_search_extracts_verified_sources(monkeypatch, fake_http):
    agent_gateway.clear_web_cache()
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    fake_http.responses.append((200, {
        "content": [
            {"type": "server_tool_use", "id": "s1", "name": "web_search", "input": {"query": "q"}},
            {"type": "web_search_tool_result", "tool_use_id": "s1", "content": [
                {"type": "web_search_result", "url": "https://shopify.dev/changelog", "title": "Changelog",
                 "page_age": "2026-11-01"},
                {"type": "web_search_result", "url": "http://insecure.example", "title": "x"}]},
            {"type": "text", "text": "Shopify announced a checkout update.",
             "citations": [{"type": "web_search_result_location", "url": "https://shopify.dev/changelog",
                            "title": "Changelog"}]}],
        "usage": {"input_tokens": 1200, "output_tokens": 90, "server_tool_use": {"web_search_requests": 1}}}))
    result = agent_gateway.web_search("latest shopify checkout changes")
    body = fake_http.requests[0]["json"]
    assert body["tools"][0]["type"] == agent_gateway.ANTHROPIC_WEB_SEARCH_TOOL
    assert result["status"] == "ok" and result["provider"] == "anthropic"
    assert [source["url"] for source in result["sources"]] == ["https://shopify.dev/changelog"]
    assert result["searches"] == 1
    cached = agent_gateway.web_search("latest  Shopify checkout changes")
    assert cached["cache_hit"] is True and len(fake_http.requests) == 1


def test_web_search_without_sources_is_not_ok(monkeypatch, fake_http):
    agent_gateway.clear_web_cache()
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    fake_http.responses.append((200, {"content": [{"type": "text", "text": "I believe the answer is X."}],
                                      "usage": {"input_tokens": 10, "output_tokens": 5}}))
    result = agent_gateway.web_search("obscure question")
    assert result["status"] == "no_sources" and result["sources"] == []


def test_database_transaction_is_released_before_every_model_turn(monkeypatch):
    released = []
    script = Script(
        _turn([_call("revenue_observations")]),
        _turn([_call("finish_answer", {"answer_markdown": "Revenue evidence was reviewed for the period.",
                                       "cited_evidence_ids": ["ev_rev_current"], "evidence_sufficiency": "partial"})]))
    monkeypatch.setattr(agent_gateway, "chat", lambda **kw: (released.append(len(script.requests)), script(**kw))[1])
    rev_agent.run_agent(objective={"q": "x"}, exposed_tools=["revenue_observations"],
                        execute_store_tool=lambda name, args: _revenue_result(),
                        remaining_seconds=lambda: 60, before_model_turn=lambda: released.append("release"))
    assert released == ["release", 0, "release", 1]


def test_rev_stream_store_question_runs_native_agent_end_to_end(monkeypatch):
    """HTTP route + investigation pipeline + agent runtime execute for real;
    only the provider boundary is scripted."""
    from fastapi.testclient import TestClient

    from src.serving import api
    from tests.test_rev_investigation import CONV, ORG, USER, workspace_db

    async def allow():
        return None

    monkeypatch.setitem(api.app.dependency_overrides, api.verify_internal_caller, allow)
    monkeypatch.setattr(api, "_Session", lambda: workspace_db())

    def finish(messages):
        payload = json.loads(messages[-1]["content"][0]["content"])
        item = next(entry for entry in payload["items"] if entry["metric"] == "recorded_order_value")
        return _turn([_call("finish_answer", {
            "answer_markdown": f"Recorded order value this week is {item['value']} {item['currency']}.",
            "cited_evidence_ids": [item["id"]], "evidence_sufficiency": "partial"})], provider="gemini",
            model="gemini-2.5-flash")

    script = Script(_turn([_call("revenue_observations", {"compare": True})], provider="gemini",
                          model="gemini-2.5-flash"), finish)
    monkeypatch.setattr(agent_gateway, "chat", script)
    response = TestClient(api.app).post("/rev/stream", json={
        "contract_version": "1.0", "organization_id": ORG, "user_id": USER, "conversation_id": CONV,
        "message": "Why did my revenue fall this week?"})
    assert response.status_code == 200
    events = []
    for frame in response.text.strip().split("\n\n"):
        lines = frame.splitlines()
        if lines and lines[0].startswith("event: "):
            events.append((lines[0][7:], json.loads("\n".join(
                line[6:] for line in lines[1:] if line.startswith("data: ")) or "{}")))
    names = [name for name, _ in events]
    assert names[0] == "accepted" and names[-1] == "final"
    assert names.index("plan") < names.index("step")
    for name, data in events:
        if name == "step":
            assert isinstance(data["tool"], str)
            assert data["status"] in {"pending", "running", "completed", "failed", "skipped"}
    final = events[-1][1]
    assert final["success"] is True and final["read_only"] is True
    assert final["text"].startswith("Recorded order value this week is")
    assert final["execution_trace"]["provider"] == "gemini"
    assert final["execution_trace"]["model"] == "gemini-2.5-flash"
    assert final["execution_trace"]["agent"]["model_directed"] is True
    assert final["orchestration"]["objective_agent"]["stop_reason"] == "model_finished"
    assert len(set(final["orchestration"]["tools"])) == len(final["orchestration"]["tools"]) <= 12
