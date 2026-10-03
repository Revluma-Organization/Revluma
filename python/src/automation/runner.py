"""Run bounded, durable automation without requiring manual activation."""

from __future__ import annotations

import json
import logging
from datetime import timedelta
from typing import Any

from mlflow.tracking import MlflowClient
from sqlalchemy import text

from src.memory.vector_store import process_embedding_jobs
from src.monitoring.drift_detector import (
    DriftCheckResult,
    run_monthly_checks,
    run_weekly_checks,
)
from src.training.lifecycle import run_model_lifecycle


logger = logging.getLogger("revluma.automation")


def _claim(raw_connection, job_name: str, interval: timedelta) -> bool:
    """Atomically claim a due job, recovering a stale claim after two hours."""
    seconds = max(60, int(interval.total_seconds()))
    with raw_connection.cursor() as cursor:
        cursor.execute("""
            INSERT INTO automation_job_state (
                job_name, status, last_started_at, next_run_at, updated_at
            ) VALUES (%s, 'running', NOW(), NOW() + (%s * INTERVAL '1 second'), NOW())
            ON CONFLICT (job_name) DO UPDATE SET
                status = 'running', last_started_at = NOW(),
                next_run_at = NOW() + (%s * INTERVAL '1 second'),
                last_error = NULL, updated_at = NOW()
            WHERE automation_job_state.next_run_at IS NULL
               OR automation_job_state.next_run_at <= NOW()
               OR (automation_job_state.status = 'running'
                   AND automation_job_state.last_started_at < NOW() - INTERVAL '2 hours')
            RETURNING job_name
        """, (job_name, seconds, seconds))
        claimed = cursor.fetchone() is not None
    raw_connection.commit()
    return claimed


def _finish(raw_connection, job_name: str, result: dict | None, error: Exception | None = None) -> None:
    with raw_connection.cursor() as cursor:
        cursor.execute("""
            UPDATE automation_job_state
            SET status = %s, last_completed_at = NOW(), last_result = %s::jsonb,
                last_error = %s, updated_at = NOW()
            WHERE job_name = %s
        """, (
            "failed" if error else "completed",
            json.dumps(result or {}),
            type(error).__name__[:120] if error else None,
            job_name,
        ))
    raw_connection.commit()


def _run_due(raw_connection, job_name: str, interval: timedelta, callback) -> dict:
    if not _claim(raw_connection, job_name, interval):
        return {"status": "not_due"}
    try:
        result = callback()
        _finish(raw_connection, job_name, result)
        return {"status": "completed", "result": result}
    except Exception as exc:
        raw_connection.rollback()
        _finish(raw_connection, job_name, None, exc)
        logger.error(
            "automation_job_failed",
            extra={"job_name": job_name, "error_type": type(exc).__name__},
        )
        return {"status": "failed", "error_type": type(exc).__name__}


def _candidate_versions() -> dict[str, str]:
    client = MlflowClient()
    versions: dict[str, str] = {}
    for name in (
        "abandonment", "sensitivity_pss", "sensitivity_css", "sensitivity_tss",
        "send_time", "churn_risk", "churn_early_warning", "offer_value",
    ):
        try:
            versions[name] = str(client.get_model_version_by_alias(name, "beta").version)
        except Exception:
            continue
    return versions


def _flatten_results(payload: dict) -> list[DriftCheckResult]:
    flattened: list[DriftCheckResult] = []
    for value in payload.values():
        if isinstance(value, DriftCheckResult):
            flattened.append(value)
        elif isinstance(value, list):
            flattened.extend(item for item in value if isinstance(item, DriftCheckResult))
    return flattened


def _persist_live_metrics(raw_connection, payload: dict) -> dict:
    versions = _candidate_versions()
    inserted = 0
    for result in _flatten_results(payload):
        model_name = result.model_name
        metric_name = result.metric_name
        if "::class_" in model_name:
            model_name, class_name = model_name.split("::", 1)
            metric_name = f"f1_{class_name}"
        version = versions.get(model_name)
        if not version or result.metric_value is None or result.error:
            continue
        with raw_connection.cursor() as cursor:
            cursor.execute("""
                INSERT INTO model_lifecycle_metrics (
                    model_name, model_version, metric_name, metric_value,
                    threshold, passed, sample_size, observed_at, metadata
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), %s::jsonb)
            """, (
                model_name, version, metric_name, result.metric_value,
                result.threshold, not result.breached, result.sample_size,
                json.dumps({"check_type": result.check_type}),
            ))
        inserted += 1
    raw_connection.commit()
    return {"checks": len(_flatten_results(payload)), "metrics_recorded": inserted}


def _run_monitoring(raw_connection, *, monthly: bool) -> dict:
    results = (
        run_monthly_checks(raw_connection)
        if monthly
        else run_weekly_checks(raw_connection, auto_retrain=False)
    )
    return _persist_live_metrics(raw_connection, results)


def _large_dataset_probe(raw_connection) -> dict:
    """Record a bounded query probe once real scale reaches 100,000 orders."""
    with raw_connection.cursor() as cursor:
        cursor.execute("""
            SELECT store.organization_id, COUNT(order_row.id)
            FROM stores AS store
            JOIN orders AS order_row ON order_row.store_id = store.id
            GROUP BY store.organization_id
            HAVING COUNT(order_row.id) >= 100000
            ORDER BY COUNT(order_row.id) DESC
            LIMIT 1
        """)
        row = cursor.fetchone()
        if not row:
            return {"status": "dormant", "reason": "requires_100000_real_orders"}
        cursor.execute("EXPLAIN (ANALYZE, FORMAT JSON) SELECT id FROM orders WHERE store_id IN (SELECT id FROM stores WHERE organization_id = %s) ORDER BY ordered_at DESC LIMIT 1000", (row[0],))
        plan = cursor.fetchone()[0]
    raw_connection.rollback()
    plan_root = plan[0].get("Plan", {}) if isinstance(plan, list) and plan else {}
    return {
        "status": "measured",
        "order_count": int(row[1]),
        "execution_time_ms": float(plan[0].get("Execution Time", 0.0)),
        "returned_rows": int(plan_root.get("Actual Rows", 0)),
    }


def run_automation_cycle(session, raw_connection) -> dict[str, Any]:
    """Process fast work and claim slower jobs at their durable cadence."""
    embeddings = process_embedding_jobs(session, limit=50)
    weekly = _run_due(
        raw_connection, "weekly_model_monitoring", timedelta(days=7),
        lambda: _run_monitoring(raw_connection, monthly=False),
    )
    monthly = _run_due(
        raw_connection, "monthly_model_monitoring", timedelta(days=30),
        lambda: _run_monitoring(raw_connection, monthly=True),
    )
    lifecycle = _run_due(
        raw_connection, "real_data_model_lifecycle", timedelta(hours=6),
        lambda: run_model_lifecycle(raw_connection),
    )
    benchmark = _run_due(
        raw_connection, "large_dataset_probe", timedelta(days=7),
        lambda: _large_dataset_probe(raw_connection),
    )
    lifecycle_result = lifecycle.get("result") or {}
    return {
        "status": "completed",
        "embeddings": embeddings,
        "weekly_monitoring": weekly["status"],
        "monthly_monitoring": monthly["status"],
        "model_lifecycle": lifecycle["status"],
        "large_dataset_probe": benchmark["status"],
        "reload_required": bool(lifecycle_result.get("reload_required")),
    }
