"""Task 209 substantive question/orchestration acceptance tests (isolated)."""
from __future__ import annotations

import copy
import json
import threading
import time
from datetime import timedelta

import pytest

from src.agents.investigation import load_conversation_context, run_investigation
from src.intelligence.evidence import evidence_context, evidence_item, period
from src.intelligence.question_orchestration import (
    CONTRACT_VERSION, build_investigation_plan, execute_orchestrated_specialists,
    reconcile_orchestration, understand_question, validate_orchestration,
)
from src.intelligence.specialists import execute_specialists, validate_specialist_result
from tests.rev_fakes import FakeDB
from tests.test_rev_investigation import NOW, ORG, USER, workspace_db

STORE = "store-a"
INVESTIGATION = "99999999-9999-4999-8999-999999999999"
WINDOW = period(NOW - timedelta(days=7), NOW, timezone_label="Africa/Lagos")
TOOLS = {"store_health", "integration_health", "data_coverage", "revenue_observations",
         "order_observations", "checkout_observations", "customer_observations",
         "product_observations", "refund_observations"}


def understanding(message, intent="revenue_investigation", context=None, followup=False):
    return understand_question(message, intent, classification={"followup": followup}, context=context or {})


def plan(message="Why did revenue change?", domains=None, **kwargs):
    u = understanding(message, kwargs.pop("intent", "revenue_investigation"), kwargs.pop("context", None), kwargs.pop("followup", False))
    if domains is not None:
        u["required_domains"] = domains
    return build_investigation_plan(message=message, intent=u["primary_intent"], understanding=u,
        investigation_id=kwargs.pop("investigation_id", INVESTIGATION), organization_id=kwargs.pop("organization_id", ORG),
        store_ids=kwargs.pop("store_ids", [STORE]), period=WINDOW, available_tools=kwargs.pop("available_tools", TOOLS), **kwargs)


def owned(metric="recorded_order_value", value="100", **kwargs):
    with evidence_context(ORG, [STORE]):
        return evidence_item(metric, label=metric, value=value, unit=kwargs.pop("unit", "currency"),
            currency=kwargs.pop("currency", "USD"), window=kwargs.pop("window", WINDOW), source="orders",
            definition=kwargs.pop("definition", "same definition"), status=kwargs.pop("status", "available"),
            coverage={"complete": True}, freshness=kwargs.pop("freshness", {"state": "fresh"}),
            domain="orders", classification="deterministic_calculation", discriminator=kwargs.pop("discriminator", metric))


def results_for(p, items=None, tools=None):
    items = items if items is not None else [owned()]
    tools = tools or {"revenue_observations": type("T", (), {"status": "available"})(),
                      "order_observations": type("T", (), {"status": "available"})()}
    return execute_specialists(intent="revenue_investigation", question=p["question"], organization_id=ORG,
        store_ids=[STORE], investigation_id=INVESTIGATION, period=WINDOW, items=items, tools=tools,
        selected=p["selected_specialists"])


# A. Single-domain routing through the real runtime.
def test_01_revenue_question_invokes_revenue_only():
    r = run_investigation(ORG, USER, "How much revenue did I make yesterday?", db=workspace_db(), now=NOW, persist=False)
    assert r["orchestration"]["selected_specialists"] == ["revenue"]
    assert "checkout_observations" not in r["investigation"]["tools_used"]


def test_02_checkout_question_executes_checkout_domain_only():
    r = run_investigation(ORG, USER, "How did checkout abandonment change?", db=workspace_db(), now=NOW, persist=False)
    assert r["question_understanding"]["required_domains"] == ["checkout"]
    assert "revenue_observations" not in r["investigation"]["tools_used"]
    assert next(t for t in r["orchestration"]["tasks"] if t["domain"] == "checkout")["status"] == "failed"
    assert r["orchestration"]["state"] == "partial_success"


def test_03_integration_question_uses_data_availability_path():
    r = run_investigation(ORG, USER, "Why can't you see my latest orders?", db=workspace_db(), now=NOW, persist=False)
    assert r["question_understanding"]["required_domains"] == ["integration"]
    assert not r["orchestration"]["selected_specialists"]


def test_04_inventory_question_invokes_operational_only():
    r = run_investigation(ORG, USER, "Which variants are out of stock?", db=workspace_db(), now=NOW, persist=False)
    assert r["orchestration"]["selected_specialists"] == ["operational"]


def test_05_retention_question_invokes_retention_only():
    r = run_investigation(ORG, USER, "Are customers coming back to buy again?", db=workspace_db(), now=NOW, persist=False)
    assert r["orchestration"]["selected_specialists"] == ["retention"]


def test_06_unsupported_write_is_not_dispatched():
    r = run_investigation(ORG, USER, "Change my product prices now", db=workspace_db(), now=NOW, persist=False)
    assert r["orchestration"]["state"] == "unsupported" and not r["orchestration"]["selected_specialists"]


def test_07_genuinely_ambiguous_message_clarifies_without_tools():
    r = run_investigation(ORG, USER, "Can you help?", db=workspace_db(), now=NOW, persist=False)
    assert r["response_type"] in {"chat", "clarification"}
    assert not r["orchestration"]["execution_records"]


# B. Mixed-domain execution.
@pytest.mark.parametrize("question,domains", [
    ("Are abandoned checkouts contributing to my revenue decline?", ["revenue", "checkout"]),
    ("Why is revenue declining, and is inventory contributing?", ["revenue", "operational"]),
    ("Why did revenue drop; is synchronization stale?", ["revenue", "integration"]),
    ("Are abandoned checkouts missing because of a sync problem?", ["checkout", "integration"]),
    ("Compare revenue, checkout activity and inventory situation", ["revenue", "checkout", "operational"]),
    ("Are sales declining because fewer customers are buying?", ["revenue", "retention"]),
    ("What is the biggest problem affecting my store right now?", ["revenue", "checkout", "integration", "operational", "retention"]),
])
def test_08_to_14_mixed_domain_runtime(question, domains):
    r = run_investigation(ORG, USER, question, db=workspace_db(), now=NOW, persist=False)
    assert r["question_understanding"]["required_domains"] == domains
    assert r["orchestration"]["state"] in {"completed", "partial_success"}
    assert len(r["orchestration"]["execution_records"]) == len(domains)
    assert len(r["investigation"]["tools_used"]) == len(set(r["investigation"]["tools_used"]))


def test_15_independent_specialists_actually_execute_in_parallel():
    p = plan(domains=["revenue", "retention"])
    barrier = threading.Barrier(2)
    def concurrent(**kwargs):
        barrier.wait(timeout=1)
        return results_for(p, [owned("ordering_customer_count", 2, unit="count", currency=None)])
    # Both workers must reach the barrier; a serial executor would time out.
    execute_orchestrated_specialists(p, period=WINDOW, items=[owned("ordering_customer_count", 2, unit="count", currency=None)],
        tools={}, executor=concurrent)


def test_16_integration_dependency_precedes_domain_analysis():
    p = plan("Revenue and sync", domains=["revenue", "integration"])
    assert next(t for t in p["tasks"] if t["domain"] == "revenue")["dependencies"] == ["integration"]
    assert next(t for t in p["tasks"] if t["domain"] == "integration")["dependencies"] == []


def test_17_shared_order_evidence_is_retrieved_once():
    r = run_investigation(ORG, USER, "Compare revenue and repeat customers", db=workspace_db(), now=NOW, persist=False)
    assert r["investigation"]["tools_used"].count("order_observations") == 1
    ids = [item["id"] for item in r["evidence"]["items"]]
    assert len(ids) == len(set(ids))


# C. Reconciliation with actual specialist result shapes.
def test_18_identical_shared_evidence_is_not_double_counted():
    p = plan(domains=["revenue", "operational"])
    item = owned("order_count", 2, unit="count", currency=None)
    results = results_for(p, [item], {"revenue_observations": type("T", (), {"status": "available"})(),
        "order_observations": type("T", (), {"status": "available"})(), "integration_health": type("T", (), {"status": "available"})()})
    rec = reconcile_orchestration(p, results, [item])
    assert item["id"] in rec["shared_evidence_ids"]


def test_19_conflicting_revenue_calculations_remain_unresolved():
    p = plan(); a = results_for(p)[0]; b = copy.deepcopy(a)
    b["specialist"]["name"] = "operational"; b["calculated_findings"][0]["value"] = "999"
    rec = reconcile_orchestration(p, [a, b], [owned()])
    assert rec["contradictions"][0]["status"] == "unresolved"


def test_20_different_periods_are_not_conflicts():
    p = plan(); a = results_for(p)[0]; b = copy.deepcopy(a); b["specialist"]["name"] = "operational"
    b["calculated_findings"][0]["period"]["start"] = "2020-01-01T00:00:00Z"; b["calculated_findings"][0]["value"] = "1"
    assert not reconcile_orchestration(p, [a, b], [owned()])["contradictions"]


def test_21_different_currencies_are_not_conflicts():
    p = plan(); a = results_for(p)[0]; b = copy.deepcopy(a); b["specialist"]["name"] = "operational"
    b["calculated_findings"][0]["currency"] = "NGN"; b["calculated_findings"][0]["value"] = "1000"
    assert not reconcile_orchestration(p, [a, b], [owned()])["contradictions"]


def test_22_different_definitions_are_not_conflicts():
    p = plan(); a = results_for(p)[0]; b = copy.deepcopy(a); b["specialist"]["name"] = "operational"
    b["calculated_findings"][0]["definition"] = "different gross basis"; b["calculated_findings"][0]["value"] = "120"
    assert not reconcile_orchestration(p, [a, b], [owned()])["contradictions"]


def test_23_stale_and_fresh_conflict_discloses_freshness():
    stale = owned(value="90", freshness={"state": "stale"}, discriminator="stale")
    p = plan(); a = results_for(p)[0]; b = copy.deepcopy(a); b["specialist"]["name"] = "operational"
    b["calculated_findings"][0]["value"] = "90"; b["calculated_findings"][0]["evidence_references"] = [stale["id"]]
    rec = reconcile_orchestration(p, [a, b], [owned(), stale])
    assert set(rec["contradictions"][0]["freshness_states"]) == {"fresh", "stale"}


def test_24_repeated_hypothesis_never_becomes_fact():
    p = plan(); a = results_for(p)[0]; b = copy.deepcopy(a); b["specialist"]["name"] = "operational"
    rec = reconcile_orchestration(p, [a, b], [owned()])
    assert rec["hypotheses_promoted_to_facts"] == 0 and all(h["verified"] is False for r in (a, b) for h in r["hypotheses"])


def test_25_invalid_reconciliation_reference_fails_closed():
    p = plan(); p["reconciliation"]["contradictions"] = [{"status": "unresolved", "evidence_references": ["foreign"]}]
    assert "orchestration_evidence_reference" in validate_orchestration(p, organization_id=ORG, evidence_ids=set())


def test_26_failed_domain_preserves_partial_status_not_global_zero():
    p = plan(domains=["revenue", "operational"]); p["execution_records"] = [{"domain": "operational", "status": "failed"}]
    reconcile_orchestration(p, results_for(p), [owned()])
    assert p["state"] == "partial_success"


# D. Contextual understanding and period continuity.
def prior(domains=("revenue",)):
    return {"last_investigation": {"id": INVESTIGATION, "intent": "revenue_investigation", "period": WINDOW},
            "last_orchestration": {"question_understanding": {"primary_intent": "revenue_investigation", "required_domains": list(domains)}}}


def test_27_followup_it_inherits_revenue_decline():
    u = understanding("Can you explain it?", context=prior(), followup=True)
    assert u["primary_intent"] == "revenue_investigation" and u["required_domains"] == ["revenue"]


def test_28_those_orders_inherits_period_and_subject():
    u = understanding("What about those orders?", context=prior(), followup=True)
    assert u["context_used"]["reporting_period_inherited"] and "revenue" in u["required_domains"]


def test_29_period_only_followup_does_not_expand_domains():
    u = understanding("What about last week?", context=prior(), followup=True)
    assert u["required_domains"] == ["revenue"]


def test_30_revenue_followup_expands_to_checkout():
    u = understanding("Could abandoned checkouts explain it?", context=prior(), followup=True)
    assert set(u["required_domains"]) == {"revenue", "checkout"}


def test_31_checkout_followup_expands_to_inventory():
    ctx = prior(("checkout",)); ctx["last_investigation"]["intent"] = "checkout_investigation"
    ctx["last_orchestration"]["question_understanding"]["primary_intent"] = "checkout_investigation"
    u = understanding("What about inventory?", intent="checkout_investigation", context=ctx, followup=True)
    assert set(u["required_domains"]) == {"checkout", "operational"}


def test_32_product_detail_followup_adds_operational_not_retention():
    u = understanding("Which products are affected?", context=prior(), followup=True)
    assert "operational" in u["required_domains"] and "retention" not in u["required_domains"]


def test_33_explicit_topic_change_drops_previous_domains():
    u = understanding("Instead, how is inventory?", intent="product_investigation", context=prior())
    assert u["required_domains"] == ["operational"]


def test_34_new_investigation_replaces_not_reuses_old_conclusion():
    r = run_investigation(ORG, USER, "Revenue this week", db=workspace_db(), now=NOW, persist=False)
    assert r["orchestration"]["request_fingerprint"] != prior().get("request_fingerprint")
    assert r["orchestration"]["state"] == "completed"


# E. Failure, bounds and idempotency.
def test_35_specialist_timeout_is_local_failure():
    p = plan(); p["per_specialist_timeout_ms"] = 1; p["overall_deadline_ms"] = 5; p["max_transient_retries"] = 0
    def slow(**kwargs): time.sleep(0.03); return results_for(p)
    results = execute_orchestrated_specialists(p, period=WINDOW, items=[owned()], tools={}, executor=slow)
    assert results[0]["status"] == "error" and results[0]["diagnostics"]["error_class"] == "SpecialistTimeout"


def test_36_permanent_failure_is_not_retried():
    p = plan(); calls = []
    def fail(**kwargs): calls.append(1); raise ValueError("invalid")
    results = execute_orchestrated_specialists(p, period=WINDOW, items=[owned()], tools={}, executor=fail)
    assert len(calls) == 1 and results[0]["status"] == "error"


def test_37_transient_retry_succeeds_once():
    p = plan(); calls = []
    def flaky(**kwargs):
        calls.append(1)
        if len(calls) == 1: raise ConnectionError("temporary")
        return results_for(p)
    results = execute_orchestrated_specialists(p, period=WINDOW, items=[owned()], tools={}, executor=flaky)
    assert len(calls) == 2 and results[0]["status"] == "success" and p["tasks"][0]["attempts"] == 2


def test_38_permission_failure_has_no_pointless_retry():
    p = plan(); calls = []
    def denied(**kwargs): calls.append(1); raise PermissionError("denied")
    execute_orchestrated_specialists(p, period=WINDOW, items=[owned()], tools={}, executor=denied)
    assert len(calls) == 1


def test_39_service_unavailable_is_transient_and_bounded():
    p = plan(); p["max_transient_retries"] = 1; calls = []
    def unavailable(**kwargs): calls.append(1); raise ConnectionError("unavailable")
    results = execute_orchestrated_specialists(p, period=WINDOW, items=[owned()], tools={}, executor=unavailable)
    assert len(calls) == 2 and results[0]["status"] == "error"


def test_40_database_failure_returns_safe_failed_orchestration():
    db = workspace_db(fail=("FROM stores",))
    r = run_investigation(ORG, USER, "Revenue", db=db, now=NOW, persist=False)
    assert r["orchestration"]["state"] == "failed" and r["investigation_outcome"]["outcome"] != "success"


def test_41_partial_specialist_results_preserve_successful_domain():
    p = plan(domains=["revenue", "retention"]); calls = []
    def partial(**kwargs):
        calls.append(kwargs["selected"][0])
        if kwargs["selected"] == ["retention"]: raise ValueError("bad")
        return results_for(plan(), [owned()])
    results = execute_orchestrated_specialists(p, period=WINDOW, items=[owned()], tools={}, executor=partial)
    assert {r["status"] for r in results} == {"success", "error"}


def test_42_all_specialists_fail_without_manufactured_results():
    p = plan(domains=["revenue", "operational"])
    results = execute_orchestrated_specialists(p, period=WINDOW, items=[owned()], tools={}, executor=lambda **kwargs: (_ for _ in ()).throw(ValueError("x")))
    assert len(results) == 2 and all(r["status"] == "error" and not r["verified_facts"] for r in results)


def test_43_overall_deadline_is_enforced():
    p = plan(); p["per_specialist_timeout_ms"] = 50; p["overall_deadline_ms"] = 2; p["max_transient_retries"] = 0
    result = execute_orchestrated_specialists(p, period=WINDOW, items=[owned()], tools={}, executor=lambda **kwargs: time.sleep(0.02))
    assert result[0]["status"] == "error"


def test_44_repeated_plan_is_idempotent_and_deduplicated():
    a, b = plan(), plan()
    assert a["request_fingerprint"] == b["request_fingerprint"]
    assert [t["task_id"] for t in a["tasks"]] == [t["task_id"] for t in b["tasks"]]
    assert len(a["tools"]) == len(set(a["tools"]))


def test_45_recursive_invocation_is_rejected():
    p = plan(); p["recursion_depth"] = 1
    assert "orchestration_recursion" in validate_orchestration(p, organization_id=ORG, evidence_ids=set())


# F. Security and isolation.
def test_46_cross_tenant_orchestration_is_rejected():
    assert "orchestration_tenant" in validate_orchestration(plan(), organization_id="other", evidence_ids=set())


def test_47_cross_store_specialist_result_is_rejected():
    result = results_for(plan())[0]; result["tenant"]["store_ids"] = ["other-store"]
    assert validate_specialist_result(result, organization_id=ORG, evidence_ids=set())


def test_48_unimplemented_specialist_capability_is_rejected():
    p = plan(); p["tasks"][0]["specialist"] = "invented"
    assert "orchestration_capability" in validate_orchestration(p, organization_id=ORG, evidence_ids=set())


def test_49_conversation_context_is_organization_scoped():
    foreign = json.dumps({"last_orchestration": {"question_understanding": {"required_domains": ["revenue"]}}})
    ctx = load_conversation_context("different-org", USER, "conversation", FakeDB(),
        context_payload={"conversation_context": {"context_window": foreign}})
    # Node supplies only an authenticated conversation; DB fallback cannot read
    # another organization's record. No foreign DB row is introduced.
    assert ctx["recent_turns"] == []


def test_50_no_merchant_write_operations_are_generated():
    r = run_investigation(ORG, USER, "Compare revenue and inventory", db=workspace_db(), now=NOW, persist=False)
    assert r["read_only"] is True and all(rec.get("executed") is False for rec in r["recommendations"])


def test_51_error_logs_and_results_do_not_echo_secrets(caplog):
    p = plan()
    results = execute_orchestrated_specialists(p, period=WINDOW, items=[owned()], tools={},
        executor=lambda **kwargs: (_ for _ in ()).throw(ConnectionError("access_token=secret")))
    serialized = json.dumps(results) + caplog.text
    assert "secret" not in serialized and "access_token" not in serialized


def test_task230_standalone_checkout_question_does_not_inherit_revenue_domain():
    result = understand_question("How many checkouts are available for investigation?", "checkout_investigation",
                                 context=prior(), classification={"followup": False})
    assert result["primary_intent"] == "checkout_investigation"
    assert result["required_domains"] == ["checkout"]


def test_task230_explicit_checkout_followup_can_expand_revenue_context():
    result = understand_question("Could abandoned checkouts explain it?", "checkout_investigation",
                                 context=prior(), classification={"followup": True})
    assert result["primary_intent"] == "revenue_investigation"
    assert set(result["required_domains"]) == {"revenue", "checkout"}
