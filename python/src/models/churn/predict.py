"""
M4 — Churn Risk Scorer: Inference Script
=========================================
Runs daily as a cron job across all customer profiles.

Two models, one answer
----------------------
`churn_risk` is the 4-class model — HEALTHY, AT_RISK, HIGH_RISK, CRITICAL.
`churn_early_warning` is a binary layer that reads only engagement decay and
promotes a HEALTHY customer to EARLY_WARNING.

That promotion is the whole point of M4. A customer whose purchase history
still looks fine passes the standard 30-day no-purchase check, so nothing
flags them — but their email opens have already fallen, they have stopped
adding to cart, and they are on their way out. Catching that is worth 4 to 6
weeks of lead time, which is the difference between a re-engagement email and
a win-back discount.

Fallback
--------
If either model is unavailable, or inference fails for any reason, the
day-band rules from the spec apply: <=30 days HEALTHY, 31-60 AT_RISK,
61-90 HIGH_RISK, >90 CRITICAL, and fallback=True. The EARLY_WARNING layer
still runs in that path — the decay score is computed from the feature vector
itself, so it needs no model at all. This function never raises.
"""

import logging
import typing

import mlflow.sklearn

from .train import (
    EARLY_WARNING_FEATURES,
    FEATURE_COLUMNS,
    compute_engagement_decay_score,
    normalize_churn_features,
    resolve_churn_tier,
)

logger = logging.getLogger("rev.m4.predict")

MODEL_NAME = "churn_risk"
EARLY_WARNING_MODEL_NAME = "churn_early_warning"
MODEL_VERSION = "m4-v1.0"

# ── Tier → action maps ────────────────────────────────────────────────────────
# EARLY_WARNING is deliberately MEDIUM and email-only with no offer attached.
# The tier exists to reach someone cheaply while they are still reachable; if
# it triggered a discount it would just be an expensive way to pay customers
# who were never going to leave.
TIER_TO_URGENCY = {
    "HEALTHY":       "LOW",
    "EARLY_WARNING": "MEDIUM",
    "AT_RISK":       "MEDIUM",
    "HIGH_RISK":     "HIGH",
    "CRITICAL":      "CRITICAL",
}
# The S3 output contract fixes this enum at email | sms | whatsapp | push.
# CRITICAL was "phone_call", which is outside that set and which the Backend
# has no send path for, so it could only ever fail downstream. WhatsApp is the
# highest-touch value the contract actually allows. See DECISION D-2.
TIER_TO_CHANNEL = {
    "HEALTHY":       "email",
    "EARLY_WARNING": "email",
    "AT_RISK":       "email",
    "HIGH_RISK":     "sms",
    "CRITICAL":      "whatsapp",
}
VALID_CHANNELS = ("email", "sms", "whatsapp", "push")
OFFER_REQUIRED_TIERS = ("HIGH_RISK", "CRITICAL")

# S3, AT_RISK action: "If email_open_rate_30d < 0.05 switch to SMS." A dead
# inbox makes the tier's default channel worthless, so the rule overrides it.
DEAD_INBOX_OPEN_RATE = 0.05

# primary_churn_signal — evaluated in order, first match wins. The order is the
# ranking: purchase behaviour outranks engagement decay, which outranks the
# competitive signals, because that is the order in which a merchant can act on
# them. Each entry is (signal name, predicate over the feature vector).
CHURN_SIGNAL_RULES = (
    ("no_recent_purchase",          lambda f: _num(f, "days_since_last_purchase", -1) > 90),
    ("purchase_frequency_decline",  lambda f: _num(f, "purchase_frequency_trend") < 0),
    ("email_engagement_decline",    lambda f: _num(f, "email_open_rate_delta") < -0.15),
    ("site_visit_decline",          lambda f: _num(f, "site_visit_delta") < -0.15),
    ("unsubscribe_risk",            lambda f: _num(f, "unsubscribe_risk_score") >= 0.60),
    ("discount_seeking",            lambda f: _num(f, "discount_seeking_escalation") > 0),
)
NO_SIGNAL = "none_detected"
DECAY_SIGNAL = "engagement_decay"
DECAY_SIGNAL_THRESHOLD = 35.0

# ── Fallback day bands (spec P3.1 / S3) ───────────────────────────────────────
FALLBACK_BANDS = [(30, "HEALTHY", 0.15), (60, "AT_RISK", 0.45), (90, "HIGH_RISK", 0.70)]
FALLBACK_CRITICAL = ("CRITICAL", 0.90)
FALLBACK_UNKNOWN = ("AT_RISK", 0.50)       # days_since_last_purchase == -1
FALLBACK_EARLY_WARNING_PROBABILITY = 0.35  # between HEALTHY 0.15 and AT_RISK 0.45

# Escalate to a human only when the money justifies a phone call.
ESCALATION_LTV_THRESHOLD = 500.0

_model_cache: dict = {}


def _load_registry_model(name: str, merchant_id: str) -> typing.Any:
    """Loads a registered model by name, cached, returning None on any failure.

    Returning None rather than raising is deliberate: the caller's whole
    contract is that scoring degrades to the day-band rules instead of failing.
    """
    if name in _model_cache:
        return _model_cache[name]
    try:
        model = mlflow.sklearn.load_model(f"models:/{name}/latest")
        _model_cache[name] = model
        logger.info("m4_model_loaded", extra={"model": name, "merchant_id": merchant_id})
        return model
    except Exception as err:
        logger.warning("m4_model_unavailable", extra={"model": name, "error": str(err)})
        return None


def load_model(merchant_id: str) -> typing.Any:
    """Loads trained M4 model for the given merchant.

    Args:
        merchant_id (str): UUID of the merchant. Models are shared across
            merchants in this phase; the id is carried for logging and for the
            per-merchant registry split later.

    Returns:
        The fitted sklearn pipeline, or None if it could not be loaded.
    """
    return _load_registry_model(MODEL_NAME, merchant_id)


def _early_warning_probability(feature_vector: dict, decay_score: float, merchant_id: str):
    """P(early warning) from the binary layer, or None if it is unavailable."""
    model = _load_registry_model(EARLY_WARNING_MODEL_NAME, merchant_id)
    if model is None:
        return None
    try:
        import pandas as pd
        row = {"engagement_decay_score": decay_score}
        X = pd.DataFrame([{col: row.get(col, feature_vector.get(col, 0.0))
                           for col in EARLY_WARNING_FEATURES}])
        return float(model.predict_proba(X)[0][1])
    except Exception as err:
        # A failure here costs only the lead time, not the score, so it is
        # logged and swallowed — the decay threshold rule takes over.
        logger.warning("m4_early_warning_failed", extra={"error": str(err)})
        return None


def _customer_ltv(feature_vector: dict) -> float:
    """Lifetime value, falling back to orders x AOV when it is not supplied."""
    ltv = float(feature_vector.get("customer_ltv") or 0.0)
    if ltv > 0:
        return ltv
    return float(feature_vector.get("past_orders_total", 0) or 0) * float(
        feature_vector.get("avg_order_value", 0.0) or 0.0
    )


def _fallback_tier(days_since_last_purchase) -> tuple:
    """The algorithmic day bands, used whenever the model cannot be."""
    try:
        days = int(days_since_last_purchase)
    except (TypeError, ValueError):
        return FALLBACK_UNKNOWN
    if days < 0:
        return FALLBACK_UNKNOWN
    for upper, tier, probability in FALLBACK_BANDS:
        if days <= upper:
            return tier, probability
    return FALLBACK_CRITICAL


def _num(feature_vector: dict, key: str, default: float = 0.0) -> float:
    """Reads one numeric feature, treating None and unparseable values as the default.

    Args:
        feature_vector: the M4 feature dict, which may be partially populated.
        key: feature name to read.
        default: value to return when the key is missing or not numeric.

    Returns:
        The feature as a float, or the default.
    """
    try:
        value = feature_vector.get(key)
        return default if value is None else float(value)
    except (TypeError, ValueError):
        return default


def _primary_churn_signal(feature_vector: dict, decay_score: float) -> str:
    """Names the strongest reason this customer looks like a churn risk.

    The tier says how urgent the customer is; this says what to actually put in
    the message. A win-back written for a lapsed buyer reads nothing like one
    written for someone who is still visiting but has stopped opening email.

    Args:
        feature_vector: the M4 feature dict.
        decay_score: engagement decay, 0-100, from compute_engagement_decay_score.

    Returns:
        A signal name from CHURN_SIGNAL_RULES, DECAY_SIGNAL when only the
        composite has moved, or NO_SIGNAL when nothing has.
    """
    for signal, matches in CHURN_SIGNAL_RULES:
        if matches(feature_vector):
            return signal
    if decay_score >= DECAY_SIGNAL_THRESHOLD:
        return DECAY_SIGNAL
    return NO_SIGNAL


def _recommended_channel(tier: str, feature_vector: dict) -> str:
    """Picks the send channel for a tier, applying the dead-inbox override.

    Args:
        tier: resolved churn tier.
        feature_vector: the M4 feature dict.

    Returns:
        One of VALID_CHANNELS.
    """
    channel = TIER_TO_CHANNEL[tier]
    if channel == "email" and _num(feature_vector, "email_open_rate_30d", 1.0) < DEAD_INBOX_OPEN_RATE:
        return "sms"
    return channel


def _build_result(tier: str, churn_probability: float, decay_score: float,
                  ltv: float, fallback: bool, feature_vector: dict) -> dict:
    """Assembles the response the S3 output contract specifies.

    Args:
        tier: resolved churn tier.
        churn_probability: P(not HEALTHY) from the main model, or a band default.
        decay_score: engagement decay, 0-100.
        ltv: customer lifetime value, for the escalation rule.
        fallback: True when the day-band rules produced the tier.
        feature_vector: the M4 feature dict, for signal and channel selection.

    Returns:
        The full response dict.
    """
    return {
        "churn_probability":      round(float(churn_probability), 4),
        "churn_tier":             tier,
        "win_back_urgency":       TIER_TO_URGENCY[tier],
        "primary_churn_signal":   _primary_churn_signal(feature_vector, decay_score),
        "engagement_decay_score": round(float(decay_score), 2),
        "recommended_channel":    _recommended_channel(tier, feature_vector),
        "offer_required":         tier in OFFER_REQUIRED_TIERS or (tier == "AT_RISK" and _num(feature_vector, "coupon_dependency_score", 0.0) > 0.4),
        "escalate_to_human":      bool(ltv > ESCALATION_LTV_THRESHOLD and tier in ("HIGH_RISK", "CRITICAL")),
        "fallback":               fallback,
        "model_version":          "fallback" if fallback else MODEL_VERSION,
    }


def predict(customer_id: str, feature_vector: dict, merchant_id: str) -> dict:
    """
    Scores a single customer's churn probability.

    Args:
        customer_id    (str) : UUID of the customer
        feature_vector (dict): The 21 named M4 features, including RFM
                               sub-scores. Known legacy aliases are accepted;
                               canonical names win when both forms are sent.
                               Missing keys score as
                               zero rather than failing — a partially populated
                               customer is scored, not dropped.
        merchant_id    (str) : UUID of the merchant

    Returns:
        dict: {
            "churn_probability"     : float,  # 0.0-1.0, P(not HEALTHY)
            "churn_tier"            : str,    # HEALTHY | EARLY_WARNING | AT_RISK
                                              # | HIGH_RISK | CRITICAL
            "win_back_urgency"      : str,    # LOW | MEDIUM | HIGH | CRITICAL
            "primary_churn_signal"  : str,    # strongest churn driver, see
                                              # CHURN_SIGNAL_RULES
            "engagement_decay_score": float,  # 0-100, higher = falling away faster
            "recommended_channel"   : str,    # email | sms | whatsapp | push
            "offer_required"        : bool,   # High tiers, or coupon-dependent AT_RISK
            "escalate_to_human"     : bool,   # LTV > 500 and HIGH_RISK/CRITICAL
            "fallback"              : bool,   # True if the day-band rules ran
            "model_version"         : str
        }

    churn_probability and churn_tier answer different questions and can
    disagree: the probability is purchase-behaviour risk from the main model,
    while an EARLY_WARNING tier comes from engagement decay. A customer the
    model is confident is HEALTHY can still be promoted, and their low
    probability is correct — it is precisely why the tier had to exist.
    """
    features = normalize_churn_features(feature_vector)
    ltv = _customer_ltv(features)
    decay_score = float(compute_engagement_decay_score(features))

    try:
        model = load_model(merchant_id)
        if model is None:
            raise RuntimeError("M4 model unavailable — using day-band rules.")

        import pandas as pd
        X = pd.DataFrame([{col: features.get(col, 0) or 0 for col in FEATURE_COLUMNS}])
        proba = model.predict_proba(X)[0]

        # classes_ is sorted alphabetically by sklearn, which is NOT the order
        # of CHURN_TIERS. Indexing by position instead of by label would
        # silently return AT_RISK's probability as HEALTHY's and mislabel every
        # prediction, so both lookups go through classes_.
        classes = list(model.classes_)
        base_tier = str(classes[int(proba.argmax())])
        healthy_idx = classes.index("HEALTHY") if "HEALTHY" in classes else None
        churn_probability = 1.0 - float(proba[healthy_idx]) if healthy_idx is not None else 1.0

        early_proba = _early_warning_probability(features, decay_score, merchant_id)
        tier = resolve_churn_tier(base_tier, decay_score, early_proba, 0.5, features)

        return _build_result(tier, churn_probability, decay_score, ltv,
                             fallback=False, feature_vector=features)

    except Exception as err:
        logger.warning(
            "m4_inference_fallback",
            extra={"customer_id": customer_id, "merchant_id": merchant_id, "error": str(err)},
        )
        base_tier, churn_probability = _fallback_tier(features.get("days_since_last_purchase", -1))
        # No model here, so resolve_churn_tier falls through to the decay
        # threshold. The early warning survives losing the registry entirely.
        tier = resolve_churn_tier(base_tier, decay_score, features=features)
        if tier == "EARLY_WARNING":
            churn_probability = FALLBACK_EARLY_WARNING_PROBABILITY
        return _build_result(tier, churn_probability, decay_score, ltv,
                             fallback=True, feature_vector=features)
