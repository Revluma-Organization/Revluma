from unittest.mock import patch

import numpy as np
import pytest

from src.models.churn import predict as churn_predict
from src.models.churn.train import (
    FEATURE_COLUMNS,
    _calculate_order_and_event_signals,
    _calculate_sequence_signals,
    _compute_churn_records,
    _is_production_eligible,
    _trend_direction,
    normalize_churn_features,
)


EXPECTED_FEATURE_COLUMNS = [
    "past_orders_total",
    "days_since_last_purchase",
    "avg_order_value",
    "purchase_frequency_trend",
    "rfm_recency_score",
    "rfm_frequency_score",
    "rfm_monetary_score",
    "historical_aov_trend",
    "email_open_rate_30d",
    "email_open_rate_90d",
    "email_open_rate_delta",
    "sms_click_rate_30d",
    "site_visit_frequency_30d",
    "site_visit_frequency_90d",
    "site_visit_delta",
    "browse_to_cart_conversion_trend",
    "coupon_dependency_score",
    "return_rate",
    "support_contact_frequency_90d",
    "discount_seeking_escalation",
    "unsubscribe_risk_score",
]


class ResultCursor:
    def __init__(self, rows):
        self._rows = iter(rows)
        self.executions = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def execute(self, query, parameters):
        self.executions.append((query, parameters))

    def fetchone(self):
        return next(self._rows)


class SingleCursorConnection:
    def __init__(self, rows):
        self.cursor_instance = ResultCursor(rows)

    def cursor(self):
        return self.cursor_instance


def test_feature_contract_uses_the_21_named_s3_signals_in_order():
    assert FEATURE_COLUMNS == EXPECTED_FEATURE_COLUMNS
    assert len(FEATURE_COLUMNS) == 21


def test_feature_aliases_normalize_without_overwriting_canonical_values():
    normalized = normalize_churn_features({
        "sms_click_rate": 0.2,
        "sms_click_rate_30d": 0.4,
        "site_visit_frequency_delta": -3,
        "browse_to_cart_trend": -1,
    })

    assert normalized["sms_click_rate_30d"] == 0.4
    assert normalized["site_visit_delta"] == -3
    assert normalized["browse_to_cart_conversion_trend"] == -1


def test_predict_sends_normalized_aliases_in_the_training_feature_order():
    class RecordingModel:
        classes_ = np.array(["AT_RISK", "CRITICAL", "HEALTHY", "HIGH_RISK"])

        def __init__(self):
            self.frame = None

        def predict_proba(self, frame):
            self.frame = frame
            return np.array([[0.1, 0.1, 0.7, 0.1]])

    model = RecordingModel()
    features = {
        "days_since_last_purchase": 10,
        "sms_click_rate": 0.2,
        "sms_click_rate_30d": 0.4,
        "site_visit_frequency_delta": -3,
        "browse_to_cart_trend": -1,
    }

    with (
        patch.object(churn_predict, "load_model", return_value=model),
        patch.object(churn_predict, "_early_warning_probability", return_value=None),
    ):
        churn_predict.predict("customer-1", features, "merchant-1")

    assert list(model.frame.columns) == FEATURE_COLUMNS
    assert model.frame.loc[0, "sms_click_rate_30d"] == 0.4
    assert model.frame.loc[0, "site_visit_delta"] == -3
    assert model.frame.loc[0, "browse_to_cart_conversion_trend"] == -1


def test_trend_direction_uses_a_five_percent_neutral_band():
    assert _trend_direction(106, 100) == 1
    assert _trend_direction(94, 100) == -1
    assert _trend_direction(105, 100) == 0
    assert _trend_direction(50, 0) == 1
    assert _trend_direction(0, 0) == 0


def test_order_and_event_signals_keep_counts_rates_and_trends_in_their_units():
    connection = SingleCursorConnection([
        (80, 100),
        (12, 45),
        (20, 5, 10, 5),
        (4, 2),
    ])

    signals = _calculate_order_and_event_signals("customer-1", connection)

    assert signals == {
        "historical_aov_trend": -1,
        "site_visit_frequency_30d": 12.0,
        "site_visit_frequency_90d": 45.0,
        "site_visit_delta": -3.0,
        "browse_to_cart_conversion_trend": -1,
        "discount_seeking_escalation": 1,
    }
    assert len(connection.cursor_instance.executions) == 4
    assert all(
        parameters == ("customer-1",)
        for _, parameters in connection.cursor_instance.executions
    )


def test_sequence_signals_are_normalized_as_rates():
    connection = SingleCursorConnection([(10, 20, 4, 6, 5, 2, 1)])

    signals = _calculate_sequence_signals("customer-1", connection)

    assert signals["email_open_rate_30d"] == pytest.approx(0.4)
    assert signals["email_open_rate_90d"] == pytest.approx(0.3)
    assert signals["email_open_rate_delta"] == pytest.approx(0.1)
    assert signals["sms_click_rate_30d"] == pytest.approx(0.4)
    assert signals["unsubscribe_risk_score"] == pytest.approx(0.05)
    assert connection.cursor_instance.executions[0][1] == ("customer-1",)


def test_real_rows_use_sequence_data_and_preserve_the_complete_contract():
    rfm = {
        "past_orders_total": 8,
        "days_since_last_purchase": 20,
        "avg_order_value": 125.0,
        "rfm_recency_score": 4,
        "rfm_frequency_score": 3,
        "rfm_monetary_score": 5,
    }
    order_signals = {
        "historical_aov_trend": 1,
        "site_visit_frequency_30d": 9.0,
        "site_visit_frequency_90d": 36.0,
        "site_visit_delta": -3.0,
        "browse_to_cart_conversion_trend": -1,
        "discount_seeking_escalation": 1,
    }
    sequence_signals = {
        "email_open_rate_30d": 0.2,
        "email_open_rate_90d": 0.5,
        "email_open_rate_delta": -0.3,
        "sms_click_rate_30d": 0.1,
        "unsubscribe_risk_score": 0.0,
    }

    with (
        patch("src.models.churn.train._relation_exists", return_value=True),
        patch("src.models.churn.train.calculate_rfm_scores", return_value=rfm),
        patch("src.models.churn.train.calculate_purchase_frequency_trend", return_value=-1),
        patch("src.models.churn.train._calculate_order_and_event_signals", return_value=order_signals),
        patch("src.models.churn.train.calculate_coupon_usage_pct", return_value=35.0),
        patch("src.models.churn.train._calculate_sequence_signals", return_value=sequence_signals),
    ):
        frame = _compute_churn_records(["customer-1"], object())

    assert list(frame.columns) == FEATURE_COLUMNS + [
        "churn_tier",
        "engagement_decay_score",
        "early_warning",
    ]
    assert frame.loc[0, "coupon_dependency_score"] == 0.35
    assert frame.loc[0, "email_open_rate_30d"] == 0.2
    assert frame.loc[0, "return_rate"] == 0
    assert frame.loc[0, "support_contact_frequency_90d"] == 0
    assert frame.loc[0, "engagement_decay_score"] > 0


def test_real_rows_use_neutral_sequence_values_when_tables_are_unavailable():
    rfm = {
        "past_orders_total": 3,
        "days_since_last_purchase": 40,
        "avg_order_value": 75.0,
        "rfm_recency_score": 2,
        "rfm_frequency_score": 2,
        "rfm_monetary_score": 2,
    }
    order_signals = {
        "historical_aov_trend": 0,
        "site_visit_frequency_30d": 0.0,
        "site_visit_frequency_90d": 0.0,
        "site_visit_delta": 0.0,
        "browse_to_cart_conversion_trend": 0,
        "discount_seeking_escalation": 0,
    }

    with (
        patch("src.models.churn.train._relation_exists", return_value=False),
        patch("src.models.churn.train.calculate_rfm_scores", return_value=rfm),
        patch("src.models.churn.train.calculate_purchase_frequency_trend", return_value=0),
        patch("src.models.churn.train._calculate_order_and_event_signals", return_value=order_signals),
        patch("src.models.churn.train.calculate_coupon_usage_pct", return_value=0.0),
        patch("src.models.churn.train._calculate_sequence_signals") as sequence_signals,
    ):
        frame = _compute_churn_records(["customer-1"], object())

    sequence_signals.assert_not_called()
    for feature in (
        "email_open_rate_30d",
        "email_open_rate_90d",
        "email_open_rate_delta",
        "sms_click_rate_30d",
        "unsubscribe_risk_score",
    ):
        assert frame.loc[0, feature] == 0


@pytest.mark.parametrize(
    ("used_real_data", "below_minimum", "meets_auc", "meets_precision", "expected"),
    [
        (True, False, True, True, True),
        (False, False, True, True, False),
        (True, True, True, True, False),
        (True, False, False, True, False),
        (True, False, True, False, False),
    ],
)
def test_production_registration_requires_real_data_and_every_quality_gate(
    used_real_data,
    below_minimum,
    meets_auc,
    meets_precision,
    expected,
):
    assert _is_production_eligible(
        used_real_data=used_real_data,
        below_minimum=below_minimum,
        meets_auc=meets_auc,
        meets_high_risk_precision=meets_precision,
    ) is expected
