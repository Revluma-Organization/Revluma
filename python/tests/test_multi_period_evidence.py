from datetime import datetime, timezone
from decimal import Decimal

from src.intelligence.multi_period_evidence import retrieve_multi_period_evidence, format_multi_period_comparison


class QueryResult:
    def __init__(self, rows):
        self.rows = rows
    def mappings(self):
        return self
    def all(self):
        return self.rows


class FakeDB:
    def __init__(self):
        self.calls = []
    def rollback(self):
        pass
    def execute(self, sql, params):
        self.calls.append((str(sql), params))
        if "FROM orders" in str(sql):
            return QueryResult([
                {"currency": "USD", "occurred_at": datetime(2026, 10, 28, tzinfo=timezone.utc), "amount": Decimal("100"), "discount_amount": Decimal("5")},
                {"currency": "NGN", "occurred_at": datetime(2026, 10, 20, tzinfo=timezone.utc), "amount": Decimal("5000"), "discount_amount": Decimal("0")},
            ])
        return QueryResult([])


def test_multi_period_evidence_is_tenant_scoped_currency_safe_and_non_fabricating():
    db = FakeDB()
    evidence = retrieve_multi_period_evidence("merchant-a", db, now=datetime(2026, 10, 29, tzinfo=timezone.utc))
    assert len(evidence["weeks"]) == 4
    assert evidence["weeks"][0]["orders"]["by_currency"] == [
        {"currency": "USD", "order_count": 1, "recorded_order_value": "100", "recorded_discount_amount": "5"}]
    assert evidence["weeks"][1]["orders"]["by_currency"] == [
        {"currency": "NGN", "order_count": 1, "recorded_order_value": "5000", "recorded_discount_amount": "0"}]
    assert all(params["org_id"] == "merchant-a" for _, params in db.calls)
    assert all("s.organization_id = :org_id" in sql for sql, _ in db.calls)
    answer = format_multi_period_comparison(evidence)
    assert "Refunds" in answer
    assert "Traffic, conversion" in answer
    assert "NGN" in answer and "USD" in answer


def test_multi_period_rejects_unauthenticated_org_and_naive_clock():
    import pytest
    db = FakeDB()
    with pytest.raises(ValueError):
        retrieve_multi_period_evidence("", db)
    with pytest.raises(ValueError):
        retrieve_multi_period_evidence("merchant-a", db, now=datetime(2026, 10, 29))
