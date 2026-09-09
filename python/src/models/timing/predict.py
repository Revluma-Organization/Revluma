"""Four-layer scheduling and inference for M3 optimal send time."""

from __future__ import annotations

import logging
import math
from datetime import datetime, time, timedelta, timezone
from typing import Any

import mlflow.pyfunc
import pandas as pd

from .train import (
    CART_VALUE_TIER_MAP,
    CHANNEL_MAP,
    FEATURE_COLUMNS,
    RECOVERY_ACTION_ALIASES,
    RECOVERY_ACTION_MAP,
)

logger = logging.getLogger("rev.m3.predict")

QUIET_START_HOUR = 22
QUIET_END_HOUR = 8
PERSONAL_HISTORY_MINIMUM = 3
PERSONAL_THRESHOLD = 0.55
PERSONAL_MAX_DELAY_HOURS = 18
GAUSSIAN_SIGMA_HOURS = 1.5

GLOBAL_BASELINES = {
    "email": (1, 10, 0),
    "sms": (3, 18, 30),
    "whatsapp": (3, 18, 30),
}


def load_model(merchant_id: str = "") -> Any:
    """Load the registered model without exposing registry error details."""
    try:
        model = mlflow.pyfunc.load_model("models:/send_time/Production")
        logger.info("m3_model_loaded", extra={"source": "registry"})
        return model
    except Exception as exc:
        logger.warning(
            "m3_model_load_failed",
            extra={"error_type": type(exc).__name__},
        )
        return None


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _timezone_for_offset(offset_hours: int) -> timezone:
    return timezone(timedelta(hours=max(-12, min(14, int(offset_hours)))))


def _outside_quiet_hours(local_datetime: datetime) -> bool:
    return QUIET_END_HOUR <= local_datetime.hour < QUIET_START_HOUR


def _move_outside_quiet_hours(candidate_utc: datetime, local_tz: timezone) -> datetime:
    local = candidate_utc.astimezone(local_tz)
    if _outside_quiet_hours(local):
        return candidate_utc
    if local.hour >= QUIET_START_HOUR:
        local = (local + timedelta(days=1)).replace(
            hour=QUIET_END_HOUR,
            minute=0,
            second=0,
            microsecond=0,
        )
    else:
        local = local.replace(
            hour=QUIET_END_HOUR,
            minute=0,
            second=0,
            microsecond=0,
        )
    return local.astimezone(timezone.utc)


def _respect_sms_interval(
    candidate_utc: datetime,
    channel: str,
    last_sms_sent_at: Any,
    local_tz: timezone,
) -> datetime:
    if channel != "sms":
        return candidate_utc
    last_sms = _parse_datetime(last_sms_sent_at)
    if last_sms is not None:
        candidate_utc = max(candidate_utc, last_sms + timedelta(hours=24))
    return _move_outside_quiet_hours(candidate_utc, local_tz)


def _next_global_baseline(
    now_utc: datetime,
    channel: str,
    local_tz: timezone,
) -> datetime:
    target_day, target_hour, target_minute = GLOBAL_BASELINES.get(
        channel,
        GLOBAL_BASELINES["email"],
    )
    local_now = now_utc.astimezone(local_tz)
    days_ahead = (target_day - local_now.weekday()) % 7
    target_date = (local_now + timedelta(days=days_ahead)).date()
    candidate = datetime.combine(
        target_date,
        time(target_hour, target_minute),
        tzinfo=local_tz,
    )
    if candidate <= local_now:
        candidate += timedelta(days=7)
    return candidate.astimezone(timezone.utc)


def _smooth_open_probabilities(values: Any) -> list[float] | None:
    if not isinstance(values, (list, tuple)) or len(values) != 24:
        return None
    try:
        probabilities = [min(max(float(value), 0.0), 1.0) for value in values]
    except (TypeError, ValueError):
        return None

    smoothed = []
    for target_hour in range(24):
        weighted_total = 0.0
        weight_sum = 0.0
        for source_hour, probability in enumerate(probabilities):
            distance = abs(target_hour - source_hour)
            circular_distance = min(distance, 24 - distance)
            weight = math.exp(
                -(circular_distance ** 2) / (2 * GAUSSIAN_SIGMA_HOURS ** 2)
            )
            weighted_total += probability * weight
            weight_sum += weight
        smoothed.append(weighted_total / weight_sum)
    return smoothed


def _next_personal_hour(
    now_utc: datetime,
    local_tz: timezone,
    smoothed_probabilities: list[float],
) -> tuple[datetime, float] | None:
    local_now = now_utc.astimezone(local_tz)
    first_candidate = local_now.replace(minute=0, second=0, microsecond=0)
    if first_candidate <= local_now:
        first_candidate += timedelta(hours=1)
    for hours_ahead in range(PERSONAL_MAX_DELAY_HOURS + 1):
        candidate = first_candidate + timedelta(hours=hours_ahead)
        delay = candidate.astimezone(timezone.utc) - now_utc
        if delay > timedelta(hours=PERSONAL_MAX_DELAY_HOURS):
            break
        probability = smoothed_probabilities[candidate.hour]
        if _outside_quiet_hours(candidate) and probability >= PERSONAL_THRESHOLD:
            return candidate.astimezone(timezone.utc), probability
    return None


def _model_candidate(
    model,
    now_utc: datetime,
    local_tz: timezone,
    channel: str,
    features: dict,
    smoothed_probabilities: list[float],
) -> tuple[datetime, float] | None:
    rows = []
    candidates = []
    local_now = now_utc.astimezone(local_tz)
    first_candidate = local_now.replace(minute=0, second=0, microsecond=0)
    if first_candidate <= local_now:
        first_candidate += timedelta(hours=1)

    action = str(features.get("recovery_action") or "SOFT_NUDGE").upper()
    action = RECOVERY_ACTION_ALIASES.get(action, action)
    tier = str(features.get("cart_value_tier") or "medium").lower()
    days_since_purchase = max(int(features.get("days_since_last_purchase", -1)), -1)
    for hours_ahead in range(PERSONAL_MAX_DELAY_HOURS + 1):
        local_candidate = first_candidate + timedelta(hours=hours_ahead)
        if local_candidate.astimezone(timezone.utc) - now_utc > timedelta(
            hours=PERSONAL_MAX_DELAY_HOURS
        ):
            break
        if not _outside_quiet_hours(local_candidate):
            continue
        candidates.append(local_candidate.astimezone(timezone.utc))
        rows.append(
            {
                "send_hour": local_candidate.hour,
                "send_day": local_candidate.weekday(),
                "channel": CHANNEL_MAP.get(channel, CHANNEL_MAP["email"]),
                "historical_open_rate": smoothed_probabilities[local_candidate.hour],
                "days_since_last_purchase": days_since_purchase,
                "cart_value_tier": CART_VALUE_TIER_MAP.get(
                    tier,
                    CART_VALUE_TIER_MAP["medium"],
                ),
                "recovery_action": RECOVERY_ACTION_MAP.get(
                    action,
                    RECOVERY_ACTION_MAP["SOFT_NUDGE"],
                ),
            }
        )
    if not rows:
        return None
    probabilities = model.predict_proba(pd.DataFrame(rows, columns=FEATURE_COLUMNS))[:, 1]
    best_index = int(probabilities.argmax())
    return candidates[best_index], float(probabilities[best_index])


def _cadence_candidate(
    now_utc: datetime,
    local_tz: timezone,
    channel: str,
    features: dict,
) -> tuple[datetime, str] | None:
    message_number = int(features.get("sequence_message_number", 1) or 1)
    if message_number not in {2, 3}:
        return None
    previous_sent = _parse_datetime(features.get("previous_message_sent_at"))
    if previous_sent is None:
        return None

    if message_number == 2:
        opened_without_click = bool(features.get("previous_message_opened")) and not bool(
            features.get("previous_message_clicked")
        )
        gap = timedelta(hours=36 if opened_without_click else 24)
    else:
        gap = timedelta(hours=48)
        channel = str(features.get("secondary_channel") or channel).lower()
        if channel not in CHANNEL_MAP:
            channel = "email"
    candidate = max(now_utc, previous_sent + gap)
    candidate = _move_outside_quiet_hours(candidate, local_tz)
    candidate = _respect_sms_interval(
        candidate,
        channel,
        features.get("last_sms_sent_at"),
        local_tz,
    )
    return candidate, channel


def _response(
    candidate_utc: datetime,
    local_tz: timezone,
    channel: str,
    confidence: float,
    reasoning_layer: str,
    fallback: bool,
) -> dict:
    return {
        "send_at": candidate_utc.astimezone(local_tz).isoformat(),
        "send_at_utc": candidate_utc.astimezone(timezone.utc).isoformat(),
        "confidence": min(max(float(confidence), 0.0), 1.0),
        "reasoning_layer": reasoning_layer,
        "channel": channel,
        "fallback": fallback,
    }


def predict(
    customer_id: str,
    feature_vector: dict,
    merchant_id: str,
    *,
    model=None,
    now: datetime | None = None,
) -> dict:
    """Return a valid D4 schedule using rules before optional model inference."""
    features = feature_vector or {}
    now_utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    offset = int(features.get("customer_timezone_offset", 0) or 0)
    local_tz = _timezone_for_offset(offset)
    channel = str(features.get("channel") or "email").lower()
    if channel not in CHANNEL_MAP:
        channel = "email"

    try:
        cadence = _cadence_candidate(now_utc, local_tz, channel, features)
        if cadence is not None:
            candidate, cadence_channel = cadence
            return _response(candidate, local_tz, cadence_channel, 1.0, "hybrid", False)

        if bool(features.get("failed_payment_attempt")):
            channel = "sms"
            candidate = _move_outside_quiet_hours(
                now_utc + timedelta(minutes=5),
                local_tz,
            )
            candidate = _respect_sms_interval(
                candidate,
                channel,
                features.get("last_sms_sent_at"),
                local_tz,
            )
            return _response(candidate, local_tz, channel, 1.0, "immediate", False)

        risk_score = float(features.get("risk_score", 0.0) or 0.0)
        tier = str(features.get("cart_value_tier") or "medium").lower()
        if risk_score >= 0.80 and tier in {"high", "premium"}:
            candidate = _move_outside_quiet_hours(
                now_utc + timedelta(minutes=8),
                local_tz,
            )
            candidate = _respect_sms_interval(
                candidate,
                channel,
                features.get("last_sms_sent_at"),
                local_tz,
            )
            return _response(candidate, local_tz, channel, 1.0, "immediate", False)

        history_points = int(features.get("history_data_points", 0) or 0)
        smoothed = _smooth_open_probabilities(
            features.get("historical_open_probabilities")
        )
        if history_points >= PERSONAL_HISTORY_MINIMUM and smoothed is not None:
            personal = _next_personal_hour(now_utc, local_tz, smoothed)
            if personal is not None:
                candidate, confidence = personal
                candidate = _respect_sms_interval(
                    candidate,
                    channel,
                    features.get("last_sms_sent_at"),
                    local_tz,
                )
                return _response(
                    candidate,
                    local_tz,
                    channel,
                    confidence,
                    "personalised",
                    False,
                )

            # The serving layer owns model loading and injects its startup cache.
            # Request-time registry calls would make latency depend on MLflow.
            active_model = model
            if active_model is not None:
                model_result = _model_candidate(
                    active_model,
                    now_utc,
                    local_tz,
                    channel,
                    features,
                    smoothed,
                )
                if model_result is not None:
                    candidate, confidence = model_result
                    candidate = _respect_sms_interval(
                        candidate,
                        channel,
                        features.get("last_sms_sent_at"),
                        local_tz,
                    )
                    return _response(
                        candidate,
                        local_tz,
                        channel,
                        confidence,
                        "hybrid",
                        False,
                    )
    except Exception as exc:
        logger.error(
            "m3_inference_failed",
            extra={"error_type": type(exc).__name__},
        )

    candidate = _next_global_baseline(now_utc, channel, local_tz)
    candidate = _respect_sms_interval(
        candidate,
        channel,
        features.get("last_sms_sent_at"),
        local_tz,
    )
    return _response(candidate, local_tz, channel, 0.0, "global_baseline", True)
