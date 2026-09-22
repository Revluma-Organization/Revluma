"""Automatic real-data training, canary aliasing, promotion, and rollback.

The lifecycle is deliberately evidence-gated:

* no training starts until mature real rows and class coverage exist;
* training functions retain their own chronological/quality gates;
* only production-eligible registered artifacts receive candidate/beta aliases;
* production promotion requires version-specific live canary evidence; and
* a breached promoted version rolls back to the recorded previous alias.

Synthetic runs can never enter this path because every training call receives a
live database connection and each model's existing registration guard requires
real data.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from mlflow.tracking import MlflowClient

from src.config import mlflow_config as _mlflow_config  # noqa: F401


logger = logging.getLogger("revluma.training.lifecycle")

_ADVISORY_LOCK_ID = 1_907_641_113
_DEFAULT_CANARY_HOURS = 168


@dataclass(frozen=True)
class Readiness:
    row_count: int
    class_count: int
    latest_at: str | None
    eligible: bool
    reason: str

    @property
    def fingerprint(self) -> str:
        raw = json.dumps(
            {
                "row_count": self.row_count,
                "class_count": self.class_count,
                "latest_at": self.latest_at,
            },
            sort_keys=True,
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Pipeline:
    name: str
    model_names: tuple[str, ...]
    readiness: Callable[[Any], Readiness]
    trainer: Callable[[Any], dict]


def _scalar_row(connection, query: str, params: tuple = ()) -> tuple:
    with connection.cursor() as cursor:
        cursor.execute(query, params)
        return cursor.fetchone() or ()


def _timestamp(value) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else None


def _m1_readiness(connection) -> Readiness:
    row = _scalar_row(connection, """
        SELECT COUNT(DISTINCT session_id),
               COUNT(DISTINCT CASE
                 WHEN recovered_at IS NOT NULL
                   OR UPPER(COALESCE(status, '')) = 'RECOVERED'
                 THEN 0 ELSE 1 END),
               MAX(updated_at)
        FROM abandoned_carts
        WHERE session_id IS NOT NULL
          AND (recovered_at IS NOT NULL
               OR UPPER(COALESCE(status, '')) IN ('ABANDONED', 'RECOVERED'))
    """)
    count, classes, latest = int(row[0] or 0), int(row[1] or 0), row[2]
    eligible = count >= 1000 and classes >= 2
    return Readiness(count, classes, _timestamp(latest), eligible,
                     "ready" if eligible else "requires_1000_labeled_sessions_and_two_classes")


def _m2_readiness(connection) -> Readiness:
    row = _scalar_row(connection, """
        SELECT COUNT(*),
               LEAST(COUNT(DISTINCT pss_label), COUNT(DISTINCT css_label),
                     COUNT(DISTINCT tss_label)),
               MAX(finalized_at)
        FROM sensitivity_training_observations
        WHERE finalized_at IS NOT NULL
          AND pss_label IS NOT NULL AND css_label IS NOT NULL
          AND tss_label IS NOT NULL
    """)
    count, classes, latest = int(row[0] or 0), int(row[1] or 0), row[2]
    eligible = count >= 500 and classes >= 2
    return Readiness(count, classes, _timestamp(latest), eligible,
                     "ready" if eligible else "requires_500_finalized_rows_and_two_classes_per_target")


def _m3_readiness(connection) -> Readiness:
    row = _scalar_row(connection, """
        WITH labeled AS (
          SELECT send.id, send.sent_at,
                 CASE WHEN BOOL_OR(event.event_type = 'opened'
                                   AND event.occurred_at BETWEEN send.sent_at
                                       AND send.sent_at + INTERVAL '120 minutes')
                            AND BOOL_OR(event.event_type = 'clicked'
                                   AND event.occurred_at BETWEEN send.sent_at
                                       AND send.sent_at + INTERVAL '120 minutes')
                      THEN 1 ELSE 0 END AS label
          FROM sequence_sends AS send
          LEFT JOIN sequence_events AS event ON event.sequence_send_id = send.id
          WHERE send.sent_at >= NOW() - INTERVAL '180 days'
            AND send.sent_at <= NOW() - INTERVAL '120 minutes'
            AND send.status IN ('sent', 'delivered')
            AND send.metadata ? 'recovery_action'
            AND send.metadata ? 'cart_value_tier'
            AND send.metadata ? 'historical_open_rate'
            AND send.metadata ? 'days_since_last_purchase'
          GROUP BY send.id, send.sent_at
        )
        SELECT COUNT(*), COUNT(DISTINCT label), MAX(sent_at) FROM labeled
    """)
    count, classes, latest = int(row[0] or 0), int(row[1] or 0), row[2]
    eligible = count >= 500 and classes >= 2
    return Readiness(count, classes, _timestamp(latest), eligible,
                     "ready" if eligible else "requires_500_complete_mature_sends_and_two_classes")


def _m4_readiness(connection) -> Readiness:
    row = _scalar_row(connection, """
        SELECT COUNT(*), COUNT(DISTINCT observed_churn_tier), MAX(finalized_at)
        FROM churn_training_observations
        WHERE finalized_at IS NOT NULL
          AND observed_churn_tier IN ('HEALTHY', 'AT_RISK', 'HIGH_RISK', 'CRITICAL')
    """)
    count, classes, latest = int(row[0] or 0), int(row[1] or 0), row[2]
    eligible = count >= 500 and classes >= 4
    return Readiness(count, classes, _timestamp(latest), eligible,
                     "ready" if eligible else "requires_500_finalized_rows_and_all_four_tiers")


def _m5_readiness(connection) -> Readiness:
    row = _scalar_row(connection, """
        SELECT COUNT(*), COUNT(DISTINCT ROUND(discount_pct::numeric, 2)),
               MAX(ordered_at)
        FROM orders
        WHERE LOWER(COALESCE(recovery_status, '')) IN
              ('converted', 'recovered', 'completed')
          AND abandoned_cart_id IS NOT NULL
          AND discount_pct IS NOT NULL AND session_id IS NOT NULL
    """)
    count, classes, latest = int(row[0] or 0), int(row[1] or 0), row[2]
    eligible = count >= 200 and classes >= 2
    return Readiness(count, classes, _timestamp(latest), eligible,
                     "ready" if eligible else "requires_200_recovered_orders_and_discount_variation")


def _train_m1(connection) -> dict:
    from src.models.abandonment.train import train
    return train(run_name="m1-automatic-real-data", db_connection=connection)


def _train_m2(connection) -> dict:
    from src.models.sensitivity.train import train
    return train(run_name="m2-automatic-real-data", db_connection=connection)


def _train_m3(connection) -> dict:
    from src.models.timing.train import train
    return train(run_name="m3-automatic-real-data", db_connection=connection)


def _train_m4(connection) -> dict:
    from src.models.churn.train import train
    return train(run_name="m4-automatic-real-data", db_connection=connection)


def _train_m5(connection) -> dict:
    from src.models.offer_value.train import train
    return train(run_name="m5-automatic-real-data", db_connection=connection)


PIPELINES = (
    Pipeline("abandonment", ("abandonment",), _m1_readiness, _train_m1),
    Pipeline(
        "sensitivity",
        ("sensitivity_pss", "sensitivity_css", "sensitivity_tss"),
        _m2_readiness,
        _train_m2,
    ),
    Pipeline("send_time", ("send_time",), _m3_readiness, _train_m3),
    Pipeline("churn", ("churn_risk", "churn_early_warning"), _m4_readiness, _train_m4),
    Pipeline("offer_value", ("offer_value",), _m5_readiness, _train_m5),
)


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(child) for key, child in value.items()
                if key not in {"model", "scaler", "early_warning_model"}}
    if isinstance(value, (list, tuple)):
        return [_json_safe(child) for child in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if hasattr(value, "item"):
        return value.item()
    return str(value)


def _production_eligible(pipeline: Pipeline, result: dict) -> bool:
    if pipeline.name != "sensitivity":
        return result.get("production_eligible") is True
    return all(
        result.get(f"{target}_metrics", {}).get("production_eligible") is True
        for target in ("pss", "css", "tss")
    )


def _run_ids(pipeline: Pipeline, result: dict) -> dict[str, str]:
    if pipeline.name == "sensitivity":
        return {
            f"sensitivity_{target}": str(result[f"{target}_metrics"]["run_id"])
            for target in ("pss", "css", "tss")
        }
    run_id = str(result.get("run_id") or "")
    return {name: run_id for name in pipeline.model_names if run_id}


def _alias_version(client: MlflowClient, name: str, alias: str) -> str | None:
    try:
        return str(client.get_model_version_by_alias(name, alias).version)
    except Exception:
        return None


def _version_for_run(client: MlflowClient, name: str, run_id: str) -> str | None:
    versions = client.search_model_versions(f"name = '{name}'")
    matches = [version for version in versions if str(version.run_id) == str(run_id)]
    if not matches:
        return None
    return str(max(matches, key=lambda version: int(version.version)).version)


def _create_run(connection, pipeline: Pipeline, readiness: Readiness) -> str | None:
    run_id = str(uuid.uuid4())
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT 1 FROM model_lifecycle_runs
            WHERE pipeline_name = %s
              AND status IN ('running', 'rejected', 'canary', 'promoted')
              AND created_at >= NOW() - INTERVAL '7 days'
            LIMIT 1
        """, (pipeline.name,))
        if cursor.fetchone():
            connection.commit()
            return None
        cursor.execute("""
            INSERT INTO model_lifecycle_runs (
                id, pipeline_name, data_fingerprint, status, metrics,
                started_at, created_at, updated_at
            ) VALUES (%s, %s, %s, 'running', %s::jsonb, NOW(), NOW(), NOW())
            ON CONFLICT (pipeline_name, data_fingerprint) DO NOTHING
            RETURNING id
        """, (
            run_id,
            pipeline.name,
            readiness.fingerprint,
            json.dumps({
                "readiness_row_count": readiness.row_count,
                "readiness_class_count": readiness.class_count,
                "readiness_latest_at": readiness.latest_at,
            }),
        ))
        created = cursor.fetchone()
    connection.commit()
    return str(created[0]) if created else None


def _update_run(connection, run_id: str, **values) -> None:
    allowed = {
        "status", "run_ids", "registered_versions", "previous_versions",
        "metrics", "production_eligible", "candidate_at", "promoted_at",
        "completed_at", "last_error",
    }
    assignments = []
    params: list[Any] = []
    for key, value in values.items():
        if key not in allowed:
            continue
        if key in {"run_ids", "registered_versions", "previous_versions", "metrics"}:
            assignments.append(f"{key} = %s::jsonb")
            params.append(json.dumps(_json_safe(value)))
        else:
            assignments.append(f"{key} = %s")
            params.append(value)
    assignments.append("updated_at = NOW()")
    params.append(run_id)
    with connection.cursor() as cursor:
        cursor.execute(
            f"UPDATE model_lifecycle_runs SET {', '.join(assignments)} WHERE id = %s",
            tuple(params),
        )
    connection.commit()


def _mark_feedback_processed(connection, pipeline_name: str) -> None:
    aliases = {
        "abandonment": ("m1_abandonment", "abandonment"),
        "sensitivity": ("m2_sensitivity", "sensitivity"),
        "send_time": ("m3_send_time", "send_time"),
        "churn": ("m4_churn", "churn_risk"),
        "offer_value": ("m5_offer_value", "offer_value"),
    }.get(pipeline_name, (pipeline_name,))
    with connection.cursor() as cursor:
        cursor.execute("""
            UPDATE model_feedback_queue
            SET status = 'processed', processed_at = NOW(), last_error = NULL,
                updated_at = NOW()
            WHERE status = 'pending' AND model_name = ANY(%s)
        """, (list(aliases),))
    connection.commit()


def _train_one_ready_pipeline(connection) -> dict:
    for pipeline in PIPELINES:
        readiness = pipeline.readiness(connection)
        if not readiness.eligible:
            continue
        lifecycle_id = _create_run(connection, pipeline, readiness)
        if lifecycle_id is None:
            continue
        previous: dict[str, dict[str, str | None]] = {}
        aliases_changed: list[str] = []
        try:
            result = pipeline.trainer(connection)
            eligible = _production_eligible(pipeline, result)
            run_ids = _run_ids(pipeline, result)
            if not eligible:
                _update_run(
                    connection,
                    lifecycle_id,
                    status="rejected",
                    run_ids=run_ids,
                    metrics=result,
                    production_eligible=False,
                    completed_at=datetime.now(timezone.utc),
                )
                return {"pipeline": pipeline.name, "status": "rejected", "reload_required": False}

            client = MlflowClient()
            previous = {
                name: {
                    "beta": _alias_version(client, name, "beta"),
                    "production": _alias_version(client, name, "production"),
                    "candidate": _alias_version(client, name, "candidate"),
                }
                for name in pipeline.model_names
            }
            versions = {
                name: _version_for_run(client, name, run_ids[name])
                for name in pipeline.model_names
            }
            if any(version is None for version in versions.values()):
                raise RuntimeError("A registered model version could not be resolved from its run.")
            for name, version in versions.items():
                client.set_registered_model_alias(name, "candidate", version)
                client.set_registered_model_alias(name, "beta", version)
                aliases_changed.append(name)

            now = datetime.now(timezone.utc)
            _update_run(
                connection,
                lifecycle_id,
                status="canary",
                run_ids=run_ids,
                registered_versions=versions,
                previous_versions=previous,
                metrics=result,
                production_eligible=True,
                candidate_at=now,
                completed_at=now,
            )
            _mark_feedback_processed(connection, pipeline.name)
            return {"pipeline": pipeline.name, "status": "canary", "reload_required": True}
        except Exception as exc:
            connection.rollback()
            if previous:
                rollback_client = locals().get("client") or MlflowClient()
                for name in aliases_changed:
                    prior = previous.get(name, {})
                    _restore_alias(rollback_client, name, "beta", prior.get("beta"))
                    _restore_alias(
                        rollback_client, name, "candidate", prior.get("candidate")
                    )
            _update_run(
                connection,
                lifecycle_id,
                status="failed",
                production_eligible=False,
                completed_at=datetime.now(timezone.utc),
                last_error=type(exc).__name__[:120],
            )
            logger.error(
                "automatic_model_training_failed",
                extra={"pipeline": pipeline.name, "error_type": type(exc).__name__},
            )
            return {"pipeline": pipeline.name, "status": "failed", "reload_required": False}
    return {"pipeline": None, "status": "no_new_ready_data", "reload_required": False}


_REQUIRED_EVIDENCE = {
    "abandonment": (("abandonment", "auc_roc", 1000),),
    "sensitivity": (
        ("sensitivity_pss", "f1_class_0", 500),
        ("sensitivity_pss", "f1_class_1", 500),
        ("sensitivity_css", "f1_class_0", 500),
        ("sensitivity_css", "f1_class_1", 500),
        ("sensitivity_tss", "f1_class_0", 500),
        ("sensitivity_tss", "f1_class_1", 500),
    ),
    "send_time": (("send_time", "randomized_policy_ctr_improvement", 500),),
    "churn": (
        ("churn_risk", "accuracy", 500),
        ("churn_early_warning", "f1_positive_class", 100),
    ),
    "offer_value": (("offer_value", "discount_rmse", 200),),
}


def _latest_metric(connection, model_name: str, version: str, metric_name: str, since) -> tuple | None:
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT metric_value, passed, sample_size
            FROM model_lifecycle_metrics
            WHERE model_name = %s AND model_version = %s
              AND metric_name = %s AND observed_at >= %s
            ORDER BY observed_at DESC
            LIMIT 1
        """, (model_name, version, metric_name, since))
        return cursor.fetchone()


def _restore_alias(client: MlflowClient, name: str, alias: str, version: str | None) -> None:
    if version:
        client.set_registered_model_alias(name, alias, version)
        return
    try:
        client.delete_registered_model_alias(name, alias)
    except Exception:
        pass


def _evaluate_candidates(connection) -> dict:
    if os.getenv("MODEL_AUTO_PROMOTION_ENABLED", "true").strip().lower() != "true":
        return {"evaluated": 0, "promoted": 0, "rolled_back": 0, "reload_required": False}
    canary_hours = max(24, int(os.getenv("MODEL_CANARY_MIN_HOURS", str(_DEFAULT_CANARY_HOURS))))
    cutoff = datetime.now(timezone.utc) - timedelta(hours=canary_hours)
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT id, pipeline_name, registered_versions, previous_versions,
                   candidate_at, promoted_at, status
            FROM model_lifecycle_runs
            WHERE status IN ('canary', 'promoted')
              AND production_eligible = TRUE
            ORDER BY candidate_at
        """)
        rows = cursor.fetchall()

    client = MlflowClient()
    evaluated = promoted = rolled_back = 0
    reload_required = False
    for row in rows:
        lifecycle_id, pipeline_name = str(row[0]), str(row[1])
        versions = row[2] if isinstance(row[2], dict) else json.loads(row[2] or "{}")
        previous = row[3] if isinstance(row[3], dict) else json.loads(row[3] or "{}")
        candidate_at, promoted_at, status = row[4], row[5], str(row[6])
        evidence_since = promoted_at or candidate_at
        if status == "canary" and (candidate_at is None or candidate_at > cutoff):
            continue
        requirements = _REQUIRED_EVIDENCE.get(pipeline_name, ())
        evidence = []
        missing = False
        for model_name, metric_name, minimum_samples in requirements:
            version = str(versions.get(model_name) or "")
            metric = _latest_metric(connection, model_name, version, metric_name, evidence_since)
            if not metric or metric[0] is None or int(metric[2] or 0) < minimum_samples:
                missing = True
                break
            evidence.append(bool(metric[1]))
        if missing:
            continue
        evaluated += 1
        if all(evidence):
            if status == "canary":
                for model_name, version in versions.items():
                    client.set_registered_model_alias(model_name, "production", str(version))
                _update_run(
                    connection,
                    lifecycle_id,
                    status="promoted",
                    promoted_at=datetime.now(timezone.utc),
                )
                promoted += 1
                reload_required = True
            continue

        for model_name in versions:
            prior = previous.get(model_name, {})
            if status == "promoted":
                _restore_alias(client, model_name, "production", prior.get("production"))
                _restore_alias(
                    client,
                    model_name,
                    "beta",
                    prior.get("beta") or prior.get("production"),
                )
            else:
                _restore_alias(
                    client,
                    model_name,
                    "beta",
                    prior.get("beta") or prior.get("production"),
                )
            _restore_alias(client, model_name, "candidate", prior.get("candidate"))
        _update_run(
            connection,
            lifecycle_id,
            status="rolled_back",
            completed_at=datetime.now(timezone.utc),
            last_error="live_quality_gate_failed",
        )
        rolled_back += 1
        reload_required = True
    return {
        "evaluated": evaluated,
        "promoted": promoted,
        "rolled_back": rolled_back,
        "reload_required": reload_required,
    }


def run_model_lifecycle(connection) -> dict:
    """Run one bounded training attempt plus promotion/rollback evaluation."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(%s)", (_ADVISORY_LOCK_ID,))
        acquired = bool((cursor.fetchone() or (False,))[0])
    connection.commit()
    if not acquired:
        return {"status": "lock_not_acquired", "reload_required": False}
    try:
        promotion = _evaluate_candidates(connection)
        training = _train_one_ready_pipeline(connection)
        return {
            "status": "completed",
            "training": training,
            "promotion": promotion,
            "reload_required": bool(
                training.get("reload_required") or promotion.get("reload_required")
            ),
        }
    finally:
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_unlock(%s)", (_ADVISORY_LOCK_ID,))
            connection.commit()
        except Exception:
            connection.rollback()
