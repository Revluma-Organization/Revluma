from decimal import Decimal
from types import SimpleNamespace

from src.agents.revenue_agent import RevenueAgent


def state(**overrides):
    values = {
        "warnings": [],
        "revenue_today": None,
        "revenue_yesterday": Decimal("5000.25"),
        "revenue_delta_pct": None,
        "revenue_trend_7d": Decimal("12.5"),
        "revenue_currency": "NGN",
        "revenue_evidence": {
            "overall_status": "available",
            "items": [
                {"evidence_id": "evidence-yesterday", "metric": "recorded_order_value",
                 "currency": "NGN", "status": "available",
                 "period": {"start": "2026-10-30T00:00:00+00:00", "end": "2026-10-31T00:00:00+00:00"}},
                {"evidence_id": "evidence-trend", "metric": "revenue_trend_7d",
                 "value": "12.5", "currency": "NGN", "status": "available"},
            ],
        },
        "revenue_anomaly": False,
        "anomalies": [],
        "opportunities": [],
        "cart_anomaly": False,
        "abandoned_cart_count": 0,
        "abandoned_cart_value": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_revenue_agent_preserves_verified_currency_and_utc_period():
    result = RevenueAgent().analyze(state(), [], "Review revenue performance")
    assert result.status == "success"
    assert result.facts == [{
        "type": "fact",
        "metric": "revenue_yesterday",
        "claim_type": "verified_fact",
        "evidence_ids": ["evidence-yesterday"],
        "value": "5000.25",
        "currency": "NGN",
        "description": "Recorded order value yesterday (UTC): 5,000.25 NGN",
        "source": "orders.total and orders.currency, previous complete UTC day",
    }]
    trend = next(signal for signal in result.signals if signal["metric"] == "revenue_trend_7d")
    assert trend["currency"] == "NGN"
    assert trend["claim_type"] == "calculated_observation"
    assert trend["evidence_ids"] == ["evidence-trend"]
    assert result.data_sources == ["evidence-yesterday", "evidence-trend"]
    assert "NGN" in trend["description"]
    assert "$" not in str(result.facts)


def test_revenue_agent_fails_closed_for_legacy_snapshot_without_currency():
    result = RevenueAgent().analyze(
        state(revenue_today=Decimal("100"), revenue_yesterday=Decimal("90"), revenue_currency=None),
        [],
        "How is revenue performing?",
    )
    assert result.status == "no_data"
    assert result.facts == []
    assert "single-currency" in result.warnings[0]


def test_revenue_agent_does_not_infer_cause_from_revenue_movement():
    result = RevenueAgent().analyze(
        state(revenue_delta_pct=-20.0, revenue_trend_7d=-18.0, revenue_evidence={
            "overall_status": "available",
            "items": [
                {"evidence_id": "evidence-yesterday", "metric": "recorded_order_value",
                 "value": "5000.25", "currency": "NGN", "status": "available"},
                {"evidence_id": "evidence-trend", "metric": "revenue_trend_7d",
                 "value": "-18.0", "currency": "NGN", "status": "available"},
            ],
        }),
        [],
        "Why did recorded order value decline?",
    )
    assert result.status == "success"
    assert result.diagnosis
    assert all("does not" in item["description"] for item in result.diagnosis)
    assert all(item["evidence_ids"] for item in result.diagnosis)
    assert all("traffic" not in item["description"].lower() or "not been verified" in item["description"].lower()
               for item in result.diagnosis)
