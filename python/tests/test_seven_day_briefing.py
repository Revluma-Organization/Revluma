"""Seven-day route and evidence-only briefing regressions."""
from src.agents.orchestrator import _is_seven_day_store_briefing
from src.intelligence.seven_day_briefing import compose_seven_day_briefing


def _evidence():
    return {
        "period_start_utc": "2026-10-21T12:00:00+00:00",
        "period_end_utc": "2026-10-28T12:00:00+00:00",
        "store_count": 1,
        "last_store_sync_at": None,
        "orders": {"status": "available", "by_currency": [
            {"currency": "NGN", "order_count": 2, "gross_recorded_order_value": "3000", "average_order_value": "1500"}
        ]},
        "abandoned_carts": {"status": "available", "by_currency": [
            {"currency": "NGN", "cart_count": 3, "cart_value": "4500"}
        ]},
        "recovered_carts": {"status": "available", "count": 1},
        "checkout_activity": {"status": "unavailable"},
    }


def test_explicit_seven_day_store_question_routes_to_evidence():
    assert _is_seven_day_store_briefing("Rev, analyze my Shopify store's performance over the last seven days. What should I be paying attention to?")
    assert _is_seven_day_store_briefing("How are my store sales this week?")
    assert not _is_seven_day_store_briefing("How can I improve Shopify sales?")
    assert not _is_seven_day_store_briefing("Is my Shopify store connected?")


def test_briefing_reports_only_verified_values_and_limits():
    output = compose_seven_day_briefing(_evidence())
    assert "2 orders" in output
    assert "3000 NGN" in output
    assert "3 carts" in output
    assert "1 carts" in output
    assert "not verified net revenue" in output
    assert "Checkout funnel:** Not yet verified" in output
    assert "initial Shopify sync" in output


def test_unavailable_orders_are_not_misreported_as_zero():
    evidence = _evidence()
    evidence["orders"] = {"status": "unavailable", "by_currency": []}
    output = compose_seven_day_briefing(evidence)
    assert "**Orders:** Unavailable" in output
    assert "No orders were recorded" not in output


def test_missing_store_does_not_claim_metrics():
    evidence = _evidence()
    evidence["store_count"] = 0
    output = compose_seven_day_briefing(evidence)
    assert "couldn't find an active connected store" in output
    assert "2 orders" not in output
