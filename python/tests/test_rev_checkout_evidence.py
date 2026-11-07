from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from src.agents.investigation import _checkout_tool_params
from src.agents.tools import ToolAuthorizationError, run_tool
from src.intelligence.checkout_evidence import retrieve_checkout_evidence
from src.intelligence.evidence import evidence_context
from tests.rev_fakes import FakeDB
from tests.test_rev_investigation import NOW, ORG, store_rows

START = NOW - timedelta(days=7)
STORE_IDS = ["store-a1", "store-a2"]


def ledger_rows(complete=True, checkpoint=True):
    return [{"store_id": store_id, "domain": "abandoned_checkouts", "status": "ok" if complete else "failed",
             "pagination_complete": complete, "records_discovered": 4,
             "last_succeeded_at": NOW, "last_checked_at": NOW,
             "error_code": None, "checkpoint": {
                 "unfiltered_root": checkpoint, "nested_complete": checkpoint,
                 "scope_verified": checkpoint, "reconciliation_complete": checkpoint,
             }} for store_id in STORE_IDS]


def aggregate(count=4):
    return [{"observed_checkout_count": count, "completed_checkout_count": 1,
             "completed_with_order_count": 1, "abandoned_checkout_count": 1,
             "unknown_lifecycle_count": 1, "incomplete_checkout_count": 1,
             "source_unavailable_count": 1, "conflicting_relationship_count": 0}]


def db_fixture(*, totals=None, ledgers=None, records=None):
    db = FakeDB()
    db.add("SELECT s.id, s.platform, s.status, s.last_synced_at", store_rows())
    db.add("SELECT s.id FROM stores", [{"id": value} for value in STORE_IDS])
    db.add("store_sync_domain_states", ledger_rows() if ledgers is None else ledgers)
    db.add("COUNT(*) AS observed_checkout_count", aggregate() if totals is None else totals)
    db.add("SUM(c.cart_value) AS recorded_value", [{
        "currency": "USD", "checkout_count": 1, "missing_value_count": 0,
        "recorded_value": Decimal("75.50"), "subtotal": Decimal("70.00"),
        "discounts": Decimal("5.00"), "taxes": Decimal("10.50"), "duties": Decimal("0.00"),
        "missing_subtotal_count": 0, "missing_discount_count": 0,
        "missing_tax_count": 0, "missing_shipping_count": 1,
    }])
    db.add("AS activity_date", [{"activity_date": "2026-11-01", "observed_checkout_count": 4,
                                "completed_checkout_count": 1, "abandoned_checkout_count": 1}])
    db.add("AS historical_product_titles", [{
        "product_id": "p1", "variant_id": "v1", "historical_product_titles": ["Historical title"],
        "historical_variant_titles": ["Old variant"], "historical_skus": ["OLD-SKU"],
        "currency": "USD", "quantity": 2, "checkout_count": 1,
        "historical_line_value": Decimal("70.00"), "missing_quantity_count": 0,
        "incomplete_value_count": 0,
    }])
    db.add("SELECT c.id, c.store_id, c.external_cart_id", records or [])
    db.add("SELECT i.abandoned_cart_id, i.id", [])
    return db


def test_lifecycle_rates_values_and_historical_variants_are_explicit():
    with evidence_context(ORG, STORE_IDS):
        result = retrieve_checkout_evidence(ORG, db_fixture(), start=START, end=NOW, now=NOW)
    metrics = {item["metric"]: item for item in result["items"]}
    assert metrics["observed_checkout_count"]["value"] == 4
    assert metrics["unknown_lifecycle_count"]["value"] == 1
    assert metrics["observed_checkout_completion_rate"]["value"] == 0.5
    assert metrics["observed_checkout_completion_rate"]["measurement"]["numerator"] == "observed_checkout_completion_rate:1"
    assert metrics["observed_checkout_completion_rate"]["measurement"]["denominator"] == "completed_plus_abandoned:2"
    assert metrics["abandoned_checkout_recorded_value"]["value"] == "75.50"
    assert metrics["abandoned_checkout_recorded_value"]["measurement"]["shipping"] == "unknown"
    line = metrics["abandoned_checkout_variant_lines"]["value"]
    assert line["historical_skus"] == ["OLD-SKU"]
    assert line["historical_line_value"] == "70.00"
    assert all(item["coverage"]["complete"] for item in result["items"])


def test_unknown_zero_denominator_and_incomplete_source_are_not_zero():
    zero = aggregate(0)
    for row in zero:
        row.update({key: 0 for key in aggregate()[0]})
    with evidence_context(ORG, STORE_IDS):
        complete = retrieve_checkout_evidence(ORG, db_fixture(totals=zero), start=START, end=NOW, now=NOW)
        partial = retrieve_checkout_evidence(ORG, db_fixture(totals=zero, ledgers=ledger_rows(False)),
                                            start=START, end=NOW, now=NOW)
    complete_metrics = {item["metric"]: item for item in complete["items"]}
    partial_metrics = {item["metric"]: item for item in partial["items"]}
    assert complete_metrics["observed_checkout_count"]["status"] == "verified_zero"
    assert complete_metrics["observed_checkout_abandonment_rate"]["status"] == "unavailable"
    assert partial_metrics["observed_checkout_count"]["status"] == "partial"
    assert partial_metrics["observed_checkout_count"]["value"] is None
    assert not partial["coverage"]["complete"]


def test_record_path_has_no_customer_pii_and_uses_exact_order_relationship():
    records = [{"id": "checkout-a", "store_id": "store-a1", "external_cart_id": "123456",
                "external_checkout_name": "#C1", "source_resource": "abandonedCheckouts",
                "source_state": "available", "source_created_at": START,
                "source_updated_at": START, "completed_at": None,
                "abandonment_observed_at": START, "retrieved_at": NOW,
                "status": "abandoned", "recovered_at": None,
                "cart_value": Decimal("50"), "subtotal": Decimal("50"),
                "discount_amount": Decimal("0"), "tax_amount": Decimal("0"),
                "shipping_amount": None, "duties_amount": Decimal("0"),
                "taxes_included": False, "currency": "USD", "has_verified_order": True,
                "orders": [{"internal_order_id": "order-a", "external_order_id": "999", "order_name": "#9"}]}]
    with evidence_context(ORG, STORE_IDS):
        result = retrieve_checkout_evidence(ORG, db_fixture(records=records), start=START, end=NOW,
                                           now=NOW, checkout_reference="123456")
    value = result["items"][0]["value"]
    assert value["lifecycle"] == "completed"
    assert value["verified_order_relationship"] is True
    serialized = str(value).lower()
    assert "email" not in serialized and "phone" not in serialized and "address" not in serialized


def test_comparison_uses_explicit_previous_window_and_checkout_followups():
    db = db_fixture()
    with evidence_context(ORG, STORE_IDS):
        result = retrieve_checkout_evidence(ORG, db, start=START, end=NOW, now=NOW, compare=True)
    assert result["comparison_items"]
    params = _checkout_tool_params("Show the abandoned ones and their line items",
                                   {"checkout_reference": "123456"})
    assert params["abandoned_only"] is True
    assert params["include_records"] is True
    assert params["checkout_reference"] == "123456"


def test_tool_rejects_unsupported_parameters_and_all_queries_are_tenant_scoped():
    with pytest.raises(ToolAuthorizationError):
        run_tool("checkout_observations", ORG, db_fixture(), {
            "start": START.isoformat(), "end": NOW.isoformat(), "raw_filter": "1=1"})
    db = db_fixture()
    result = run_tool("checkout_observations", ORG, db,
                      {"start": START.isoformat(), "end": NOW.isoformat()}, now=NOW)
    assert result.status in {"available", "partial", "verified_zero"}
    statements = [entry[0] for entry in db.statements if "abandoned_carts" in entry[0]]
    assert statements and all("organization_id = :org_id" in sql for sql in statements)
    assert all("SELECT *" not in sql for sql in statements)
