"""
Unit tests for P2-A -- Dynamic Business State Refresh
Tests the _get_next_rebuild_interval function in business_state.py.
"""

import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from unittest.mock import MagicMock

from src.intelligence.business_state import (
    BusinessState,
    CUSTOMER_CONTEXT_LIMIT,
    LTV_APPROACH_BAND,
    LTV_THRESHOLDS,
    VIP_INACTIVE_DAYS,
    _get_next_rebuild_interval,
    _load_customer_ml_signals,
)


class TestBusinessStateRefresh:

    def test_normal_load_returns_15_minutes(self):
        result = _get_next_rebuild_interval(current_event_rate=10, baseline_rate=10)
        assert result == timedelta(minutes=15)

    def test_elevated_load_returns_5_minutes(self):
        result = _get_next_rebuild_interval(current_event_rate=20, baseline_rate=10)
        assert result == timedelta(minutes=5)

    def test_spike_load_returns_1_minute(self):
        result = _get_next_rebuild_interval(current_event_rate=50, baseline_rate=10)
        assert result == timedelta(minutes=1)

    def test_boundary_exactly_2x_baseline_returns_5_minutes(self):
        result = _get_next_rebuild_interval(current_event_rate=20, baseline_rate=10)
        assert result == timedelta(minutes=5)

    def test_boundary_exactly_5x_baseline_returns_1_minute(self):
        result = _get_next_rebuild_interval(current_event_rate=50, baseline_rate=10)
        assert result == timedelta(minutes=1)

    def test_zero_baseline_does_not_raise_division_error(self):
        # A new merchant with no history must not cause a ZeroDivisionError.
        result = _get_next_rebuild_interval(current_event_rate=0, baseline_rate=0)
        assert result == timedelta(minutes=15)

    def test_zero_baseline_with_live_traffic_stays_normal(self):
        result = _get_next_rebuild_interval(current_event_rate=100, baseline_rate=0)
        assert result == timedelta(minutes=15)

    def test_negative_baseline_stays_normal(self):
        result = _get_next_rebuild_interval(current_event_rate=100, baseline_rate=-5)
        assert result == timedelta(minutes=15)

    def test_just_below_2x_stays_normal(self):
        # 1.9x ratio should not trigger elevated
        result = _get_next_rebuild_interval(current_event_rate=19, baseline_rate=10)
        assert result == timedelta(minutes=15)

    def test_just_below_5x_stays_elevated(self):
        # 4.9x ratio should not trigger spike
        result = _get_next_rebuild_interval(current_event_rate=49, baseline_rate=10)
        assert result == timedelta(minutes=5)


def _complete_state() -> BusinessState:
    generated_at = datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc)
    return BusinessState(
        id="state-id",
        organization_id="organisation-id",
        schema_version="1.1",
        generated_at=generated_at,
        data_freshness_at=generated_at,
        staleness_threshold_mins=15,
        computation_status="complete",
        warnings=[],
        revenue_today=Decimal("120.50"),
        revenue_yesterday=Decimal("100.00"),
        revenue_delta_pct=20.5,
        revenue_trend_7d=8.0,
        revenue_anomaly=False,
        abandoned_cart_count=2,
        abandoned_cart_value=Decimal("45.00"),
        cart_anomaly=False,
        churn_risk_count=3,
        vip_inactive_count=1,
        returning_customer_rate=0.4,
        returning_customer_rate_delta=5.0,
        opportunities=[],
        risks=[],
        anomalies=[],
        trends=[],
        ml_signals={},
        inventory_signals={"status": "unavailable"},
        anomaly_severity="normal",
        root_causes=[],
        current_event_rate=12.0,
        baseline_event_rate=10.0,
        next_rebuild_at=generated_at + timedelta(minutes=15),
        cart_delta_pct_vs_avg=25.0,
    )


class TestBusinessStateContract:

    def test_nested_contract_contains_each_health_domain(self):
        state = _complete_state().to_dict()

        assert state["sales_health"]["revenue_today"] == 120.5
        assert state["customer_health"]["returning_customer_rate_delta"] == 5.0
        assert state["inventory_health"] == {"status": "unavailable"}
        assert state["anomaly_summary"]["severity"] == "normal"
        assert state["traffic"]["baseline_event_rate_5m_30d"] == 10.0

    def test_flat_compatibility_keys_match_nested_values(self):
        state = _complete_state().to_dict()

        assert state["revenue_today"] == state["sales_health"]["revenue_today"]
        assert state["cart_anomaly"] == state["sales_health"]["cart_anomaly"]
        assert (
            state["returning_customer_rate"]
            == state["customer_health"]["returning_customer_rate"]
        )

    def test_assignment_canonical_contract_is_exposed_without_removing_compatibility(self):
        state = _complete_state().to_dict()

        assert state["snapshot_at"] == state["generated_at"]
        assert state["merchant_id"] == state["organization_id"]
        assert state["revenue"] == {
            "today": 120.5,
            "yesterday": 100.0,
            "delta_pct": 20.5,
            "trend_7d": 8.0,
            "anomaly": False,
            "severity": "low",
        }
        assert state["abandoned_carts"] == {
            "count": 2,
            "value": 45.0,
            "delta_pct_vs_avg": 25.0,
            "anomaly": False,
        }
        assert state["customers"]["vip_inactive_45d"] == 1
        assert state["inventory"] == {"status": "unavailable"}
        assert state["ml_outputs"] == {}
        assert state["top_opportunities"] == []
        assert state["active_concerns"] == []


class TestCustomerAgentContext:

    def test_context_uses_purchase_activity_and_contains_no_pii(self):
        db = MagicMock()
        db.execute.return_value.mappings.return_value.all.return_value = [
            {
                "customer_id": "customer-1",
                "rfm_segment": "champion",
                "past_orders_total": 3,
                "ltv": Decimal("520.00"),
                "previous_ltv": Decimal("480.00"),
                "days_inactive": 45,
            }
        ]

        payload = _load_customer_ml_signals(db, {"store_ids": ("store-1",)})

        statement, params = db.execute.call_args.args
        sql = str(statement)
        assert "latest.ordered_at" in sql
        assert "c.updated_at" not in sql
        assert "email" not in sql
        assert "full_name" not in sql
        assert "phone" not in sql
        assert params["context_limit"] == CUSTOMER_CONTEXT_LIMIT
        assert params["vip_days"] == VIP_INACTIVE_DAYS
        assert params["approach_floor"] == 1 - LTV_APPROACH_BAND
        assert tuple(params[f"ltv_{index}"] for index in range(len(LTV_THRESHOLDS))) == LTV_THRESHOLDS
        assert payload == {
            "customers": [
                {
                    "customer_id": "customer-1",
                    "rfm_segment": "champion",
                    "past_orders_total": 3,
                    "ltv": 520.0,
                    "previous_ltv": 480.0,
                    "days_inactive": 45,
                }
            ],
            "limit": CUSTOMER_CONTEXT_LIMIT,
            "truncated": False,
        }

    def test_context_marks_a_full_page_as_possibly_truncated(self):
        db = MagicMock()
        rows = [
            {
                "customer_id": f"customer-{index}",
                "rfm_segment": "champion",
                "past_orders_total": 1,
                "ltv": Decimal("100.00"),
                "previous_ltv": Decimal("50.00"),
                "days_inactive": 45,
            }
            for index in range(CUSTOMER_CONTEXT_LIMIT)
        ]
        db.execute.return_value.mappings.return_value.all.return_value = rows

        payload = _load_customer_ml_signals(db, {"store_ids": ("store-1",)})

        assert payload["truncated"] is True
