from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pandas as pd
import pytest

from src.models.timing import train as timing_train
from src.models.timing.predict import predict
from src.models.timing.train import (
    FEATURE_COLUMNS,
    RECOVERY_ACTION_MAP,
    TARGET_COLUMN,
    _bootstrap_probability_intervals,
    _build_send_feature_record,
    _evaluate_probabilities,
    _expected_calibration_error,
    _generate_synthetic_data,
    _is_production_eligible,
    _load_real_send_rows,
    _load_verified_policy_ctr_improvement,
    _probability_quality_passed,
    _temporal_calibration_splits,
    load_training_data,
)


NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


def test_training_uses_the_seven_canonical_features():
    assert FEATURE_COLUMNS == [
        "send_hour",
        "send_day",
        "channel",
        "historical_open_rate",
        "days_since_last_purchase",
        "cart_value_tier",
        "recovery_action",
    ]
    assert set(RECOVERY_ACTION_MAP) == {
        "DISCOUNT",
        "FRICTION_FIX",
        "TRUST_REASSURE",
        "HYBRID_BUNDLE",
        "TRUST_PLUS_DEAL",
        "FRICTION_PLUS_TRUST",
        "FULL_PERSONALISE",
        "NUDGE",
        "SOFT_NUDGE",
    }


def test_synthetic_training_frame_matches_the_feature_contract():
    x_train, x_test, y_train, y_test = _generate_synthetic_data(200)

    assert list(x_train.columns) == FEATURE_COLUMNS
    assert list(x_test.columns) == FEATURE_COLUMNS
    assert len(x_train) + len(x_test) == len(y_train) + len(y_test) == 200


def test_real_send_record_reads_historical_rate_and_purchase_recency():
    row = (
        "send-1",
        "customer-1",
        "sms",
        datetime(2026, 8, 30, 18, 0, tzinfo=timezone.utc),
        {
            "recovery_action": "TRUST_REASSURE",
            "cart_value_tier": "premium",
            "historical_open_rate": 0.65,
            "days_since_last_purchase": 12,
        },
        1,
    )

    record = _build_send_feature_record(row)

    assert list(record) == FEATURE_COLUMNS + [TARGET_COLUMN]
    assert record["historical_open_rate"] == 0.65
    assert record["days_since_last_purchase"] == 12
    assert record["cart_value_tier"] == 2


def test_real_query_uses_the_documented_sequence_event_schema():
    connection = MagicMock()
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.fetchall.return_value = []

    frame = _load_real_send_rows(connection)

    sql = cursor.execute.call_args.args[0]
    assert "e.sequence_send_id = s.id" in sql
    assert "e.occurred_at" in sql
    assert "e.event_type = 'opened'" in sql
    assert "e.event_type = 'clicked'" in sql
    assert "s.sent_at <= NOW() - INTERVAL '120 minutes'" in sql
    assert "s.status IN ('sent', 'delivered')" in sql
    assert frame.empty


def test_real_loader_rejects_incomplete_feature_snapshots():
    connection = MagicMock()
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.fetchall.return_value = [
        ("send-1", "customer-1", "email", NOW, {"recovery_action": "NUDGE"}, 1)
    ]

    frame = _load_real_send_rows(connection)

    assert frame.empty
    assert list(frame.columns) == FEATURE_COLUMNS + [TARGET_COLUMN]


def test_legacy_hybrid_action_maps_to_canonical_hybrid_bundle():
    row = (
        "send-1",
        "customer-1",
        "email",
        NOW,
        {"recovery_action": "HYBRID"},
        0,
    )

    record = _build_send_feature_record(row)

    assert record["recovery_action"] == RECOVERY_ACTION_MAP["HYBRID_BUNDLE"]


def test_real_training_rejects_a_chronological_split_missing_a_class(monkeypatch):
    rows = pd.DataFrame(
        {
            **{column: [0] * 500 for column in FEATURE_COLUMNS},
            TARGET_COLUMN: [0] * 425 + [1] * 75,
        }
    )
    monkeypatch.setattr(timing_train, "_load_real_send_rows", lambda _db: rows)

    with pytest.raises(RuntimeError, match="each contain both outcome classes"):
        load_training_data(db_connection=MagicMock())


def test_calibration_error_uses_probability_bins():
    error = _expected_calibration_error(
        [0, 0, 1, 1],
        [0.1, 0.2, 0.8, 0.9],
        n_bins=2,
    )

    assert error == 0.15


def test_probability_metrics_and_intervals_show_honest_skill_over_null():
    labels = [0, 0, 0, 0, 1, 1, 1, 1]
    probabilities = [0.02, 0.05, 0.08, 0.12, 0.88, 0.92, 0.95, 0.98]

    metrics, _ = _evaluate_probabilities(labels, probabilities)
    metrics.update(
        _bootstrap_probability_intervals(labels, probabilities, n_resamples=100)
    )

    assert metrics["average_precision"] == 1.0
    assert metrics["brier_improvement"] > 0
    assert metrics["log_loss_improvement"] > 0
    assert metrics["score_selection_lift"] == 0.5
    assert _probability_quality_passed(metrics)


def test_temporal_calibration_never_trains_on_future_rows():
    labels = pd.Series(([0, 1] * 50))

    splits = _temporal_calibration_splits(labels)

    assert len(splits) == 5
    assert all(train_index.max() < test_index.min() for train_index, test_index in splits)


def test_policy_gate_reads_only_randomized_control_evidence():
    connection = MagicMock()
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.side_effect = [("model_evaluation_metrics",), (0.09, 650)]

    lift, sample_size = _load_verified_policy_ctr_improvement(connection)

    evaluation_sql = cursor.execute.call_args_list[1].args[0]
    assert lift == 0.09
    assert sample_size == 650
    assert "DISTINCT ON (organization_id)" in evaluation_sql
    assert "randomized_policy_ctr_improvement" in evaluation_sql
    assert "metadata->>'evaluation_design' = 'randomized_control'" in evaluation_sql


def test_failed_payment_uses_immediate_sms_override():
    result = predict(
        "customer-1",
        {"failed_payment_attempt": True, "channel": "email", "customer_timezone_offset": 0},
        "merchant-1",
        now=NOW,
    )

    assert result["reasoning_layer"] == "immediate"
    assert result["channel"] == "sms"
    assert result["send_at_utc"] == (NOW + timedelta(minutes=5)).isoformat()
    assert result["fallback"] is False


def test_premium_high_risk_uses_eight_minute_override():
    result = predict(
        "customer-1",
        {
            "risk_score": 0.8,
            "cart_value_tier": "premium",
            "channel": "email",
            "customer_timezone_offset": 0,
        },
        "merchant-1",
        now=NOW,
    )

    assert result["reasoning_layer"] == "immediate"
    assert result["send_at_utc"] == (NOW + timedelta(minutes=8)).isoformat()


def test_personal_history_selects_a_safe_future_hour_within_18_hours():
    probabilities = [0.05] * 24
    probabilities[15] = 0.95
    probabilities[16] = 0.95
    probabilities[17] = 0.95

    result = predict(
        "customer-1",
        {
            "channel": "email",
            "customer_timezone_offset": 0,
            "historical_open_probabilities": probabilities,
            "history_data_points": 6,
        },
        "merchant-1",
        now=NOW,
    )

    assert result["reasoning_layer"] == "personalised"
    assert result["send_at"].startswith("2026-09-01T15:00:00")
    assert result["confidence"] >= 0.55


def test_sparse_history_uses_channel_specific_global_baseline():
    result = predict(
        "customer-1",
        {
            "channel": "sms",
            "customer_timezone_offset": 0,
            "historical_open_probabilities": [0.9] * 24,
            "history_data_points": 2,
        },
        "merchant-1",
        now=NOW,
    )

    assert result["reasoning_layer"] == "global_baseline"
    assert result["channel"] == "sms"
    assert result["send_at"].startswith("2026-09-03T18:30:00")
    assert result["fallback"] is True


def test_second_message_waits_36_hours_after_open_without_click():
    previous = NOW - timedelta(hours=1)
    result = predict(
        "customer-1",
        {
            "channel": "email",
            "customer_timezone_offset": 0,
            "sequence_message_number": 2,
            "previous_message_sent_at": previous.isoformat(),
            "previous_message_opened": True,
            "previous_message_clicked": False,
        },
        "merchant-1",
        now=NOW,
    )

    assert result["reasoning_layer"] == "hybrid"
    assert datetime.fromisoformat(result["send_at_utc"]) >= previous + timedelta(hours=36)


def test_two_sms_messages_are_never_scheduled_within_24_hours():
    last_sms = NOW - timedelta(hours=2)
    result = predict(
        "customer-1",
        {
            "channel": "sms",
            "customer_timezone_offset": 0,
            "last_sms_sent_at": last_sms.isoformat(),
        },
        "merchant-1",
        now=NOW,
    )

    assert datetime.fromisoformat(result["send_at_utc"]) >= last_sms + timedelta(hours=24)


def test_model_failure_does_not_expose_exception_text(caplog):
    model = MagicMock()
    model.predict_proba.side_effect = RuntimeError("private-customer@example.com")

    predict(
        "customer-1",
        {
            "channel": "email",
            "customer_timezone_offset": 0,
            "historical_open_probabilities": [0.1] * 24,
            "history_data_points": 3,
        },
        "merchant-1",
        model=model,
        now=NOW,
    )

    assert "private-customer@example.com" not in caplog.text


def test_timing_registration_requires_real_data_predictive_quality_and_policy_lift():
    assert _is_production_eligible(
        used_real_data=True,
        score_selection_lift=0.08,
        calibration_error=0.12,
        probability_quality_passed=True,
        verified_policy_ctr_improvement=0.08,
        policy_evaluation_events=500,
    )
    assert not _is_production_eligible(
        used_real_data=False,
        score_selection_lift=0.50,
        calibration_error=0.01,
        probability_quality_passed=True,
        verified_policy_ctr_improvement=0.50,
        policy_evaluation_events=500,
    )
    assert not _is_production_eligible(
        used_real_data=True,
        score_selection_lift=0.07,
        calibration_error=0.01,
        probability_quality_passed=True,
        verified_policy_ctr_improvement=0.50,
        policy_evaluation_events=500,
    )
    assert not _is_production_eligible(
        used_real_data=True,
        score_selection_lift=0.20,
        calibration_error=0.13,
        probability_quality_passed=True,
        verified_policy_ctr_improvement=0.50,
        policy_evaluation_events=500,
    )
    assert not _is_production_eligible(
        used_real_data=True,
        score_selection_lift=0.20,
        calibration_error=0.01,
        probability_quality_passed=False,
        verified_policy_ctr_improvement=0.50,
        policy_evaluation_events=500,
    )
    assert not _is_production_eligible(
        used_real_data=True,
        score_selection_lift=0.20,
        calibration_error=0.01,
        probability_quality_passed=True,
        verified_policy_ctr_improvement=None,
        policy_evaluation_events=0,
    )
