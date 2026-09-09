"""
Model Monitoring and Drift Detection Service.

Monitors live model performance against recent database observations and
triggers Slack alerts or automatic retraining when thresholds are breached.
"""

from __future__ import annotations

import os
import sys
import typing
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

import pandas as pd

try:
    import mlflow
    import mlflow.sklearn
except ImportError:  # pragma: no cover
    mlflow = None

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))
from src.config.mlflow_config import get_or_create_experiment  # noqa: E402
from src.features.pipeline import (  # noqa: E402
    calculate_scroll_depth,
    calculate_tab_switch_count,
    calculate_time_on_page_ms,
    calculate_checkout_step_reached,
    calculate_failed_payment_attempt,
    calculate_cursor_hesitation,
    calculate_cart_item_remove_count,
    calculate_cart_item_add_count,
)
from src.features.event_processor import group_events_by_session  # noqa: E402

MONITORING_EXPERIMENT_NAME = "Revluma-Monitoring"

# Monitoring thresholds.
M1_AUC_ROC_FLOOR = 0.70
M2_CLASS_F1_FLOOR = 0.63
M4_ACCURACY_FLOOR = 0.70
M3_POLICY_CTR_IMPROVEMENT_FLOOR = 0.05
M5_DISCOUNT_RMSE_CEILING = 5.0
M1_RETRAIN_MIN_SAMPLES = 1000
M2_RETRAIN_MIN_SAMPLES = 500
M3_RETRAIN_MIN_SAMPLES = 500
M5_RETRAIN_MIN_SAMPLES = 200

# Trailing windows used to pull fresh labeled data for each check.
M1_WINDOW_DAYS = 7
M2_WINDOW_DAYS = 7
M4_WINDOW_DAYS = 30


# ---------------------------------------------------------------------------
# Shared result type
# ---------------------------------------------------------------------------

@dataclass
class DriftCheckResult:
    model_name: str
    check_type: str          # "weekly" | "monthly"
    metric_name: str
    metric_value: Optional[float]
    threshold: float
    breached: bool
    sample_size: int
    retraining_triggered: bool = False
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Slack alerting
# ---------------------------------------------------------------------------

def _send_slack_alert(message: str) -> bool:
    """Posts `message` to the engineering Slack channel via an incoming
    webhook. Returns False (never raises) on any failure — an alerting
    failure must not crash the monitoring job. SLACK_WEBHOOK_URL is read
    from the environment only, per the repo's credential-handling
    standard (never hardcoded, never committed)."""
    webhook_url = os.environ.get("SLACK_WEBHOOK_URL")
    if not webhook_url:
        print(f"[drift_detector] SLACK_WEBHOOK_URL not set — alert not sent: {message}")
        return False
    if requests is None:
        print(f"[drift_detector] `requests` not installed — alert not sent: {message}")
        return False

    try:
        response = requests.post(webhook_url, json={"text": message}, timeout=5.0)
        return response.status_code == 200
    except Exception as e:
        print(f"[drift_detector] Slack alert failed (non-fatal): {e}")
        return False


def _format_alert(result: DriftCheckResult) -> str:
    """Formats an alert dict into a readable string."""
    header = ":rotating_light: *Revluma Model Drift Alert*"
    lines = [
        header,
        f"*Model:* {result.model_name}  ({result.check_type} check)",
        f"*Metric:* {result.metric_name} = "
        f"{result.metric_value:.4f}" if result.metric_value is not None else "N/A",
        f"*Threshold:* {result.threshold:.2f}",
        f"*Sample size:* {result.sample_size}",
    ]
    if result.retraining_triggered:
        lines.append(":arrows_counterclockwise: Automatic retraining has been triggered.")
    if result.error:
        lines.append(f"*Error:* {result.error}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# MLflow logging
# ---------------------------------------------------------------------------

def _get_or_create_monitoring_experiment() -> None:
    """Keep monitoring runs separate from the Revluma-MVP training history."""
    if mlflow is None:
        return
    get_or_create_experiment()  # ensures tracking URI / auth are configured
    experiment = mlflow.get_experiment_by_name(MONITORING_EXPERIMENT_NAME)
    if experiment is None:
        mlflow.create_experiment(MONITORING_EXPERIMENT_NAME)
    mlflow.set_experiment(MONITORING_EXPERIMENT_NAME)


def _log_result_to_mlflow(result: DriftCheckResult) -> None:
    """Logs drift results to MLflow."""
    if mlflow is None:
        return
    try:
        _get_or_create_monitoring_experiment()
        with mlflow.start_run(run_name=f"drift-{result.model_name}-{result.check_type}"):
            mlflow.set_tag("model", result.model_name)
            mlflow.set_tag("check_type", result.check_type)
            mlflow.set_tag("breached", str(result.breached))
            mlflow.set_tag("retraining_triggered", str(result.retraining_triggered))
            mlflow.log_param("metric_name", result.metric_name)
            mlflow.log_param("threshold", result.threshold)
            mlflow.log_param("sample_size", result.sample_size)
            if result.metric_value is not None:
                mlflow.log_metric(result.metric_name, result.metric_value)
            if result.error:
                mlflow.set_tag("error", result.error[:250])
    except Exception as e:  # pragma: no cover
        print(f"[drift_detector] MLflow logging failed (non-fatal): {e}")


def _load_registered_model(model_name: str) -> typing.Any:
    """Loads a model from the MLflow registry the same way api.py does.
    Returns None on any failure so callers can skip the check gracefully
    rather than crash the whole monitoring run."""
    if mlflow is None:
        return None
    try:
        return mlflow.sklearn.load_model(f"models:/{model_name}/Production")
    except Exception as e:
        print(f"[drift_detector] Could not load model '{model_name}': {e}")
        return None


# ---------------------------------------------------------------------------
# M1 — Abandonment AUC-ROC (weekly, retrain on breach)
# ---------------------------------------------------------------------------

def _load_recent_m1_eval_set(db_connection, days: int = M1_WINDOW_DAYS) -> pd.DataFrame | None:
    """Build a recent observed M1 evaluation set with the training contract."""
    with db_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                session_id,
                CASE
                    WHEN recovered_at IS NOT NULL
                      OR UPPER(COALESCE(status, '')) = 'RECOVERED'
                    THEN 'RECOVERED'
                    ELSE 'ABANDONED'
                END AS outcome
            FROM abandoned_carts
            WHERE session_id IS NOT NULL
              AND (
                  recovered_at IS NOT NULL
                  OR UPPER(COALESCE(status, '')) IN ('ABANDONED', 'RECOVERED')
              )
              AND updated_at >= NOW() - (%s * INTERVAL '1 day')
            """,
            (days,)
        )
        session_rows = cursor.fetchall()

    if not session_rows:
        return None

    session_ids = [r[0] for r in session_rows]
    labels = {r[0]: (1 if r[1] == "ABANDONED" else 0) for r in session_rows}

    with db_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT session_id, event_type, created_at as timestamp, payload
            FROM events
            WHERE session_id = ANY(%s)
            """,
            (session_ids,)
        )
        event_rows = cursor.fetchall()

    raw_events = [
        {
            "session_id": row[0], "event_type": row[1],
            "timestamp": row[2].isoformat() if hasattr(row[2], "isoformat") else row[2],
            "payload": row[3] if isinstance(row[3], dict) else {},
        }
        for row in event_rows
    ]
    events_by_session = group_events_by_session(raw_events)

    records = []
    for session_id in session_ids:
        events = events_by_session.get(session_id, [])
        records.append({
            "scroll_depth_pct": calculate_scroll_depth(events),
            "tab_switch_count": calculate_tab_switch_count(events),
            "time_on_page_ms": calculate_time_on_page_ms(events),
            "cursor_hesitation": calculate_cursor_hesitation(events),
            "checkout_step_reached": calculate_checkout_step_reached(events),
            "failed_payment_attempt": int(calculate_failed_payment_attempt(events)),
            "cart_item_add_count": calculate_cart_item_add_count(events),
            "cart_item_remove_count": calculate_cart_item_remove_count(events),
            "abandoned": labels[session_id],
        })
    return pd.DataFrame.from_records(records)


def check_m1_drift(db_connection, auto_retrain: bool = True) -> DriftCheckResult:
    """Weekly M1 AUC-ROC check. Below M1_AUC_ROC_FLOOR (0.70) triggers
    automatic retraining via abandonment.train.train()."""
    result = DriftCheckResult(
        model_name="abandonment", check_type="weekly", metric_name="auc_roc",
        metric_value=None, threshold=M1_AUC_ROC_FLOOR, breached=False, sample_size=0,
    )
    try:
        model = _load_registered_model("abandonment")
        if model is None:
            result.error = "model not found in registry"
            return result

        eval_df = _load_recent_m1_eval_set(db_connection)
        if eval_df is None or eval_df["abandoned"].nunique() < 2:
            result.error = "insufficient labeled data in trailing window"
            return result

        from sklearn.metrics import roc_auc_score
        from src.models.abandonment.train import FEATURE_COLUMNS
        feature_cols = FEATURE_COLUMNS
        X = eval_df[feature_cols]
        y = eval_df["abandoned"]
        y_prob = model.predict_proba(X)[:, 1]

        auc = float(roc_auc_score(y, y_prob))
        result.metric_value = auc
        result.sample_size = len(eval_df)
        result.breached = auc < M1_AUC_ROC_FLOOR

        if result.breached and auto_retrain and result.sample_size >= M1_RETRAIN_MIN_SAMPLES:
            result.retraining_triggered = _trigger_m1_retraining(db_connection)

    except Exception as e:
        result.error = str(e)

    _log_result_to_mlflow(result)
    if result.breached:
        _send_slack_alert(_format_alert(result))
    return result


def _trigger_m1_retraining(db_connection) -> bool:
    """Kicks off an M1 retraining run in-process. Returns True if the
    retraining run completed without raising; a retraining failure is
    reported but never propagated — the drift check itself must still
    complete and alert."""
    try:
        from src.models.abandonment.train import train as train_m1
        print("[drift_detector] M1 AUC-ROC below floor — triggering retraining.")
        train_m1(run_name="m1-auto-retrain-drift", db_connection=db_connection)
        return True
    except Exception as e:
        print(f"[drift_detector] M1 auto-retraining failed: {e}")
        return False


# ---------------------------------------------------------------------------
# M2 — Sensitivity per-class F1 (weekly)
# ---------------------------------------------------------------------------

def _load_recent_m2_eval_set(db_connection, days: int = M2_WINDOW_DAYS) -> pd.DataFrame | None:
    """Load recent immutable M2 snapshots with finalized observed labels."""
    from src.models.sensitivity.predict import FEATURE_COLUMNS

    with db_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT feature_snapshot, pss_label, css_label, tss_label
            FROM sensitivity_training_observations
            WHERE finalized_at IS NOT NULL
              AND finalized_at >= NOW() - (%s * INTERVAL '1 day')
              AND pss_label IS NOT NULL
              AND css_label IS NOT NULL
              AND tss_label IS NOT NULL
            ORDER BY decision_at
            """,
            (days,),
        )
        rows = cursor.fetchall()

    records = []
    for raw_snapshot, pss_label, css_label, tss_label in rows:
        try:
            snapshot = (
                json.loads(raw_snapshot)
                if isinstance(raw_snapshot, str)
                else raw_snapshot
            )
            if not isinstance(snapshot, dict):
                continue
            if any(name not in snapshot for name in FEATURE_COLUMNS):
                continue
            record = {name: float(snapshot[name]) for name in FEATURE_COLUMNS}
            record.update({
                "PSS_label": int(bool(pss_label)),
                "CSS_label": int(bool(css_label)),
                "TSS_label": int(bool(tss_label)),
            })
            records.append(record)
        except (TypeError, ValueError, json.JSONDecodeError):
            continue

    if not records:
        return None
    return pd.DataFrame.from_records(
        records,
        columns=FEATURE_COLUMNS + ["PSS_label", "CSS_label", "TSS_label"],
    )


def check_m2_drift(db_connection) -> list[DriftCheckResult]:
    """Weekly M2 per-class F1 check for PSS, CSS, and TSS models.

    One result is returned for each binary class so a low-performing class
    is visible even when aggregate accuracy appears acceptable.
    """
    results: list[DriftCheckResult] = []
    from src.models.sensitivity.predict import FEATURE_COLUMNS

    try:
        eval_df = _load_recent_m2_eval_set(db_connection)
        pss_model = _load_registered_model("sensitivity_pss")
        css_model = _load_registered_model("sensitivity_css")

        if eval_df is None:
            skipped = DriftCheckResult(
                model_name="sensitivity", check_type="weekly", metric_name="f1",
                metric_value=None, threshold=M2_CLASS_F1_FLOOR, breached=False,
                sample_size=0, error="insufficient labeled data in trailing window",
            )
            _log_result_to_mlflow(skipped)
            return [skipped]

        from sklearn.metrics import f1_score
        X = eval_df[FEATURE_COLUMNS]

        for target_name, model, label_col in (
            ("sensitivity_pss", pss_model, "PSS_label"),
            ("sensitivity_css", css_model, "CSS_label"),
            ("sensitivity_tss", _load_registered_model("sensitivity_tss"), "TSS_label"),
        ):
            if model is None or eval_df[label_col].nunique() < 2:
                results.append(DriftCheckResult(
                    model_name=target_name, check_type="weekly", metric_name="f1_per_class",
                    metric_value=None, threshold=M2_CLASS_F1_FLOOR, breached=False,
                    sample_size=len(eval_df),
                    error="model not found or only one class present in window",
                ))
                continue

            y_true = eval_df[label_col]
            y_pred = model.predict(X)
            per_class_f1 = f1_score(y_true, y_pred, average=None, labels=[0, 1], zero_division=0)

            for class_label, f1 in zip([0, 1], per_class_f1):
                breached = bool(f1 < M2_CLASS_F1_FLOOR)
                result = DriftCheckResult(
                    model_name=f"{target_name}::class_{class_label}", check_type="weekly",
                    metric_name="f1", metric_value=float(f1), threshold=M2_CLASS_F1_FLOOR,
                    breached=breached, sample_size=len(eval_df),
                )
                _log_result_to_mlflow(result)
                if breached:
                    _send_slack_alert(_format_alert(result))
                results.append(result)

    except Exception as e:
        error_result = DriftCheckResult(
            model_name="sensitivity", check_type="weekly", metric_name="f1",
            metric_value=None, threshold=M2_CLASS_F1_FLOOR, breached=False,
            sample_size=0, error=str(e),
        )
        _log_result_to_mlflow(error_result)
        results.append(error_result)

    return results


# ---------------------------------------------------------------------------
# M4 — Churn accuracy (monthly, alert only)
# ---------------------------------------------------------------------------

def _load_recent_m4_eval_set(db_connection, days: int = M4_WINDOW_DAYS) -> pd.DataFrame | None:
    """Load recent immutable snapshots with finalized observed churn tiers."""
    from src.models.churn.train import _load_real_customer_rows

    frame = _load_real_customer_rows(
        db_connection,
        finalized_within_days=days,
    )
    return None if frame.empty else frame


def check_m4_drift(db_connection) -> DriftCheckResult:
    """Monthly M4 overall accuracy check; alert without auto-retraining."""
    result = DriftCheckResult(
        model_name="churn_risk", check_type="monthly", metric_name="accuracy",
        metric_value=None, threshold=M4_ACCURACY_FLOOR, breached=False, sample_size=0,
    )
    try:
        model = _load_registered_model("churn_risk")
        if model is None:
            result.error = "model not found in registry"
            return result

        eval_df = _load_recent_m4_eval_set(db_connection)
        if eval_df is None or len(eval_df) == 0:
            result.error = "insufficient labeled data in trailing window"
            return result

        from sklearn.metrics import accuracy_score
        from src.models.churn.train import FEATURE_COLUMNS
        feature_cols = FEATURE_COLUMNS
        X = eval_df[feature_cols]
        y_true = eval_df["churn_tier"]
        y_pred = model.predict(X)

        acc = float(accuracy_score(y_true, y_pred))
        result.metric_value = acc
        result.sample_size = len(eval_df)
        result.breached = acc < M4_ACCURACY_FLOOR

    except Exception as e:
        result.error = str(e)

    _log_result_to_mlflow(result)
    if result.breached:
        _send_slack_alert(_format_alert(result))
    return result


def _load_aggregate_evaluation_metric(db_connection, model_name: str, metric_name: str, days: int):
    """Load a persisted, tenant-safe monitoring aggregate.

    The backend handoff defines ``model_evaluation_metrics`` as the durable
    source for metrics that cannot be reconstructed faithfully from a single
    model artifact, such as timing lift and discount RMSE.
    """
    with db_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT AVG(metric_value), COUNT(*)
            FROM model_evaluation_metrics
            WHERE model_name = %s AND metric_name = %s
              AND observed_at >= NOW() - INTERVAL '%s days'
            """,
            (model_name, metric_name, days),
        )
        value, sample_size = cursor.fetchone() or (None, 0)
    return (float(value) if value is not None else None), int(sample_size or 0)


def _check_aggregate_metric(db_connection, *, model_name: str, metric_name: str,
                            threshold: float, breach_when_below: bool,
                            minimum_samples: int) -> DriftCheckResult:
    result = DriftCheckResult(
        model_name=model_name, check_type="monthly", metric_name=metric_name,
        metric_value=None, threshold=threshold, breached=False, sample_size=0,
    )
    try:
        value, sample_size = _load_aggregate_evaluation_metric(
            db_connection, model_name, metric_name, 30
        )
        result.metric_value, result.sample_size = value, sample_size
        if value is None or sample_size < minimum_samples:
            result.error = f"insufficient evaluation records (requires {minimum_samples})"
        else:
            result.breached = value < threshold if breach_when_below else value > threshold
    except Exception as exc:
        result.error = str(exc)
    _log_result_to_mlflow(result)
    if result.breached:
        _send_slack_alert(_format_alert(result))
    return result


def check_m3_drift(db_connection) -> DriftCheckResult:
    """Check monthly randomized-control send-time CTR lift."""
    return _check_aggregate_metric(
        db_connection,
        model_name="send_time",
        metric_name="randomized_policy_ctr_improvement",
        threshold=M3_POLICY_CTR_IMPROVEMENT_FLOOR,
        breach_when_below=True,
        minimum_samples=M3_RETRAIN_MIN_SAMPLES,
    )


def check_m5_drift(db_connection) -> DriftCheckResult:
    """Check monthly offer-value discount RMSE against the hard ceiling."""
    return _check_aggregate_metric(
        db_connection, model_name="offer_value", metric_name="discount_rmse",
        threshold=M5_DISCOUNT_RMSE_CEILING, breach_when_below=False,
        minimum_samples=M5_RETRAIN_MIN_SAMPLES,
    )


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def run_weekly_checks(db_connection, auto_retrain: bool = True) -> dict:
    """Runs the two weekly checks (M1 AUC-ROC, M2 per-class F1). Intended
    to be invoked by a weekly cron/scheduler entry."""
    print(f"[drift_detector] Running weekly checks at {datetime.now(timezone.utc).isoformat()}")
    m1_result = check_m1_drift(db_connection, auto_retrain=auto_retrain)
    m2_results = check_m2_drift(db_connection)
    return {"m1": m1_result, "m2": m2_results}


def run_monthly_checks(db_connection) -> dict:
    """Run the monthly M3, M4, and M5 monitoring checks."""
    print(f"[drift_detector] Running monthly checks at {datetime.now(timezone.utc).isoformat()}")
    m4_result = check_m4_drift(db_connection)
    m3_result = check_m3_drift(db_connection)
    m5_result = check_m5_drift(db_connection)
    return {"m3": m3_result, "m4": m4_result, "m5": m5_result}


def run_all_checks(db_connection, auto_retrain: bool = True) -> dict:
    """Convenience entry point that runs both weekly and monthly checks in
    one call — useful for local testing and for a single daily cron job
    that internally decides what's due (see `_is_due` pattern below)."""
    weekly = run_weekly_checks(db_connection, auto_retrain=auto_retrain)
    monthly = run_monthly_checks(db_connection)
    return {**weekly, **monthly}


if __name__ == "__main__":
    import psycopg2

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL environment variable is not set.")
        sys.exit(1)

    conn = psycopg2.connect(database_url)
    try:
        run_all_checks(conn)
    finally:
        conn.close()
