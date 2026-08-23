"""
M3 — Optimal Send-Time Predictor: Inference Script
====================================================
Runs at message send time, per customer, per recovery event.
Determines the single best hour + day to send a recovery message
and which channel to prioritise.

Failsafe: if model unavailable or inference fails for any reason,
returns a safe default with fallback=True. Never raises.
"""

import os
import logging
import typing
from datetime import datetime, timezone, timedelta

import mlflow.pyfunc

logger = logging.getLogger("rev.m3.predict")

# ── Channel constants (must match CHANNEL_MAP in train.py) ────────────────────
CHANNEL_IDX_TO_NAME = {0: "email", 1: "sms", 2: "whatsapp"}

# ── Fallback defaults ─────────────────────────────────────────────────────────
# Used when the model is unavailable.
# Research consensus: 10am local is the safest default send time.
FALLBACK_HOUR           = 10
FALLBACK_DAY_OFFSET     = 0     # Today
FALLBACK_CHANNEL        = "email"
FALLBACK_WINDOW_HOURS   = 2     # Window is always 2 hours wide per spec


def load_model(merchant_id: str) -> typing.Any:
    """
    Loads the trained M3 model from MLflow model registry or local store.

    Args:
        merchant_id (str): UUID of the merchant.

    Returns:
        Loaded sklearn pipeline, or None on failure.
    """
    try:
        model = mlflow.pyfunc.load_model("models:/send_time/Production")
        logger.info("m3_model_loaded", extra={"source": "registry", "merchant_id": merchant_id})
        return model
    except Exception as registry_err:
        logger.warning("m3_registry_unavailable", extra={"error": str(registry_err)})

    try:
        local_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "../../../../mlruns")
        )
        model = mlflow.pyfunc.load_model(f"file://{local_path}/0/latest/artifacts/m3_timing_model")
        logger.info("m3_model_loaded", extra={"source": "local", "merchant_id": merchant_id})
        return model
    except Exception as local_err:
        logger.error("m3_model_load_failed", extra={"error": str(local_err)})
        return None


def _build_send_window(optimal_hour: int, day_offset: int) -> tuple[str, str]:
    """
    Builds the ISO 8601 send window start and end strings.

    Window is always 2 hours wide per spec.

    Args:
        optimal_hour (int): Best local hour (0–23).
        day_offset (int): 0 = today, 1 = tomorrow, 2 = day after.

    Returns:
        tuple: (send_window_start, send_window_end) as ISO strings.
    """
    now = datetime.now(tz=timezone.utc)
    target_date = now + timedelta(days=day_offset)
    start = target_date.replace(hour=optimal_hour, minute=0, second=0, microsecond=0)
    end   = start + timedelta(hours=FALLBACK_WINDOW_HOURS)
    return start.isoformat(), end.isoformat()


def _score_all_windows(model, base_features: dict) -> tuple[int, int, str, float]:
    """
    Scores all 24-hour × 3-day × 3-channel combinations and returns the best.

    Brute-forces all 216 combinations (24h × 3 days × 3 channels), scores
    each with the M3 model, and returns the combination with the highest
    predicted conversion probability.

    This approach is intentionally exhaustive rather than a single-point
    prediction because M3 must answer "when is the BEST time?" not just
    "will this specific time work?". Latency is acceptable because 216
    small predict_proba calls on a shallow GBM take well under 10ms.

    Args:
        model: Loaded sklearn model with predict_proba method.
        base_features (dict): Non-time features from the request.

    Returns:
        tuple: (best_hour, best_day_offset, best_channel_name, best_confidence)
    """
    import pandas as pd

    # CHANNEL_MAP from train.py: email=0, sms=1, whatsapp=2
    recovery_action = base_features.get("recovery_action", 4)       # int-encoded
    cart_value_tier = base_features.get("cart_value_tier", 1)       # int-encoded
    tz_offset       = base_features.get("customer_timezone_offset", 0)

    best_score    = -1.0
    best_hour     = FALLBACK_HOUR
    best_day      = FALLBACK_DAY_OFFSET
    best_channel  = FALLBACK_CHANNEL

    for day_offset in range(3):
        for hour in range(24):
            for ch_idx, ch_name in CHANNEL_IDX_TO_NAME.items():
                row = pd.DataFrame([{
                    "local_hour_of_session":    hour,
                    "day_of_week_session":      (datetime.now(tz=timezone.utc).weekday() + day_offset) % 7,
                    "channel":                  ch_idx,
                    "recovery_action":          recovery_action,
                    "cart_value_tier":          cart_value_tier,
                    "customer_timezone_offset": tz_offset,
                }])
                score = model.predict_proba(row)[0][1]  # P(conversion)
                if score > best_score:
                    best_score   = score
                    best_hour    = hour
                    best_day     = day_offset
                    best_channel = ch_name

    return best_hour, best_day, best_channel, float(best_score)


def predict(
    customer_id: str,
    feature_vector: dict,
    merchant_id: str,
) -> dict:
    """
    Predicts the optimal hour and day to send a recovery message.

    Scores all 216 hour/day/channel combinations and returns the one
    with the highest predicted conversion probability. Output schema
    matches the 7-field spec from the D4 implementation plan exactly.

    Args:
        customer_id    (str) : UUID of the customer.
        feature_vector (dict): Session + customer timing features:
            {
                "local_hour_of_session"     : int,   # 0–23
                "day_of_week_session"       : int,   # 0=Monday
                "recovery_action"           : int,   # int-encoded (CHANNEL_MAP)
                "cart_value_tier"           : int,   # 0=low,1=med,2=high
                "customer_timezone_offset"  : int,   # UTC offset in hours
            }
        merchant_id (str): UUID of the merchant.

    Returns:
        dict: {
            "optimal_send_hour"      : int,    # 0–23 local hour
            "optimal_send_day_offset": int,    # 0=today, 1=tomorrow, 2=day after
            "channel_priority"       : str,    # "email" | "sms" | "whatsapp"
            "confidence"             : float,  # 0.0–1.0
            "send_window_start"      : str,    # ISO timestamp
            "send_window_end"        : str,    # ISO timestamp (window = 2 hours)
            "fallback"               : bool,   # True if model unavailable
        }
    """
    try:
        model = load_model(merchant_id)
        if model is None:
            raise RuntimeError("Model unavailable — activating failsafe.")

        best_hour, best_day, best_channel, confidence = _score_all_windows(
            model, feature_vector
        )
        window_start, window_end = _build_send_window(best_hour, best_day)

        return {
            "optimal_send_hour":       best_hour,
            "optimal_send_day_offset": best_day,
            "channel_priority":        best_channel,
            "confidence":              confidence,
            "send_window_start":       window_start,
            "send_window_end":         window_end,
            "fallback":                False,
        }

    except Exception as err:
        # ── Failsafe ─────────────────────────────────────────────────────────
        # Spec: if model unavailable, return send_window_start = now + 1 hour,
        # optimal_send_hour = current hour + 1, fallback = True.
        logger.error(
            "m3_inference_failsafe_activated",
            extra={"customer_id": customer_id, "merchant_id": merchant_id, "error": str(err)},
        )
        now          = datetime.now(tz=timezone.utc)
        fallback_dt  = now + timedelta(hours=1)
        window_end   = fallback_dt + timedelta(hours=FALLBACK_WINDOW_HOURS)
        return {
            "optimal_send_hour":       fallback_dt.hour,
            "optimal_send_day_offset": 0,
            "channel_priority":        FALLBACK_CHANNEL,
            "confidence":              0.0,
            "send_window_start":       fallback_dt.isoformat(),
            "send_window_end":         window_end.isoformat(),
            "fallback":                True,
        }
