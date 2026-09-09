from types import SimpleNamespace
from unittest.mock import patch

from src.agents.retention_agent import (
    RetentionAgent,
    _discount_allowed,
    _highest_value_winback,
)


def _business_state(churn_customers=None):
    customers = churn_customers or []
    return SimpleNamespace(
        id="state-1",
        churn_risk_count=0,
        abandoned_cart_count=0,
        abandoned_cart_value=0.0,
        returning_customer_rate=0.35,
        vip_inactive_count=0,
        cart_anomaly=False,
        opportunities=[],
        warnings=[],
        ml_signals={"churn": {"customers": customers}},
    )


def test_structured_output_matches_the_exact_s5_schema():
    output = RetentionAgent().structured_output(_business_state(), [], "retention status")

    assert set(output) == {
        "domain",
        "findings",
        "confidence",
        "recommended_action",
        "evidence_references",
        "contradictions_detected",
    }
    assert isinstance(output["findings"], str)
    assert output["recommended_action"] is None or isinstance(
        output["recommended_action"], str
    )
    assert isinstance(output["confidence"], float)
    assert all(isinstance(item, str) for item in output["evidence_references"])
    assert all(isinstance(item, str) for item in output["contradictions_detected"])


def test_highest_value_winback_uses_expected_value_not_ltv_alone():
    customers = [
        {
            "customer_id": "high-ltv-low-risk",
            "churn_tier": "AT_RISK",
            "customer_ltv": 1000,
            "churn_probability": 0.2,
        },
        {
            "customer_id": "lower-ltv-high-risk",
            "churn_tier": "HIGH_RISK",
            "customer_ltv": 500,
            "churn_probability": 0.8,
        },
    ]

    selected = _highest_value_winback(customers)

    assert selected["customer_id"] == "lower-ltv-high-risk"


def test_healthy_and_early_warning_tiers_never_allow_discounts():
    assert _discount_allowed("HEALTHY") is False
    assert _discount_allowed("EARLY_WARNING") is False
    assert _discount_allowed("AT_RISK") is True


def test_vip_facts_and_recommendations_use_the_45_day_cohort():
    state = _business_state()
    state.vip_inactive_count = 2

    result = RetentionAgent().analyze(state, [], "retention status")

    vip_fact = next(fact for fact in result.facts if fact["metric"] == "vip_inactive_count")
    vip_recommendation = next(
        recommendation
        for recommendation in result.recommendations
        if recommendation["action"] == "vip_reengagement"
    )
    assert "45+ days" in vip_fact["description"]
    assert "45+ days" in vip_recommendation["description"]


def test_analysis_uses_only_the_supplied_context_package():
    customer = {
        "customer_id": "customer-1",
        "churn_tier": "HIGH_RISK",
        "customer_ltv": 600,
        "churn_probability": 0.8,
        "recommended_channel": "sms",
    }

    result = RetentionAgent().analyze(
        _business_state([customer]),
        [],
        "best win-back opportunity",
    )

    recommendation = result.recommendations[0]
    assert recommendation["params"]["customer_id"] == "customer-1"
    assert recommendation["params"]["channel"] == "sms"
    assert recommendation["params"]["use_discount"] is True


def test_failure_logs_do_not_include_exception_text(caplog):
    agent = RetentionAgent()
    with patch.object(
        agent,
        "_analyze",
        side_effect=RuntimeError("private-customer@example.com"),
    ):
        agent.analyze(_business_state(), [], "status")

    assert "private-customer@example.com" not in caplog.text
