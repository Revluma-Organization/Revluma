from types import SimpleNamespace
from unittest.mock import patch

from src.agents.customer_agent import (
    CustomerAgent,
    _approaching_second_purchase,
    _just_reached_ltv_threshold,
    _vip_inactive,
)


def _business_state(customers=None):
    return SimpleNamespace(
        id="state-1",
        churn_risk_count=0,
        returning_customer_rate=0.3,
        vip_inactive_count=0,
        warnings=[],
        ml_signals={"customer": {"customers": customers or []}},
    )


def test_structured_output_matches_the_exact_s5_schema():
    output = CustomerAgent().structured_output(_business_state(), [], "customer health")

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


def test_vip_inactive_threshold_starts_at_45_days():
    customers = [
        {"customer_id": "too-early", "rfm_segment": "champion", "days_inactive": 44},
        {"customer_id": "eligible", "rfm_segment": "champion", "days_inactive": 45},
        {"customer_id": "loyal-not-vip", "rfm_segment": "loyal", "days_inactive": 60},
    ]

    selected = _vip_inactive(customers)

    assert [customer["customer_id"] for customer in selected] == ["eligible"]


def test_aggregate_vip_count_is_treated_as_the_45_day_cohort():
    state = _business_state([])
    state.vip_inactive_count = 2

    result = CustomerAgent().analyze(state, [], None)
    output = CustomerAgent().structured_output(state, [], None)

    vip_fact = next(fact for fact in result.facts if fact["metric"] == "vip_inactive_count")
    assert "45+ days" in vip_fact["description"]
    assert "VIP_THRESHOLD_IS_30_NOT_45" not in output["contradictions_detected"]


def test_second_purchase_cohort_contains_exactly_one_time_buyers():
    customers = [
        {"customer_id": "none", "past_orders_total": 0},
        {"customer_id": "one", "past_orders_total": 1},
        {"customer_id": "repeat", "past_orders_total": 2},
    ]

    selected = _approaching_second_purchase(customers)

    assert [customer["customer_id"] for customer in selected] == ["one"]


def test_just_reached_ltv_threshold_requires_a_real_prior_value():
    customers = [
        {"customer_id": "crossed", "previous_ltv": 480, "ltv": 520},
        {"customer_id": "already-above", "previous_ltv": 510, "ltv": 540},
        {"customer_id": "no-prior", "ltv": 520},
    ]

    selected = _just_reached_ltv_threshold(customers)

    assert len(selected) == 1
    assert selected[0]["customer_id"] == "crossed"
    assert selected[0]["ltv_threshold"] == 500


def test_newly_crossed_ltv_threshold_becomes_a_recommendation():
    customer = {
        "customer_id": "customer-1",
        "previous_ltv": 480,
        "ltv": 520,
        "past_orders_total": 3,
        "rfm_segment": "loyal",
        "days_inactive": 10,
    }

    result = CustomerAgent().analyze(
        _business_state([customer]),
        [],
        "customers needing attention",
    )

    recommendation = next(
        item
        for item in result.recommendations
        if item["action"] == "ltv_threshold_reached"
    )
    assert recommendation["params"]["ltv_threshold"] == 500
    assert recommendation["params"]["use_discount"] is False


def test_failure_logs_do_not_include_exception_text(caplog):
    agent = CustomerAgent()
    with patch.object(
        agent,
        "_analyze",
        side_effect=RuntimeError("private-customer@example.com"),
    ):
        agent.analyze(_business_state(), [], "status")

    assert "private-customer@example.com" not in caplog.text
