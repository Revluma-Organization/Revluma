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
import os
from datetime import datetime, timedelta, timezone
 
logger = logging.getLogger("revluma.learning.feedback_loop")
 
# ---------------------------------------------------------------------------
# Evaluation windows (task doc, verbatim): campaigns 48h, sequences 7d,
# win-back sequences 14d.
# ---------------------------------------------------------------------------
EVALUATION_WINDOWS = {
    "campaign": timedelta(hours=48),
    "sequence": timedelta(days=7),
    "winback": timedelta(days=14),
}
DEFAULT_EVALUATION_WINDOW = EVALUATION_WINDOWS["sequence"]
 
OUTCOME_METRIC_KEYS = ("open_rate", "click_rate", "conversion_rate", "revenue_impact")
 
 
def _parse_timestamp(ts) -> datetime | None:
    """Safe timestamp parser — accepts a datetime, an ISO8601 string
    (with or without trailing 'Z'), or None. Never raises."""
    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    if not ts or not isinstance(ts, str):
        return None
    try:
        normalized = ts[:-1] + "+00:00" if ts.endswith("Z") else ts
        parsed = datetime.fromisoformat(normalized)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None
 
 
def is_due_for_evaluation(recommendation_type: str, executed_at, now: datetime = None) -> tuple[bool, datetime | None]:
    """
    Determines whether a recommendation's evaluation window has elapsed.
 
    Args:
        recommendation_type: "campaign" | "sequence" | "winback". Unknown
            types safely fall back to the "sequence" (7-day) window rather
            than raising — flagged via a warning log, not an exception.
        executed_at: datetime or ISO8601 string of when the recommendation
            was executed/sent.
        now: override for "current time" (testability). Defaults to
            datetime.now(timezone.utc).
 
    Returns:
        (is_due: bool, due_at: datetime | None) — due_at is None only when
        executed_at could not be parsed.
    """
    now = now or datetime.now(timezone.utc)
    window = EVALUATION_WINDOWS.get(recommendation_type)
    if window is None:
        logger.warning(
            f"Unknown recommendation_type '{recommendation_type}' — "
            f"falling back to the 'sequence' (7-day) evaluation window."
        )
        window = DEFAULT_EVALUATION_WINDOW
 
    executed_dt = _parse_timestamp(executed_at)
    if executed_dt is None:
        return False, None
 
    due_at = executed_dt + window
    return now >= due_at, due_at
 
 
def compute_prediction_errors(predicted: dict, observed: dict) -> dict:
    """
    Compares predicted vs observed outcome metrics and computes a
    normalised learning signal. See module docstring point 3 for the
    formula rationale.
 
    Args:
        predicted: {"open_rate", "click_rate", "conversion_rate", "revenue_impact"}
        observed : same shape, from real orders/events data
 
    Returns:
        dict: {
            "errors"            : {metric: abs_error, ...},
            "largest_error_step": str,   # metric name with the biggest miss
            "learning_signal"   : float, # 0.0-1.0, proportional to error magnitude
        }
    """
    if not isinstance(predicted, dict):
        predicted = {}
    if not isinstance(observed, dict):
        observed = {}
 
    errors = {}
    for key in OUTCOME_METRIC_KEYS:
        p = predicted.get(key, 0.0) or 0.0
        o = observed.get(key, 0.0) or 0.0
        try:
            errors[key] = abs(float(p) - float(o))
        except (TypeError, ValueError):
            errors[key] = 0.0
 
    largest_error_step = max(errors, key=errors.get) if errors else "unknown"
 
    rate_errors = [errors["open_rate"], errors["click_rate"], errors["conversion_rate"]]
    rate_component = sum(rate_errors) / len(rate_errors) if rate_errors else 0.0
 
    observed_revenue = observed.get("revenue_impact", 0.0) or 0.0
    revenue_baseline = abs(float(observed_revenue)) if observed_revenue else 100.0
    revenue_component = min(1.0, errors["revenue_impact"] / revenue_baseline)
 
    learning_signal = round(min(1.0, max(0.0, (rate_component + revenue_component) / 2.0)), 4)
 
    return {
        "errors": errors,
        "largest_error_step": largest_error_step,
        "learning_signal": learning_signal,
    }
 
 
def _write_strategic_memory_entry(entry: dict, db) -> bool:
    """
    Writes a reflection entry to the `strategic_memory` table.
 
    Schema assumed (flagged gap, see module docstring point 1):
        strategic_memory(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            merchant_id UUID,
            recommendation_id TEXT,
            entry_type TEXT,          -- 'reflection' for this file's writes
            payload JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
 
    Never raises — returns False on any failure (missing table, no db,
    serialization error) so a memory-write failure never blocks the
    learning signal from still reaching the feedback queue.
    """
    if db is None:
        logger.warning("No DB connection provided — strategic_memory entry not persisted.")
        return False
 
    try:
        with db.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO strategic_memory
                    (merchant_id, recommendation_id, entry_type, payload, created_at)
                VALUES (%s, %s, %s, %s, NOW())
                """,
                (
                    entry.get("merchant_id"),
                    entry.get("recommendation_id"),
                    "reflection",
                    json.dumps(entry, default=str),
                ),
            )
        db.commit()
        return True
    except Exception as e:
        logger.warning(f"Failed to write strategic_memory entry: {e}")
        return False
 
 
def _enqueue_retraining_signal(model_name: str, learning_signal: float, context: dict) -> bool:
    """
    Pushes a learning signal onto the model's retraining feedback queue
    via Redis LPUSH (see module docstring point 2). Never raises.
    """
    redis_url = os.getenv("REDIS_URL")
    if not redis_url:
        logger.warning(
            f"REDIS_URL not configured — learning signal for '{model_name}' "
            f"was computed but not enqueued: {learning_signal}"
        )
        return False
 
    try:
        import redis
        client = redis.from_url(redis_url, socket_connect_timeout=2)
        payload = json.dumps({
            "model_name": model_name,
            "learning_signal": learning_signal,
            "context": context,
            "enqueued_at": datetime.now(timezone.utc).isoformat(),
        }, default=str)
        client.lpush(f"model_feedback_queue:{model_name}", payload)
        return True
    except Exception as e:
        logger.warning(f"Failed to enqueue learning signal for '{model_name}': {e}")
        return False
 
 
def run_outcome_monitor(recommendation: dict, observed_outcome: dict, db=None, now: datetime = None) -> dict:
    """
    Main entrypoint. Evaluates a single executed recommendation against
    its real observed outcome, IF the evaluation window has elapsed.
 
    Args:
        recommendation: {
            "recommendation_id" : str,
            "recommendation_type": "campaign" | "sequence" | "winback",
            "executed_at"        : datetime | ISO8601 str,
            "model_name"         : str,  # e.g. "send_time", "sensitivity", "offer_value"
            "merchant_id"        : str,
            "predicted_outcome"  : {"open_rate", "click_rate", "conversion_rate", "revenue_impact"},
        }
        observed_outcome: same 4-key shape, from real orders/events data.
        db: database connection for the Strategic Memory write (optional).
        now: override for "current time" (testability).
 
    Returns:
        dict: {"status": "not_due"} | {"status": "evaluated", ...full reflection...}
              | {"status": "error", "reason": str}
        Never raises.
    """
    try:
        if not isinstance(recommendation, dict):
            return {"status": "error", "reason": "recommendation is not a dict"}
 
        recommendation_type = recommendation.get("recommendation_type", "sequence")
        executed_at = recommendation.get("executed_at")
 
        due, due_at = is_due_for_evaluation(recommendation_type, executed_at, now)
        if due_at is None:
            return {"status": "error", "reason": "executed_at could not be parsed"}
        if not due:
            return {
                "status": "not_due",
                "recommendation_id": recommendation.get("recommendation_id"),
                "due_at": due_at.isoformat(),
            }
 
        predicted = recommendation.get("predicted_outcome", {})
        result = compute_prediction_errors(predicted, observed_outcome)
 
        model_name = recommendation.get("model_name", "unknown")
        reflection = {
            "recommendation_id": recommendation.get("recommendation_id"),
            "recommendation_type": recommendation_type,
            "merchant_id": recommendation.get("merchant_id"),
            "model_name": model_name,
            "predicted_outcome": predicted,
            "observed_outcome": observed_outcome,
            "errors": result["errors"],
            "largest_error_step": result["largest_error_step"],
            "learning_signal": result["learning_signal"],
            "narrative": (
                f"Predicted vs observed outcome for recommendation "
                f"{recommendation.get('recommendation_id')} ({model_name}): "
                f"largest miss was '{result['largest_error_step']}' "
                f"(|error|={result['errors'][result['largest_error_step']]:.4f}). "
                f"Learning signal {result['learning_signal']} queued for retraining."
            ),
            "evaluated_at": (now or datetime.now(timezone.utc)).isoformat(),
        }
 
        memory_write_ok = _write_strategic_memory_entry(reflection, db)
        queue_ok = _enqueue_retraining_signal(
            model_name, result["learning_signal"],
            context={"recommendation_id": recommendation.get("recommendation_id"),
                      "largest_error_step": result["largest_error_step"]},
        )
 
        return {
            "status": "evaluated",
            **reflection,
            "memory_write_ok": memory_write_ok,
            "queue_ok": queue_ok,
        }
 
    except Exception as e:
        logger.warning(f"run_outcome_monitor failed: {e}")
        return {"status": "error", "reason": str(e)}
 
 
def run_outcome_monitor_for_pending(pending_recommendations: list, observed_outcomes: dict, db=None, now: datetime = None) -> dict:
    """
    Batch entrypoint — intended to be invoked by a scheduled cron job.
    Continues processing on per-recommendation failure, matching the
    "never abort the batch" pattern used by rfm_sync.py.
 
    Args:
        pending_recommendations: list of recommendation dicts (see
            run_outcome_monitor's docstring for shape).
        observed_outcomes: dict keyed by recommendation_id -> observed
            outcome dict. Recommendations with no matching entry are
            skipped (counted as "no_observed_data"), not errored.
        db: database connection, passed through to each evaluation.
        now: override for "current time" (testability).
 
    Returns:
        dict: {"evaluated": int, "not_due": int, "no_observed_data": int,
               "errors": int, "results": list[dict]}
    """
    summary = {"evaluated": 0, "not_due": 0, "no_observed_data": 0, "errors": 0, "results": []}
 
    if not isinstance(pending_recommendations, list):
        return summary
 
    for rec in pending_recommendations:
        try:
            rec_id = rec.get("recommendation_id") if isinstance(rec, dict) else None
            observed = observed_outcomes.get(rec_id) if isinstance(observed_outcomes, dict) else None
            if observed is None:
                summary["no_observed_data"] += 1
                continue
 
            result = run_outcome_monitor(rec, observed, db=db, now=now)
            summary["results"].append(result)
            status = result.get("status")
            if status == "evaluated":
                summary["evaluated"] += 1
            elif status == "not_due":
                summary["not_due"] += 1
            else:
                summary["errors"] += 1
        except Exception as e:
            logger.warning(f"Per-recommendation failure in outcome monitor batch: {e}")
            summary["errors"] += 1
            continue
 
    return summary
 
 
if __name__ == "__main__":
    print("Revluma Learning Loop — Outcome Monitor. Intended to be invoked by a "
          "scheduler (see run_outcome_monitor_for_pending) against real "
          "recommendation + orders/events data, not run standalone.")