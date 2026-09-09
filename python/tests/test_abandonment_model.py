from unittest.mock import MagicMock, patch

import numpy as np

from src.models.abandonment import predict as abandonment_predict
from src.models.abandonment import train as abandonment_train
from src.models.abandonment.train import (
    FEATURE_COLUMNS,
    _compute_m1_feature_records,
    _is_production_eligible,
    _load_real_session_rows,
    generate_synthetic_data,
)


def test_generate_synthetic_data_uses_the_eight_feature_contract():
    data = generate_synthetic_data(100)

    assert list(data.columns) == FEATURE_COLUMNS + ["abandoned"]
    assert len(FEATURE_COLUMNS) == 8
    assert data["cursor_hesitation"].between(0, 10).all()


def test_real_feature_records_use_focus_blur_hesitation_score():
    events = [
        {
            "event_type": "field_focus",
            "timestamp": "2026-08-30T10:00:00Z",
            "payload": {"field_name": "payment"},
        },
        {
            "event_type": "field_blur",
            "timestamp": "2026-08-30T10:00:04Z",
            "payload": {"field_name": "payment"},
        },
    ]

    data = _compute_m1_feature_records(
        ["session-1"],
        {"session-1": 1},
        {"session-1": events},
    )

    assert data.loc[0, "cursor_hesitation"] == 4
    assert list(data.drop(columns=["abandoned"]).columns) == FEATURE_COLUMNS


def test_m1_boost_prefers_canonical_hesitation_score():
    assert abandonment_predict._compute_boosts({"cursor_hesitation": 2}) == 0.10
    assert abandonment_predict._compute_boosts({"cursor_hesitation_count": 2}) == 0.10
    assert abandonment_predict._compute_boosts({
        "cursor_hesitation": 0,
        "cursor_hesitation_count": 10,
    }) == 0.0


def test_predict_passes_the_training_feature_order_to_the_model():
    class RecordingModel:
        def __init__(self):
            self.columns = None

        def predict_proba(self, frame):
            self.columns = list(frame.columns)
            return np.array([[0.4, 0.6]])

    model = RecordingModel()
    feature_vector = {column: 0 for column in FEATURE_COLUMNS}

    with patch.object(abandonment_predict, "load_model", return_value=model):
        result = abandonment_predict.predict(feature_vector, "merchant-1")

    assert result["fallback"] is False
    assert model.columns == FEATURE_COLUMNS


def test_intervention_window_remains_an_integer_for_fractional_score():
    result = abandonment_predict._decide_intervention(
        0.8,
        {"cursor_hesitation": 2.5},
    )

    assert result["intervention_window_seconds"] == 35
    assert isinstance(result["intervention_window_seconds"], int)


def test_m1_registration_requires_real_minimum_data_and_all_quality_gates():
    assert _is_production_eligible(
        used_real_data=True,
        below_minimum=False,
        auc_roc=0.75,
        precision=0.70,
        recall=0.65,
    )
    assert not _is_production_eligible(
        used_real_data=False,
        below_minimum=False,
        auc_roc=0.99,
        precision=0.99,
        recall=0.99,
    )
    assert not _is_production_eligible(
        used_real_data=True,
        below_minimum=True,
        auc_roc=0.99,
        precision=0.99,
        recall=0.99,
    )
    assert not _is_production_eligible(
        used_real_data=True,
        below_minimum=False,
        auc_roc=0.74,
        precision=0.70,
        recall=0.65,
    )


def test_real_training_uses_abandoned_carts_as_the_canonical_label_source():
    queries = []
    result_sets = iter(
        [
            [("session-1", "ABANDONED")],
            [
                (
                    "session-1",
                    "page_view",
                    "2026-09-01T10:00:00Z",
                    {},
                )
            ],
        ]
    )

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, query, parameters=None):
            queries.append((query, parameters))

        def fetchall(self):
            return next(result_sets)

    class Connection:
        def cursor(self):
            return Cursor()

    frame = _load_real_session_rows(Connection())

    assert "FROM abandoned_carts" in queries[0][0]
    assert "FROM checkout" not in queries[0][0]
    assert frame.loc[0, "abandoned"] == 1


def test_train_returns_run_evidence_after_model_fitting():
    run = MagicMock()
    run.info.run_id = "run-1"
    run.info.experiment_id = "experiment-1"
    run_context = MagicMock()
    run_context.__enter__.return_value = run

    with (
        patch.object(abandonment_train, "get_or_create_experiment"),
        patch.object(abandonment_train.mlflow, "set_experiment"),
        patch.object(abandonment_train.mlflow, "start_run", return_value=run_context),
        patch.object(abandonment_train, "_log_training_metrics"),
        patch.object(abandonment_train, "get_run_url", return_value="safe-run-url"),
    ):
        result = abandonment_train.train("unit-test-run")

    assert result["run_id"] == "run-1"
    assert result["run_url"] == "safe-run-url"
    assert result["used_real_data"] is False
    assert result["production_eligible"] is False
