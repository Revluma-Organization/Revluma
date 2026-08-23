"""
M1 — Abandonment Probability Predictor: Inference Script
=========================================================
Runs every 60 seconds on all active checkout sessions.
When score exceeds abandonment threshold, triggers exit-intent
intervention via the Recovery Queue → Channel Dispatcher.

3-Phase Scoring System
-----------------------
Phase 1: Real-time risk scoring — base_risk from model + 6 boost modifiers.
Phase 2: Intervention decision — thresholds determine what fires.
Phase 3: Pre-abandonment monitoring — low-risk sessions are watched silently.

Failsafe: if model unavailable or inference fails for any reason,
returns {"final_risk_score": 0.50, "intervention_window": 60, "fallback": True}.
Never raises. Never returns a 500 from the serving endpoint.
"""

import os
import logging
import pickle
import typing

import mlflow.pyfunc

logger = logging.getLogger("rev.m1.predict")

# ── Thresholds ────────────────────────────────────────────────────────────────
ABANDONED_THRESHOLD   = 0.65   # Phase 2 upper zone — trigger M2 + email/SMS
YELLOW_THRESHOLD      = 0.55   # Phase 2 lower zone — in-session signals only
MONITOR_THRESHOLD     = 0.35   # Phase 3 — log and watch
# Below MONITOR_THRESHOLD → no action, normal browsing.

# ── Boost modifiers (all additive on top of base_risk) ────────────────────────
BOOST_FAILED_PAYMENT         = +0.18
BOOST_CHECKOUT_STALL         = +0.12   # step >= 4 AND stall > 120s
BOOST_CURSOR_HESITATION      = +0.10   # hesitation_count >= 2
BOOST_TAB_SWITCH             = +0.09   # switches >= 3 AND total_hidden_ms > 60s
BOOST_CART_REMOVE            = +0.08   # remove_count >= 1
DISCOUNT_RETURN_RECOVERED    = -0.10   # return visitor who responded to past recovery


def load_model(merchant_id: str) -> typing.Any:
    """
    Loads the trained M1 model for a specific merchant from MLflow
    model registry or local artifact store.

    Tries the MLflow model registry first (production path). Falls back
    to the local mlruns artifact store if the registry is unavailable.
    Returns None if neither path succeeds — the caller must handle None
    gracefully and activate the failsafe path.

    Args:
        merchant_id (str): UUID of the merchant (models are per-merchant in Phase 3;
                           in Phase 1 a shared model is used for all merchants).

    Returns:
        Loaded sklearn pipeline (scaler + logistic regression), or None on failure.
    """
    try:
        model = mlflow.pyfunc.load_model(f"models:/abandonment/Production")
        logger.info("m1_model_loaded", extra={"source": "registry", "merchant_id": merchant_id})
        return model
    except Exception as registry_err:
        logger.warning("m1_registry_unavailable", extra={"error": str(registry_err)})

    # Fallback: local mlruns artifact (dev / pre-registry path)
    try:
        local_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "../../../../mlruns")
        )
        model = mlflow.pyfunc.load_model(f"file://{local_path}/0/latest/artifacts/model")
        logger.info("m1_model_loaded", extra={"source": "local", "merchant_id": merchant_id})
        return model
    except Exception as local_err:
        logger.error("m1_model_load_failed", extra={"error": str(local_err)})
        return None


def _compute_boosts(session_context: dict) -> float:
    """
    Computes the sum of all additive boost modifiers for a session.

    Each modifier is defined in the Phase 1 spec. All 6 conditions are
    checked independently and their values summed — they are NOT mutually
    exclusive. The result is added to base_risk before clamping.

    Args:
        session_context (dict): Extended session signals beyond the 7 base features.
            Expected keys (all optional — missing keys default safely):
                failed_payment_attempt      (bool)
                checkout_step_reached       (int)
                checkout_stall_duration_sec (float)
                cursor_hesitation_count     (int)
                tab_switch_count            (int)
                total_hidden_ms             (float)
                cart_item_remove_count      (int)
                is_return_visitor           (bool)
                previous_recovery_response  (bool)

    Returns:
        float: Total boost delta (can be negative).
    """
    boost = 0.0

    if session_context.get("failed_payment_attempt", False):
        boost += BOOST_FAILED_PAYMENT

    if (session_context.get("checkout_step_reached", 0) >= 4
            and session_context.get("checkout_stall_duration_sec", 0) > 120):
        boost += BOOST_CHECKOUT_STALL

    if session_context.get("cursor_hesitation_count", 0) >= 2:
        boost += BOOST_CURSOR_HESITATION

    if (session_context.get("tab_switch_count", 0) >= 3
            and session_context.get("total_hidden_ms", 0) > 60000):
        boost += BOOST_TAB_SWITCH

    if session_context.get("cart_item_remove_count", 0) >= 1:
        boost += BOOST_CART_REMOVE

    if (session_context.get("is_return_visitor", False)
            and session_context.get("previous_recovery_response", False)):
        boost += DISCOUNT_RETURN_RECOVERED

    return boost


def _decide_intervention(final_risk: float, session_context: dict) -> dict:
    """
    Phase 2 & 3 decision tree.

    Maps the final_risk_score to one of four intervention tiers defined
    in the spec. Computes intervention_window_seconds for the ABANDONED
    tier based on exit speed and hesitation signals.

    Args:
        final_risk (float): Clamped score from 0.0 to 1.0.
        session_context (dict): Same dict passed to _compute_boosts.

    Returns:
        dict: Intervention decision fields to merge into the predict() result.
    """
    if final_risk >= ABANDONED_THRESHOLD:
        # Intervention window: shorter window if high hesitation + fast exit
        hesitation = session_context.get("cursor_hesitation_count", 0)
        base_window = 60  # seconds
        window = max(15, base_window - (hesitation * 10))
        return {
            "intervention_tier": "abandoned",
            "intervention_window_seconds": window,
            "trigger_m2": True,
            "in_session_signals": True,
        }

    if final_risk >= YELLOW_THRESHOLD:
        # Yellow zone: only in-session signals, no email/SMS yet
        return {
            "intervention_tier": "yellow",
            "intervention_window_seconds": None,
            "trigger_m2": False,
            "in_session_signals": True,   # social proof, urgency, 1-click payment
        }

    if final_risk >= MONITOR_THRESHOLD:
        return {
            "intervention_tier": "monitor",
            "intervention_window_seconds": None,
            "trigger_m2": False,
            "in_session_signals": False,
        }

    return {
        "intervention_tier": "none",
        "intervention_window_seconds": None,
        "trigger_m2": False,
        "in_session_signals": False,
    }


def predict(
    feature_vector: dict,
    merchant_id: str,
    session_context: typing.Optional[dict] = None,
) -> dict:
    """
    Scores a single live session for abandonment probability.

    Implements the full 3-phase scoring system from the D3 spec:
      Phase 1 — real-time base_risk + 6 boost modifiers → final_risk_score
      Phase 2 — intervention decision (abandoned / yellow zone)
      Phase 3 — pre-abandonment monitoring

    The failsafe path is always active: any exception at any point returns
    a safe neutral score of 0.50 with fallback=True. This function must
    never raise and must never cause the serving endpoint to return 5xx.

    Args:
        feature_vector (dict): The 7 M1 features from the feature store:
            {
                "scroll_depth_pct"       : float,
                "tab_switch_count"       : int,
                "time_on_page_ms"        : int,
                "checkout_step_reached"  : int,
                "failed_payment_attempt" : bool,
                "cart_item_add_count"    : int,
                "cart_item_remove_count" : int,
            }
        merchant_id (str): UUID of the merchant.
        session_context (dict | None): Extended session signals for boost
            modifiers and intervention window calculation. Missing keys are
            handled gracefully with safe defaults.

    Returns:
        dict: {
            "final_risk_score"           : float,   # 0.0–1.0, clamped
            "base_risk"                  : float,   # raw model output
            "boost_applied"              : float,   # total modifier delta
            "intervention_tier"          : str,     # abandoned|yellow|monitor|none
            "intervention_window_seconds": int|None,
            "trigger_m2"                 : bool,
            "in_session_signals"         : bool,
            "fallback"                   : bool,    # True if failsafe activated
            "model_version"              : str,
        }
    """
    ctx = session_context or {}

    try:
        model = load_model(merchant_id)
        if model is None:
            raise RuntimeError("Model unavailable — activating failsafe.")

        import pandas as pd
        feature_order = [
            "scroll_depth_pct",
            "tab_switch_count",
            "time_on_page_ms",
            "checkout_step_reached",
            "failed_payment_attempt",
            "cart_item_add_count",
            "cart_item_remove_count",
        ]
        X = pd.DataFrame([{col: feature_vector.get(col, 0) for col in feature_order}])
        proba = model.predict_proba(X)[0][1]  # P(abandoned=1)

        boost   = _compute_boosts(ctx)
        final   = float(max(0.0, min(1.0, proba + boost)))
        decision = _decide_intervention(final, ctx)

        return {
            "final_risk_score":            final,
            "base_risk":                   float(proba),
            "boost_applied":               float(boost),
            "fallback":                    False,
            "model_version":               "m1-v1.0",
            **decision,
        }

    except Exception as err:
        # ── Failsafe ─────────────────────────────────────────────────────────
        # Spec: "if model unavailable or inference fails, return
        # final_risk_score = 0.50, intervention_window = 60, fallback = True.
        # Never crash. Never return a 500 from the serving endpoint."
        logger.error(
            "m1_inference_failsafe_activated",
            extra={"merchant_id": merchant_id, "error": str(err)},
        )
        return {
            "final_risk_score":            0.50,
            "base_risk":                   0.50,
            "boost_applied":               0.0,
            "intervention_tier":           "monitor",
            "intervention_window_seconds": 60,
            "trigger_m2":                  False,
            "in_session_signals":          False,
            "fallback":                    True,
            "model_version":               "failsafe",
        }
