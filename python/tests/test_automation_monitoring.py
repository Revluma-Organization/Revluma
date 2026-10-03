import pandas as pd

from src.monitoring import drift_detector


class _EarlyWarningModel:
    def predict(self, frame):
        return (frame["engagement_decay_score"] >= 35).astype(int).to_numpy()


def test_early_warning_monitor_uses_observed_healthy_cohort(monkeypatch):
    frame = pd.DataFrame(
        {
            "churn_tier": ["HEALTHY"] * 100 + ["AT_RISK"],
            "early_warning": [0] * 50 + [1] * 50 + [0],
            "engagement_decay_score": [10.0] * 50 + [60.0] * 50 + [70.0],
        }
    )
    monkeypatch.setattr(drift_detector, "_load_registered_model", lambda name: _EarlyWarningModel())
    monkeypatch.setattr(drift_detector, "_load_recent_m4_eval_set", lambda connection: frame)
    monkeypatch.setattr(drift_detector, "_log_result_to_mlflow", lambda result: None)

    result = drift_detector.check_m4_early_warning_drift(object())

    assert result.metric_value == 1.0
    assert result.sample_size == 100
    assert result.breached is False
