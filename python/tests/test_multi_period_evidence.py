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


class CohortDB:
    """A merchant-filtered fixture exercising all four evidence queries."""
    def __init__(self):
        self.calls = []
    def rollback(self):
        raise AssertionError("Successful cohort queries must not roll back")
    def execute(self, sql, params):
        query = str(sql)
        self.calls.append((query, params.copy()))
        assert "s.organization_id = :org_id" in query
        assert params["org_id"] == "merchant-a"
        if "o.customer_id, o.ordered_at, o.id" in query:
            return QueryResult([
                {"customer_id": "buyer-1", "ordered_at": datetime(2026, 10, 1, tzinfo=timezone.utc), "id": "order-0"},
                {"customer_id": "buyer-1", "ordered_at": datetime(2026, 10, 28, tzinfo=timezone.utc), "id": "order-1"},
                {"customer_id": "buyer-2", "ordered_at": datetime(2026, 10, 20, tzinfo=timezone.utc), "id": "order-2"},
                {"customer_id": "buyer-2", "ordered_at": datetime(2026, 10, 28, tzinfo=timezone.utc), "id": "order-3"},
            ])
        if "FROM customers c" in query:
            return QueryResult([
                {"created_at": datetime(2026, 10, 28, tzinfo=timezone.utc)},
                {"created_at": datetime(2026, 10, 20, tzinfo=timezone.utc)},
            ])
        if "o.currency, o.ordered_at AS occurred_at" in query:
            return QueryResult([
                {"currency": "USD", "occurred_at": datetime(2026, 10, 28, tzinfo=timezone.utc), "amount": Decimal("100"), "discount_amount": Decimal("5")},
            ])
        return QueryResult([])


def test_merchant_cohorts_and_discounts_match_recorded_history():
    db = CohortDB()
    evidence = retrieve_multi_period_evidence("merchant-a", db, now=datetime(2026, 10, 29, tzinfo=timezone.utc))
    current, prior = evidence["weeks"][:2]
    assert current["purchasers"] == {"status": "available", "first_time_orders": 0, "returning_orders": 2}
    assert prior["purchasers"] == {"status": "available", "first_time_orders": 1, "returning_orders": 0}
    assert current["customers"]["new_customer_records"] == 1
    assert prior["customers"]["new_customer_records"] == 1
    assert current["orders"]["by_currency"][0]["recorded_discount_amount"] == "5"
    answer = format_multi_period_comparison(evidence)
    assert "Returning" in answer or "returning purchaser orders: 2" in answer
    assert "Recorded order discounts: 5 USD" in answer
    assert len(db.calls) == 4


def test_comparison_request_with_sync_context_is_not_store_connection_question():
    from src.agents.orchestrator import _is_store_connection_question

    question = (
        "What has changed in my Shopify store recently? Compare my store's performance "
        "over the latest 7 days against the previous three 7-day periods. "
        "Use only verified data from my connected Shopify store. "
        "Explain whether orders and checkout activity are syncing correctly."
    )
    assert not _is_store_connection_question(question)
    assert _is_store_connection_question("Can you check if my Shopify store is connected and syncing?")
