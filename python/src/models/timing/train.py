"""Training pipeline for M3, the optimal send-time model."""

from __future__ import annotations

import logging
from urllib.parse import urlsplit, urlunsplit

import mlflow
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

from src.config.mlflow_config import get_or_create_experiment

logger = logging.getLogger("rev.m3.train")

CHANNEL_MAP = {"email": 0, "sms": 1, "whatsapp": 2}
RECOVERY_ACTION_MAP = {
    "DISCOUNT": 0,
    "FRICTION_FIX": 1,
    "TRUST_REASSURE": 2,
    "HYBRID_BUNDLE": 3,
    "TRUST_PLUS_DEAL": 4,
    "FRICTION_PLUS_TRUST": 5,
    "FULL_PERSONALISE": 6,
    "NUDGE": 7,
    "SOFT_NUDGE": 8,
}
RECOVERY_ACTION_ALIASES = {"HYBRID": "HYBRID_BUNDLE"}
# ``high`` is retained as an input alias for the assigned ``premium`` tier.
CART_VALUE_TIER_MAP = {"low": 0, "medium": 1, "high": 2, "premium": 2}

MIN_REAL_LABELED_EVENTS = 500
DECISION_THRESHOLD = 0.40
MIN_CTR_IMPROVEMENT = 0.08
MAX_CALIBRATION_ERROR = 0.12
SYNTHETIC_GENERATOR_VERSION = "2.0"

FEATURE_COLUMNS = [
    "send_hour",
    "send_day",
    "channel",
    "historical_open_rate",
    "days_since_last_purchase",
    "cart_value_tier",
    "recovery_action",
]


def _generate_synthetic_data(n: int = 2000) -> tuple:
    """Generate deterministic development data with the production feature shape."""
    if n < 1:
        raise ValueError("n must be at least 1")

    rng = np.random.default_rng(42)
    send_hour = rng.integers(0, 24, n)
    send_day = rng.integers(0, 7, n)
    channel = rng.choice([0, 1, 2], size=n, p=[0.5, 0.3, 0.2])
    historical_open_rate = rng.beta(2.5, 3.5, n)
    days_since_last_purchase = rng.integers(0, 181, n)
    cart_value_tier = rng.choice([0, 1, 2], size=n, p=[0.4, 0.4, 0.2])
    recovery_action = rng.integers(0, len(RECOVERY_ACTION_MAP), n)

    peak_hour = ((send_hour >= 9) & (send_hour <= 11)) | (
        (send_hour >= 18) & (send_hour <= 20)
    )
    probability = 0.08 + 0.48 * historical_open_rate
    probability += np.where(peak_hour, 0.18, 0.0)
    probability += np.where((channel > 0) & peak_hour, 0.08, 0.0)
    probability += np.where(send_day >= 5, -0.05, 0.0)
    probability += np.where(days_since_last_purchase <= 30, 0.08, -0.03)
    probability += np.where(cart_value_tier == 2, 0.05, 0.0)
    probability += np.where(
        np.isin(
            recovery_action,
            [RECOVERY_ACTION_MAP["DISCOUNT"], RECOVERY_ACTION_MAP["HYBRID_BUNDLE"]],
        ),
        0.07,
        0.0,
    )
    target = rng.binomial(1, np.clip(probability, 0.01, 0.95))

    features = pd.DataFrame(
        {
            "send_hour": send_hour,
            "send_day": send_day,
            "channel": channel,
            "historical_open_rate": historical_open_rate,
            "days_since_last_purchase": days_since_last_purchase,
            "cart_value_tier": cart_value_tier,
            "recovery_action": recovery_action,
        },
        columns=FEATURE_COLUMNS,
    )
    return train_test_split(
        features,
        target,
        test_size=0.2,
        random_state=42,
        stratify=target,
    )


def _load_real_send_rows(db_connection) -> pd.DataFrame:
    """Load labeled send outcomes without silently falling back to synthetic data."""
    try:
        with db_connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    s.id,
                    s.customer_id,
                    s.channel,
                    s.sent_at,
                    s.metadata,
                    CASE
                        WHEN MAX(CASE WHEN e.event_type = 'opened'
                                      AND e.occurred_at >= s.sent_at
                                      AND e.occurred_at <= s.sent_at + INTERVAL '120 minutes'
                                 THEN 1 ELSE 0 END) = 1
                         AND MAX(CASE WHEN e.event_type = 'clicked'
                                      AND e.occurred_at >= s.sent_at
                                      AND e.occurred_at <= s.sent_at + INTERVAL '120 minutes'
                                 THEN 1 ELSE 0 END) = 1
                        THEN 1 ELSE 0
                    END AS conversion_within_120min
                FROM sequence_sends s
                LEFT JOIN sequence_events e ON e.sequence_send_id = s.id
                WHERE s.sent_at >= NOW() - INTERVAL '180 days'
                GROUP BY s.id, s.customer_id, s.channel, s.sent_at, s.metadata
                ORDER BY s.sent_at ASC, s.id ASC
                """
            )
            rows = cursor.fetchall()
    except Exception as exc:
        raise RuntimeError(
            f"M3 real-data query failed ({type(exc).__name__})."
        ) from exc

    if not rows:
        return pd.DataFrame(columns=FEATURE_COLUMNS + ["conversion_within_120min"])
    return pd.DataFrame.from_records(_build_send_feature_record(row) for row in rows)


def _build_send_feature_record(row: tuple) -> dict:
    """Convert one ordered send record into the exact seven-feature contract."""
    _send_id, _customer_id, channel, sent_at, metadata, label = row
    meta = metadata if isinstance(metadata, dict) else {}
    channel_key = str(channel or "email").lower()
    action_key = str(meta.get("recovery_action", "SOFT_NUDGE")).upper()
    action_key = RECOVERY_ACTION_ALIASES.get(action_key, action_key)
    tier_key = str(meta.get("cart_value_tier", "medium")).lower()

    try:
        historical_open_rate = float(meta.get("historical_open_rate", 0.0))
    except (TypeError, ValueError):
        historical_open_rate = 0.0
    try:
        days_since_last_purchase = int(meta.get("days_since_last_purchase", -1))
    except (TypeError, ValueError):
        days_since_last_purchase = -1

    return {
        "send_hour": int(getattr(sent_at, "hour", 12)),
        "send_day": int(sent_at.weekday() if hasattr(sent_at, "weekday") else 0),
        "channel": CHANNEL_MAP.get(channel_key, CHANNEL_MAP["email"]),
        "historical_open_rate": min(max(historical_open_rate, 0.0), 1.0),
        "days_since_last_purchase": max(days_since_last_purchase, -1),
        "cart_value_tier": CART_VALUE_TIER_MAP.get(
            tier_key,
            CART_VALUE_TIER_MAP["medium"],
        ),
        "recovery_action": RECOVERY_ACTION_MAP.get(
            action_key,
            RECOVERY_ACTION_MAP["SOFT_NUDGE"],
        ),
        "conversion_within_120min": int(bool(label)),
    }


def load_training_data(n: int = 2000, db_connection=None) -> tuple:
    """Load development data or a production-eligible chronological real split."""
    if db_connection is None:
        x_train, x_test, y_train, y_test = _generate_synthetic_data(n=n)
        logger.warning("m3_synthetic_training_data", extra={"row_count": n})
        return x_train, x_test, y_train, y_test, False

    real_data = _load_real_send_rows(db_connection)
    if len(real_data) < MIN_REAL_LABELED_EVENTS:
        raise RuntimeError(
            "M3 requires at least "
            f"{MIN_REAL_LABELED_EVENTS} labeled real send events; found {len(real_data)}."
        )
    if real_data["conversion_within_120min"].nunique() < 2:
        raise RuntimeError("M3 real training data must contain both outcome classes.")

    split_index = int(len(real_data) * 0.85)
    x = real_data[FEATURE_COLUMNS]
    y = real_data["conversion_within_120min"]
    if y.iloc[:split_index].nunique() < 2 or y.iloc[split_index:].nunique() < 2:
        raise RuntimeError(
            "M3 chronological train and test splits must each contain both outcome classes."
        )
    return (
        x.iloc[:split_index],
        x.iloc[split_index:],
        y.iloc[:split_index],
        y.iloc[split_index:],
        True,
    )


def build_model() -> CalibratedClassifierCV:
    """Build the calibrated gradient-boosting classifier required by D4."""
    base_model = GradientBoostingClassifier(
        n_estimators=200,
        learning_rate=0.05,
        max_depth=2,
        min_samples_leaf=20,
        subsample=0.85,
        random_state=42,
    )
    return CalibratedClassifierCV(base_model, method="sigmoid", cv=5)


def _expected_calibration_error(y_true, y_probability, n_bins: int = 10) -> float:
    """Return weighted absolute calibration error across fixed probability bins."""
    observed = np.asarray(y_true, dtype=float)
    predicted = np.asarray(y_probability, dtype=float)
    if observed.size == 0:
        return 0.0
    boundaries = np.linspace(0.0, 1.0, n_bins + 1)
    bin_ids = np.minimum(np.digitize(predicted, boundaries[1:-1]), n_bins - 1)
    error = 0.0
    for bin_id in range(n_bins):
        mask = bin_ids == bin_id
        if mask.any():
            error += float(mask.mean()) * abs(
                float(observed[mask].mean()) - float(predicted[mask].mean())
            )
    return round(error, 10)


def _safe_run_url(run) -> str | None:
    """Build a credential-free MLflow run URL when the tracking URI is HTTP(S)."""
    parsed = urlsplit(mlflow.get_tracking_uri())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    host = parsed.hostname
    if parsed.port:
        host = f"{host}:{parsed.port}"
    base = urlunsplit((parsed.scheme, host, parsed.path.rstrip("/"), "", ""))
    return f"{base}/#/experiments/{run.info.experiment_id}/runs/{run.info.run_id}"


def _is_production_eligible(
    *,
    used_real_data: bool,
    ctr_improvement: float,
    calibration_error: float,
) -> bool:
    """Require real data and both assigned M3 quality gates for registration."""
    return (
        used_real_data
        and ctr_improvement >= MIN_CTR_IMPROVEMENT
        and calibration_error <= MAX_CALIBRATION_ERROR
    )


def train(run_name: str = "m3-timing-training", db_connection=None) -> dict:
    """Train, evaluate, gate, and log M3 to MLflow/DagsHub."""
    get_or_create_experiment()
    x_train, x_test, y_train, y_test, used_real_data = load_training_data(
        n=5000,
        db_connection=db_connection,
    )
    model = build_model()

    if np.unique(y_train).size < 2:
        raise RuntimeError("M3 training split must contain both outcome classes.")

    with mlflow.start_run(run_name=run_name) as run:
        mlflow.set_tags(
            {
                "model": "timing",
                "data_source": "real" if used_real_data else "synthetic",
            }
        )
        if not used_real_data:
            mlflow.set_tag("synthetic_generator_version", SYNTHETIC_GENERATOR_VERSION)
            mlflow.set_tag("synthetic_only_not_for_registration", "true")
        model.fit(x_train, y_train)
        probabilities = model.predict_proba(x_test)[:, 1]
        predictions = (probabilities >= DECISION_THRESHOLD).astype(int)

        selected = predictions == 1
        baseline_ctr = float(np.mean(y_test))
        selected_ctr = (
            float(np.mean(np.asarray(y_test)[selected])) if selected.any() else 0.0
        )
        ctr_improvement = selected_ctr - baseline_ctr
        calibration_error = _expected_calibration_error(y_test, probabilities)
        metrics = {
            "accuracy": accuracy_score(y_test, predictions),
            "precision": precision_score(y_test, predictions, zero_division=0),
            "recall": recall_score(y_test, predictions, zero_division=0),
            "f1_score": f1_score(y_test, predictions, zero_division=0),
            "auc_roc": roc_auc_score(y_test, probabilities),
            "global_baseline_ctr": baseline_ctr,
            "model_selected_ctr": selected_ctr,
            "ctr_improvement": ctr_improvement,
            "calibration_error": calibration_error,
        }
        mlflow.log_params(
            {
                "feature_columns": ",".join(FEATURE_COLUMNS),
                "n_training_samples": len(x_train),
                "min_real_labeled_events": MIN_REAL_LABELED_EVENTS,
                "decision_threshold": DECISION_THRESHOLD,
                "n_estimators": 200,
                "learning_rate": 0.05,
                "max_depth": 2,
                "min_samples_leaf": 20,
                "subsample": 0.85,
                "calibration_method": "sigmoid",
                "calibration_cv_folds": 5,
                "min_ctr_improvement": MIN_CTR_IMPROVEMENT,
                "max_calibration_error": MAX_CALIBRATION_ERROR,
            }
        )
        mlflow.log_metrics(metrics)
        mlflow.log_metric("label_positive_rate", float(np.mean(y_train)))

        gates_passed = (
            ctr_improvement >= MIN_CTR_IMPROVEMENT
            and calibration_error <= MAX_CALIBRATION_ERROR
        )
        production_eligible = _is_production_eligible(
            used_real_data=used_real_data,
            ctr_improvement=ctr_improvement,
            calibration_error=calibration_error,
        )
        mlflow.set_tag("quality_gates_passed", str(gates_passed).lower())
        mlflow.set_tag("production_eligible", str(production_eligible).lower())
        registration = (
            {"registered_model_name": "send_time"}
            if production_eligible
            else {}
        )
        mlflow.sklearn.log_model(
            model,
            "m3_timing_model",
            **registration,
        )
        if not gates_passed:
            logger.warning(
                "m3_quality_gate_failed",
                extra={
                    "ctr_improvement": ctr_improvement,
                    "calibration_error": calibration_error,
                },
            )

        result = {
            "model": model,
            "used_real_data": used_real_data,
            "production_eligible": production_eligible,
            "quality_gates_passed": gates_passed,
            "metrics": metrics,
            "run_id": run.info.run_id,
            "run_url": _safe_run_url(run),
        }
        logger.info(
            "m3_training_complete",
            extra={
                "run_id": run.info.run_id,
                "used_real_data": used_real_data,
                "quality_gates_passed": gates_passed,
            },
        )
        return result


if __name__ == "__main__":
    train()
