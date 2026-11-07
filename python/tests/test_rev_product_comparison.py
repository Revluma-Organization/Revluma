"""Task 206: product comparison-window evidence (contribution analysis).
Synthetic fixtures, labelled as such: FakeDB routes, no live Shopify."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from src.intelligence.evidence import evidence_context
from src.intelligence.product_evidence import retrieve_product_evidence

ORG = "00000000-0000-0000-0000-000000000001"
STORE = "00000000-0000-0000-0000-000000000002"
NOW = datetime(2026, 11, 7, 12, tzinfo=timezone.utc)
CURRENT_START = NOW - timedelta(days=7)


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


def line(name, currency, units, value):
    return {"product_name": name, "currency": currency, "units": units, "line_value": Decimal(value)}


def product_row():
    return {"id": "p-internal", "store_id": STORE, "external_id": "1001", "name": "Gear",
            "type": "Physical", "status": "ACTIVE", "vendor": "Vendor", "sku": "G1",
            "created_at": NOW, "updated_at": NOW, "created_at_auto": None,
            "updated_at_auto": NOW, "manage_stock": True, "stock_quantity": 0,
            "stock_status": "outofstock"}


def window_rows(params):
    """Route the compare query by its window: previous vs current."""
    start = params["start"]
    if start < CURRENT_START:
        return [line("Trail Jacket", "USD", 6, "300"), line("Rain Shell", "USD", 4, "160"),
                line("Base Layer", "USD", 5, "100")]
    return [line("Trail Jacket", "USD", 3, "150"), line("Rain Shell", "USD", 4, "160"),
            line("Base Layer", "USD", 2, "40"), line("Insulated Parka", "USD", 2, "90")]


def make_db(compare_fn=window_rows, display_fn=None):
    # Route order mirrors the real SQL text: _INVENTORY_SQL contains the
    # product_variants marker, so the inventory marker must be checked first.
    routes = [
        ("FROM products p", [product_row()]),
        ("JOIN inventory_items", []),
        ("FROM product_variants v", []),
        ("FROM store_sync_domain_states", []),
        ("COUNT(DISTINCT o.id)", []),
        ("LIMIT 100", compare_fn),
        ("LIMIT 6", display_fn or (lambda params: compare_fn(params))),
        ("FROM intelligence_findings f", []),
    ]
    return DB(routes)


def run(compare=True, **kwargs):
    return retrieve_product_evidence(ORG, make_db(), start=CURRENT_START, end=NOW, now=NOW,
                                     compare=compare, **kwargs)


def test_without_compare_the_shape_is_unchanged():
    result = run(compare=False)
    assert "comparison" not in result
    metrics = [item["metric"] for item in result["items"] if item["metric"] != "product_evidence"]
    # One units + one recorded-value item per displayed line name, in order.
    assert all(m in ("product_units_sold", "product_recorded_value") for m in metrics)
    assert metrics.count("product_recorded_value") == 4  # current window line names


def test_comparison_changes_are_currency_matched_and_safe():
    result = run()
    comparison = result["comparison"]
    assert comparison["period"]["label"] == "previous period"
    assert comparison["overall_status"] == "available"
    by_name = {change["product_name"]: change for change in comparison["changes"]}
    jacket = by_name["Trail Jacket"]
    assert jacket["currency"] == "USD"
    assert jacket["previous"] == "300" and jacket["current"] == "150"
    assert jacket["delta"] == "-150"
    assert jacket["percent"] == "-50.0" and jacket["direction"] == "down"
    assert jacket["status"] == "available"
    shell = by_name["Rain Shell"]
    assert shell["delta"] == "0" and shell["direction"] == "flat" and shell["percent"] == "0.0"
    assert shell["status"] == "available"
    parka = by_name["Insulated Parka"]
    assert parka["previous"] is None
    assert parka["status"] == "unsupported"
    assert parka["reason"] == "no_recorded_line_rows_in_previous_window"


def test_unrecorded_side_is_never_treated_as_zero():
    result = run()
    comparison = result["comparison"]
    parka = next(c for c in comparison["changes"] if c["product_name"] == "Insulated Parka")
    assert parka["delta"] is None, "no delta may be computed against an unrecorded side"
    assert "lost" not in comparison["scope"] and "recoverable" not in str(comparison).lower()


def test_declining_product_delta_and_percent_are_exact():
    result = run()
    comparison = result["comparison"]
    base = next(c for c in comparison["changes"] if c["product_name"] == "Base Layer")
    assert base["previous"] == "100" and base["current"] == "40"
    assert base["delta"] == "-60" and base["percent"] == "-60.0"


def test_changes_are_bounded_and_sorted_by_magnitude():
    result = run()
    changes = result["comparison"]["changes"]
    assert len(changes) <= 10
    deltas = [abs(Decimal(c["delta"])) for c in changes if c["delta"] is not None]
    assert deltas == sorted(deltas, reverse=True)


def test_both_sides_items_are_resolvable_inside_the_result():
    result = run()
    comparison = result["comparison"]
    all_ids = {item["id"] for item in result["items"]} | \
              {item["id"] for item in comparison["items"]}
    for change in comparison["changes"]:
        for side in ("current_evidence_id", "previous_evidence_id"):
            if change[side] is not None:
                assert change[side] in all_ids, f"{side} for {change['product_name']} must resolve"


def test_current_side_items_added_to_main_list_for_changed_names():
    result = run()
    metrics = [item["metric"] for item in result["items"]]
    # The previous-window items are NOT in the main list...
    assert all("previous" not in (item["period"].get("label") or "") for item in result["items"])
    # ...and the previous list carries its own window label.
    assert all(item["period"]["label"] == "previous period" for item in result["comparison"]["items"]
               if item["metric"] == "product_recorded_value")


def test_previous_window_query_failure_is_unavailable_not_zero():
    def failing(params):
        raise RuntimeError("simulated outage")
    db = make_db(compare_fn=failing, display_fn=lambda params: [])
    result = retrieve_product_evidence(ORG, db, start=CURRENT_START, end=NOW, now=NOW, compare=True)
    assert result["comparison"]["overall_status"] == "unavailable"
    assert result["comparison"]["changes"] == []


def test_explicit_comparison_window_must_precede_the_current_one():
    with pytest.raises(ValueError, match="end before"):
        retrieve_product_evidence(ORG, make_db(), start=CURRENT_START, end=NOW, now=NOW, compare=True,
                                  comparison_start=NOW - timedelta(days=3), comparison_end=NOW)


def test_previous_zero_denominator_is_disclosed_not_invented():
    def zeros(params):
        start = params["start"]
        if start < CURRENT_START:
            return [line("Trail Jacket", "USD", 0, "0")]
        return [line("Trail Jacket", "USD", 3, "150")]
    db = make_db(compare_fn=zeros, display_fn=zeros)
    result = retrieve_product_evidence(ORG, db, start=CURRENT_START, end=NOW, now=NOW, compare=True)
    change = result["comparison"]["changes"][0]
    # The zero previous value is disclosed, never divided: no percent is
    # invented, but the delta (a recorded-value computation) is reported.
    assert change["percent"] is None
    assert change["delta"] == "150"
    assert change["direction"] == "up"
    assert change["status"] == "available"
    assert change["reason"] is None


def test_all_queries_are_tenant_scoped():
    db = make_db()
    retrieve_product_evidence(ORG, db, start=CURRENT_START, end=NOW, now=NOW, compare=True)
    assert db.calls, "comparison must issue authorized queries"
    for sql, params in db.calls:
        assert params.get("org_id") == ORG
        assert "organization_id" in sql
