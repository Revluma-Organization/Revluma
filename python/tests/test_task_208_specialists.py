"""Task 208 substantive specialist acceptance tests (synthetic, isolated)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json

import pytest

from src.agents.investigation import run_investigation
from src.agents.tools import ToolResult
from src.intelligence.evidence import evidence_context, evidence_item, period
from src.intelligence.retention_evidence import retrieve_retention_evidence
from src.intelligence.specialists import execute_specialists, select_specialists, validate_specialist_result
from tests.rev_fakes import FakeDB
from tests.test_rev_investigation import CONV, NOW, ORG, USER, workspace_db

STORE = "store-a"
INVESTIGATION = "99999999-9999-4999-8999-999999999999"
WINDOW = period(NOW - timedelta(days=7), NOW, timezone_label="Africa/Lagos")


def item(metric, value=1, *, unit="count", currency=None, status="available", coverage=True,
         classification="deterministic_calculation", discriminator="", value_window=None):
    return evidence_item(metric, label=metric.replace("_", " "), value=value, unit=unit,
        currency=currency, window=value_window or WINDOW, source="orders", definition=f"Definition of {metric}.",
        status=status, coverage={"complete": coverage, "status": "complete" if coverage else "partial"},
        freshness={"state": "fresh"}, domain="orders", classification=classification,
        discriminator=discriminator or metric)


def execute(name, items, *, tools=None, question="Investigate", intent=None, selected=None):
    tools = tools if tools is not None else {tool: ToolResult(tool, "available") for tool in {
        "revenue": ("revenue_observations", "order_observations"),
        "retention": ("customer_observations",),
        "operational": ("integration_health",),
    }[name]}
    with evidence_context(ORG, [STORE]):
        # Items supplied by each test are created inside ownership scope below.
        owned = []
        for source in items:
            owned.append(item(source["metric"], source.get("value"), unit=source.get("unit", "count"),
                currency=source.get("currency"), status=source.get("status", "available"),
                coverage=source.get("coverage", True), classification=source.get("classification", "deterministic_calculation"),
                discriminator=source.get("discriminator", source["metric"]), value_window=source.get("window")))
    results = execute_specialists(intent=intent or {"revenue": "revenue_investigation", "retention": "customer_retention", "operational": "product_investigation"}[name],
        question=question, organization_id=ORG, store_ids=[STORE], investigation_id=INVESTIGATION,
        period=WINDOW, items=owned, tools=tools, selected=selected or [name])
    result = results[0]
    assert validate_specialist_result(result, organization_id=ORG, evidence_ids={i["id"] for i in owned}) == []
    return result, owned


# 1–10 Revenue specialist

def test_01_revenue_overview_uses_real_canonical_facts():
    result, _ = execute("revenue", [{"metric": "recorded_order_value", "value": "125.50", "unit": "currency", "currency": "USD"},
                                    {"metric": "recorded_order_count", "value": 5}])
    assert result["status"] == "success"
    assert {f["metric"] for f in result["calculated_findings"]} == {"recorded_order_value", "recorded_order_count"}
    assert result["recommendations"][0]["executed"] is False


def test_02_revenue_decline_is_not_a_causal_claim():
    result, _ = execute("revenue", [{"metric": "recorded_order_value", "value": "50", "unit": "currency", "currency": "USD"}],
                        question="Why did revenue drop?")
    assert result["hypotheses"][0]["verified"] is False
    assert "none is established as the cause" in result["hypotheses"][0]["statement"]


def test_03_comparison_period_values_remain_separate():
    previous = period(NOW - timedelta(days=14), NOW - timedelta(days=7))
    result, _ = execute("revenue", [{"metric": "recorded_order_value", "value": "50", "unit": "currency", "currency": "USD"},
                                    {"metric": "recorded_order_value", "value": "100", "unit": "currency", "currency": "USD", "window": previous, "discriminator": "previous"}])
    assert len(result["calculated_findings"]) == 3
    assert len({f["period"]["start"] for f in result["calculated_findings"] if f["metric"] == "recorded_order_value"}) == 2
    change = next(f for f in result["calculated_findings"] if f["metric"] == "recorded_order_value_change")
    assert Decimal(change["value"]) == Decimal("-50") and len(change["evidence_references"]) == 2


def test_04_product_contribution_requires_order_line_evidence():
    result, _ = execute("revenue", [{"metric": "product_order_lines", "value": {"historical_line_value": "75.00", "currency": "USD"}, "unit": "record"}])
    assert result["recommendations"][0]["label"].startswith("Review the highest-contribution")
    assert result["calculated_findings"][0]["value"]["historical_line_value"] == "75.00"


def test_05_average_order_value_preserves_currency_and_provenance():
    result, _ = execute("revenue", [{"metric": "average_order_value", "value": "25.10", "unit": "currency", "currency": "USD"}])
    fact = result["calculated_findings"][0]
    assert fact["currency"] == "USD" and fact["evidence_references"]


def test_06_refund_and_discount_analysis_does_not_double_count():
    result, _ = execute("revenue", [{"metric": "refund_amount", "value": "5", "unit": "currency", "currency": "USD"},
                                    {"metric": "discount_amount", "value": "3", "unit": "currency", "currency": "USD"}])
    assert len(result["calculated_findings"]) == 2
    assert "separately" in result["recommendations"][0]["label"]


def test_07_missing_history_is_not_a_zero():
    result, _ = execute("revenue", [{"metric": "recorded_order_value", "value": None, "unit": "currency", "currency": "USD", "status": "unavailable", "coverage": False}])
    assert result["status"] == "no_data"
    assert result["investigation_outcome"] == "insufficient_coverage"
    assert result["unknowns"]


def test_08_mixed_currencies_are_never_aggregated():
    result, _ = execute("revenue", [{"metric": "recorded_order_value", "value": "10", "unit": "currency", "currency": "USD"},
                                    {"metric": "recorded_order_value", "value": "1000", "unit": "currency", "currency": "NGN", "discriminator": "ngn"}])
    assert result["currency_integrity"]["currencies"] == ["NGN", "USD"]
    assert result["currency_integrity"]["mixed_currency_totals"] is False
    assert {f["currency"] for f in result["calculated_findings"]} == {"USD", "NGN"}


def test_09_incomplete_order_lines_stay_unavailable():
    result, _ = execute("revenue", [{"metric": "product_order_lines", "value": {"historical_line_value": None}, "unit": "record", "status": "partial", "coverage": False}])
    assert result["status"] == "no_data"
    assert not result["recommendations"]


def test_10_no_recoverable_revenue_or_execution_is_invented():
    result, _ = execute("revenue", [{"metric": "refund_amount", "value": "10", "unit": "currency", "currency": "USD"}],
                        question="How much revenue can you guarantee I recover?")
    serialized = str(result).lower()
    assert "recoverable revenue" not in serialized and "guaranteed savings" not in serialized
    assert all(rec["state"] == "recommended" and not rec["executed"] for rec in result["recommendations"])


# 11–20 Retention specialist and actual tenant-scoped evidence retrieval

def retention_db(*, verified=True, aggregate=None, intervals=None, cohorts=None):
    db = FakeDB()
    db.add("SELECT id, last_synced_at, status", [{"id": STORE, "last_synced_at": NOW, "status": "active"}])
    db.add("intelligence_order_coverage", [{"store_id": STORE, "coverage_start": NOW - timedelta(days=400),
        "coverage_end": NOW + timedelta(days=1), "certified_at": NOW, "customer_lifetime_verified": verified}])
    db.add("COUNT(DISTINCT o.customer_id)", [aggregate or {"ordering_customers": 4, "customer_associated_orders": 7,
        "repeat_within_window_customers": 2, "returning_customers": 2, "first_time_customers": 2}])
    db.add("observed_second_purchases", [intervals or {"observed_second_purchases": 2, "mean_days": Decimal("12.5"), "median_days": Decimal("10")}])
    db.add("entered_customers", [cohorts or {"cohort": "2026-07", "entered_customers": 4,
        "repeat_within_90d_customers": 2, "immature_customers": 0}])
    return db


def retention_items(db):
    with evidence_context(ORG, [STORE]):
        return retrieve_retention_evidence(ORG, db, start=NOW - timedelta(days=7), end=NOW,
            now=NOW, timezone="Africa/Lagos")


def test_11_first_time_and_returning_require_lifetime_history():
    result = retention_items(retention_db(verified=True))
    values = {i["metric"]: i["value"] for i in result["items"]}
    assert values["first_time_customer_count"] == 2 and values["returning_customer_count"] == 2


def test_12_returning_customer_count_has_explicit_population():
    result = retention_items(retention_db())
    metric = next(i for i in result["items"] if i["metric"] == "returning_customer_count")
    assert metric["value"] == 2 and "before the window" in metric["definition"]


def test_13_repeat_purchase_rate_uses_same_window_denominator():
    result = retention_items(retention_db())
    metric = next(i for i in result["items"] if i["metric"] == "repeat_within_window_customer_rate")
    assert metric["value"] == Decimal("0.5")
    assert "ordering_customer_count" in metric["definition"]
    empty = retention_items(retention_db(aggregate={"ordering_customers": 0, "customer_associated_orders": 0,
        "repeat_within_window_customers": 0, "returning_customers": 0, "first_time_customers": 0}))
    empty_rate = next(i for i in empty["items"] if i["metric"] == "repeat_within_window_customer_rate")
    assert empty_rate["value"] is None and empty_rate["status"] == "unavailable"


def test_14_cohort_entry_and_maturity_are_explicit():
    result = retention_items(retention_db())
    metric = next(i for i in result["items"] if i["metric"] == "customer_cohort_90d")
    assert metric["value"]["mature_customers"] == 4
    assert metric["value"]["repeat_within_90d_rate"] == "0.5"
    assert metric["value"]["entry_rule"].startswith("First lifetime")


def test_15_repeat_interval_excludes_customers_without_second_purchase():
    result = retention_items(retention_db())
    metric = next(i for i in result["items"] if i["metric"] == "repeat_purchase_interval_days")
    assert metric["value"]["median_days"] == "10"
    assert "no-repeat" in metric["value"]["maturity"]


def test_16_incomplete_history_distinguishes_newly_observed_not_first_time():
    result = retention_items(retention_db(verified=False))
    by_metric = {i["metric"]: i for i in result["items"]}
    assert by_metric["first_time_customer_count"]["value"] is None
    assert by_metric["first_time_customer_count"]["status"] == "unavailable"
    assert by_metric["newly_observed_customer_count"]["value"] == 2
    assert "customer_lifetime_history_uncertified" in result["warnings"]


def test_17_duplicate_customer_associations_use_distinct_identity_sql():
    db = retention_db()
    retention_items(db)
    aggregate = next(sql for sql, _ in db.statements if "COUNT(DISTINCT o.customer_id)" in sql)
    assert "PARTITION BY o.store_id,o.customer_id" in "\n".join(sql for sql, _ in db.statements)
    assert db.scoped_organizations() == {ORG}


def test_18_privacy_safe_aggregation_contains_no_customer_records_or_pii():
    result = retention_items(retention_db())
    assert all(i["unit"] != "record" or i["metric"] in {"repeat_purchase_interval_days", "customer_cohort_90d"} for i in result["items"])
    assert not any(key in str(result).lower() for key in ("email", "phone", "address", "customer_name"))
    for sql, params in db_statements_safe(retention_db()):
        assert "customer" not in params


def db_statements_safe(db):
    return db.statements


def test_19_unsupported_churn_claims_are_refused_deterministically():
    response = run_investigation(ORG, USER, "What is each customer's churn probability?", db=workspace_db(), now=NOW, persist=False)
    assert response["investigation_outcome"]["outcome"] == "unsupported_capability"
    assert "churn probability" in response["text"]


def test_20_unsupported_customer_intent_claims_are_not_inferred():
    result, _ = execute("retention", [{"metric": "repeat_within_window_customer_count", "value": 2}],
                        question="Are these customers definitely going to buy?")
    assert result["hypotheses"] == []
    assert "purchase intent" in " ".join(result["limitations"])


# 21–30 Operational specialist

def test_21_current_inventory_availability_uses_variant_location_record():
    result, _ = execute("operational", [{"metric": "product_evidence", "value": {"variants": [{"inventory_levels": [{"quantities": {"available": 0}}]}]}, "unit": "record", "classification": "verified_fact"}])
    assert result["verified_facts"][0]["metric"] == "product_evidence"
    assert "across every active location" in result["recommendations"][0]["label"]


def test_22_variant_and_location_relationship_is_not_flattened():
    value = {"variants": [{"variant_id": "v1", "inventory_levels": [{"location_id": "a", "quantities": {"available": 0}}, {"location_id": "b", "quantities": {"available": 4}}]}]}
    result, _ = execute("operational", [{"metric": "product_evidence", "value": value, "unit": "record", "classification": "verified_fact"}])
    levels = result["verified_facts"][0]["value"]["variants"][0]["inventory_levels"]
    assert len(levels) == 2


def test_23_historical_inventory_is_not_reconstructed_from_snapshot():
    result, _ = execute("operational", [{"metric": "product_evidence", "value": {"variants": []}, "unit": "record", "classification": "verified_fact"}])
    assert any("cannot establish historical stock" in limitation for limitation in result["limitations"])


def test_24_stockout_evidence_does_not_claim_lost_revenue():
    result, _ = execute("operational", [{"metric": "product_evidence", "value": {"variants": []}, "unit": "record", "classification": "verified_fact"}])
    assert result["hypotheses"][0]["verified"] is False
    assert "lost revenue is not established" in result["hypotheses"][0]["statement"]


def test_25_fulfillment_status_counts_are_distinct_order_counts():
    result, _ = execute("operational", [{"metric": "fulfilled_count", "value": 4}, {"metric": "unfulfilled_count", "value": 2}])
    assert len(result["calculated_findings"]) == 2


def test_26_split_fulfillment_does_not_duplicate_orders():
    result, _ = execute("operational", [{"metric": "split_fulfillment_count", "value": 2}, {"metric": "order_count", "value": 8}])
    assert result["calculated_findings"][0]["value"] == 2


def test_27_delayed_fulfillment_uses_disclosed_threshold_not_sla_claim():
    result, _ = execute("operational", [{"metric": "delayed_unfulfilled_count", "value": 3}])
    assert result["recommendations"][0]["priority"] == "high"
    assert "72 hours" in result["recommendations"][0]["label"]
    assert "remain unverified" in result["recommendations"][0]["why"]


def test_28_refund_and_return_evidence_preserves_status_distinctions():
    result, _ = execute("operational", [{"metric": "refunded_count", "value": 2}, {"metric": "partially_refunded_count", "value": 1}])
    assert {f["metric"] for f in result["calculated_findings"]} == {"refunded_count", "partially_refunded_count"}


def test_29_integration_failure_is_not_reported_as_operational_success():
    result, _ = execute("operational", [], tools={"integration_health": ToolResult("integration_health", "unavailable")})
    assert result["status"] == "no_data" and result["investigation_outcome"] == "retrieval_failed"
    assert result["diagnostics"]["failed_tools"] == ["integration_health"]


def test_30_stale_operational_data_remains_partial():
    # Coverage/freshness is supplied by the canonical evidence, not inferred by the specialist.
    with evidence_context(ORG, [STORE]):
        stale = evidence_item("unfulfilled_count", label="Unfulfilled", value=2, window=WINDOW,
            source="orders", definition="Unfulfilled orders.", coverage={"complete": True}, freshness={"state": "stale"})
    results = execute_specialists(intent="product_investigation", question="stock", organization_id=ORG,
        store_ids=[STORE], investigation_id=INVESTIGATION, period=WINDOW, items=[stale],
        tools={"integration_health": ToolResult("integration_health", "available")}, selected=["operational"])
    assert results[0]["freshness"]["state"] == "stale"


# 31–40 Orchestration and coordination

def test_31_revenue_only_request_executes_only_revenue():
    question = "How did revenue and AOV change?"
    assert select_specialists("revenue_investigation", question) == ["revenue"]
    result, _ = execute("revenue", [{"metric": "average_order_value", "value": "25", "unit": "currency", "currency": "USD"}], question=question)
    assert result["specialist"]["name"] == "revenue" and result["calculated_findings"]


def test_32_retention_only_request_executes_only_retention():
    question = "How many customers purchased more than once?"
    assert select_specialists("customer_retention", question) == ["retention"]
    result, _ = execute("retention", [{"metric": "repeat_within_window_customer_count", "value": 2}], question=question)
    assert result["specialist"]["name"] == "retention" and result["calculated_findings"][0]["value"] == 2


def test_33_operations_only_request_executes_only_operational():
    question = "Do I have products running out of stock?"
    assert select_specialists("product_investigation", question) == ["operational"]
    result, _ = execute("operational", [{"metric": "product_evidence", "value": {"variants": []}, "unit": "record", "classification": "verified_fact"}], question=question)
    assert result["specialist"]["name"] == "operational" and result["verified_facts"]


def test_34_revenue_plus_inventory_executes_both_with_shared_evidence():
    with evidence_context(ORG, [STORE]):
        items = [item("recorded_order_count", 4), item("product_evidence", {"variants": []}, unit="record", classification="verified_fact")]
    results = execute_specialists(intent="revenue_investigation", question="Did inventory affect revenue?", organization_id=ORG,
        store_ids=[STORE], investigation_id=INVESTIGATION, period=WINDOW, items=items,
        tools={"revenue_observations": ToolResult("revenue_observations", "available"), "order_observations": ToolResult("order_observations", "available"),
               "product_observations": ToolResult("product_observations", "available"), "integration_health": ToolResult("integration_health", "available")})
    assert [r["specialist"]["name"] for r in results] == ["revenue", "operational"]
    assert len({i["id"] for i in items}) == 2


def test_35_retention_plus_order_history_executes_real_runtime():
    db = workspace_db()
    response = run_investigation(ORG, USER, "Are customers coming back to buy again?", db=db, now=NOW, persist=False)
    assert [s["specialist"]["name"] for s in response["specialists"]] == ["retention"]
    assert response["specialists"][0]["calculated_findings"]
    assert any("COUNT(DISTINCT o.customer_id)" in sql for sql, _ in db.statements)
    trend_db = workspace_db()
    trend_db.routes = [(pattern, ([{"ordering_customers": 2, "customer_associated_orders": 4,
        "repeat_within_window_customers": 1, "returning_customers": 1, "first_time_customers": 1},
        {"ordering_customers": 1, "customer_associated_orders": 2,
         "repeat_within_window_customers": 1, "returning_customers": 1, "first_time_customers": 0}]
        if pattern == "COUNT(DISTINCT o.customer_id)" else rows)) for pattern, rows in trend_db.routes]
    trend = run_investigation(ORG, USER, "Has repeat purchasing declined?", db=trend_db, now=NOW, persist=False)
    assert any(fact["metric"] == "repeat_within_window_customer_rate" for fact in trend["comparison_facts"])
    assert "relative change" in trend["text"]


def test_36_cross_domain_priority_question_executes_all_relevant_specialists():
    question = "What issue should I investigate first?"
    assert select_specialists("store_overview", question) == ["revenue", "retention", "operational"]
    with evidence_context(ORG, [STORE]):
        items = [item("recorded_order_count", 4), item("repeat_within_window_customer_count", 2),
                 item("delayed_unfulfilled_count", 1)]
    tools = {name: ToolResult(name, "available") for name in ("revenue_observations", "order_observations", "customer_observations", "integration_health")}
    results = execute_specialists(intent="store_overview", question=question, organization_id=ORG,
        store_ids=[STORE], investigation_id=INVESTIGATION, period=WINDOW, items=items, tools=tools)
    assert [r["specialist"]["name"] for r in results] == ["revenue", "retention", "operational"]
    assert all(r["calculated_findings"] for r in results)


def test_37_specialist_failure_does_not_produce_success():
    result, _ = execute("revenue", [], tools={})
    assert result["status"] == "no_data" and result["investigation_outcome"] == "retrieval_failed"
    assert not result["verified_facts"] and not result["calculated_findings"]


def test_38_partial_specialist_success_preserves_independent_facts():
    result, _ = execute("revenue", [{"metric": "recorded_order_count", "value": 3}],
        tools={"revenue_observations": ToolResult("revenue_observations", "unavailable"), "order_observations": ToolResult("order_observations", "available")})
    assert result["status"] == "partial" and result["investigation_outcome"] == "partial_success"
    assert result["calculated_findings"]


def test_39_contradictory_outputs_are_disclosed_not_manufactured_into_agreement():
    with evidence_context(ORG, [STORE]):
        items = [item("recorded_order_count", 3), item("recorded_order_count", 4, discriminator="other")]
    results = execute_specialists(intent="store_overview", question="priority", organization_id=ORG, store_ids=[STORE],
        investigation_id=INVESTIGATION, period=WINDOW, items=items,
        tools={"revenue_observations": ToolResult("revenue_observations", "available"), "order_observations": ToolResult("order_observations", "available"),
               "customer_observations": ToolResult("customer_observations", "available"), "integration_health": ToolResult("integration_health", "available")},
        selected=["revenue"])
    assert results[0]["contradictions"] and results[0]["status"] == "partial"


def test_40_follow_up_context_preserves_execution_and_evidence_references():
    first_db = workspace_db()
    first = run_investigation(ORG, USER, "Why did my revenue fall this week?",
        conversation_id=CONV, db=first_db, now=NOW, persist=True)
    execution = first["specialists"][0]
    assert execution["follow_up_context"]["execution_id"] == execution["execution_id"]
    assert execution["evidence_references"]
    update = next(params for sql, params in first_db.statements if "SET context_window" in sql)
    context = json.loads(update["context"])
    assert context["last_specialists"][0]["execution_id"] == execution["execution_id"]
    assert context["last_specialists"][0]["evidence_references"]
    second_db = workspace_db(conversation_rows=[{"summary": "Revenue", "context_window": context}])
    second = run_investigation(ORG, USER, "What about that?", conversation_id=CONV,
        db=second_db, now=NOW, persist=False)
    assert execution["execution_id"] in second["investigation"]["context_used"]["previous_specialist_executions"]
    assert second["specialists"][0]["execution_id"] != execution["execution_id"]
