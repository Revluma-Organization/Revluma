from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from src.intelligence.seven_day_evidence import (
    format_revenue_evidence,
    resolve_revenue_period,
    retrieve_revenue_evidence,
)


NOW = datetime(2026, 10, 31, 12, tzinfo=timezone.utc)
START = NOW - timedelta(days=7)
END = NOW


class Result:
    def __init__(self, rows=None):
        self.rows = rows or []

    def mappings(self):
        return self

    def all(self):
        return self.rows


class RevenueDB:
    def __init__(self, *, stores=None, coverage=None, orders=None, fail=None):
        self.stores = stores if stores is not None else [
            {"id": "store-a", "platform": "shopify", "status": "active", "last_synced_at": NOW - timedelta(minutes=5)}
        ]
        self.coverage = coverage if coverage is not None else [
            {"store_id": "store-a", "coverage_start": START - timedelta(days=1),
             "coverage_end": END + timedelta(days=1), "certified_at": NOW,
             "source": "shopify_verified_history_v1", "source_run_id": "coverage-run-123"}
        ]
        self.orders = orders if orders is not None else [
            {"currency": "NGN", "item_count": 1, "amount": Decimal("5000.10")},
            {"currency": "USD", "item_count": 2, "amount": Decimal("125.55")},
        ]
        self.fail = fail
        self.expected_start = START
        self.expected_end = END
        self.calls = []
        self.rollbacks = 0

    def rollback(self):
        self.rollbacks += 1

    def execute(self, statement, params):
        sql = str(statement)
        self.calls.append((sql, params))
        if self.fail == "stores" and "FROM stores" in sql:
            raise RuntimeError("db unavailable")
        if "FROM stores" in sql:
            assert params["org_id"] == "org-a"
            return Result(self.stores)
        if "FROM intelligence_order_coverage" in sql:
            if self.fail == "coverage":
                raise RuntimeError("coverage unavailable")
            assert params["org_id"] == "org-a"
            assert params["trusted_source"] == "shopify_verified_history_v1"
            assert "ANY(CAST(:store_ids AS uuid[]))" in sql
            return Result(self.coverage)
        if "FROM orders" in sql:
            if self.fail == "orders":
                raise RuntimeError("query failure")
            assert params["org_id"] == "org-a"
            assert params["start"] == self.expected_start
            assert params["end"] == self.expected_end
            assert "s.organization_id = :org_id" in sql
            assert "o.ordered_at >= :start" in sql and "o.ordered_at < :end" in sql
            assert "LOWER(COALESCE(o.recovery_status, '')) <> 'cancelled'" in sql
            assert "COUNT(DISTINCT o.id)" in sql
            return Result(self.orders)
        raise AssertionError(f"Unexpected SQL: {sql}")


def retrieve(db):
    return retrieve_revenue_evidence("org-a", db, start=START, end=END, now=NOW)


def test_contract_envelope_preserves_currency_decimal_and_calculation_lineage():
    db = RevenueDB()
    evidence = retrieve(db)
    assert evidence["contract_version"] == "1.0"
    assert evidence["overall_status"] == "available"
    assert evidence["period"]["timezone"] == "UTC"
    assert evidence["period"]["semantics"] == "[start,end)"
    values = [x for x in evidence["items"] if x["metric"] == "recorded_order_value"]
    assert [(x["currency"], x["value"]) for x in values] == [
        ("NGN", "5000.10"), ("USD", "125.55")
    ]
    assert "gross_revenue" in {x["metric"] for x in evidence["items"]}
    assert "net_revenue" in {x["metric"] for x in evidence["items"]}
    assert "refund_value" in {x["metric"] for x in evidence["items"]}
    aov = [x for x in evidence["items"] if x["metric"] == "average_order_value"]
    assert {(x["currency"], x["value"]) for x in aov} == {
        ("USD", "62.775"), ("NGN", "5000.10")
    }
    assert all(x["calculation"]["input_evidence_ids"] for x in aov)
    assert all(x["source"]["system"] == "shopify" for x in values)
    assert all(x["status"] == "available" for x in values)


def test_query_is_organization_scoped_and_never_adds_mixed_currencies():
    db = RevenueDB()
    evidence = retrieve(db)
    order_query = next(sql for sql, _ in db.calls if "FROM orders" in sql)
    assert "s.organization_id = :org_id" in order_query
    assert "GROUP BY CASE" in order_query
    assert "UPPER(BTRIM(o.currency)) ~" in order_query
    assert len([x for x in evidence["items"] if x["metric"] == "recorded_order_value"]) == 2
    assert not any(x["metric"] == "total_revenue_all_currencies" for x in evidence["items"])


def test_missing_coverage_is_unknown_not_verified_zero():
    db = RevenueDB(coverage=[])
    evidence = retrieve(db)
    assert evidence["overall_status"] == "unknown"
    assert all(x["status"] == "unknown" for x in evidence["items"] if x["metric"] == "recorded_order_value")
    assert "REVENUE_EVIDENCE_UNKNOWN" in [x["code"] for x in evidence["errors"]]


def test_partial_store_coverage_never_claims_complete_organization_total():
    stores = [
        {"id": "store-a", "platform": "shopify", "status": "active", "last_synced_at": NOW - timedelta(minutes=5)},
        {"id": "store-b", "platform": "shopify", "status": "active", "last_synced_at": NOW - timedelta(minutes=5)},
    ]
    db = RevenueDB(stores=stores)
    evidence = retrieve(db)
    assert evidence["overall_status"] == "partial"
    assert all(x["coverage"]["completeness"] == "partial" for x in evidence["items"] if x["metric"] == "recorded_order_value")


def test_stale_source_sync_is_reported_as_stale():
    stores = [{"id": "store-a", "platform": "shopify", "status": "active", "last_synced_at": NOW - timedelta(hours=2)}]
    db = RevenueDB(stores=stores)
    evidence = retrieve(db)
    assert evidence["overall_status"] == "stale"
    assert any("exceeds the 30-minute" in " ".join(x["coverage"]["limitations"]) for x in evidence["items"] if x["metric"] == "recorded_order_value")


def test_failed_order_query_is_unavailable_and_never_zero():
    db = RevenueDB(fail="orders")
    evidence = retrieve(db)
    assert evidence["overall_status"] == "unavailable"
    assert evidence["items"] == []
    assert evidence["errors"] == [{"code": "REVENUE_ORDER_QUERY_FAILED"}]
    assert db.rollbacks == 1
    assert "no zero value" in " ".join(evidence["warnings"])


def test_failed_store_scope_is_unavailable():
    db = RevenueDB(fail="stores")
    evidence = retrieve(db)
    assert evidence["overall_status"] == "unavailable"
    assert evidence["organization_scope"]["store_count"] == 0


def test_no_authorized_shopify_store_is_unavailable_not_zero():
    db = RevenueDB(stores=[])
    evidence = retrieve(db)
    assert evidence["overall_status"] == "unavailable"
    assert evidence["items"] == []
    assert len(db.calls) == 1


def test_zero_orders_with_full_coverage_only_certifies_zero_count_not_currencyless_money():
    db = RevenueDB(orders=[])
    evidence = retrieve(db)
    assert evidence["overall_status"] == "available"
    count = next(x for x in evidence["items"] if x["metric"] == "recorded_order_count")
    value = next(x for x in evidence["items"] if x["metric"] == "recorded_order_value")
    assert count["value"] == 0 and count["status"] == "available"
    assert value["value"] is None and value["status"] == "unsupported"
    assert value["currency"] is None


def test_custom_periods_use_utc_inclusive_calendar_dates_and_half_open_end():
    result = resolve_revenue_period(
        "show revenue between 2026-12-30 and 2027-01-02",
        now=NOW,
    )
    assert result["status"] == "supported"
    assert result["start"] == datetime(2026, 12, 30, tzinfo=timezone.utc)
    assert result["end"] == datetime(2027, 1, 3, tzinfo=timezone.utc)


def test_merchant_local_today_and_yesterday_are_unsupported_without_store_timezone():
    for phrase in ("revenue today", "sales yesterday"):
        result = resolve_revenue_period(phrase, now=NOW)
        assert result["status"] == "unsupported"
        assert "timezone is not persisted" in result["reason"]


def test_rolling_seven_and_thirty_day_windows_are_complete_utc_calendar_days():
    seven = resolve_revenue_period("revenue for the last 7 days", now=NOW)
    thirty = resolve_revenue_period("sales in the past 30 days", now=NOW)
    utc_today_start = datetime(2026, 10, 31, 0, tzinfo=timezone.utc)
    assert seven["start"] == utc_today_start - timedelta(days=7)
    assert thirty["start"] == utc_today_start - timedelta(days=30)
    assert seven["end"] == thirty["end"] == utc_today_start
    assert seven["timezone"] == thirty["timezone"] == "UTC"


def test_rejects_naive_or_invalid_period_boundaries():
    with pytest.raises(ValueError, match="Authenticated organization"):
        retrieve_revenue_evidence("", RevenueDB(), start=START, end=END, now=NOW)
    with pytest.raises(ValueError, match="timezone-aware"):
        retrieve_revenue_evidence("org-a", RevenueDB(), start=datetime(2026, 10, 1), end=END, now=NOW)
    with pytest.raises(ValueError, match="after start"):
        retrieve_revenue_evidence("org-a", RevenueDB(), start=END, end=START, now=NOW)


def test_formatter_never_labels_recorded_order_value_gross_or_net_revenue():
    text = format_revenue_evidence(retrieve(RevenueDB()))
    assert "Recorded order value (USD)" in text
    assert "Recorded order value (NGN)" in text
    assert "not a gross-sales or net-revenue report" in text
    assert "not separately itemized" in text

def test_period_older_than_verified_coverage_is_insufficient_history():
    db = RevenueDB()
    db.expected_start = NOW - timedelta(days=30)
    db.expected_end = NOW
    evidence = retrieve_revenue_evidence(
        "org-a", db, start=db.expected_start, end=db.expected_end, now=NOW
    )
    assert evidence["overall_status"] == "insufficient_history"
    assert all(
        item["status"] == "insufficient_history"
        for item in evidence["items"]
        if item["metric"] == "recorded_order_value"
    )


def test_unknown_currency_is_counted_but_never_reported_as_money():
    db = RevenueDB(orders=[
        {"currency": "UNKNOWN", "item_count": 2, "amount": Decimal("123.45")}
    ])
    evidence = retrieve(db)
    count = next(item for item in evidence["items"] if item["metric"] == "recorded_order_count")
    value = next(item for item in evidence["items"] if item["metric"] == "recorded_order_value")
    assert count["value"] == 2 and count["currency"] is None
    assert value["value"] is None and value["currency"] is None and value["status"] == "unsupported"

def test_gbp_eur_usd_ngn_are_reported_as_separate_currency_items():
    db = RevenueDB(orders=[
        {"currency": "EUR", "item_count": 1, "amount": Decimal("19.99")},
        {"currency": "GBP", "item_count": 2, "amount": Decimal("30.01")},
        {"currency": "NGN", "item_count": 3, "amount": Decimal("5000.10")},
        {"currency": "USD", "item_count": 4, "amount": Decimal("40.40")},
    ])
    evidence = retrieve(db)
    values = {
        item["currency"]: item["value"]
        for item in evidence["items"]
        if item["metric"] == "recorded_order_value"
    }
    assert values == {
        "EUR": "19.99", "GBP": "30.01", "NGN": "5000.10", "USD": "40.40"
    }
    assert len(values) == 4

def test_daylight_saving_boundary_is_not_guessed_without_store_timezone():
    result = resolve_revenue_period(
        "revenue between 2026-03-07 and 2026-03-09",
        now=NOW,
    )
    assert result["timezone"] == "UTC"
    assert result["end"] - result["start"] == timedelta(hours=72)

def test_today_and_yesterday_are_supported_only_when_utc_is_explicit():
    today = resolve_revenue_period("revenue today UTC", now=NOW)
    yesterday = resolve_revenue_period("sales yesterday UTC", now=NOW)
    today_start = datetime(2026, 10, 31, 0, tzinfo=timezone.utc)
    assert today["start"] == today_start
    assert today["end"] == NOW
    assert today["label"] == "today UTC to request time"
    assert yesterday["start"] == today_start - timedelta(days=1)
    assert yesterday["end"] == today_start

def test_coverage_query_failure_preserves_unknown_status_and_partial_values():
    db = RevenueDB(fail="coverage")
    evidence = retrieve(db)
    assert evidence["overall_status"] == "unknown"
    values = [item for item in evidence["items"] if item["metric"] == "recorded_order_value"]
    assert values and all(item["status"] == "unknown" for item in values)
    assert any("attestations could not be retrieved" in warning for warning in evidence["warnings"])
    assert "REVENUE_EVIDENCE_UNKNOWN" in [item["code"] for item in evidence["errors"]]

def test_month_and_year_boundary_periods_are_inclusive_dates_with_exclusive_end():
    month = resolve_revenue_period(
        "revenue between 2026-01-01 and 2026-01-31", now=NOW
    )
    year = resolve_revenue_period(
        "revenue from 2026-12-31 to 2027-01-01", now=NOW
    )
    assert month["start"] == datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert month["end"] == datetime(2026, 2, 1, tzinfo=timezone.utc)
    assert year["start"] == datetime(2026, 12, 31, tzinfo=timezone.utc)
    assert year["end"] == datetime(2027, 1, 2, tzinfo=timezone.utc)

def test_unsupported_relative_periods_are_not_silently_replaced_with_seven_days():
    for phrase in (
        "revenue for the last month",
        "sales over the last 90 days",
        "revenue this quarter",
        "sales for the previous year",
        "what was revenue in Q1 2026",
        "show sales for October 2026",
        "what was revenue in FY2026",
    ):
        result = resolve_revenue_period(phrase, now=NOW)
        assert result["status"] == "unsupported"
        assert "explicit UTC date range" in result["reason"]

def test_zero_value_order_is_not_confused_with_zero_orders():
    db = RevenueDB(orders=[
        {"currency": "USD", "item_count": 1, "amount": Decimal("0.00")}
    ])
    evidence = retrieve(db)
    count = next(item for item in evidence["items"] if item["metric"] == "recorded_order_count")
    value = next(item for item in evidence["items"] if item["metric"] == "recorded_order_value")
    assert evidence["overall_status"] == "available"
    assert count["value"] == 1 and count["status"] == "available"
    assert value["value"] == "0.00" and value["currency"] == "USD"
    assert value["status"] == "available"

def test_invalid_and_reversed_custom_periods_return_unsupported_without_throwing():
    invalid = resolve_revenue_period(
        "revenue between 2026-02-30 and 2026-03-02", now=NOW
    )
    reversed_range = resolve_revenue_period(
        "sales from 2026-03-02 to 2026-02-28", now=NOW
    )
    assert invalid["status"] == "unsupported"
    assert "invalid ISO calendar date" in invalid["reason"]
    assert reversed_range["status"] == "unsupported"
    assert "must not precede" in reversed_range["reason"]
" in order_query
    assert "LOWER(COALESCE(o.recovery_status, '')) <> 'cancelled'" in order_query
    assert len([x for x in evidence["items"] if x["metric"] == "recorded_order_value"]) == 2
    assert not any(x["metric"] == "total_revenue_all_currencies" for x in evidence["items"])


def test_missing_coverage_is_unknown_not_verified_zero():
    db = RevenueDB(coverage=[])
    evidence = retrieve(db)
    assert evidence["overall_status"] == "unknown"
    assert all(x["status"] == "unknown" for x in evidence["items"] if x["metric"] == "recorded_order_value")
    assert "REVENUE_EVIDENCE_UNKNOWN" in [x["code"] for x in evidence["errors"]]


def test_partial_store_coverage_never_claims_complete_organization_total():
    stores = [
        {"id": "store-a", "platform": "shopify", "status": "active", "last_synced_at": NOW - timedelta(minutes=5)},
        {"id": "store-b", "platform": "shopify", "status": "active", "last_synced_at": NOW - timedelta(minutes=5)},
    ]
    db = RevenueDB(stores=stores)
    evidence = retrieve(db)
    assert evidence["overall_status"] == "partial"
    assert all(x["coverage"]["completeness"] == "partial" for x in evidence["items"] if x["metric"] == "recorded_order_value")


def test_stale_source_sync_is_reported_as_stale():
    stores = [{"id": "store-a", "platform": "shopify", "status": "active", "last_synced_at": NOW - timedelta(hours=2)}]
    db = RevenueDB(stores=stores)
    evidence = retrieve(db)
    assert evidence["overall_status"] == "stale"
    assert any("exceeds the 30-minute" in " ".join(x["coverage"]["limitations"]) for x in evidence["items"] if x["metric"] == "recorded_order_value")


def test_failed_order_query_is_unavailable_and_never_zero():
    db = RevenueDB(fail="orders")
    evidence = retrieve(db)
    assert evidence["overall_status"] == "unavailable"
    assert evidence["items"] == []
    assert evidence["errors"] == [{"code": "REVENUE_ORDER_QUERY_FAILED"}]
    assert db.rollbacks == 1
    assert "no zero value" in " ".join(evidence["warnings"])


def test_failed_store_scope_is_unavailable():
    db = RevenueDB(fail="stores")
    evidence = retrieve(db)
    assert evidence["overall_status"] == "unavailable"
    assert evidence["organization_scope"]["store_count"] == 0


def test_no_authorized_shopify_store_is_unavailable_not_zero():
    db = RevenueDB(stores=[])
    evidence = retrieve(db)
    assert evidence["overall_status"] == "unavailable"
    assert evidence["items"] == []
    assert len(db.calls) == 1


def test_zero_orders_with_full_coverage_only_certifies_zero_count_not_currencyless_money():
    db = RevenueDB(orders=[])
    evidence = retrieve(db)
    assert evidence["overall_status"] == "available"
    count = next(x for x in evidence["items"] if x["metric"] == "recorded_order_count")
    value = next(x for x in evidence["items"] if x["metric"] == "recorded_order_value")
    assert count["value"] == 0 and count["status"] == "available"
    assert value["value"] is None and value["status"] == "unsupported"
    assert value["currency"] is None


def test_custom_periods_use_utc_inclusive_calendar_dates_and_half_open_end():
    result = resolve_revenue_period(
        "show revenue between 2026-12-30 and 2027-01-02",
        now=NOW,
    )
    assert result["status"] == "supported"
    assert result["start"] == datetime(2026, 12, 30, tzinfo=timezone.utc)
    assert result["end"] == datetime(2027, 1, 3, tzinfo=timezone.utc)


def test_merchant_local_today_and_yesterday_are_unsupported_without_store_timezone():
    for phrase in ("revenue today", "sales yesterday"):
        result = resolve_revenue_period(phrase, now=NOW)
        assert result["status"] == "unsupported"
        assert "timezone is not persisted" in result["reason"]


def test_rolling_seven_and_thirty_day_windows_are_complete_utc_calendar_days():
    seven = resolve_revenue_period("revenue for the last 7 days", now=NOW)
    thirty = resolve_revenue_period("sales in the past 30 days", now=NOW)
    utc_today_start = datetime(2026, 10, 31, 0, tzinfo=timezone.utc)
    assert seven["start"] == utc_today_start - timedelta(days=7)
    assert thirty["start"] == utc_today_start - timedelta(days=30)
    assert seven["end"] == thirty["end"] == utc_today_start
    assert seven["timezone"] == thirty["timezone"] == "UTC"


def test_rejects_naive_or_invalid_period_boundaries():
    with pytest.raises(ValueError, match="Authenticated organization"):
        retrieve_revenue_evidence("", RevenueDB(), start=START, end=END, now=NOW)
    with pytest.raises(ValueError, match="timezone-aware"):
        retrieve_revenue_evidence("org-a", RevenueDB(), start=datetime(2026, 10, 1), end=END, now=NOW)
    with pytest.raises(ValueError, match="after start"):
        retrieve_revenue_evidence("org-a", RevenueDB(), start=END, end=START, now=NOW)


def test_formatter_never_labels_recorded_order_value_gross_or_net_revenue():
    text = format_revenue_evidence(retrieve(RevenueDB()))
    assert "Recorded order value (USD)" in text
    assert "Recorded order value (NGN)" in text
    assert "not a gross-sales or net-revenue report" in text
    assert "not separately itemized" in text

def test_period_older_than_verified_coverage_is_insufficient_history():
    db = RevenueDB()
    db.expected_start = NOW - timedelta(days=30)
    db.expected_end = NOW
    evidence = retrieve_revenue_evidence(
        "org-a", db, start=db.expected_start, end=db.expected_end, now=NOW
    )
    assert evidence["overall_status"] == "insufficient_history"
    assert all(
        item["status"] == "insufficient_history"
        for item in evidence["items"]
        if item["metric"] == "recorded_order_value"
    )


def test_unknown_currency_is_counted_but_never_reported_as_money():
    db = RevenueDB(orders=[
        {"currency": "UNKNOWN", "item_count": 2, "amount": Decimal("123.45")}
    ])
    evidence = retrieve(db)
    count = next(item for item in evidence["items"] if item["metric"] == "recorded_order_count")
    value = next(item for item in evidence["items"] if item["metric"] == "recorded_order_value")
    assert count["value"] == 2 and count["currency"] is None
    assert value["value"] is None and value["currency"] is None and value["status"] == "unsupported"

def test_gbp_eur_usd_ngn_are_reported_as_separate_currency_items():
    db = RevenueDB(orders=[
        {"currency": "EUR", "item_count": 1, "amount": Decimal("19.99")},
        {"currency": "GBP", "item_count": 2, "amount": Decimal("30.01")},
        {"currency": "NGN", "item_count": 3, "amount": Decimal("5000.10")},
        {"currency": "USD", "item_count": 4, "amount": Decimal("40.40")},
    ])
    evidence = retrieve(db)
    values = {
        item["currency"]: item["value"]
        for item in evidence["items"]
        if item["metric"] == "recorded_order_value"
    }
    assert values == {
        "EUR": "19.99", "GBP": "30.01", "NGN": "5000.10", "USD": "40.40"
    }
    assert len(values) == 4

def test_daylight_saving_boundary_is_not_guessed_without_store_timezone():
    result = resolve_revenue_period(
        "revenue between 2026-03-07 and 2026-03-09",
        now=NOW,
    )
    assert result["timezone"] == "UTC"
    assert result["end"] - result["start"] == timedelta(hours=72)

def test_today_and_yesterday_are_supported_only_when_utc_is_explicit():
    today = resolve_revenue_period("revenue today UTC", now=NOW)
    yesterday = resolve_revenue_period("sales yesterday UTC", now=NOW)
    today_start = datetime(2026, 10, 31, 0, tzinfo=timezone.utc)
    assert today["start"] == today_start
    assert today["end"] == NOW
    assert today["label"] == "today UTC to request time"
    assert yesterday["start"] == today_start - timedelta(days=1)
    assert yesterday["end"] == today_start

def test_coverage_query_failure_preserves_unknown_status_and_partial_values():
    db = RevenueDB(fail="coverage")
    evidence = retrieve(db)
    assert evidence["overall_status"] == "unknown"
    values = [item for item in evidence["items"] if item["metric"] == "recorded_order_value"]
    assert values and all(item["status"] == "unknown" for item in values)
    assert any("attestations could not be retrieved" in warning for warning in evidence["warnings"])
    assert "REVENUE_EVIDENCE_UNKNOWN" in [item["code"] for item in evidence["errors"]]

def test_month_and_year_boundary_periods_are_inclusive_dates_with_exclusive_end():
    month = resolve_revenue_period(
        "revenue between 2026-01-01 and 2026-01-31", now=NOW
    )
    year = resolve_revenue_period(
        "revenue from 2026-12-31 to 2027-01-01", now=NOW
    )
    assert month["start"] == datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert month["end"] == datetime(2026, 2, 1, tzinfo=timezone.utc)
    assert year["start"] == datetime(2026, 12, 31, tzinfo=timezone.utc)
    assert year["end"] == datetime(2027, 1, 2, tzinfo=timezone.utc)

def test_unsupported_relative_periods_are_not_silently_replaced_with_seven_days():
    for phrase in (
        "revenue for the last month",
        "sales over the last 90 days",
        "revenue this quarter",
        "sales for the previous year",
        "what was revenue in Q1 2026",
        "show sales for October 2026",
        "what was revenue in FY2026",
    ):
        result = resolve_revenue_period(phrase, now=NOW)
        assert result["status"] == "unsupported"
        assert "explicit UTC date range" in result["reason"]

def test_zero_value_order_is_not_confused_with_zero_orders():
    db = RevenueDB(orders=[
        {"currency": "USD", "item_count": 1, "amount": Decimal("0.00")}
    ])
    evidence = retrieve(db)
    count = next(item for item in evidence["items"] if item["metric"] == "recorded_order_count")
    value = next(item for item in evidence["items"] if item["metric"] == "recorded_order_value")
    assert evidence["overall_status"] == "available"
    assert count["value"] == 1 and count["status"] == "available"
    assert value["value"] == "0.00" and value["currency"] == "USD"
    assert value["status"] == "available"

def test_invalid_and_reversed_custom_periods_return_unsupported_without_throwing():
    invalid = resolve_revenue_period(
        "revenue between 2026-02-30 and 2026-03-02", now=NOW
    )
    reversed_range = resolve_revenue_period(
        "sales from 2026-03-02 to 2026-02-28", now=NOW
    )
    assert invalid["status"] == "unsupported"
    assert "invalid ISO calendar date" in invalid["reason"]
    assert reversed_range["status"] == "unsupported"
    assert "must not precede" in reversed_range["reason"]
