import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from src.agents.investigation import _order_tool_params, run_investigation
from src.agents.tools import ToolAuthorizationError, run_tool
from src.intelligence.evidence import evidence_context
from src.intelligence.order_evidence import retrieve_order_evidence
from tests.rev_fakes import FakeDB
from tests.test_rev_investigation import NOW, ORG, USER, store_rows, coverage_rows, workspace_db

START = NOW - timedelta(days=7)
STORE_IDS = ["store-a1", "store-a2"]


def ledgers(status="ok", complete=True):
    rows = []
    for store_id in STORE_IDS:
        for domain in ("orders", "transactions", "refunds", "fulfillments"):
            rows.append({"store_id": store_id, "domain": domain, "status": status,
                         "pagination_complete": complete, "last_succeeded_at": NOW - timedelta(minutes=5),
                         "last_checked_at": NOW - timedelta(minutes=5), "error_code": None})
    return rows


def db_fixture(*, aggregate=None, ledgers_rows=None, coverage=None):
    db = FakeDB()
    db.add("SELECT s.id, s.platform, s.status, s.last_synced_at", store_rows())
    db.add("SELECT id, last_synced_at, status", store_rows())
    db.add("SELECT s.id FROM stores", [{"id": value} for value in STORE_IDS])
    db.add("intelligence_order_coverage", coverage if coverage is not None else coverage_rows())
    db.add("store_sync_domain_states", ledgers_rows if ledgers_rows is not None else ledgers())
    db.add("PAID') AS paid_count", aggregate if aggregate is not None else [{
        "order_count": 8, "paid_count": 4, "pending_payment_count": 1, "partially_paid_count": 1,
        "refunded_count": 1, "partially_refunded_count": 1, "cancelled_count": 2,
        "fulfilled_count": 3, "unfulfilled_count": 4, "partially_fulfilled_count": 1,
        "open_count": 6, "closed_count": 2,
    }])
    db.add("SELECT 'financial' AS dimension", [
        {"dimension": "financial", "source_status": "PAID", "status_count": 4},
        {"dimension": "fulfillment", "source_status": "UNFULFILLED", "status_count": 4},
    ])
    db.add("COUNT(*) AS order_count", [{"currency": "USD", "order_count": 4, "order_value": Decimal("400.00")}])
    db.add("FROM business_states", [])
    return db


def test_lifecycle_aggregates_are_deterministic_and_use_task198_aov():
    with evidence_context(ORG, STORE_IDS):
        result = retrieve_order_evidence(ORG, db_fixture(), start=START, end=NOW, now=NOW)
    metrics = {item["metric"]: item for item in result["items"]}
    assert metrics["order_count"]["value"] == 8
    assert metrics["pending_payment_count"]["value"] == 1
    assert metrics["unfulfilled_count"]["value"] == 4
    assert metrics["partially_fulfilled_count"]["value"] == 1
    assert metrics["orders_by_financial_paid"]["value"] == 4
    assert metrics["average_order_value"]["value"] == "100.00"
    assert metrics["average_order_value"]["measurement"]["numerator"]
    assert all(item["organization_id"] == ORG for item in result["items"])
    assert all(item["coverage"]["complete"] for item in result["items"])


def test_zero_orders_requires_complete_coverage():
    zero = {"order_count": 0, "paid_count": 0, "pending_payment_count": 0,
            "partially_paid_count": 0, "refunded_count": 0, "partially_refunded_count": 0,
            "cancelled_count": 0, "fulfilled_count": 0, "unfulfilled_count": 0,
            "partially_fulfilled_count": 0, "open_count": 0, "closed_count": 0}
    with evidence_context(ORG, STORE_IDS):
        certified = retrieve_order_evidence(ORG, db_fixture(aggregate=[zero]), start=START, end=NOW, now=NOW)
        partial = retrieve_order_evidence(ORG, db_fixture(aggregate=[zero], coverage=[]), start=START, end=NOW, now=NOW)
    assert next(i for i in certified["items"] if i["metric"] == "order_count")["status"] == "verified_zero"
    assert next(i for i in partial["items"] if i["metric"] == "order_count")["value"] is None


def test_incomplete_pagination_is_not_complete_or_zero():
    with evidence_context(ORG, STORE_IDS):
        result = retrieve_order_evidence(ORG, db_fixture(ledgers_rows=ledgers(complete=False)), start=START, end=NOW, now=NOW)
    assert "order_pagination_or_sync_incomplete" in result["warnings"]
    assert all(not item["coverage"]["complete"] for item in result["items"])


def order_rows():
    return [{
        "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "store_id": "store-a1",
        "external_order_id": "9001", "external_order_name": "#1001", "customer_id": "customer-internal",
        "ordered_at": START + timedelta(days=1), "source_updated_at": NOW - timedelta(hours=1),
        "processed_at": START + timedelta(days=1), "closed_at": None,
        "recovery_status": "completed", "cancel_reason": None,
        "financial_status": "PARTIALLY_REFUNDED", "display_fulfillment_status": "UNFULFILLED",
        "total": Decimal("80.00"), "refunded_total": Decimal("20.00"), "currency": "USD",
        "presentment_currency": "USD", "test_flag": False, "source_name": "web",
    }]


def attach_records(db):
    db.routes.insert(0, ("o.external_order_name", order_rows()))
    db.routes.insert(1, ("oi.quantity_fulfilled", [{
        "order_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "id": "line-internal",
        "external_line_item_id": "line-1", "external_product_id": "deleted-product",
        "external_variant_id": "variant-1", "product_name": "Historical jacket",
        "variant_title": "Blue / L", "sku": None, "quantity": 2,
        "quantity_fulfilled": 0, "quantity_remaining": 2,
        "unit_price": Decimal("50.00"), "discounted_unit_price": Decimal("40.00"),
        "original_line_total": Decimal("100.00"), "discount_amount": Decimal("20.00"),
        "currency": "USD", "line_total": Decimal("80.00"),
    }]))
    db.routes.insert(2, ("'refund' AS relation_type", [
        {"relation_type": "refund", "store_id": "store-a1", "external_order_id": "9001", "external_id": "refund-1",
         "created_at": NOW, "updated_at": NOW, "amount": Decimal("20.00"), "currency": "USD",
         "status": None, "line_items": [{"line_item_id": "line-1", "quantity": 1}], "tracking_info": []},
        {"relation_type": "fulfillment", "store_id": "store-a1", "external_order_id": "9001", "external_id": "fulfillment-1",
         "created_at": NOW, "updated_at": NOW, "amount": None, "currency": None,
         "status": "CANCELLED", "line_items": [{"line_item_id": "line-1", "quantity": 1}], "tracking_info": []},
        {"relation_type": "refund", "store_id": "store-a2", "external_order_id": "9001", "external_id": "cross-store",
         "created_at": NOW, "updated_at": NOW, "amount": Decimal("999.00"), "currency": "USD",
         "status": None, "line_items": [], "tracking_info": []},
    ]))
    return db


def test_individual_order_preserves_historical_items_and_relationships_without_pii():
    db = attach_records(db_fixture())
    with evidence_context(ORG, STORE_IDS):
        result = retrieve_order_evidence(ORG, db, start=START, end=NOW, now=NOW, order_reference="#1001")
    record = result["items"][0]["value"]
    assert record["financial_status"] == "PARTIALLY_REFUNDED"
    assert record["fulfillment_status"] == "UNFULFILLED"
    assert record["delivery_verified"] is False
    assert record["line_items"][0]["product_title_at_order"] == "Historical jacket"
    assert record["line_items"][0]["product_id"] == "deleted-product"
    assert record["line_items"][0]["discount_amount"] == "20.00"
    assert {entry["type"] for entry in record["relationships"]} == {"refund", "fulfillment"}
    serialized = json.dumps(record)
    assert "email" not in serialized and "phone" not in serialized and "address" not in serialized


def test_forged_references_and_filters_fail_before_order_queries():
    db = db_fixture()
    with pytest.raises(ToolAuthorizationError):
        run_tool("order_observations", ORG, db, {"start": START.isoformat(), "end": NOW.isoformat(), "store_id": "store-a2"}, now=NOW)
    with pytest.raises(ToolAuthorizationError):
        run_tool("order_observations", ORG, db, {"start": START.isoformat(), "end": NOW.isoformat(), "financial_status": "PAID; DELETE FROM orders"}, now=NOW)


def test_rev_explains_independent_financial_and_fulfillment_status():
    db = attach_records(workspace_db())
    result = run_investigation(ORG, USER, "What happened to order #1001?", db=db, now=NOW, persist=False)
    assert "PARTIALLY_REFUNDED" in result["text"]
    assert "UNFULFILLED" in result["text"]
    assert "Fulfillment does not verify delivery" in result["text"]
    assert result["evidence"]["validation"]["valid"] is True


def test_followup_order_filters_are_allowlisted_and_inherited():
    initial = _order_tool_params("Show the unfulfilled orders")
    assert initial["fulfillment_status"] == "UNFULFILLED"
    followup = _order_tool_params("Which products were in those orders?", initial)
    assert followup == initial
    assert _order_tool_params("Which orders are awaiting payment?")["financial_status"] == "PENDING"
    assert _order_tool_params("Show the cancelled ones", initial)["cancelled"] is True


def test_product_variant_aggregates_and_lifecycle_comparisons_preserve_historical_identity():
    db = db_fixture()
    db.routes.insert(0, ("ARRAY_AGG(DISTINCT oi.order_id)", [
        {"product_id": "product-1", "variant_id": "variant-1", "historical_product_titles": ["Jacket at order time"],
         "historical_variant_titles": ["Blue / L"], "historical_skus": ["J-BLUE-L"], "currency": "USD",
         "quantity": 2, "missing_quantity_count": 0, "historical_line_value": Decimal("80.00"),
         "incomplete_value_count": 0, "order_count": 1, "order_ids": ["order-1"]},
        {"product_id": "product-1", "variant_id": "variant-2", "historical_product_titles": ["Jacket at order time"],
         "historical_variant_titles": ["Blue / M"], "historical_skus": ["J-BLUE-M"], "currency": "USD",
         "quantity": 1, "missing_quantity_count": 0, "historical_line_value": Decimal("35.00"),
         "incomplete_value_count": 0, "order_count": 1, "order_ids": ["order-1"]},
    ]))
    with evidence_context(ORG, STORE_IDS):
        result = retrieve_order_evidence(ORG, db, start=START, end=NOW, now=NOW, compare=True)
    products = [item for item in result["items"] if item["metric"] == "product_order_lines"]
    variants = [item for item in result["items"] if item["metric"] == "variant_order_lines"]
    assert len(products) == 1 and len(variants) == 2
    assert products[0]["value"]["quantity"] == 3
    assert products[0]["value"]["order_count"] == 1
    assert products[0]["value"]["historical_line_value"] == "115.00"
    assert products[0]["value"]["historical_product_titles"] == ["Jacket at order time"]
    assert any(item["metric"] == "order_count" for item in result["comparison_items"])
    assert any(item["metric"] == "product_order_lines" for item in result["comparison_items"])
