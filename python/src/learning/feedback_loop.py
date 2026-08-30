"""
Rev Intelligence -- Sub-1-Hour Feedback Loop for Cart Recovery (P3-A)
=======================================================================
Provides a fast-path feedback channel for time-sensitive campaign types.

Channel-specific windows:
  - cart_recovery_email: 45 minutes
  - cart_recovery_sms:   20 minutes
  - win_back_campaign:   48 hours
  - win_back_sequence:   7 days

When a scheduled check fires and performance is below threshold, the
variant is automatically paused, the event is written to audit_log,
a Strategic Memory reflection is created, and the model feedback queues
for M1 and M2 are updated.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

logger = logging.getLogger("rev.feedback_loop")

FEEDBACK_WINDOWS: dict[str, timedelta] = {
    "cart_recovery_email": timedelta(minutes=45),
    "cart_recovery_sms":   timedelta(minutes=20),
    "win_back_campaign":   timedelta(hours=48),
    "win_back_sequence":   timedelta(days=7),
}

PAUSE_THRESHOLDS: dict[str, dict] = {
    "cart_recovery_email": {"open_rate": 0.15, "click_rate": 0.03},
    "cart_recovery_sms":   {"click_rate": 0.05},
}


def schedule_outcome_check(recommendation_id: str, channel: str, sent_at: datetime, db) -> None:
    window = FEEDBACK_WINDOWS.get(channel, timedelta(hours=48))
    check_at = sent_at + window
    db.execute(
        text("""
            INSERT INTO scheduled_outcome_checks (recommendation_id, channel, check_at, created_at)
            VALUES (:rid, :ch, :cat, NOW())
            ON CONFLICT (recommendation_id) DO NOTHING
        """),
        {"rid": recommendation_id, "ch": channel, "cat": check_at},
    )
    db.commit()
    logger.info("outcome_check_scheduled", extra={
        "recommendation_id": recommendation_id,
        "channel": channel,
        "check_at": check_at.isoformat(),
    })


def run_due_outcome_checks(db) -> int:
    due = db.execute(
        text("SELECT recommendation_id, channel FROM scheduled_outcome_checks WHERE check_at <= NOW() AND processed_at IS NULL"),
    ).fetchall()
    processed = 0
    for row in due:
        try:
            _evaluate_outcome(str(row[0]), row[1], db)
            db.execute(
                text("UPDATE scheduled_outcome_checks SET processed_at = NOW() WHERE recommendation_id = :rid"),
                {"rid": str(row[0])},
            )
            db.commit()
            processed += 1
        except Exception as e:
            logger.error("outcome_check_failed", extra={"recommendation_id": str(row[0]), "error": str(e)}, exc_info=True)
    return processed


def _evaluate_outcome(recommendation_id: str, channel: str, db) -> None:
    thresholds = PAUSE_THRESHOLDS.get(channel)
    if not thresholds:
        return

    row = db.execute(
        text("SELECT open_rate, click_rate FROM campaign_metrics WHERE recommendation_id = :rid LIMIT 1"),
        {"rid": recommendation_id},
    ).fetchone()

    if not row:
        logger.warning("no_metrics_found", extra={"recommendation_id": recommendation_id})
        return

    actual_open_rate = float(row[0] or 0)
    actual_click_rate = float(row[1] or 0)

    breached_metric = None
    breached_value = None
    threshold_value = None

    if "open_rate" in thresholds and actual_open_rate < thresholds["open_rate"]:
        breached_metric, breached_value, threshold_value = "open_rate", actual_open_rate, thresholds["open_rate"]
    elif "click_rate" in thresholds and actual_click_rate < thresholds["click_rate"]:
        breached_metric, breached_value, threshold_value = "click_rate", actual_click_rate, thresholds["click_rate"]

    if not breached_metric:
        logger.info("outcome_check_passed", extra={"recommendation_id": recommendation_id, "channel": channel})
        return

    now = datetime.now(timezone.utc)

    db.execute(
        text("UPDATE campaign_recommendations SET status='paused', paused_at=:now, pause_reason=:reason WHERE id=:rid"),
        {"rid": recommendation_id, "now": now, "reason": f"{breached_metric}_below_threshold"},
    )

    db.execute(
        text("""
            INSERT INTO audit_log (entity_type, entity_id, action, context, created_at)
            VALUES ('campaign_recommendation', :rid, 'auto_paused', :ctx, :now)
        """),
        {"rid": recommendation_id, "now": now, "ctx": json.dumps({
            "channel": channel, "open_rate": actual_open_rate, "click_rate": actual_click_rate,
            "threshold_breached": breached_metric, "threshold_value": threshold_value,
            "paused_at": now.isoformat(),
        })},
    )
    db.commit()

    _write_strategic_memory_reflection(recommendation_id, channel, breached_metric, breached_value, threshold_value, now, db)
    _enqueue_retraining_signal(recommendation_id, channel, db)

    logger.info("variant_paused", extra={
        "recommendation_id": recommendation_id, "channel": channel,
        "breached_metric": breached_metric, "actual_value": breached_value, "threshold": threshold_value,
    })


def _write_strategic_memory_reflection(recommendation_id, channel, reason, actual_value, threshold, paused_at, db):
    db.execute(
        text("""
            INSERT INTO strategic_memory (memory_type, payload, created_at, updated_at)
            VALUES ('campaign_paused', :payload, NOW(), NOW())
        """),
        {"payload": json.dumps({
            "type": "campaign_paused", "recommendation_id": recommendation_id,
            "channel": channel, "reason": f"{reason}_below_threshold",
            "actual_value": actual_value, "threshold": threshold,
            "paused_at": paused_at.isoformat(),
        })},
    )
    db.commit()


def _enqueue_retraining_signal(recommendation_id: str, channel: str, db) -> None:
    for model in ("m1_abandonment", "m2_sensitivity"):
        db.execute(
            text("INSERT INTO model_feedback_queue (model_name, signal_type, recommendation_id, created_at) VALUES (:m, 'negative', :rid, NOW())"),
            {"m": model, "rid": recommendation_id},
        )
    db.commit()
