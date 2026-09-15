"""
M5 — Offer Value Optimizer: Inference Script
=============================================
Implements the full five-step offer-value decision flow:

    Step 1 — Offer Necessity Gate   (hard business rules, no model)
    Step 2 — Base Discount Calculation (trained model, exact-formula fallback)
    Step 3 — Modifier Adjustments   (customer/cart/churn context, no model)
    Step 4 — Hard Caps              (0.0-25.0%, plus merchant-configured cap)
    Step 5 — Offer Type Selection + expiry

Never raises. Any unexpected error returns a safe zero-discount
CART_REMINDER fallback — consistent with this repo's "no prediction
endpoint ever returns a 500 / crashes a batch" standard.
"""

from __future__ import annotations

import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), "../../.."))

# ---------------------------------------------------------------------------
# Step 1 gate thresholds and Step 4 hard cap — identical to train.py.
# ---------------------------------------------------------------------------
TSS_THRESHOLD = 60
PSS_NUDGE_FLOOR = 35
CSS_NUDGE_FLOOR = 35
MAX_DISCOUNT_PCT = 25.0
DEFAULT_MERCHANT_MAX_DISCOUNT_PCT = 20  # per store_config docstring below

FEATURE_COLUMNS = [
    "pss_score",
    "past_orders_with_coupon_pct",
    "visited_coupon_page",
    "searched_discount_terms",
    "failed_coupon_count",
]

_model_cache: dict = {}


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------
def load_model(merchant_id: str):
    """
    Loads the trained M5 model for the given merchant from the MLflow
    registry. Caches in memory. Returns None on ANY failure.

    NOTE: the model is currently global, not merchant-specific —
    `merchant_id` is accepted for forward-compatible API stability. Same
    known gap as every other model in this repo (see M2's predict.py for
    the identical note).
    """
    if "offer_value" in _model_cache:
        return _model_cache["offer_value"]
    try:
        import mlflow.sklearn
        model = mlflow.sklearn.load_model("models:/offer_value/Production")
        _model_cache["offer_value"] = model
        return model
    except Exception:
        return None


def load_merchant_constraints(merchant_id: str, db) -> dict:
    """
    Loads discount constraints from store_config for this merchant.

    Query: SELECT discount_cap, min_margin FROM store_config
           WHERE merchant_id = %s

    Per AI_DATA_REQUIREMENTS.md Section 7.4, `store_config.discount_cap`
    (or an equivalently-named max-discount column) is flagged PARTIAL —
    existence not yet confirmed — and `min_margin_pct` is flagged MISSING
    entirely. Both default safely rather than block inference.

    Args:
        merchant_id: UUID of the merchant
        db: Active database connection (or None)

    Returns:
        dict: {
            "max_discount_pct": int,        # hard cap, default 20
            "min_margin_pct"  : int | None,  # optional floor, None if not set
        }
    """
    defaults = {
        "max_discount_pct": DEFAULT_MERCHANT_MAX_DISCOUNT_PCT,
        "min_margin_pct": None,
    }

    if not merchant_id or db is None:
        return defaults

    try:
        with db.cursor() as cursor:
            cursor.execute(
                "SELECT discount_cap, min_margin FROM store_config WHERE merchant_id = %s",
                (merchant_id,),
            )
            row = cursor.fetchone()
        if not row:
            return defaults

        max_discount = int(row[0]) if row[0] is not None else defaults["max_discount_pct"]
        min_margin = int(row[1]) if len(row) > 1 and row[1] is not None else None
        return {"max_discount_pct": max_discount, "min_margin_pct": min_margin}
    except Exception:
        return defaults


# ---------------------------------------------------------------------------
# Step 2 — Base Discount Calculation
# ---------------------------------------------------------------------------
def _base_discount_formula(pss_score, past_orders_with_coupon_pct,
                            visited_coupon_page, searched_discount_terms,
                            failed_coupon_count) -> float:
    """
    Exact Step 2 formula, used as the model-free fallback when the
    MLflow-registered model is unavailable. Identical to train.py's
    synthetic label formula — see that file for the full formula
    docstring/derivation.
    """
    return (
        2.0
        + (float(pss_score) / 100.0) * 14.0
        + float(past_orders_with_coupon_pct) * 8.0
        + (3.5 if visited_coupon_page else 0.0)
        + (2.5 if searched_discount_terms else 0.0)
        + (float(failed_coupon_count) / 3.0) * 2.0
    )


def _compute_base_discount(feature_vector: dict, merchant_id: str) -> tuple[float, bool]:
    """
    Step 2: computes the base discount % via the trained model, falling
    back to the exact closed-form formula (see above) if the model is
    unavailable or inference fails.

    Returns:
        (base_discount_pct, used_model: bool)
    """
    pss_score = feature_vector.get("pss_score", 0) or 0
    coupon_pct = feature_vector.get("past_orders_with_coupon_pct", 0.0) or 0.0
    visited = bool(feature_vector.get("visited_coupon_page", False))
    searched = bool(feature_vector.get("searched_discount_terms", False))
    failed_coupon_count = feature_vector.get("failed_coupon_count", 0) or 0

    model = load_model(merchant_id)
    if model is not None:
        try:
            import pandas as pd
            row = pd.DataFrame([{
                "pss_score": pss_score,
                "past_orders_with_coupon_pct": coupon_pct,
                "visited_coupon_page": int(visited),
                "searched_discount_terms": int(searched),
                "failed_coupon_count": failed_coupon_count,
            }], columns=FEATURE_COLUMNS)
            base = float(model.predict(row)[0])
            return base, True
        except Exception:
            pass  # fall through to formula

    base = _base_discount_formula(pss_score, coupon_pct, visited, searched, failed_coupon_count)
    return base, False


# ---------------------------------------------------------------------------
# Step 3 — Modifier Adjustments
# ---------------------------------------------------------------------------
def _apply_modifiers(base_discount: float, feature_vector: dict) -> dict:
    """
    Applies the Step 3 customer-history modifiers to the Step 2 base
    discount, then resolves any categorical override (VIP_ACCESS,
    FREE_SHIPPING, PAYMENT_FIX).

    Ordering note: the decision flow
    lists these 7 rules in a flat sequence, but applying them literally in
    that order produces inconsistent outcomes when multiple rules fire
    together — e.g. a VIP customer (LTV > $1000, listed 2nd) whose current
    cart happens to be under $30 (listed 4th) would, under strict
    sequential overwriting, end up silently downgraded from VIP_ACCESS to
    plain FREE_SHIPPING with 0.0 discount, discarding the VIP signal
    entirely. To avoid that, this implementation:
      1. Applies the four SIZE-ADJUSTING rules together first (LTV>500&
         orders>5 x0.70, cart>300 x0.75, churn_tier +5.0, first_purchase
         +3.0) — these are magnitude tweaks to a single number, order
         between them doesn't change the outcome's category.
      2. Then resolves CATEGORICAL overrides (which replace the whole
         offer, not just its size) in priority order:
             PAYMENT_FIX > VIP_ACCESS > FREE_SHIPPING
         Payment friction is a hard blocker (a discount can't fix a
         declined card) so it always wins. VIP status is a stronger,
         longer-lived merchant-value signal than the current cart's
         dollar size, so it outranks the small-cart free-shipping rule.
    This priority choice is an explicit engineering judgment call, not
    given by the specification and should be confirmed with product.

    Returns:
        dict: {
            "discount_pct": float,       # post-modifier, pre-hard-cap
            "offer_type_override": str | None,
            "notes": list[str],          # human-readable reasoning fragments
        }
    """
    discount = base_discount
    notes = []

    ltv = feature_vector.get("ltv", 0.0) or 0.0
    past_orders_total = feature_vector.get("past_orders_total", 0) or 0
    # cart_value deliberately defaults to None, NOT 0.0 — a 0.0 default
    # would spuriously trigger the "cart < $30 -> FREE_SHIPPING" override
    # on every call where the caller simply didn't pass cart_value, which
    # is a materially different situation from a genuinely small cart.
    # Both size-based cart rules below are skipped when cart_value is
    # unknown rather than treated as $0.
    cart_value = feature_vector.get("cart_value")
    churn_tier = feature_vector.get("churn_tier", "HEALTHY") or "HEALTHY"
    is_first_purchase = bool(feature_vector.get("is_first_purchase", False))
    failed_payment_count = feature_vector.get("failed_payment_count", 0) or 0
    pss_score = feature_vector.get("pss_score", 0) or 0

    # --- size-adjusting modifiers ---
    if ltv > 500 and past_orders_total > 5:
        discount *= 0.70
        notes.append("loyal high-LTV customer needs less incentive (x0.70)")

    if cart_value is not None and cart_value > 300:
        discount *= 0.75
        notes.append("large cart value reduces the discount needed (x0.75)")

    if churn_tier in ("HIGH_RISK", "CRITICAL"):
        discount += 5.0
        notes.append(f"churn tier {churn_tier} adds urgency (+5.0)")

    if is_first_purchase:
        discount += 3.0
        notes.append("first purchase gets a welcome incentive (+3.0)")

    # --- categorical overrides (priority: PAYMENT_FIX > VIP_ACCESS > FREE_SHIPPING) ---
    if failed_payment_count >= 1 and pss_score < 40:
        notes.append("failed payment + low price-sensitivity: fix payment friction, not price")
        return {"discount_pct": 0.0, "offer_type_override": "PAYMENT_FIX", "notes": notes}

    if ltv > 1000:
        discount = min(discount, 5.0)
        notes.append("LTV > $1000: VIP treatment, discount capped at 5%")
        return {"discount_pct": discount, "offer_type_override": "VIP_ACCESS", "notes": notes}

    if cart_value is not None and cart_value < 30:
        notes.append("cart value under $30: free shipping instead of a percentage discount")
        return {"discount_pct": 0.0, "offer_type_override": "FREE_SHIPPING", "notes": notes}

    return {"discount_pct": discount, "offer_type_override": None, "notes": notes}


# ---------------------------------------------------------------------------
# Step 5 — Offer Type Selection + expiry
# ---------------------------------------------------------------------------
# Expiry rules for the 3 offer types the doc gives explicit hours for.
_EXPIRY_HOURS = {
    "DISCOUNT_PLUS_FREE_SHIPPING": 12,
    "PERCENTAGE_DISCOUNT": 24,
    "FREE_SHIPPING": 48,
    "TRUST_SIGNAL": 0,       # 0 = no expiry, matching existing api.py convention
    # Conservative defaults when the merchant has not configured a value.
    "PAYMENT_FIX": 24,       # matches urgency of a standard discount reminder
    "VIP_ACCESS": 48,        # VIP customers get more time, not less
    "NUDGE": 24,
    "CART_REMINDER": 72,     # lowest-urgency offer type
}


def _select_offer_type(discount_pct: float, css_score: int, override: str | None) -> str:
    """Step 5, run only when Step 3 didn't already fix a categorical override."""
    if override is not None:
        return override
    if discount_pct == 0 and css_score >= 60:
        return "FREE_SHIPPING"
    if discount_pct > 0 and css_score >= 50:
        return "DISCOUNT_PLUS_FREE_SHIPPING"
    if discount_pct > 0:
        return "PERCENTAGE_DISCOUNT"
    return "CART_REMINDER"


def _round1(x: float) -> float:
    return round(float(x), 1)


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------
def predict(feature_vector: dict, merchant_id: str, db=None) -> dict:
    """
    Recommends the minimum discount % needed to convert this shopper,
    following the full 5-Step Offer Value Logic.

    Args:
        feature_vector (dict): expects (all optional, safely defaulted):
            pss_score, css_score, tss_score (0-100 ints, from M2),
            recovery_action (str, from M2 — used for the Step 1 gate 3
                              short-circuit on NUDGE/SOFT_NUDGE),
            past_orders_with_coupon_pct (float 0-1), visited_coupon_page
            (bool), searched_discount_terms (bool), failed_coupon_count
            (int) — Step 2 model inputs,
            ltv (float), past_orders_total (int), cart_value (float),
            churn_tier (str), is_first_purchase (bool),
            failed_payment_count (int) — Step 3 modifier inputs.
        merchant_id (str): UUID of the merchant.
        db: Database session for loading merchant discount-cap constraints.

    Returns:
        dict: {
            "discount_pct"                  : float 0.0-25.0 (or lower if
                                                merchant cap is stricter),
            "offer_type"                    : str,
            "offer_expires_hours"           : int,
            "minimum_order_value"           : float,
            "expected_recovery_probability" : float 0.0-1.0,
            "margin_cost_estimate_pct"      : float,
            "reasoning"                     : str,
            "model_version"                 : str,
            "fallback"                      : bool,
        }
    """
    FALLBACK = {
        "discount_pct": 0.0,
        "offer_type": "CART_REMINDER",
        "offer_expires_hours": _EXPIRY_HOURS["CART_REMINDER"],
        "minimum_order_value": 0.0,
        "expected_recovery_probability": 0.0,
        "margin_cost_estimate_pct": 0.0,
        "reasoning": "Inference error — defaulting to a safe no-discount cart reminder.",
        "model_version": "fallback",
        "fallback": True,
    }

    try:
        if not isinstance(feature_vector, dict):
            feature_vector = {}

        pss_score = int(feature_vector.get("pss_score", 0) or 0)
        css_score = int(feature_vector.get("css_score", 0) or 0)
        tss_score = int(feature_vector.get("tss_score", 0) or 0)
        recovery_action = feature_vector.get("recovery_action")

        # ---- Step 1: Offer Necessity Gate (runs before any model inference) ----
        if tss_score >= TSS_THRESHOLD:
            return {
                "discount_pct": 0.0,
                "offer_type": "TRUST_SIGNAL",
                "offer_expires_hours": _EXPIRY_HOURS["TRUST_SIGNAL"],
                "minimum_order_value": 0.0,
                "expected_recovery_probability": 0.0,
                "margin_cost_estimate_pct": 0.0,
                "reasoning": (
                    f"Trust Sensitivity Score {tss_score} >= {TSS_THRESHOLD}: a discount "
                    "won't address a trust/security blocker — surfacing a trust reassurance "
                    "signal instead."
                ),
                "model_version": "1.0.0",
                "fallback": False,
            }

        if pss_score < PSS_NUDGE_FLOOR and css_score < CSS_NUDGE_FLOOR:
            return {
                "discount_pct": 0.0,
                "offer_type": "NUDGE",
                "offer_expires_hours": _EXPIRY_HOURS["NUDGE"],
                "minimum_order_value": 0.0,
                "expected_recovery_probability": 0.0,
                "margin_cost_estimate_pct": 0.0,
                "reasoning": (
                    f"PSS {pss_score} and CSS {css_score} both below {PSS_NUDGE_FLOOR}: "
                    "low sensitivity on both axes — a soft reminder is more appropriate "
                    "than a discount."
                ),
                "model_version": "1.0.0",
                "fallback": False,
            }

        if recovery_action in ("NUDGE", "SOFT_NUDGE"):
            offer_type = "FREE_SHIPPING" if css_score >= 60 else "CART_REMINDER"
            return {
                "discount_pct": 0.0,
                "offer_type": offer_type,
                "offer_expires_hours": _EXPIRY_HOURS[offer_type],
                "minimum_order_value": 0.0,
                "expected_recovery_probability": 0.0,
                "margin_cost_estimate_pct": 0.0,
                "reasoning": (
                    f"Upstream M2 recovery_action is {recovery_action}: holding the "
                    "discount at 0 per the M2 recommendation."
                ),
                "model_version": "1.0.0",
                "fallback": False,
            }

        # ---- Step 2: Base Discount Calculation ----
        base_discount, used_model = _compute_base_discount(feature_vector, merchant_id)

        # ---- Step 3: Modifier Adjustments ----
        modified = _apply_modifiers(base_discount, feature_vector)
        discount_pct = modified["discount_pct"]
        override = modified["offer_type_override"]

        # ---- Step 4: Hard Caps (25% absolute ceiling, plus merchant cap) ----
        merchant_constraints = load_merchant_constraints(merchant_id, db)
        effective_cap = min(MAX_DISCOUNT_PCT, float(merchant_constraints["max_discount_pct"]))
        capped_by_merchant = False
        if override is None:
            # Only percentage-style offers are subject to the merchant cap;
            # VIP_ACCESS/PAYMENT_FIX/FREE_SHIPPING already resolved their
            # own fixed discount_pct in Step 3.
            pre_cap = discount_pct
            discount_pct = max(0.0, min(effective_cap, discount_pct))
            capped_by_merchant = discount_pct < pre_cap
        else:
            discount_pct = max(0.0, min(MAX_DISCOUNT_PCT, discount_pct))
        discount_pct = _round1(discount_pct)

        # ---- Step 5: Offer Type Selection + expiry ----
        offer_type = _select_offer_type(discount_pct, css_score, override)
        expires_hours = _EXPIRY_HOURS.get(offer_type, 24)

        # Heuristic estimates — no calibrated outcome data exists yet
        # The outcome monitor records later recovery results.
        # placeholders pending real conversion data.
        expected_recovery_probability = round(
            min(0.95, 0.30 + (discount_pct / MAX_DISCOUNT_PCT) * 0.35 + (pss_score / 100.0) * 0.15),
            2,
        )
        margin_cost_estimate_pct = discount_pct if offer_type not in (
            "FREE_SHIPPING", "DISCOUNT_PLUS_FREE_SHIPPING"
        ) else round(discount_pct + 2.0, 1)  # +2.0 flat shipping-cost heuristic

        reasoning_parts = [
            f"Base discount {'(model)' if used_model else '(formula fallback)'}: "
            f"{_round1(base_discount)}%."
        ]
        reasoning_parts.extend(modified["notes"])
        if capped_by_merchant:
            reasoning_parts.append(
                f"Capped at merchant limit {merchant_constraints['max_discount_pct']}%."
            )
        reasoning = " ".join(reasoning_parts)

        return {
            "discount_pct": discount_pct,
            "offer_type": offer_type,
            "offer_expires_hours": expires_hours,
            "minimum_order_value": 0.0,
            "expected_recovery_probability": expected_recovery_probability,
            "margin_cost_estimate_pct": margin_cost_estimate_pct,
            "reasoning": reasoning,
            "model_version": "1.0.0" if used_model else "1.0.0-formula-fallback",
            "fallback": False,
        }

    except Exception:
        return FALLBACK
