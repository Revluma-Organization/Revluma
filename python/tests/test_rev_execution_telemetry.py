"""Structured execution telemetry and request-scoped reuse (requirements 2 and 3).

Unit tests for ``ExecutionRecorder`` and ``RequestToolMemo`` plus
PROVIDER-MOCKED integration tests through ``run_investigation`` (real
runtime, scripted Gemini HTTP endpoint via ``tests.rev_provider_fakes``).
They prove the telemetry contract, not production latency or quality.
"""
from __future__ import annotations

import json
import logging
import threading
from types import SimpleNamespace

import pytest

from src.agents import investigation
from src.intelligence import execution_telemetry as telemetry
from src.intelligence.evidence_cache import RequestToolMemo
from tests.rev_provider_fakes import FakeGemini, understanding
from tests.test_rev_investigation import CONV, ORG, USER, workspace_db

SECRET_MESSAGE = "Why did revenue fall for owner@example.com order #48213?"


def _records(caplog) -> list[dict]:
    return [json.loads(record.getMessage().split(" ", 1)[1]) for record in caplog.records
            if record.name == "rev.execution_telemetry" and record.getMessage().startswith("rev_execution_record ")]


# ---------------------------------------------------------------------------
# ExecutionRecorder privacy contract
# ---------------------------------------------------------------------------

def test_recorder_accepts_only_tokens_numbers_and_identifiers():
    recorder = telemetry.ExecutionRecorder(execution_id="exec-1", correlation_id="not a valid id!",
                                           organization_id=ORG)
    recorder.set_objective(intent="revenue_investigation", request_class=SECRET_MESSAGE)
    recorder.set_routing(gate="tools", sources=["tenant_memory", "owner@example.com is private"],
                         followup=1, confidence=7)
    recorder.record_model_call(provider="gemini", model="gemini-2.5-flash", duration_ms=12.5,
                               input_tokens=100, output_tokens=20, purpose="agent_turn")
    recorder.record_tool("revenue_observations", "available", 4.2)
    recorder.note_failure("Traceback: secret stack with owner@example.com")
    summary = recorder.summary(final_status="completed", outcome="answered")

    blob = json.dumps(summary)
    assert "owner@example.com" not in blob and "48213" not in blob and "Traceback" not in blob
    assert summary["identifiers"]["execution_id"] == "exec-1"
    assert summary["identifiers"]["correlation_id"] is None
    assert summary["objective"] == {"intent": "revenue_investigation", "request_class": None}
    assert summary["routing"]["sources"] == ["tenant_memory"]
    assert summary["routing"]["followup"] is True and summary["routing"]["confidence"] == 1.0
    assert summary["model_calls"][0]["purpose"] == "agent_turn"
    assert summary["token_usage"]["total"] == 120 and summary["token_usage"]["scope"] == "all_model_calls"
    assert summary["failure_category"] is None


def test_module_helpers_are_no_ops_outside_an_execution():
    assert telemetry.current() is None
    telemetry.record_model_call(provider="gemini", model="m")
    telemetry.record_tool("revenue_observations", "available", 1)
    telemetry.record_cache("request_tool_memo", "hit")
    telemetry.record_knowledge("revluma_product_docs", "ok", result_count=1)


def test_recorder_bounds_model_calls():
    recorder = telemetry.ExecutionRecorder()
    for _ in range(telemetry.MAX_MODEL_CALLS + 5):
        recorder.record_model_call(provider="gemini", model="m", purpose="agent_turn")
    summary = recorder.summary(final_status="completed")
    assert len(summary["model_calls"]) == telemetry.MAX_MODEL_CALLS
    assert summary["dropped"]["model_calls"] == 5


# ---------------------------------------------------------------------------
# RequestToolMemo: reuse within one request only, never failed evidence
# ---------------------------------------------------------------------------

def test_memo_reuses_identical_usable_calls_within_one_request():
    calls = []

    def run(tool, params):
        calls.append((tool, params))
        return SimpleNamespace(status="available", items=[len(calls)])

    memo = RequestToolMemo(run=run)
    first = memo("revenue_observations", {"compare": True, "window": "w1"})
    second = memo("revenue_observations", {"window": "w1", "compare": True})  # same params, other order
    other = memo("revenue_observations", {"compare": False, "window": "w1"})

    assert second is first and other is not first
    assert len(calls) == 2 and memo.stats == {"executed": 2, "reused": 1}


def test_memo_never_reuses_failed_or_unavailable_evidence():
    statuses = iter(["storage_failure", "unavailable", "available"])
    memo = RequestToolMemo(run=lambda tool, params: SimpleNamespace(status=next(statuses)))

    assert memo("refund_observations", {}).status == "storage_failure"
    assert memo("refund_observations", {}).status == "unavailable"
    assert memo("refund_observations", {}).status == "available"
    assert memo.stats == {"executed": 3, "reused": 0}


def test_memo_is_not_shared_between_requests():
    calls = []
    run = lambda tool, params: calls.append(tool) or SimpleNamespace(status="available")  # noqa: E731

    RequestToolMemo(run=run)("order_observations", {})
    RequestToolMemo(run=run)("order_observations", {})
    assert calls == ["order_observations", "order_observations"]


def test_memo_records_reuse_in_telemetry():
    recorder = telemetry.ExecutionRecorder()
    memo = RequestToolMemo(run=lambda tool, params: SimpleNamespace(status="partial"))
    with telemetry.recording(recorder):
        memo("checkout_observations", {})
        memo("checkout_observations", {})
    summary = recorder.summary(final_status="completed")
    assert summary["cache"]["request_tool_memo"] == {"store": 1, "hit": 1}
    assert summary["tool_reuse_count"] == 1


# ---------------------------------------------------------------------------
# One record per execution: success, failure, cancellation (scripted provider)
# ---------------------------------------------------------------------------

@pytest.fixture
def provider(monkeypatch):
    return FakeGemini().install(monkeypatch)


def test_successful_execution_emits_exactly_one_content_free_record(monkeypatch, provider, caplog):
    caplog.set_level(logging.INFO, logger="rev.execution_telemetry")
    provider.understand = lambda message: understanding("diagnosis", store=True, mode="analysis",
                                                        domains=["revenue"])

    def finish(view):
        item = next(entry for entry in view["results"]["revenue_observations"][0]["items"]
                    if entry["metric"] == "recorded_order_value")
        return [provider.call("finish_answer", {
            "answer_markdown": f"Recorded order value is {item['value']} {item['currency']}.",
            "cited_evidence_ids": [item["id"]], "evidence_sufficiency": "partial"})]

    provider.agent_turns = [lambda view: [provider.call("revenue_observations")], finish]
    result = investigation.run_investigation(ORG, USER, SECRET_MESSAGE, conversation_id=CONV,
                                             db=workspace_db())

    records = _records(caplog)
    assert len(records) == 1
    record = records[0]
    assert record == result["execution_trace"]["telemetry"]
    assert record["final_status"] == "completed" and record["cancelled"] is False
    assert record["identifiers"]["conversation_id"] == CONV
    assert record["identifiers"]["execution_id"] == result["execution_trace"]["investigation_id"]
    assert record["objective"]["intent"] == "revenue_investigation"
    assert {call["provider"] for call in record["model_calls"]} == {"gemini"}
    assert [call["purpose"] for call in record["model_calls"]].count("agent_turn") == 2
    assert all(call["model"] for call in record["model_calls"])
    assert "agent_loop" in [stage["stage"] for stage in record["stages"]]
    assert all(stage["duration_ms"] is not None for stage in record["stages"])
    blob = json.dumps(record)
    for needle in ("owner@example.com", "48213", "Why did revenue", "30.31"):
        assert needle not in blob


def test_failed_execution_emits_one_record_with_a_failure_category(monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="rev.execution_telemetry")
    for name in ("GEMINI_API_KEY", "ANTHROPIC_API_KEY", "AI_FALLBACK_PROVIDERS", "OPENAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("REV_NARRATIVE_LLM", "false")

    with pytest.raises(Exception) as raised:
        investigation.run_investigation(ORG, USER, "How does Revluma define refund rate?",
                                        conversation_id=CONV, db=workspace_db())

    assert type(raised.value).__name__ == "ModelProviderError"
    records = _records(caplog)
    assert len(records) == 1
    assert records[0]["final_status"] == "failed"
    assert records[0]["failure_category"]
    assert records[0]["cancelled"] is False


def test_cancelled_execution_emits_one_record_marked_cancelled(monkeypatch, provider, caplog):
    caplog.set_level(logging.INFO, logger="rev.execution_telemetry")
    provider.understand = lambda message: understanding("diagnosis", store=True, mode="analysis",
                                                        domains=["revenue"])
    cancel = threading.Event()

    def stop(view):
        cancel.set()  # the merchant pressed stop while the model was thinking
        return [provider.call("revenue_observations")]

    provider.agent_turns = [stop]
    with pytest.raises(investigation.InvestigationCancelled):
        investigation.run_investigation(ORG, USER, "Why did my revenue fall this week?",
                                        conversation_id=CONV, db=workspace_db(), cancel_event=cancel)

    records = _records(caplog)
    assert len(records) == 1
    assert records[0]["cancelled"] is True and records[0]["final_status"] == "cancelled"
    assert records[0]["failure_category"] is None
