from datetime import datetime, timezone, timedelta
from decimal import Decimal

import pytest

from src.agents.investigation import resolve_reporting_period
from src.intelligence.evidence import evidence_context
from src.intelligence.finding_evidence import retrieve_finding_evidence
from src.intelligence.product_evidence import retrieve_product_evidence

ORG = "00000000-0000-0000-0000-000000000001"
STORE = "00000000-0000-0000-0000-000000000002"
FINDING = "00000000-0000-0000-0000-000000000003"
NOW = datetime(2026, 11, 7, 12, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def authorized_evidence_scope():
    with evidence_context(ORG, [STORE]):
        yield


class Result:
    def __init__(self, rows): self.rows = rows
    def mappings(self): return self
    def all(self): return self.rows


class DB:
    def __init__(self, routes): self.routes = routes; self.calls = []
    def execute(self, statement, params):
        sql = str(statement); self.calls.append((sql, params))
        for marker, rows in self.routes:
            if marker in sql:
                return Result(rows(params) if callable(rows) else rows)
        return Result([])


def dt(value): return datetime.fromisoformat(value.replace("Z", "+00:00"))


def test_rolling_previous_calendar_and_partial_comparisons_are_deterministic():
    rolling = resolve_reporting_period("previous 90 days", NOW, timezone_name="Africa/Lagos")
    assert rolling["kind"] == "rolling"
    assert dt(rolling["start"]) == NOW - timedelta(days=90)
    assert dt(rolling["end"]) == NOW
    quarter = resolve_reporting_period("Q4 2026", NOW, timezone_name="Africa/Lagos")
    assert quarter["kind"] == "calendar_quarter"
    assert quarter["start"] == "2026-09-30T23:00:00Z"
    assert quarter["end"] == "2026-11-07T12:00:00Z"
    current = resolve_reporting_period("this quarter", NOW, timezone_name="Africa/Lagos")
    comparison = current["compared_to"]
    assert current["is_partial"] is True
    assert dt(comparison["end"]) < dt(current["start"])
    assert dt(current["end"]) - dt(current["start"]) == dt(comparison["end"]) - dt(comparison["start"])
    assert current["comparison_semantics"] == "equal_elapsed_time_non_overlapping"
    named = resolve_reporting_period("March 2025", NOW, timezone_name="Africa/Lagos")
    assert named["kind"] == "calendar_month"
    assert named["start"] == "2025-02-28T23:00:00Z"
    assert named["end"] == "2025-03-31T23:00:00Z"


def test_future_and_inverted_calendar_periods_are_rejected():
    with pytest.raises(ValueError, match="future"):
        resolve_reporting_period("Q1 2027", NOW)
    with pytest.raises(ValueError):
        resolve_reporting_period("from 2026-11-02 to 2026-11-01", NOW)


def finding_row(status="open", end="2026-11-07T00:00:00+00:00"):
    return {"id": FINDING, "store_id": STORE, "type": "revenue_drop", "severity": "high",
        "status": status, "title": "Revenue fell", "description": "Stored detection",
        "evidence": {"verified": True, "complete": True, "currency": "USD", "currentCount": 2,
            "previousCount": 4, "currentRevenue": 20, "previousRevenue": 80,
            "currentStart": "2026-11-06T00:00:00Z", "currentEnd": end,
            "previousStart": "2026-11-05T00:00:00Z", "previousEnd": "2026-11-06T00:00:00Z",
            "coverage_source": "order_coverage", "coverage_run_id": "run-1"},
        "action": {"type": "inspect", "description": "Inspect channel mix"},
        "dedupe_key": "x", "detected_at": NOW - timedelta(hours=2), "updated_at": NOW - timedelta(hours=1),
        "acknowledged_at": None, "resolved_at": NOW if status == "resolved" else None, "dismissed_at": None}


def test_finding_lookup_is_scoped_and_returns_lifecycle_evidence_and_orders():
    order = {"external_order_id": "o1", "external_order_name": "#1", "ordered_at": NOW - timedelta(hours=3),
             "total": Decimal("10"), "refunded_total": Decimal("0"), "currency": "USD", "recovery_status": "paid"}
    db = DB([("FROM intelligence_findings f", [finding_row()]), ("FROM orders o JOIN intelligence_findings", [order])])
    result = retrieve_finding_evidence(ORG, db, now=NOW, finding_reference=FINDING)
    assert result["overall_status"] == "available"
    record = result["items"][0]["value"]
    assert record["current_validity"] == "current_evidence_verified"
    assert record["underlying_order_records"][0]["external_order_id"] == "o1"
    assert result["items"][0]["source"]["references"][0]["sync_run_id"] == "run-1"
    for sql, params in db.calls:
        assert params["org_id"] == ORG
        assert "organization_id" in sql


def test_resolved_stale_and_missing_findings_do_not_impersonate_current_problems():
    resolved = retrieve_finding_evidence(ORG, DB([("FROM intelligence_findings f", [finding_row("resolved")])]),
        now=NOW, finding_reference=FINDING)
    assert resolved["items"][0]["value"]["current_validity"] == "historical_resolved"
    assert resolved["items"][0]["status"] == "partial"
    stale_row = finding_row(end="2026-11-01T00:00:00+00:00")
    stale_row["evidence"].update(previousStart="2026-10-30T00:00:00Z", previousEnd="2026-10-31T00:00:00Z", currentStart="2026-10-31T00:00:00Z")
    stale = retrieve_finding_evidence(ORG, DB([("FROM intelligence_findings f", [stale_row])]),
        now=NOW, finding_reference=FINDING)
    assert stale["items"][0]["value"]["current_validity"] == "stale_unreverified"
    missing = retrieve_finding_evidence(ORG, DB([]), now=NOW, finding_reference=FINDING)
    assert not missing["items"] and missing["overall_status"] == "partial"


def product_row():
    return {"id": "p-internal", "store_id": STORE, "external_id": "1001", "name": "Test product",
        "type": "Physical", "status": "ACTIVE", "vendor": "Vendor", "sku": "BASE", "created_at": NOW,
        "updated_at": NOW, "created_at_auto": None, "updated_at_auto": NOW, "manage_stock": True,
        "stock_quantity": 0, "stock_status": "outofstock"}


def test_product_identity_variants_inventory_performance_and_findings_are_bounded():
    variant = {"store_id": STORE, "product_external_id": "1001", "external_id": "v1", "title": "Small", "sku": "S", "barcode": None,
        "inventory_item_external_id": "i1", "price": Decimal("10"), "compare_at_price": None,
        "selected_options": [{"name": "Size", "value": "Small"}], "position": 1, "tracked": True,
        "available_for_sale": True, "created_at": NOW, "updated_at": NOW, "synced_at": NOW}
    level = {"store_id": STORE, "product_external_id": "1001", "variant_id": "v1", "inventory_item_id": "i1", "inventory_sku": "S",
        "inventory_tracked": True, "location_id": "l1", "location_name": "Main", "is_active": True,
        "quantities": {"available": 4}, "synced_at": NOW}
    ledger = {"store_id": STORE, "domain": "products", "status": "ok", "pagination_complete": True,
              "last_succeeded_at": NOW - timedelta(minutes=5), "error_code": None}
    ledgers = [ledger] + [{**ledger, "domain": domain} for domain in ("inventory_items", "inventory_levels", "locations")]
    performance = {"store_id": STORE, "external_product_id": "1001", "external_variant_id": "v1", "currency": "USD", "units": 2,
                   "line_value": Decimal("20"), "order_count": 1}
    db = DB([("FROM products p", [product_row()]), ("JOIN inventory_items", [level]), ("FROM product_variants v", [variant]), ("FROM store_sync_domain_states", ledgers),
        ("FROM order_items oi", [performance]), ("FROM intelligence_findings f", [])])
    result = retrieve_product_evidence(ORG, db, start=NOW-timedelta(days=7), end=NOW, now=NOW,
                                      product_reference="1001")
    record = result["items"][0]["value"]
    assert record["product_id"] == "1001"
    assert record["variants"][0]["variant_id"] == "v1"
    assert record["variants"][0]["inventory_levels"][0]["quantities"]["available"] == 4
    assert record["order_line_evidence"][0]["recorded_line_value"] == "20"
    assert result["items"][0]["coverage"]["inventory_complete"] is True
    assert all(params["org_id"] == ORG for _, params in db.calls)


def test_missing_inventory_is_not_an_out_of_stock_claim():
    db = DB([("FROM products p", [product_row()]), ("FROM product_variants v\n", []),
             ("FROM store_sync_domain_states", [])])
    result = retrieve_product_evidence(ORG, db, start=NOW-timedelta(days=7), end=NOW, now=NOW)
    assert result["overall_status"] == "partial"
    assert result["items"][0]["value"]["inventory_coverage_complete"] is False
    assert "Missing inventory records never establish out-of-stock" in result["items"][0]["limitations"][0]


def test_ambiguous_product_name_does_not_select_arbitrary_record():
    db = DB([("FROM products p", [product_row(), {**product_row(), "external_id": "1002", "name": "Test product"}])])
    result = retrieve_product_evidence(ORG, db, start=NOW-timedelta(days=7), end=NOW, now=NOW,
                                      product_reference="Test product")
    assert result["overall_status"] == "partial"
    assert "ambiguous_product_reference" in result["warnings"]


def test_same_external_product_id_in_two_stores_never_mixes_variants():
    other_store = "00000000-0000-0000-0000-000000000009"
    other_product = {**product_row(), "id": "p-other", "store_id": other_store}
    variant_a = {"store_id": STORE, "product_external_id": "1001", "external_id": "variant-a",
                 "title": "A", "selected_options": [], "position": 1}
    variant_b = {"store_id": other_store, "product_external_id": "1001", "external_id": "variant-b",
                 "title": "B", "selected_options": [], "position": 1}
    db = DB([("FROM products p", [product_row(), other_product]),
             ("FROM product_variants v", [variant_a, variant_b])])
    with evidence_context(ORG, [STORE, other_store]):
        result = retrieve_product_evidence(ORG, db, start=NOW-timedelta(days=7), end=NOW,
                                          now=NOW, product_reference="1001")
    records = {item["value"]["store_id"]: item["value"] for item in result["items"] if item["metric"] == "product_evidence"}
    assert [v["variant_id"] for v in records[STORE]["variants"]] == ["variant-a"]
    assert [v["variant_id"] for v in records[other_store]["variants"]] == ["variant-b"]
