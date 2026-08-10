"""
Model Monitoring and Drift Detection Service.

Monitors live model performance against recent database observations and
triggers Slack alerts or automatic retraining when thresholds are breached.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

import numpy as np
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
    calculate_coupon_usage_pct,
    calculate_cursor_hesitation,
    calculate_abandoned_at_shipping_reveal,
    calculate_visited_coupon_page,
    calculate_searched_discount_terms,
    calculate_past_orders_total,
    calculate_days_since_last_purchase,
    calculate_avg_order_value,
    calculate_purchase_frequency_trend,
    calculate_rfm_scores,
)
from src.features.event_processor import group_events_by_session  # noqa: E402

MONITORING_EXPERIMENT_NAME = "Revluma-Monitoring"

# Thresholds — exact values from the Phase 3 task.
M1_AUC_ROC_FLOOR = 0.65
M2_CLASS_F1_FLOOR = 0.60
M4_ACCURACY_FLOOR = 0.70

# Trailing windows used to pull "fresh" labelled data for each check.
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
    """Ensures runs from this module land in Revluma-Monitoring, not the
    Revluma-MVP training experiment — the Phase 3 task explicitly requires
    a separate experiment for monitoring runs."""
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
        return mlflow.sklearn.load_model(f"models:/{model_name}/latest")
    except Exception as e:
        print(f"[drift_detector] Could not load model '{model_name}': {e}")
        return None


# ---------------------------------------------------------------------------
# M1 — Abandonment AUC-ROC (weekly, retrain on breach)
# ---------------------------------------------------------------------------

def _load_recent_m1_eval_set(db_connection, days: int = M1_WINDOW_DAYS) -> pd.DataFrame | None:
    """Pulls checkout sessions resolved (ABANDONED/RECOVERED/COMPLETED) in
    the trailing `days` window and computes the 5 M1 features with the
    exact pipeline.py functions, mirroring
    abandonment/train.py::_load_real_session_rows so the eval set uses
    identical feature logic to what the model was trained on."""
    with db_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT session_id, status
            FROM checkout
            WHERE status IN ('ABANDONED', 'RECOVERED', 'COMPLETED')
              AND updated_at >= NOW() - INTERVAL '%s days'
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
            SELECT session_id, event_type, timestamp, payload
            FROM customer_events
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
            "checkout_step_reached": calculate_checkout_step_reached(events),
            "failed_payment_attempt": int(calculate_failed_payment_attempt(events)),
            "abandoned": labels[session_id],
        })
    return pd.DataFrame.from_records(records)


def check_m1_drift(db_connection, auto_retrain: bool = True) -> DriftCheckResult:
    """Weekly M1 AUC-ROC check. Below M1_AUC_ROC_FLOOR (0.65) triggers
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
            result.error = "insufficient labelled data in trailing window"
            return result

        from sklearn.metrics import roc_auc_score
        feature_cols = ["scroll_depth_pct", "tab_switch_count", "time_on_page_ms",
                         "checkout_step_reached", "failed_payment_attempt"]
        X = eval_df[feature_cols]
        y = eval_df["abandoned"]
        y_prob = model.predict_proba(X)[:, 1]

        auc = float(roc_auc_score(y, y_prob))
        result.metric_value = auc
        result.sample_size = len(eval_df)
        result.breached = auc < M1_AUC_ROC_FLOOR

        if result.breached and auto_retrain:
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
# M2 — Sensitivity per-class F1 (weekly, alert only)
# ---------------------------------------------------------------------------

def _load_recent_m2_eval_set(db_connection, days: int = M2_WINDOW_DAYS) -> pd.DataFrame | None:
    """Mirrors sensitivity/train.py::_load_real_sensitivity_rows but scoped
    to the trailing `days` window, for use as a fresh evaluation set
    rather than a training set."""
    with db_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT c.session_id, c.customer_id
            FROM checkout c
            WHERE c.status IN ('ABANDONED', 'RECOVERED')
              AND c.customer_id IS NOT NULL
              AND c.updated_at >= NOW() - INTERVAL '%s days'
            """,
            (days,)
        )
        session_rows = cursor.fetchall()

    if not session_rows:
        return None

    session_ids = [r[0] for r in session_rows]
    customer_by_session = {r[0]: r[1] for r in session_rows}

    with db_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT session_id, event_type, timestamp, payload
            FROM customer_events WHERE session_id = ANY(%s)
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

    with db_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT session_id, recovery_action FROM orders
            WHERE session_id = ANY(%s) AND recovery_status = 'CONVERTED'
            ORDER BY ordered_at DESC
            """,
            (session_ids,)
        )
        recovery_rows = cursor.fetchall()

    converted_action = {}
    for session_id, action in recovery_rows:
        converted_action.setdefault(session_id, action)

    price_actions = {"DISCOUNT", "HYBRID"}
    convenience_actions = {"FRICTION_FIX", "HYBRID"}

    records = []
    for session_id in session_ids:
        customer_id = customer_by_session[session_id]
        events = events_by_session.get(session_id, [])
        action = converted_action.get(session_id)

        records.append({
            "coupon_usage_pct": calculate_coupon_usage_pct(customer_id, db_connection) * 100.0,
            "visited_coupon_page": int(calculate_visited_coupon_page(events)),
            "searched_discount_terms": int(calculate_searched_discount_terms(events)),
            "cursor_hesitation": calculate_cursor_hesitation(events),
            "abandoned_at_shipping_reveal": int(calculate_abandoned_at_shipping_reveal(events)),
            "checkout_step_reached": calculate_checkout_step_reached(events),
            "scroll_depth_pct": calculate_scroll_depth(events),
            "time_on_page_ms": calculate_time_on_page_ms(events),
            "PSS_label": int(action in price_actions) if action else 0,
            "CSS_label": int(action in convenience_actions) if action else 0,
        })
    return pd.DataFrame.from_records(records)


def check_m2_drift(db_connection) -> list[DriftCheckResult]:
    """Weekly M2 per-class F1 check for both PSS and CSS models. Returns
    one DriftCheckResult per class (4 total: PSS-0, PSS-1, CSS-0, CSS-1),
    since the Phase 3 task requires alerting "if any class F1 drops below
    0.60" — each class is tracked and alerted independently."""
    results: list[DriftCheckResult] = []
    feature_cols = [
        "coupon_usage_pct", "visited_coupon_page", "searched_discount_terms",
        "cursor_hesitation", "abandoned_at_shipping_reveal",
        "checkout_step_reached", "scroll_depth_pct", "time_on_page_ms",
    ]

    try:
        eval_df = _load_recent_m2_eval_set(db_connection)
        pss_model = _load_registered_model("sensitivity_pss")
        css_model = _load_registered_model("sensitivity_css")

        if eval_df is None:
            skipped = DriftCheckResult(
                model_name="sensitivity", check_type="weekly", metric_name="f1",
                metric_value=None, threshold=M2_CLASS_F1_FLOOR, breached=False,
                sample_size=0, error="insufficient labelled data in trailing window",
            )
            _log_result_to_mlflow(skipped)
            return [skipped]

        from sklearn.metrics import f1_score
        X = eval_df[feature_cols]

        for target_name, model, label_col in (
            ("sensitivity_pss", pss_model, "PSS_label"),
            ("sensitivity_css", css_model, "CSS_label"),
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
    """Builds a fresh M4 evaluation set the same way churn/train.py's real
    path does, scoped to customers active within the trailing window."""
    with db_connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT DISTINCT c.id
            FROM customers c
            JOIN orders o ON o.customer_id = c.id
            WHERE o.ordered_at >= NOW() - INTERVAL '%s days'
            """,
            (days,)
        )
        rows = cursor.fetchall()

    customer_ids = [r[0] for r in rows]
    if not customer_ids:
        return None

    records = []
    for customer_id in customer_ids:
        rfm = calculate_rfm_scores(customer_id, db_connection)
        trend = calculate_purchase_frequency_trend(customer_id, db_connection)
        days_since = rfm["days_since_last_purchase"]

        if days_since == -1:
            risk_score = 0.5
        else:
            risk_score = min(days_since / 180.0, 1.0)
            if trend == -1:
                risk_score += 0.3
            elif trend == 1:
                risk_score -= 0.3
            if rfm["rfm_recency_score"] <= 2:
                risk_score += 0.2
            if rfm["rfm_frequency_score"] >= 4:
                risk_score -= 0.2
        risk_score = float(np.clip(risk_score, 0.0, 1.0))

        if risk_score <= 0.30:
            tier = "HEALTHY"
        elif risk_score <= 0.60:
            tier = "AT_RISK"
        elif risk_score <= 0.80:
            tier = "HIGH_RISK"
        else:
            tier = "CRITICAL"

        records.append({
            "past_orders_total": rfm["past_orders_total"],
            "days_since_last_purchase": days_since,
            "avg_order_value": rfm["avg_order_value"],
            "purchase_frequency_trend": trend,
            "rfm_recency_score": rfm["rfm_recency_score"],
            "rfm_frequency_score": rfm["rfm_frequency_score"],
            "rfm_monetary_score": rfm["rfm_monetary_score"],
            "churn_tier": tier,
        })
    return pd.DataFrame.from_records(records)


def check_m4_drift(db_connection) -> DriftCheckResult:
    """Monthly M4 overall accuracy check. Alert-only per the Phase 3 task
    (no auto-retraining rule was specified for M4, unlike M1)."""
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
            result.error = "insufficient labelled data in trailing window"
            return result

        from sklearn.metrics import accuracy_score
        feature_cols = ["past_orders_total", "days_since_last_purchase", "avg_order_value",
                         "purchase_frequency_trend", "rfm_recency_score",
                         "rfm_frequency_score", "rfm_monetary_score"]
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
    """Runs the monthly check (M4 accuracy). Intended to be invoked by a
    monthly cron/scheduler entry."""
    print(f"[drift_detector] Running monthly checks at {datetime.now(timezone.utc).isoformat()}")
    m4_result = check_m4_drift(db_connection)
    return {"m4": m4_result}


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