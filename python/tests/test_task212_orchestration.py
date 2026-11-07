"""Task 212 orchestration-level deadline, retry and consistency checks."""
import time
from decimal import Decimal

import pytest

import src.agents.investigation as investigation
from src.agents.investigation import run_investigation
from src.intelligence.conversation_reliability import validate_context_summary
from src.intelligence.reliability import InvestigationDeadline
from tests.test_rev_investigation import NOW, ORG, USER, CONV, order_fixture, workspace_db


def test_analysis_projects_tenant_safe_bounded_conversation_summary():
    result = run_investigation(ORG, USER, "Why did my revenue fall?", db=workspace_db(),
                               conversation_id=CONV, now=NOW, persist=False)
    summary = result["structured_summary"]
    assert not validate_context_summary(summary, organization_id=ORG, conversation_id=CONV)
    assert summary["summary_method"] == "deterministic_bounded_projection_no_model"
    assert summary["active_investigation_id"] == result["investigation"]["id"]
    assert summary["reporting_period"] == result["investigation"]["period"]
    assert result["consistency"]["contract_version"] == "rev-consistency-v1"
    assert result["reliability"]["contract_version"] == "rev-reliability-v1"


def test_equivalent_repeat_uses_current_deterministic_calculation_not_model_prose(monkeypatch):
    first = run_investigation(ORG, USER, "Why did revenue fall?", db=workspace_db(),
                              conversation_id=CONV, now=NOW, persist=False)
    def forbidden(*args, **kwargs):
        raise AssertionError("model composition must not run for an unchanged canonical repeat")
    monkeypatch.setattr(investigation, "_compose_narrative", forbidden)
    second = run_investigation(
        ORG, USER, "Why was my revenue lower?", db=workspace_db(),
        conversation_id=CONV, now=NOW, persist=False,
        context_payload={"conversation_context": {"context_window": {
            "last_consistency": first["consistency"],
        }}})
    assert second["consistency"]["status"] == "unchanged"
    semantic = lambda result: [(item["metric"], item["value"], item["currency"], item["period"])
                               for item in result["evidence"]["items"]]
    assert semantic(second) == semantic(first)
    first_confidence = first["response"]["confidence"]
    second_confidence = second["response"]["confidence"]
    for key in ("category", "coverage", "communication"):
        assert second_confidence[key] == first_confidence[key]
    assert sorted(second_confidence["claims"].values(), key=str) == sorted(
        first_confidence["claims"].values(), key=str)


def test_changed_evidence_recalculates_and_discloses_snapshot_change(monkeypatch):
    monkeypatch.setenv("REV_NARRATIVE_LLM", "false")
    first = run_investigation(ORG, USER, "Why did revenue fall?", db=workspace_db(),
                              now=NOW, persist=False)
    changed_db = workspace_db(order_rows=[order_fixture("USD", 3, "42.50")])
    second = run_investigation(
        ORG, USER, "Why did revenue fall?", db=changed_db, conversation_id=CONV, now=NOW, persist=False,
        context_payload={"conversation_context": {"context_window": {
            "last_consistency": first["consistency"],
        }}})
    assert second["consistency"]["status"] == "evidence_changed"
    assert "evidence_snapshot" in second["consistency"]["changed_fields"]
    assert "Updated evidence" in second["text"]
    assert "42.50" in second["text"]


def test_overall_deadline_fails_remaining_domains_without_empty_success(monkeypatch):
    def expired(*args, **kwargs):
        return InvestigationDeadline(time.monotonic() - 2, 1000)
    monkeypatch.setattr(investigation.InvestigationDeadline, "start", expired)
    result = run_investigation(ORG, USER, "Investigate revenue and carts", db=workspace_db(),
                               now=NOW, persist=False,
                               context_payload={"execution_policy": {"overall_timeout_ms": 1000}})
    failures = result["reliability"]["failures"]
    assert failures and all(failure["category"] == "timeout" for failure in failures)
    assert result["investigation"]["status"] in {"partial", "insufficient_data"}
    assert result["response_type"] == "analysis"
    assert result["investigation_outcome"]["outcome"] not in {"success", "complete", "completed"}
    assert any(step["status"] == "failed" for step in result["investigation"]["steps"])


def test_transient_retrieval_retries_once_and_permanent_failure_does_not_retry(monkeypatch):
    original = investigation.run_tool
    attempts = {"transient": 0, "permanent": 0}
    def controlled(tool, *args, **kwargs):
        if tool == "revenue_observations":
            attempts["transient"] += 1
            if attempts["transient"] == 1:
                raise TimeoutError("synthetic transient")
        if tool == "checkout_observations":
            attempts["permanent"] += 1
            raise ValueError("synthetic permanent")
        return original(tool, *args, **kwargs)
    monkeypatch.setattr(investigation, "run_tool", controlled)
    result = run_investigation(ORG, USER, "Investigate revenue and carts", db=workspace_db(),
                               now=NOW, persist=False)
    assert attempts == {"transient": 2, "permanent": 1}
    assert result["evidence"]["items"]
    assert result["investigation"]["status"] in {"partial", "insufficient_data"}
    assert any(failure["category"] == "schema_validation_failed" for failure in result["reliability"]["failures"])
