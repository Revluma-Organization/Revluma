"""Contract tests for read-only seven-day merchant evidence."""
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import Mock
import pytest

from src.intelligence.seven_day_evidence import retrieve_seven_day_evidence


class Result:
    def __init__(self, rows=None, scalar_value=None):
        self.rows = rows or []
        self.scalar_value = scalar_value

    def mappings(self):
        return self

    def all(self):
        return self.rows

    def scalar(self):
        return self.scalar_value


def test_requires_authenticated_organization():
    with pytest.raises(ValueError, match="Authenticated organization"):
        retrieve_seven_day_evidence("", Mock())


def test_rejects_naive_clock():
    with pytest.raises(ValueError, match="timezone-aware"):
        retrieve_seven_day_evidence("org-1", Mock(), now=datetime(2026, 10, 28))


def test_zero_activity_is_available_and_period_is_half_open():
    db = Mock()
    db.execute.side_effect = [
        Result([{"id": "store-1", "last_synced_at": datetime(2026, 10, 28, tzinfo=timezone.utc)}]),
        Result([]), Result([]), Result(scalar_value=0),
    ]
    end = datetime(2026, 10, 28, 12, tzinfo=timezone.utc)
    evidence = retrieve_seven_day_evidence("org-1", db, now=end)
    assert evidence["period_start_utc"] == "2026-10-21T12:00:00+00:00"
    assert evidence["period_end_utc"] == end.isoformat()
    assert evidence["orders"] == {"status": "available", "by_currency": []}
    assert evidence["recovered_carts"]["count"] == 0
    assert evidence["checkout_activity"]["status"] == "unavailable"
    assert all(call.args[1]["org_id"] == "org-1" for call in db.execute.call_args_list)
    for call in db.execute.call_args_list[1:]:
        sql = str(call.args[0])
        assert "s.organization_id = :org_id" in sql
        assert ">= :start" in sql and "< :end" in sql


def test_currency_separation_and_recovered_definition():
    db = Mock()
    db.execute.side_effect = [
        Result([{"id": "store-1", "last_synced_at": None}]),
        Result([
            {"currency": "NGN", "item_count": 2, "amount": Decimal("3000")},
            {"currency": "USD", "item_count": 1, "amount": Decimal("20")},
        ]),
        Result([{"currency": "NGN", "item_count": 3, "amount": Decimal("4500")}]),
        Result(scalar_value=1),
    ]
    evidence = retrieve_seven_day_evidence("org-1", db)
    orders = evidence["orders"]["by_currency"]
    assert orders[0]["average_order_value"] == "1500"
    assert orders[1]["gross_recorded_order_value"] == "20"
    assert evidence["abandoned_carts"]["by_currency"][0]["cart_count"] == 3
    assert evidence["recovered_carts"]["count"] == 1
    assert evidence["last_store_sync_at"] is None


def test_no_stores_returns_unavailable_not_fake_zero():
    db = Mock()
    db.execute.return_value = Result([])
    evidence = retrieve_seven_day_evidence("org-1", db)
    assert evidence["orders"]["status"] == "unavailable"
    assert evidence["recovered_carts"]["count"] is None
    assert db.execute.call_count == 1


def test_failed_order_query_does_not_fabricate_revenue():
    db = Mock()
    db.execute.side_effect = [
        Result([{"id": "store-1", "last_synced_at": None}]),
        RuntimeError("query failure"), Result([]), Result(scalar_value=0),
    ]
    evidence = retrieve_seven_day_evidence("org-1", db)
    assert evidence["orders"]["status"] == "unavailable"
    assert evidence["abandoned_carts"]["status"] == "available"
    db.rollback.assert_called_once()
