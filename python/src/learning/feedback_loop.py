"""
Rev Intelligence -- Sub-1-Hour Feedback Loop for Cart Recovery (P3-A)
=======================================================================
Provides a fast-path feedback channel for time-sensitive campaign types.

Channel-specific windows:
  - cart_recovery_email: 45 minutes
  - cart_recovery_sms:   20 minutes
  - win_back_campaign:   48 hours
  - win_back_sequence:   7 days

Due recommendations are measured from normalised sequence delivery events.
Underperforming variants are paused and their audit, memory, outcome, and model
feedback records are committed atomically.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

logger = logging.getLogger("rev.feedback_loop")

FEEDBACK_WINDOWS: dict[str, timedelta] = {
    "cart_recovery_email": timedelta(minutes=45),
    "cart_recovery_sms": timedelta(minutes=20),
    "win_back_campaign": timedelta(hours=48),
    "win_back_sequence": timedelta(days=7),
}

PAUSE_THRESHOLDS: dict[str, dict[str, float]] = {
    "cart_recovery_email": {"open_rate": 0.15, "click_rate": 0.03},
    "cart_recovery_sms": {"click_rate": 0.05},
}

REQUIRED_FEEDBACK_TABLES = (
    "sequence_sends",
    "sequence_events",
    "audit_logs",
    "model_feedback_queue",
)


class FeedbackPersistenceUnavailable(RuntimeError):
    """Raised until the backend-owned feedback migration is available."""


def schedule_outcome_check(
    recommendation_id: str,
    channel: str,
    sent_at: datetime,
    db,
) -> None:
    """Schedule one idempotent recommendation outcome evaluation."""
    if channel not in FEEDBACK_WINDOWS:
        raise ValueError(f"Unsupported feedback channel: {channel}")
    if sent_at.tzinfo is None:
        sent_at = sent_at.replace(tzinfo=timezone.utc)

    _require_column(db, "recommendations", "channel")
    _require_column(db, "recommendations", "outcome_checked_at")
    check_at = sent_at + FEEDBACK_WINDOWS[channel]

    try:
        updated = db.execute(
            text("""
                UPDATE recommendations
                SET channel = :channel,
                    evaluate_after = :check_at,
                    outcome_checked_at = NULL,
                    updated_at = NOW()
                WHERE id = :recommendation_id
            """),
            {
                "recommendation_id": recommendation_id,
                "channel": channel,
                "check_at": check_at,
            },
        )
        if getattr(updated, "rowcount", 0) == 0:
            raise ValueError("Recommendation does not exist.")
        db.commit()
    except Exception:
        db.rollback()
        raise

    logger.info(
        "outcome_check_scheduled",
        extra={
            "recommendation_id": recommendation_id,
            "channel": channel,
            "check_at": check_at.isoformat(),
        },
    )


def run_due_outcome_checks(db, limit: int = 100) -> int:
    """Claim and evaluate due recommendations without duplicate workers."""
    if not isinstance(limit, int) or not 1 <= limit <= 1000:
        raise ValueError("limit must be an integer from 1 to 1000.")

    _require_feedback_persistence(db)
    processed = 0
    for _ in range(limit):
        try:
            due = _claim_one_due_recommendation(db)
            if not due:
                db.rollback()
                break

            _evaluate_outcome(
                str(due[0]),
                str(due[2]),
                db,
                organization_id=str(due[1]),
            )
            db.commit()
            processed += 1
        except Exception as exc:
            db.rollback()
            logger.exception(
                "outcome_check_failed",
                extra={"error_type": type(exc).__name__},
            )
            break
    return processed


def _claim_one_due_recommendation(db):
    return db.execute(
        text("""
            UPDATE recommendations
            SET outcome_checked_at = NOW(),
                updated_at = NOW()
            WHERE id = (
                SELECT id
                FROM recommendations
                WHERE evaluate_after <= NOW()
                  AND outcome_checked_at IS NULL
                  AND channel IS NOT NULL
                  AND status NOT IN ('paused', 'rejected', 'cancelled')
                ORDER BY evaluate_after, id
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING id, organization_id, channel
        """),
    ).fetchone()


def _evaluate_outcome(
    recommendation_id: str,
    channel: str,
    db,
    organization_id: str | None = None,
) -> None:
    """Measure one recommendation and persist its learning result."""
    if organization_id is None:
        organization_id = _get_recommendation_organization(recommendation_id, db)

    metrics = _load_delivery_metrics(recommendation_id, db)
    sent_count = int(metrics[0] or 0)
    opened_count = int(metrics[1] or 0)
    clicked_count = int(metrics[2] or 0)
    open_rate = opened_count / sent_count if sent_count else 0.0
    click_rate = clicked_count / sent_count if sent_count else 0.0

    thresholds = PAUSE_THRESHOLDS.get(channel, {})
    breached_metric, actual_value, threshold_value = (
        _first_breach(thresholds, open_rate, click_rate)
        if sent_count > 0
        else (None, None, None)
    )
    outcome_status = (
        "insufficient_data" if sent_count == 0
        else "underperformed" if breached_metric
        else "met_threshold"
    )
    learning_signal = -1.0 if breached_metric else 1.0 if sent_count else 0.0
    factors = {
        "channel": channel,
        "sent_count": sent_count,
        "opened_count": opened_count,
        "clicked_count": clicked_count,
        "open_rate": open_rate,
        "click_rate": click_rate,
        "threshold_breached": breached_metric,
        "threshold_value": threshold_value,
    }
    outcome_id = _upsert_outcome(
        recommendation_id,
        organization_id,
        outcome_status,
        learning_signal,
        factors,
        db,
    )

    if not breached_metric:
        logger.info(
            "outcome_check_completed",
            extra={
                "recommendation_id": recommendation_id,
                "channel": channel,
                "status": outcome_status,
            },
        )
        return

    now = datetime.now(timezone.utc)
    reason = f"{breached_metric}_below_threshold"
    db.execute(
        text("""
            UPDATE recommendations
            SET status = 'paused',
                paused_at = :paused_at,
                pause_reason = :reason,
                updated_at = NOW()
            WHERE id = :recommendation_id
              AND organization_id = :organization_id
        """),
        {
            "recommendation_id": recommendation_id,
            "organization_id": organization_id,
            "paused_at": now,
            "reason": reason,
        },
    )
    _write_audit_log(
        recommendation_id,
        organization_id,
        channel,
        reason,
        factors,
        now,
        db,
    )
    _write_strategic_memory_reflection(
        recommendation_id,
        organization_id,
        channel,
        reason,
        actual_value,
        threshold_value,
        now,
        db,
    )
    _enqueue_retraining_signals(
        recommendation_id,
        outcome_id,
        organization_id,
        channel,
        factors,
        db,
    )
    logger.info(
        "recommendation_auto_paused",
        extra={
            "recommendation_id": recommendation_id,
            "channel": channel,
            "breached_metric": breached_metric,
        },
    )


def _load_delivery_metrics(recommendation_id: str, db):
    return db.execute(
        text("""
            WITH sends AS (
                SELECT id
                FROM sequence_sends
                WHERE recommendation_id = :recommendation_id
                  AND status IN ('sent', 'delivered')
            )
            SELECT
                (SELECT COUNT(*) FROM sends) AS sent_count,
                COUNT(DISTINCT sequence_send_id)
                    FILTER (WHERE event_type = 'opened') AS opened_count,
                COUNT(DISTINCT sequence_send_id)
                    FILTER (WHERE event_type = 'clicked') AS clicked_count
            FROM sequence_events
            WHERE sequence_send_id IN (SELECT id FROM sends)
        """),
        {"recommendation_id": recommendation_id},
    ).fetchone() or (0, 0, 0)


def _first_breach(
    thresholds: dict[str, float],
    open_rate: float,
    click_rate: float,
) -> tuple[str | None, float | None, float | None]:
    actuals = {"open_rate": open_rate, "click_rate": click_rate}
    for metric in ("open_rate", "click_rate"):
        threshold = thresholds.get(metric)
        if threshold is not None and actuals[metric] < threshold:
            return metric, actuals[metric], threshold
    return None, None, None


def _upsert_outcome(
    recommendation_id: str,
    organization_id: str,
    status: str,
    learning_signal: float,
    factors: dict,
    db,
) -> str:
    outcome_id = str(uuid.uuid4())
    row = db.execute(
        text("""
            INSERT INTO recommendation_outcomes (
                id, recommendation_id, organization_id, actual_result,
                measured_at, outcome_status, learning_signal,
                contributing_factors, should_repeat, created_at, updated_at
            ) VALUES (
                :id, :recommendation_id, :organization_id, :actual_result,
                NOW(), :outcome_status, :learning_signal,
                CAST(:factors AS JSONB), :should_repeat, NOW(), NOW()
            )
            ON CONFLICT (recommendation_id) DO UPDATE SET
                actual_result = EXCLUDED.actual_result,
                measured_at = EXCLUDED.measured_at,
                outcome_status = EXCLUDED.outcome_status,
                learning_signal = EXCLUDED.learning_signal,
                contributing_factors = EXCLUDED.contributing_factors,
                should_repeat = EXCLUDED.should_repeat,
                updated_at = NOW()
            RETURNING id
        """),
        {
            "id": outcome_id,
            "recommendation_id": recommendation_id,
            "organization_id": organization_id,
            "actual_result": status,
            "outcome_status": status,
            "learning_signal": learning_signal,
            "factors": json.dumps(factors),
            "should_repeat": status == "met_threshold",
        },
    ).fetchone()
    return str(row[0]) if row else outcome_id


def _write_audit_log(
    recommendation_id: str,
    organization_id: str,
    channel: str,
    reason: str,
    factors: dict,
    paused_at: datetime,
    db,
) -> None:
    context = {
        **factors,
        "channel": channel,
        "reason": reason,
        "paused_at": paused_at.isoformat(),
    }
    db.execute(
        text("""
            INSERT INTO audit_logs (
                id, organization_id, recommendation_id, entity_type,
                entity_id, action, context, created_at
            ) VALUES (
                :id, :organization_id, :recommendation_id,
                'recommendation', :recommendation_id, 'auto_paused',
                CAST(:context AS JSONB), :created_at
            )
        """),
        {
            "id": str(uuid.uuid4()),
            "organization_id": organization_id,
            "recommendation_id": recommendation_id,
            "context": json.dumps(context),
            "created_at": paused_at,
        },
    )


def _write_strategic_memory_reflection(
    recommendation_id: str,
    organization_id: str,
    channel: str,
    reason: str,
    actual_value: float | None,
    threshold: float | None,
    paused_at: datetime,
    db,
) -> None:
    payload = {
        "type": "recommendation_auto_paused",
        "recommendation_id": recommendation_id,
        "channel": channel,
        "reason": reason,
        "actual_value": actual_value,
        "threshold": threshold,
        "paused_at": paused_at.isoformat(),
    }
    db.execute(
        text("""
            INSERT INTO merchant_memories (
                id, organization_id, memory_type, memory_key, memory_value,
                memory_source, authority_level, confidence, importance,
                is_active, use_count, created_at, updated_at
            ) VALUES (
                :id, :organization_id, 'strategic', :memory_key,
                CAST(:memory_value AS JSONB), 'feedback_loop',
                2, 0.9, 4, TRUE, 0, NOW(), NOW()
            )
            ON CONFLICT (organization_id, memory_key) DO UPDATE SET
                memory_value = EXCLUDED.memory_value,
                confidence = EXCLUDED.confidence,
                is_active = TRUE,
                updated_at = NOW()
        """),
        {
            "id": str(uuid.uuid4()),
            "organization_id": organization_id,
            "memory_key": f"recommendation.{recommendation_id}.feedback",
            "memory_value": json.dumps(payload),
        },
    )


def _enqueue_retraining_signals(
    recommendation_id: str,
    outcome_id: str,
    organization_id: str,
    channel: str,
    factors: dict,
    db,
) -> None:
    for model_name in ("m1_abandonment", "m2_sensitivity"):
        db.execute(
            text("""
                INSERT INTO model_feedback_queue (
                    id, organization_id, recommendation_id,
                    recommendation_outcome_id, model_name, signal_type,
                    payload, status, idempotency_key,
                    attempt_count, created_at, updated_at
                ) VALUES (
                    :id, :organization_id, :recommendation_id,
                    :outcome_id, :model_name, 'negative',
                    CAST(:payload AS JSONB), 'pending', :idempotency_key,
                    0, NOW(), NOW()
                )
                ON CONFLICT (organization_id, idempotency_key) DO NOTHING
            """),
            {
                "id": str(uuid.uuid4()),
                "organization_id": organization_id,
                "recommendation_id": recommendation_id,
                "outcome_id": outcome_id,
                "model_name": model_name,
                "payload": json.dumps({"channel": channel, **factors}),
                "idempotency_key": f"{recommendation_id}:{model_name}:negative",
            },
        )


def _get_recommendation_organization(recommendation_id: str, db) -> str:
    organization_id = db.execute(
        text("""
            SELECT organization_id
            FROM recommendations
            WHERE id = :recommendation_id
            LIMIT 1
        """),
        {"recommendation_id": recommendation_id},
    ).scalar()
    if not organization_id:
        raise ValueError("Recommendation does not exist.")
    return str(organization_id)


def _require_feedback_persistence(db) -> None:
    for table_name in REQUIRED_FEEDBACK_TABLES:
        if not _table_exists(db, table_name):
            raise FeedbackPersistenceUnavailable(
                f"{table_name} is pending the backend Phase 2 migration."
            )
    for column_name in ("channel", "paused_at", "pause_reason", "outcome_checked_at"):
        _require_column(db, "recommendations", column_name)


def _require_column(db, table_name: str, column_name: str) -> None:
    exists = db.execute(
        text("""
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = :table_name
                  AND column_name = :column_name
            )
        """),
        {"table_name": table_name, "column_name": column_name},
    ).scalar()
    if not exists:
        raise FeedbackPersistenceUnavailable(
            f"{table_name}.{column_name} is pending the backend Phase 2 migration."
        )


def _table_exists(db, table_name: str) -> bool:
    return bool(
        db.execute(
            text("SELECT to_regclass(:table_name) IS NOT NULL"),
            {"table_name": f"public.{table_name}"},
        ).scalar()
    )
