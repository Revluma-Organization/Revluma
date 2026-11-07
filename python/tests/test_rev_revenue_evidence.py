from datetime import datetime, timedelta, timezone
from decimal import Decimal

from src.intelligence.revenue_evidence import retrieve_revenue_evidence
from tests.rev_fakes import FakeDB

NOW = datetime(2026, 10, 31, 12, tzinfo=timezone.utc)
START, END = NOW - timedelta(days=7), NOW
ORG = "11111111-1111-1111-1111-111111111111"


def stores():
    return [
        {"id": "store-a1", "status": "active", "last_synced_at": NOW - timedelta(minutes=5)},
        {"id": "store-a2", "status": "connected", "last_synced_at": NOW - timedelta(minutes=6)},
    ]


def coverage():
    return [
        {"store_id": "store-a1", "coverage_start": START - timedelta(days=1),
         "coverage_end": END + timedelta(days=1), "certified_at": NOW,
         "customer_lifetime_verified": True},
        {"store_id": "store-a2", "coverage_start": START - timedelta(days=1),
         "coverage_end": END + timedelta(days=1), "certified_at": NOW,
         "customer_lifetime_verified": True},
    ]


def revenue_db(order_rows):
    db = FakeDB()
    db.add("SELECT id, last_synced_at, status", stores())
    db.add("intelligence_order_coverage", coverage())
    db.add("COUNT(*) AS order_count", order_rows)
    return db


def test_revenue_is_currency_separated_and_organization_scoped():
    db = revenue_db([
        {"currency": "USD", "order_count": 3, "order_value": Decimal("30.31")},
        {"currency": "NGN", "order_count": 1, "order_value": Decimal("1000.00")},
    ])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)

    assert evidence["overall_status"] == "available"
    assert evidence["organization_scope"]["store_count"] == 2
    values = {item["currency"]: item["value"] for item in evidence["items"]
              if item["metric"] == "recorded_order_value"}
    counts = {item["currency"]: item["value"] for item in evidence["items"]
              if item["metric"] == "recorded_order_count"}
    assert values == {"USD": "30.31", "NGN": "1000.00"}
    assert counts == {"USD": 3, "NGN": 1}
    assert all(str(ORG) in str(params.values()) for sql, params in db.statements
               if "orders o" in sql)
    order_sql = next(sql for sql, _ in db.statements if "orders o" in sql)
    assert "o.ordered_at < :end" in order_sql
    assert "'cancelled'" in order_sql
    assert "organization_id = :org_id" in order_sql


def test_verified_zero_is_not_a_currency_zero():
    evidence = retrieve_revenue_evidence(ORG, revenue_db([]), start=START, end=END, now=NOW)
    count = next(item for item in evidence["items"] if item["metric"] == "recorded_order_count")
    value = next(item for item in evidence["items"] if item["metric"] == "recorded_order_value")
    assert evidence["overall_status"] == "available"
    assert count["value"] == 0 and count["status"] == "verified_zero"
    assert value["value"] is None and value["currency"] is None
    assert value["status"] == "unsupported"


def test_failed_order_query_is_unavailable_never_zero():
    db = FakeDB(fail_patterns=("COUNT(*) AS order_count",))
    db.add("SELECT id, last_synced_at, status", stores())
    db.add("intelligence_order_coverage", coverage())
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    assert evidence["overall_status"] == "unavailable"
    assert all(item["status"] == "unavailable" for item in evidence["items"]
               if item["metric"].startswith("recorded_order"))
    assert all(item["value"] is None for item in evidence["items"]
               if item["metric"].startswith("recorded_order"))


def test_no_store_means_no_revenue_claim():
    db = FakeDB().add("SELECT id, last_synced_at, status", [])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    assert evidence["overall_status"] == "unavailable"
    assert evidence["items"] == []
    assert any("No active or connected store" in warning for warning in evidence["warnings"])


def test_incomplete_coverage_degrades_to_partial():
    partial = [dict(row) for row in coverage()]
    partial[1]["coverage_end"] = START
    db = FakeDB()
    db.add("SELECT id, last_synced_at, status", stores())
    db.add("intelligence_order_coverage", partial)
    db.add("COUNT(*) AS order_count",
           [{"currency": "USD", "order_count": 1, "order_value": Decimal("10")}])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    assert evidence["overall_status"] == "partial"
    assert evidence["coverage"]["complete"] is False


def test_orders_without_iso_currency_are_excluded_from_totals():
    db = revenue_db([
        {"currency": "USD", "order_count": 1, "order_value": Decimal("10")},
        {"currency": None, "order_count": 4, "order_value": Decimal("99")},
        {"currency": "us dollars", "order_count": 2, "order_value": Decimal("5")},
    ])
    evidence = retrieve_revenue_evidence(ORG, db, start=START, end=END, now=NOW)
    values = [item for item in evidence["items"] if item["metric"] == "recorded_order_value"]
    assert [item["currency"] for item in values] == ["USD"]
    assert "99.00" not in str(evidence["by_currency"])
    assert any("without a valid ISO currency" in warning for warning in evidence["warnings"])
