"""
M2 — Shopper Sensitivity Classifier: Inference Script
======================================================
Loads the three PSS/CSS/TSS models trained by train.py, scores a shopper's
feature vector, and applies the 9-condition Recovery Action Matrix to
decide the recovery_action, classification, and channel_priority.

Never raises. Any load or inference failure returns the fallback response
(pss=css=tss=50, classification="ambiguous", recovery_action="SOFT_NUDGE")
with fallback=True — consistent with the "never return a 500 / never crash
the batch" pattern used across every other model's predict.py in this repo.
"""

from __future__ import annotations

import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))

# This ordered 13-column contract is shared with train.py.
FEATURE_COLUMNS = [
    "past_orders_with_coupon_pct",
    "visited_coupon_page",
    "searched_discount_terms",
    "cart_item_remove_count",
    "coupon_field_visited",
    "abandoned_at_shipping_reveal",
    "checkout_step_reached",
    "cursor_hesitation",
    "time_on_page_ms",
    "failed_payment_attempt",
    "failed_payment_count",
    "is_return_visitor",
    "avg_order_value",
]

# Tier boundaries: HIGH >=60, LOW <40, and MID otherwise.
HIGH_THRESHOLD = 60
LOW_THRESHOLD = 40

_model_cache: dict = {}


def _tier(score: int) -> str:
    if score >= HIGH_THRESHOLD:
        return "HIGH"
    if score < LOW_THRESHOLD:
        return "LOW"
    return "MID"


_EXACT_MATRIX = {
    ("HIGH", "LOW", "LOW"): (
        "price_sensitive", "DISCOUNT", "show_discount_offer",
        ["sms", "email", "whatsapp"],
    ),
    ("LOW", "HIGH", "LOW"): (
        "convenience_sensitive", "FRICTION_FIX", "simplify_checkout",
        ["sms", "push"],
    ),
    ("LOW", "LOW", "HIGH"): (
        "trust_sensitive", "TRUST_REASSURE", "trust_and_security_reassurance",
        ["email", "whatsapp"],
    ),
    ("HIGH", "HIGH", "LOW"): (
        "price_and_convenience_sensitive", "HYBRID_BUNDLE", "discount_plus_free_shipping",
        ["sms", "email", "push"],
    ),
    ("HIGH", "LOW", "HIGH"): (
        "price_and_trust_sensitive", "TRUST_PLUS_DEAL", "discount_plus_money_back_guarantee",
        ["email", "sms"],
    ),
    ("LOW", "HIGH", "HIGH"): (
        "convenience_and_trust_sensitive", "FRICTION_PLUS_TRUST", "one_click_checkout_plus_free_returns",
        ["push", "email"],
    ),
}


def classify(pss_score: int, css_score: int, tss_score: int) -> dict:
    """
    Applies the 9-condition Recovery Action Matrix to three 0-100 scores.

    A pure high-trust score never includes a discount; it uses TRUST_REASSURE.
    This rule applies to the pure-trust case
    (condition 3). This is enforced by construction — condition 3 in the
    exact matrix maps to TRUST_REASSURE with no discount, and none of the
    fallback conditions (7/8/9) ever select a discount-bearing action when
    TSS alone is HIGH and the others are LOW, because that exact combination
    is already claimed by condition 3.

    Returns:
        dict: classification, recovery_action, recommended_offer,
              channel_priority (list[str])
    """
    pss_tier = _tier(pss_score)
    css_tier = _tier(css_score)
    tss_tier = _tier(tss_score)

    # Conditions 1-6: exact tier-triple matches
    exact = _EXACT_MATRIX.get((pss_tier, css_tier, tss_tier))
    if exact is not None:
        classification, action, offer, channels = exact
        return {
            "classification": classification,
            "recovery_action": action,
            "recommended_offer": offer,
            "channel_priority": channels,
        }

    # Condition 7: all three scores are at least MID (>= 40) — no single
    # axis is a clear non-signal, so personalise across all of them.
    if pss_score >= LOW_THRESHOLD and css_score >= LOW_THRESHOLD and tss_score >= LOW_THRESHOLD:
        return {
            "classification": "fully_sensitive",
            "recovery_action": "FULL_PERSONALISE",
            "recommended_offer": "personalized_multi_signal_offer",
            "channel_priority": ["sms", "email"],
        }

    # Condition 8: all three LOW — no meaningful signal on any axis.
    if pss_tier == "LOW" and css_tier == "LOW" and tss_tier == "LOW":
        return {
            "classification": "neutral",
            "recovery_action": "NUDGE",
            "recommended_offer": "reminder_email",
            "channel_priority": ["email"],
        }

    # Condition 9: catch-all — anything left has at least one MID score
    # without a clear winning axis. Never offers a discount.
    return {
        "classification": "ambiguous",
        "recovery_action": "SOFT_NUDGE",
        "recommended_offer": "cart_persistence_confirmation",
        "channel_priority": ["email"],
    }


def _load_model(target: str):
    """
    Loads one of the three registered M2 models ('pss' | 'css' | 'tss')
    from the MLflow registry. Caches in memory. Returns None on ANY
    failure — the model is not merchant-partitioned today (all three
    models are global), matching the current state of every other model
    in this repo despite docstrings elsewhere aspirationally saying
    "per-merchant" (see abandonment/predict.py for the same known gap).
    """
    if target in _model_cache:
        return _model_cache[target]
    try:
        import mlflow.sklearn
        model = mlflow.sklearn.load_model(f"models:/sensitivity_{target}/Production")
        _model_cache[target] = model
        return model
    except Exception:
        return None


def load_model(merchant_id: str):
    """
    Loads all three trained M2 models (PSS, CSS, TSS) for the given
    merchant.

    NOTE: models are currently global, not merchant-specific —
    `merchant_id` is accepted for forward-compatible API stability but is
    not yet used to select a merchant-scoped model. Flagged as a known gap,
    consistent with the same limitation across M1/M3/M4/M5.

    Returns:
        dict: {"pss": model|None, "css": model|None, "tss": model|None}
    """
    return {
        "pss": _load_model("pss"),
        "css": _load_model("css"),
        "tss": _load_model("tss"),
    }


def _build_feature_row(feature_vector: dict) -> list:
    """
    Assembles a single ordered feature row from a (possibly partial /
    malformed) feature_vector dict, applying safe defaults for every
    missing or invalid value. Booleans are cast to 0/1. Never raises.
    """
    defaults = {
        "past_orders_with_coupon_pct": 0.0,
        "visited_coupon_page": False,
        "searched_discount_terms": False,
        "cart_item_remove_count": 0,
        "coupon_field_visited": False,
        "abandoned_at_shipping_reveal": False,
        "checkout_step_reached": 0,
        "cursor_hesitation": 0,
        "time_on_page_ms": 0,
        "failed_payment_attempt": False,
        "failed_payment_count": 0,
        "is_return_visitor": False,
        "avg_order_value": 0.0,
    }

    if not isinstance(feature_vector, dict):
        feature_vector = {}

    # The event pipeline exposes the normalized 0-10 score. Older callers
    # may still send raw milliseconds, so preserve that input compatibility
    # at the boundary without changing the trained feature contract.
    if "cursor_hesitation" not in feature_vector:
        if "cursor_hesitation_score" in feature_vector:
            legacy_value = feature_vector["cursor_hesitation_score"]
            divisor = 1
        else:
            legacy_value = feature_vector.get("cursor_hesitation_ms", 0)
            divisor = 1000 if "cursor_hesitation_ms" in feature_vector else 1
        try:
            feature_vector["cursor_hesitation"] = min(
                10,
                max(0, int(float(legacy_value) // divisor)),
            )
        except (TypeError, ValueError):
            feature_vector["cursor_hesitation"] = 0

    row = []
    for col in FEATURE_COLUMNS:
        value = feature_vector.get(col, defaults[col])
        if value is None:
            value = defaults[col]
        if isinstance(value, bool):
            row.append(int(value))
        elif isinstance(value, (int, float)):
            row.append(value)
        else:
            row.append(defaults[col])
    return row


def predict(feature_vector: dict, merchant_id: str, db=None) -> dict:
    """
    Classifies a shopper's sensitivity profile and returns PSS + CSS + TSS
    scores plus the recovery action decided by the 9-condition matrix.

    `is_return_visitor` is derived automatically as `past_orders_total > 0`
    when the caller provides `past_orders_total` in feature_vector but omits
    `is_return_visitor` explicitly — this keeps the caller from having to
    duplicate logic that pipeline.py's calculate_past_orders_total already
    covers.

    Args:
        feature_vector (dict): Raw/assembled features. Any of the 13
            FEATURE_COLUMNS, plus optionally `past_orders_total` (int) used
            only to derive `is_return_visitor` when not given directly.
        merchant_id (str): UUID of the merchant.
        db: unused today (models are global); accepted for API stability
            and forward-compatibility with merchant-scoped models.

    Returns:
        dict: {
            "pss_score"         : int,   # 0-100, stored in abandoned_carts
            "css_score"         : int,   # 0-100
            "tss_score"         : int,   # 0-100
            "classification"    : str,
            "recovery_action"   : str,   # one of the 9 matrix actions
            "recommended_offer" : str,
            "channel_priority"  : list[str],
            "model_version"     : str,
            "fallback"          : bool,
        }
    """
    FALLBACK = {
        "pss_score": 50,
        "css_score": 50,
        "tss_score": 50,
        "classification": "ambiguous",
        "recovery_action": "SOFT_NUDGE",
        "recommended_offer": "cart_persistence_confirmation",
        "channel_priority": ["email"],
        "model_version": "fallback",
        "fallback": True,
    }

    try:
        if not isinstance(feature_vector, dict):
            feature_vector = {}
        else:
            feature_vector = dict(feature_vector)  # don't mutate caller's dict

        if "is_return_visitor" not in feature_vector and "past_orders_total" in feature_vector:
            past_orders = feature_vector.get("past_orders_total") or 0
            try:
                feature_vector["is_return_visitor"] = int(past_orders) > 0
            except (TypeError, ValueError):
                pass

        models = load_model(merchant_id)
        if not models["pss"] or not models["css"] or not models["tss"]:
            return FALLBACK

        row = _build_feature_row(feature_vector)

        import pandas as pd
        X = pd.DataFrame([row], columns=FEATURE_COLUMNS)

        pss_score = int(round(float(models["pss"].predict_proba(X)[0][1]) * 100))
        css_score = int(round(float(models["css"].predict_proba(X)[0][1]) * 100))
        tss_score = int(round(float(models["tss"].predict_proba(X)[0][1]) * 100))

        decision = classify(pss_score, css_score, tss_score)

        return {
            "pss_score": pss_score,
            "css_score": css_score,
            "tss_score": tss_score,
            **decision,
            "model_version": "2.0.0",
            "fallback": False,
        }
    except Exception:
        return FALLBACK
