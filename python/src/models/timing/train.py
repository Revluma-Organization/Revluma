"""Training pipeline for M3, the optimal send-time model."""

from __future__ import annotations

import json
import logging

import mlflow
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    f1_score,
    log_loss,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import TimeSeriesSplit, train_test_split

from src.config.mlflow_config import get_or_create_experiment, get_run_url

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
# ``high`` is retained as an input alias for the canonical ``premium`` tier.
CART_VALUE_TIER_MAP = {"low": 0, "medium": 1, "high": 2, "premium": 2}

MIN_REAL_LABELED_EVENTS = 500
MIN_POLICY_EVALUATION_EVENTS = 500
EVALUATION_THRESHOLD = 0.40
MIN_SCORE_SELECTION_LIFT = 0.08
MIN_POLICY_CTR_IMPROVEMENT = 0.08
MAX_CALIBRATION_ERROR = 0.12
SYNTHETIC_GENERATOR_VERSION = "2.0"
TARGET_COLUMN = "engaged_within_120min"
BOOTSTRAP_RESAMPLES = 500

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
                    END AS engaged_within_120min
                FROM sequence_sends s
                LEFT JOIN sequence_events e ON e.sequence_send_id = s.id
                WHERE s.sent_at >= NOW() - INTERVAL '180 days'
                  AND s.sent_at <= NOW() - INTERVAL '120 minutes'
                  AND s.status IN ('sent', 'delivered')
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
        return pd.DataFrame(columns=FEATURE_COLUMNS + [TARGET_COLUMN])

    records = []
    rejected = 0
    for row in rows:
        try:
            records.append(_build_send_feature_record(row, strict=True))
        except (TypeError, ValueError):
            rejected += 1
    if rejected:
        logger.warning(
            "m3_incomplete_real_feature_snapshots",
            extra={"rejected_row_count": rejected, "queried_row_count": len(rows)},
        )
    return pd.DataFrame.from_records(
        records,
        columns=FEATURE_COLUMNS + [TARGET_COLUMN],
    )


def _build_send_feature_record(row: tuple, *, strict: bool = False) -> dict:
    """Convert one ordered send record into the exact seven-feature contract."""
    _send_id, _customer_id, channel, sent_at, metadata, label = row
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except json.JSONDecodeError:
            metadata = None
    meta = metadata if isinstance(metadata, dict) else {}
    required_metadata = {
        "recovery_action",
        "cart_value_tier",
        "historical_open_rate",
        "days_since_last_purchase",
    }
    if strict:
        missing = sorted(required_metadata.difference(meta))
        if missing:
            raise ValueError(f"Missing immutable M3 metadata: {', '.join(missing)}")
        if not hasattr(sent_at, "hour") or not hasattr(sent_at, "weekday"):
            raise TypeError("sent_at must be a timestamp")

    channel_key = str(channel or "email").lower()
    action_key = str(meta.get("recovery_action", "SOFT_NUDGE")).upper()
    action_key = RECOVERY_ACTION_ALIASES.get(action_key, action_key)
    tier_key = str(meta.get("cart_value_tier", "medium")).lower()

    if strict and channel_key not in CHANNEL_MAP:
        raise ValueError(f"Unsupported channel: {channel_key}")
    if strict and action_key not in RECOVERY_ACTION_MAP:
        raise ValueError(f"Unsupported recovery action: {action_key}")
    if strict and tier_key not in CART_VALUE_TIER_MAP:
        raise ValueError(f"Unsupported cart value tier: {tier_key}")

    try:
        historical_open_rate = float(meta.get("historical_open_rate", 0.0))
    except (TypeError, ValueError):
        historical_open_rate = 0.0
    try:
        days_since_last_purchase = int(meta.get("days_since_last_purchase", -1))
    except (TypeError, ValueError):
        days_since_last_purchase = -1
    if strict and not 0.0 <= historical_open_rate <= 1.0:
        raise ValueError("historical_open_rate must be between 0 and 1")
    if strict and days_since_last_purchase < -1:
        raise ValueError("days_since_last_purchase must be -1 or greater")

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
        TARGET_COLUMN: int(bool(label)),
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
    if real_data[TARGET_COLUMN].nunique() < 2:
        raise RuntimeError("M3 real training data must contain both outcome classes.")

    split_index = int(len(real_data) * 0.85)
    x = real_data[FEATURE_COLUMNS]
    y = real_data[TARGET_COLUMN]
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


def _temporal_calibration_splits(labels: pd.Series) -> list[tuple[np.ndarray, np.ndarray]]:
    """Return the largest valid expanding-window calibration split."""
    observed = np.asarray(labels)
    for n_splits in range(5, 1, -1):
        splits = list(TimeSeriesSplit(n_splits=n_splits).split(observed))
        if all(
            np.unique(observed[train_index]).size == 2
            and np.unique(observed[test_index]).size == 2
            for train_index, test_index in splits
        ):
            return splits
    raise RuntimeError(
        "M3 real training data cannot form a temporal calibration split with "
        "both outcome classes in every fold."
    )


def build_model(*, calibration_cv=5) -> CalibratedClassifierCV:
    """Build the calibrated gradient-boosting send-time classifier."""
    base_model = GradientBoostingClassifier(
        n_estimators=200,
        learning_rate=0.05,
        max_depth=2,
        min_samples_leaf=20,
        subsample=0.85,
        random_state=42,
    )
    return CalibratedClassifierCV(base_model, method="sigmoid", cv=calibration_cv)


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


def _evaluate_probabilities(y_true, probabilities) -> tuple[dict, np.ndarray]:
    """Evaluate ranking, probability quality, and threshold diagnostics."""
    observed = np.asarray(y_true, dtype=int)
    predicted_probability = np.asarray(probabilities, dtype=float)
    predictions = (predicted_probability >= EVALUATION_THRESHOLD).astype(int)
    selected = predictions == 1
    baseline_rate = float(observed.mean())
    selected_rate = float(observed[selected].mean()) if selected.any() else 0.0
    null_probability = np.full(
        observed.shape,
        np.clip(baseline_rate, np.finfo(float).eps, 1 - np.finfo(float).eps),
    )
    model_brier = float(brier_score_loss(observed, predicted_probability))
    null_brier = float(brier_score_loss(observed, null_probability))
    model_log_loss = float(log_loss(observed, predicted_probability, labels=[0, 1]))
    null_log_loss = float(log_loss(observed, null_probability, labels=[0, 1]))

    metrics = {
        "accuracy": float(accuracy_score(observed, predictions)),
        "precision": float(precision_score(observed, predictions, zero_division=0)),
        "recall": float(recall_score(observed, predictions, zero_division=0)),
        "f1_score": float(f1_score(observed, predictions, zero_division=0)),
        "auc_roc": float(roc_auc_score(observed, predicted_probability)),
        "average_precision": float(
            average_precision_score(observed, predicted_probability)
        ),
        "label_positive_rate": baseline_rate,
        "score_selected_engagement_rate": selected_rate,
        "score_selection_lift": selected_rate - baseline_rate,
        "selection_rate": float(selected.mean()),
        "brier_score": model_brier,
        "null_brier_score": null_brier,
        "brier_improvement": null_brier - model_brier,
        "log_loss": model_log_loss,
        "null_log_loss": null_log_loss,
        "log_loss_improvement": null_log_loss - model_log_loss,
        "calibration_error": _expected_calibration_error(
            observed,
            predicted_probability,
        ),
    }
    metrics["average_precision_lift"] = (
        metrics["average_precision"] - baseline_rate
    )
    # Compatibility aliases keep existing dashboards readable. They describe
    # score-selected enrichment, not randomized or causal policy lift.
    metrics["global_baseline_ctr"] = baseline_rate
    metrics["model_selected_ctr"] = selected_rate
    metrics["ctr_improvement"] = metrics["score_selection_lift"]
    return metrics, selected


def _bootstrap_probability_intervals(
    y_true,
    probabilities,
    *,
    n_resamples: int = BOOTSTRAP_RESAMPLES,
) -> dict:
    """Return deterministic paired 95% bootstrap intervals for key metrics."""
    observed = np.asarray(y_true, dtype=int)
    predicted_probability = np.asarray(probabilities, dtype=float)
    rng = np.random.default_rng(42)
    values = {
        "auc_roc": [],
        "average_precision_lift": [],
        "brier_improvement": [],
        "log_loss_improvement": [],
        "score_selection_lift": [],
    }
    for _ in range(n_resamples):
        indices = rng.integers(0, observed.size, observed.size)
        sample_y = observed[indices]
        if np.unique(sample_y).size < 2:
            continue
        sample_probability = predicted_probability[indices]
        sample_metrics, _ = _evaluate_probabilities(sample_y, sample_probability)
        for metric_name in values:
            values[metric_name].append(sample_metrics[metric_name])

    if not values["auc_roc"]:
        raise RuntimeError("M3 bootstrap evaluation produced no two-class samples.")

    intervals = {}
    for metric_name, samples in values.items():
        lower, upper = np.percentile(samples, [2.5, 97.5])
        intervals[f"{metric_name}_ci_lower"] = float(lower)
        intervals[f"{metric_name}_ci_upper"] = float(upper)
    return intervals


def _probability_quality_passed(metrics: dict) -> bool:
    """Require statistically supported improvement over a constant predictor."""
    return (
        metrics["auc_roc_ci_lower"] > 0.5
        and metrics["average_precision_lift_ci_lower"] > 0.0
        and metrics["brier_improvement_ci_lower"] > 0.0
        and metrics["log_loss_improvement_ci_lower"] > 0.0
    )


def _load_verified_policy_ctr_improvement(db_connection) -> tuple[float | None, int]:
    """Load recent weighted lift from randomized-control policy evaluations."""
    try:
        with db_connection.cursor() as cursor:
            cursor.execute("SELECT to_regclass('model_evaluation_metrics')")
            relation = cursor.fetchone()
            if not relation or relation[0] is None:
                return None, 0
            cursor.execute(
                """
                WITH latest_evaluations AS (
                    SELECT DISTINCT ON (organization_id)
                        organization_id,
                        metric_value,
                        sample_size
                    FROM model_evaluation_metrics
                    WHERE model_name = 'send_time'
                      AND metric_name = 'randomized_policy_ctr_improvement'
                      AND observed_at >= NOW() - INTERVAL '30 days'
                      AND metadata->>'evaluation_design' = 'randomized_control'
                    ORDER BY organization_id, observed_at DESC
                )
                SELECT
                    SUM(metric_value * sample_size) / NULLIF(SUM(sample_size), 0),
                    SUM(sample_size)
                FROM latest_evaluations
                """
            )
            row = cursor.fetchone()
    except Exception as exc:
        raise RuntimeError(
            f"M3 policy-evaluation query failed ({type(exc).__name__})."
        ) from exc

    if not row or row[0] is None:
        return None, 0
    return float(row[0]), int(row[1] or 0)


def _is_production_eligible(
    *,
    used_real_data: bool,
    score_selection_lift: float,
    calibration_error: float,
    probability_quality_passed: bool,
    verified_policy_ctr_improvement: float | None,
    policy_evaluation_events: int,
) -> bool:
    """Require real evidence, predictive quality, and controlled policy lift."""
    return (
        used_real_data
        and score_selection_lift >= MIN_SCORE_SELECTION_LIFT
        and calibration_error <= MAX_CALIBRATION_ERROR
        and probability_quality_passed
        and verified_policy_ctr_improvement is not None
        and verified_policy_ctr_improvement >= MIN_POLICY_CTR_IMPROVEMENT
        and policy_evaluation_events >= MIN_POLICY_EVALUATION_EVENTS
    )


def train(run_name: str = "m3-timing-training", db_connection=None) -> dict:
    """Train, evaluate, gate, and log M3 to MLflow/DagsHub."""
    get_or_create_experiment()
    x_train, x_test, y_train, y_test, used_real_data = load_training_data(
        n=5000,
        db_connection=db_connection,
    )
    calibration_cv = _temporal_calibration_splits(y_train) if used_real_data else 5
    model = build_model(calibration_cv=calibration_cv)

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
        metrics, _ = _evaluate_probabilities(y_test, probabilities)
        metrics.update(_bootstrap_probability_intervals(y_test, probabilities))
        probability_quality_passed = _probability_quality_passed(metrics)
        verified_policy_ctr_improvement, policy_evaluation_events = (
            _load_verified_policy_ctr_improvement(db_connection)
            if used_real_data
            else (None, 0)
        )
        if verified_policy_ctr_improvement is not None:
            metrics["verified_policy_ctr_improvement"] = (
                verified_policy_ctr_improvement
            )
        mlflow.log_params(
            {
                "feature_columns": ",".join(FEATURE_COLUMNS),
                "n_training_samples": len(x_train),
                "min_real_labeled_events": MIN_REAL_LABELED_EVENTS,
                "evaluation_threshold": EVALUATION_THRESHOLD,
                "n_estimators": 200,
                "learning_rate": 0.05,
                "max_depth": 2,
                "min_samples_leaf": 20,
                "subsample": 0.85,
                "calibration_method": "sigmoid",
                "calibration_cv_folds": 5,
                "min_score_selection_lift": MIN_SCORE_SELECTION_LIFT,
                "min_policy_ctr_improvement": MIN_POLICY_CTR_IMPROVEMENT,
                "min_policy_evaluation_events": MIN_POLICY_EVALUATION_EVENTS,
                "max_calibration_error": MAX_CALIBRATION_ERROR,
            }
        )
        mlflow.log_metrics(metrics)
        mlflow.log_metric("training_label_positive_rate", float(np.mean(y_train)))

        gates_passed = (
            metrics["score_selection_lift"] >= MIN_SCORE_SELECTION_LIFT
            and metrics["score_selection_lift_ci_lower"] > 0.0
            and metrics["calibration_error"] <= MAX_CALIBRATION_ERROR
            and probability_quality_passed
        )
        production_eligible = _is_production_eligible(
            used_real_data=used_real_data,
            score_selection_lift=metrics["score_selection_lift"],
            calibration_error=metrics["calibration_error"],
            probability_quality_passed=probability_quality_passed,
            verified_policy_ctr_improvement=verified_policy_ctr_improvement,
            policy_evaluation_events=policy_evaluation_events,
        )
        mlflow.set_tag("quality_gates_passed", str(gates_passed).lower())
        mlflow.set_tag(
            "probability_quality_passed",
            str(probability_quality_passed).lower(),
        )
        mlflow.set_tag("score_selection_lift_is_causal", "false")
        mlflow.set_tag(
            "controlled_policy_evaluation_available",
            str(verified_policy_ctr_improvement is not None).lower(),
        )
        mlflow.set_tag("policy_evaluation_events", str(policy_evaluation_events))
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
                    "score_selection_lift": metrics["score_selection_lift"],
                    "calibration_error": metrics["calibration_error"],
                    "probability_quality_passed": probability_quality_passed,
                },
            )

        result = {
            "model": model,
            "used_real_data": used_real_data,
            "production_eligible": production_eligible,
            "quality_gates_passed": gates_passed,
            "metrics": metrics,
            "run_id": run.info.run_id,
            "run_url": get_run_url(run.info.run_id, run.info.experiment_id),
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
