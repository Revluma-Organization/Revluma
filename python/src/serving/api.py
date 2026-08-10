import typing
"""
Revluma ML Serving API
========================
Real-time inference endpoints for Revluma's five predictive models.
uvicorn src.serving.api:app --reload --port 8000

#--
#newly added
#--
CORRECTIONS APPLIED (auditing the uploaded draft against the task doc's
actual P2.1 spec found several real mismatches - see chat for the full
audit table). Summary of what changed in this rewrite:

  1. AbandonmentFeatures - added cart_item_add_count and
     cart_item_remove_count (doc requires 7 fields; draft had 5).

  2. SensitivityFeatures - renamed coupon_usage_pct -> the real
     pipeline.py name past_orders_with_coupon_pct, fixed its scale from
     0-100 to the real 0.0-1.0 ratio, and swapped time_on_page_ms for
     tab_switch_count to match the actual 8-feature weighted table in
     M2's README.

  3. ChurnRiskResponse - full rewrite. Draft returned
     {churn_score, risk_level, trigger_winback, customer_segment} but
     the doc requires {churn_probability, churn_tier, win_back_urgency,
     engagement_decay_score, recommended_channel, offer_required,
     escalate_to_human}. Also fixed a real bug: the draft called
     model.predict_proba(X)[0][1] assuming a BINARY model, but M4 is a
     4-CLASS classifier - that indexing would silently return the wrong
     class's probability every time.

  4. SendTimeFeatures / SendTimeResponse - full rewrite. Draft's input
     schema (email_open_hour_history, etc.) didn't match the doc's real
     schema (channel, recovery_action, cart_value_tier,
     customer_timezone_offset) at all, and the response used
     best_send_hour/best_send_day ints instead of the required ISO 8601
     send_at/send_at_utc timestamps. Endpoint now grid-searches candidate
     hours using the M3 model (see train.py's redesign) and returns the
     doc's exact response shape.

  5. OfferValueFeatures/Response - full rewrite. Added tss_score input
     (see M5 train.py for why - M2 outputs PSS+CSS+TSS, not just two
     scores). Implemented the doc's two separate hard gates (TRUST_SIGNAL
     vs NUDGE) which the draft didn't have at all. Rebuilt response to
     match the doc's required fields.

  6. GET /health - added version, models_loaded, database_url_set,
     uptime_seconds per doc spec (draft only returned status+service).

  7. Startup model preload - added, per doc: "On application startup,
     attempt to load all five models into the cache... never crash on
     startup due to a missing model."

Kept unchanged (already matched the doc): the sensitivity decision
matrix logic and thresholds, the general fallback-never-500 pattern, and
the in-memory _model_cache design.
#--
#end new
#--
"""

import asyncio
import functools
import os
import secrets
import sys
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
from fastapi import FastAPI, Depends, HTTPException, Header
from pydantic import BaseModel, Field
import mlflow.sklearn

# Setup MLflow configuration
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))
try:
    from src.config.mlflow_config import get_or_create_experiment
    get_or_create_experiment()
except Exception:
    pass  # Failsafe

app = FastAPI(
    title="Revluma ML Serving API",
    description="Real-time inference endpoints for Revluma's five predictive models.",
    version="0.2.0"
)

_START_TIME = time.time()

# ---------------------------------------------------------------------------
# Internal API Key Authentication (F-02)
# ---------------------------------------------------------------------------
# Only callers presenting a valid X-Internal-Key header may hit /predict/*.
# The /health endpoint remains open (needed for uptime probes / load balancers).
ML_INTERNAL_KEY = os.environ.get("ML_INTERNAL_KEY", "")

async def verify_internal_caller(
    x_internal_key: str = Header(None, convert_underscores=False),
) -> None:
    """Validate the shared secret between Node backend and this ML service.
    Fails with 401 if the key is missing, empty, or doesn't match.
    Uses constant-time comparison to prevent timing side-channels."""
    if not ML_INTERNAL_KEY:
        # If no key is configured, deny all authenticated requests -
        # misconfiguration must fail closed, not open.
        raise HTTPException(
            status_code=500,
            detail="ML_INTERNAL_KEY is not configured on the server.",
        )
    if not x_internal_key or not secrets.compare_digest(x_internal_key, ML_INTERNAL_KEY):
        raise HTTPException(status_code=401, detail="Unauthorized")


# ---------------------------------------------------------------------------
# Global State & Caching
# ---------------------------------------------------------------------------
_model_cache: dict = {}



async def _run_inference(fn, *args) -> typing.Any:
    """
    Run a blocking scikit-learn call in the default thread pool executor.
    Prevents synchronous ML inference from blocking the asyncio event loop
    and allows other requests to be served concurrently.
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, functools.partial(fn, *args))

# Registry names - MUST exactly match registered_model_name used in each
# model's train.py, or load_model() will always return None.
MODEL_NAMES = ["abandonment", "sensitivity_pss", "sensitivity_css",
               "churn_risk", "send_time", "offer_value"]


def _load_model(model_name: str) -> typing.Any:
    """
    Loads model from MLflow safely.
    Caches in memory. Returns None on ANY failure to prevent crashes.
    """
    if model_name in _model_cache:
        return _model_cache[model_name]
    try:
        model = mlflow.sklearn.load_model(f"models:/{model_name}/latest")
        _model_cache[model_name] = model
        return model
    except Exception:
        return None


@app.on_event("startup")
async def _preload_models() -> None:
    """
    Per doc: attempt to load all five models into cache on startup.
    Log which loaded and which fell back. Never crash startup if a
    model is missing - that's exactly what the fallback logic is for.
    """
    for name in MODEL_NAMES:
        model = _load_model(name)
        status = "loaded" if model is not None else "FALLBACK (not found)"
        print(f"[startup] model '{name}': {status}")


# ---------------------------------------------------------------------------
# Request Schemas (Pydantic)
# ---------------------------------------------------------------------------
class AbandonmentFeatures(BaseModel):
    scroll_depth_pct: float = Field(0.0, ge=0.0, le=100.0)
    tab_switch_count: int = Field(0, ge=0)
    time_on_page_ms: int = Field(0, ge=0)
    checkout_step_reached: int = Field(0, ge=0, le=5)
    failed_payment_attempt: bool = Field(False)
    cart_item_add_count: int = Field(0, ge=0)
    cart_item_remove_count: int = Field(0, ge=0)


class SensitivityFeatures(BaseModel):
    # Matches the 8-feature weighted table in M2's README exactly.
    # past_orders_with_coupon_pct is a 0.0-1.0 RATIO in pipeline.py
    # (calculate_coupon_usage_pct), not a 0-100 percentage - the earlier
    # draft had both the wrong name and the wrong scale.
    past_orders_with_coupon_pct: float = Field(0.0, ge=0.0, le=1.0)
    visited_coupon_page: bool = Field(False)
    searched_discount_terms: bool = Field(False)
    cursor_hesitation: int = Field(0, ge=0)
    abandoned_at_shipping_reveal: bool = Field(False)
    checkout_step_reached: int = Field(0, ge=0, le=5)
    scroll_depth_pct: float = Field(0.0, ge=0.0, le=100.0)
    tab_switch_count: int = Field(0, ge=0)


class ChurnFeatures(BaseModel):
    past_orders_total: int = Field(0, ge=0)
    days_since_last_purchase: int = Field(-1, ge=-1)
    avg_order_value: float = Field(0.0, ge=0.0)
    purchase_frequency_trend: int = Field(0, ge=-1, le=1)
    rfm_recency_score: int = Field(1, ge=1, le=5)
    rfm_frequency_score: int = Field(1, ge=1, le=5)
    rfm_monetary_score: int = Field(1, ge=1, le=5)
    # NOTE: the doc's escalate_to_human rule needs customer LTV, which
    # isn't among M4's 7 trained features. Accepted here as an optional
    # input; if not provided we approximate LTV as
    # past_orders_total * avg_order_value. Flagged - a real LTV field
    # from the customer_crm table would be more accurate than this proxy.
    customer_ltv: float = Field(0.0, ge=0.0)


class SendTimeFeatures(BaseModel):
    local_hour_of_session: int = Field(12, ge=0, le=23)
    day_of_week_session: int = Field(0, ge=0, le=6)
    channel: str = Field("email", pattern="^(email|sms|whatsapp)$")
    recovery_action: str = Field(
        "SOFT_NUDGE",
        pattern="^(DISCOUNT|FRICTION_FIX|HYBRID|NUDGE|SOFT_NUDGE)$"
    )
    cart_value_tier: str = Field("medium", pattern="^(low|medium|high)$")
    customer_timezone_offset: int = Field(0, ge=-12, le=14)


class OfferValueFeatures(BaseModel):
    pss_score: int = Field(0, ge=0, le=100)
    css_score: int = Field(0, ge=0, le=100)
    # tss_score: M2 output per the doc ("PSS + CSS + TSS"), but no real
    # backing data exists yet anywhere in the repo - see M5 train.py.
    # Defaults to 0 (not trust-blocked) so the TRUST_SIGNAL gate doesn't
    # spuriously fire until real TSS data is available.
    tss_score: int = Field(0, ge=0, le=100)
    cursor_hesitation: int = Field(0, ge=0)
    past_orders_total: int = Field(0, ge=0)
    past_orders_with_coupon_pct: float = Field(0.0, ge=0.0, le=1.0)
    days_since_last_purchase: int = Field(-1, ge=-1)
    avg_order_value: float = Field(0.0, ge=0.0)
    visited_coupon_page: bool = Field(False)
    searched_discount_terms: bool = Field(False)


# ---------------------------------------------------------------------------
# Response Schemas
# ---------------------------------------------------------------------------
class AbandonmentResponse(BaseModel):
    abandonment_probability: float
    should_intervene: bool
    confidence: float
    model_version: str
    fallback: bool = False


class SensitivityResponse(BaseModel):
    pss_score: int = 50
    css_score: int = 50
    classification: str = "ambiguous"
    recovery_action: str = "SOFT_NUDGE"
    recommended_offer: str = "subtle_popup"
    model_version: str = "fallback"
    fallback: bool = False


class ChurnRiskResponse(BaseModel):
    churn_probability: float
    churn_tier: str
    win_back_urgency: str
    engagement_decay_score: float
    recommended_channel: str
    offer_required: bool
    escalate_to_human: bool
    model_version: str
    fallback: bool = False


class SendTimeResponse(BaseModel):
    send_at: str
    send_at_utc: str
    confidence: float
    reasoning_layer: str
    channel: str
    fallback: bool = False


class OfferValueResponse(BaseModel):
    discount_pct: float
    offer_type: str
    offer_expires_hours: int
    minimum_order_value: float
    expected_recovery_probability: float
    margin_cost_estimate_pct: float
    reasoning: str
    fallback: bool = False


# ---------------------------------------------------------------------------
# Shared constants / small helpers
# ---------------------------------------------------------------------------
CHURN_TIERS = ["HEALTHY", "AT_RISK", "HIGH_RISK", "CRITICAL"]
TIER_TO_URGENCY = {"HEALTHY": "LOW", "AT_RISK": "MEDIUM", "HIGH_RISK": "HIGH", "CRITICAL": "CRITICAL"}
TIER_TO_CHANNEL = {"HEALTHY": "email", "AT_RISK": "email", "HIGH_RISK": "sms", "CRITICAL": "phone_call"}

TIMING_CHANNEL_MAP = {"email": 0, "sms": 1, "whatsapp": 2}
RECOVERY_ACTION_MAP = {"DISCOUNT": 0, "FRICTION_FIX": 1, "HYBRID": 2, "NUDGE": 3, "SOFT_NUDGE": 4}
CART_VALUE_TIER_MAP = {"low": 0, "medium": 1, "high": 2}

FALLBACK_SEND_HOUR = {"email": 10, "sms": 18, "whatsapp": 18}
FALLBACK_SEND_DAY = {"email": 1, "sms": 3, "whatsapp": 3}  # ISO: 0=Mon .. Tue=1, Thu=3


def _next_occurrence_utc(target_hour: int, target_day: int, tz_offset_hours: int) -> tuple[datetime, datetime]:
    """
    Given a target local hour (0-23), target ISO day-of-week (0=Mon..6=Sun),
    and the customer's UTC offset in hours, returns the next occurrence as
    (local_datetime, utc_datetime).
    """
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc + timedelta(hours=tz_offset_hours)

    days_ahead = (target_day - local_now.weekday()) % 7
    candidate_local = local_now.replace(hour=target_hour, minute=0, second=0, microsecond=0) + timedelta(days=days_ahead)

    if candidate_local <= local_now:
        candidate_local += timedelta(days=7)

    candidate_utc = candidate_local - timedelta(hours=tz_offset_hours)
    return candidate_local, candidate_utc


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check() -> dict:
    return {
        "status": "ok",
        "service": "revluma-ml-serving",
        "version": app.version,
        "models_loaded": list(_model_cache.keys()),
        "database_url_set": bool(os.getenv("DATABASE_URL")),
        "uptime_seconds": time.time() - _START_TIME,
    }


@app.post("/predict/abandonment-probability", response_model=AbandonmentResponse,
          dependencies=[Depends(verify_internal_caller)])
async def predict_abandonment(features: AbandonmentFeatures) -> AbandonmentResponse:
    try:
        model = _load_model("abandonment")
        if not model:
            return AbandonmentResponse(
                abandonment_probability=0.5,
                should_intervene=False,
                confidence=0.0,
                model_version="fallback",
                fallback=True
            )

        feature_vector = pd.DataFrame([features.dict()])
        prob = float((await _run_inference(model.predict_proba, feature_vector))[0][1])
        return AbandonmentResponse(
            abandonment_probability=prob,
            should_intervene=prob > 0.65,
            confidence=0.9,
            model_version="1.0",
            fallback=False
        )
    except Exception:
        return AbandonmentResponse(
            abandonment_probability=0.5,
            should_intervene=False,
            confidence=0.0,
            model_version="fallback",
            fallback=True
        )


@app.post("/predict/shopper-sensitivity", response_model=SensitivityResponse,
          dependencies=[Depends(verify_internal_caller)])
async def predict_sensitivity(features: SensitivityFeatures) -> SensitivityResponse:
    try:
        pss_model = _load_model("sensitivity_pss")
        css_model = _load_model("sensitivity_css")

        if not pss_model or not css_model:
            return SensitivityResponse(fallback=True)

        feature_vector = pd.DataFrame([features.dict()])
        pss_prob = float((await _run_inference(pss_model.predict_proba, feature_vector))[0][1])
        css_prob = float((await _run_inference(css_model.predict_proba, feature_vector))[0][1])

        pss_score = int(pss_prob * 100)
        css_score = int(css_prob * 100)

        if pss_score >= 60 and css_score < 40:
            classification = "price_sensitive"
            action = "DISCOUNT"
            offer = "show_discount_offer"
        elif pss_score < 40 and css_score >= 60:
            classification = "convenience_sensitive"
            action = "FRICTION_FIX"
            offer = "simplify_checkout"
        elif pss_score >= 60 and css_score >= 60:
            classification = "dual_sensitive"
            action = "HYBRID"
            offer = "personalized_bundle"
        elif pss_score < 40 and css_score < 40:
            classification = "neutral"
            action = "NUDGE"
            offer = "reminder_email"
        else:
            classification = "ambiguous"
            action = "SOFT_NUDGE"
            offer = "subtle_popup"

        return SensitivityResponse(
            pss_score=pss_score,
            css_score=css_score,
            classification=classification,
            recovery_action=action,
            recommended_offer=offer,
            model_version="1.0",
            fallback=False
        )
    except Exception:
        return SensitivityResponse(fallback=True)


@app.post("/predict/churn-risk", response_model=ChurnRiskResponse,
          dependencies=[Depends(verify_internal_caller)])
async def predict_churn(features: ChurnFeatures) -> ChurnRiskResponse:
    days = features.days_since_last_purchase
    ltv = features.customer_ltv if features.customer_ltv > 0 else (
        features.past_orders_total * features.avg_order_value
    )

    try:
        model = _load_model("churn_risk")
        if not model:
            return _get_churn_fallback(days, ltv)

        feature_cols = [
            'past_orders_total', 'days_since_last_purchase', 'avg_order_value',
            'purchase_frequency_trend', 'rfm_recency_score', 'rfm_frequency_score',
            'rfm_monetary_score'
        ]
        feature_vector = pd.DataFrame([{k: getattr(features, k) for k in feature_cols}])

        # M4 is a 4-CLASS classifier (see train.py), NOT binary. The earlier
        # draft's predict_proba(X)[0][1] indexing was a real bug - it would
        # have silently returned P(AT_RISK) as if it were a generic churn
        # probability regardless of the actual predicted class.
        proba = (await _run_inference(model.predict_proba, feature_vector))[0]
        predicted_idx = int(proba.argmax())
        tier = CHURN_TIERS[predicted_idx]
        # churn_probability = P(anything other than HEALTHY) - a single
        # scalar "risk of churning at all", distinct from churn_tier which
        # is the discrete predicted class.
        churn_probability = float(1.0 - proba[0])
        urgency = TIER_TO_URGENCY[tier]

        # engagement_decay_score has no dedicated model output - approximated
        # from the predicted tier's own probability mass. Flagged: a real
        # engagement-decay signal would need actual engagement event data
        # (see M4's flagged missing 17 signals).
        engagement_decay_score = float(proba[predicted_idx] * 100)

        return ChurnRiskResponse(
            churn_probability=churn_probability,
            churn_tier=tier,
            win_back_urgency=urgency,
            engagement_decay_score=engagement_decay_score,
            recommended_channel=TIER_TO_CHANNEL[tier],
            offer_required=tier in ("HIGH_RISK", "CRITICAL"),
            escalate_to_human=(ltv > 500 and tier == "CRITICAL"),
            model_version="1.0",
            fallback=False
        )
    except Exception:
        return ChurnRiskResponse(
            churn_probability=0.5,
            churn_tier="AT_RISK",
            win_back_urgency="MEDIUM",
            engagement_decay_score=50.0,
            recommended_channel="email",
            offer_required=False,
            escalate_to_human=False,
            model_version="fallback",
            fallback=True
        )


def _get_churn_fallback(days: int, ltv: float) -> ChurnRiskResponse:
    """Algorithmic fallback per doc's exact day-based tier rules."""
    if days == -1:
        tier = "AT_RISK"
        churn_probability = 0.5
    elif days <= 30:
        tier, churn_probability = "HEALTHY", 0.15
    elif days <= 60:
        tier, churn_probability = "AT_RISK", 0.45
    elif days <= 90:
        tier, churn_probability = "HIGH_RISK", 0.70
    else:
        tier, churn_probability = "CRITICAL", 0.90

    urgency = TIER_TO_URGENCY[tier]
    return ChurnRiskResponse(
        churn_probability=churn_probability,
        churn_tier=tier,
        win_back_urgency=urgency,
        engagement_decay_score=churn_probability * 100,
        recommended_channel=TIER_TO_CHANNEL[tier],
        offer_required=tier in ("HIGH_RISK", "CRITICAL"),
        escalate_to_human=(ltv > 500 and tier == "CRITICAL"),
        model_version="fallback",
        fallback=True
    )


@app.post("/predict/send-time", response_model=SendTimeResponse,
          dependencies=[Depends(verify_internal_caller)])
async def predict_send_time(features: SendTimeFeatures) -> SendTimeResponse:
    try:
        model = _load_model("send_time")
        if not model:
            # Global baseline rules from the doc: email -> Tue 10:00 local,
            # sms -> Thu 18:30 local. whatsapp not specified; treat like sms.
            hour = FALLBACK_SEND_HOUR.get(features.channel, 10)
            day = FALLBACK_SEND_DAY.get(features.channel, 1)
            local_dt, utc_dt = _next_occurrence_utc(hour, day, features.customer_timezone_offset)
            return SendTimeResponse(
                send_at=local_dt.isoformat(),
                send_at_utc=utc_dt.isoformat(),
                confidence=0.0,
                reasoning_layer="global_baseline",
                channel=features.channel,
                fallback=True
            )

        # Grid-search candidate hours (0-23) for this channel/day context,
        # holding the business-context fields fixed, and pick the
        # highest-scoring hour. Day is taken from the request as-is.
        base_row = {
            'day_of_week_session': features.day_of_week_session,
            'channel': TIMING_CHANNEL_MAP[features.channel],
            'recovery_action': RECOVERY_ACTION_MAP[features.recovery_action],
            'cart_value_tier': CART_VALUE_TIER_MAP[features.cart_value_tier],
            'customer_timezone_offset': features.customer_timezone_offset,
        }
        grid = pd.DataFrame([
            {**base_row, 'local_hour_of_session': h} for h in range(24)
        ])[['local_hour_of_session', 'day_of_week_session', 'channel',
            'recovery_action', 'cart_value_tier', 'customer_timezone_offset']]

        probs = (await _run_inference(model.predict_proba, grid))[:, 1]
        best_hour = int(probs.argmax())
        confidence = float(probs[best_hour])

        local_dt, utc_dt = _next_occurrence_utc(
            best_hour, features.day_of_week_session, features.customer_timezone_offset
        )

        return SendTimeResponse(
            send_at=local_dt.isoformat(),
            send_at_utc=utc_dt.isoformat(),
            confidence=confidence,
            reasoning_layer="personalised",
            channel=features.channel,
            fallback=False
        )
    except Exception:
        local_dt, utc_dt = _next_occurrence_utc(10, 1, 0)
        return SendTimeResponse(
            send_at=local_dt.isoformat(),
            send_at_utc=utc_dt.isoformat(),
            confidence=0.0,
            reasoning_layer="global_baseline",
            channel=features.channel if features else "email",
            fallback=True
        )


@app.post("/predict/offer-value", response_model=OfferValueResponse,
          dependencies=[Depends(verify_internal_caller)])
async def predict_offer_value(features: OfferValueFeatures) -> OfferValueResponse:
    try:
        # Hard gates evaluated BEFORE touching the model, per doc - two
        # separate rules, not one:
        if features.tss_score >= 60:
            return OfferValueResponse(
                discount_pct=0.0,
                offer_type="TRUST_SIGNAL",
                offer_expires_hours=0,
                minimum_order_value=0.0,
                expected_recovery_probability=0.0,
                margin_cost_estimate_pct=0.0,
                reasoning="Shopper shows high trust-friction signals (TSS>=60); "
                          "a discount won't address the blocker - surfacing a "
                          "trust/security reassurance instead.",
                fallback=False
            )

        if features.pss_score < 35 and features.css_score < 35:
            return OfferValueResponse(
                discount_pct=0.0,
                offer_type="NUDGE",
                offer_expires_hours=24,
                minimum_order_value=0.0,
                expected_recovery_probability=0.0,
                margin_cost_estimate_pct=0.0,
                reasoning="Shopper shows low price and convenience sensitivity; "
                          "a soft reminder is more appropriate than a discount.",
                fallback=False
            )

        model = _load_model("offer_value")
        if not model:
            # Algorithmic fallback based on sensitivity scores
            pct = 15.0 if features.pss_score >= 60 else 5.0
            return OfferValueResponse(
                discount_pct=pct,
                offer_type="DISCOUNT",
                offer_expires_hours=24,
                minimum_order_value=0.0,
                expected_recovery_probability=0.0,
                margin_cost_estimate_pct=pct,
                reasoning="Model unavailable - using PSS-based algorithmic fallback.",
                fallback=True
            )

        feature_cols = [
            'pss_score', 'css_score', 'tss_score', 'cursor_hesitation',
            'past_orders_total', 'past_orders_with_coupon_pct',
            'days_since_last_purchase', 'avg_order_value',
            'visited_coupon_page', 'searched_discount_terms'
        ]
        feature_vector = pd.DataFrame([{k: getattr(features, k) for k in feature_cols}])
        raw_pct = float((await _run_inference(model.predict, feature_vector))[0])
        pct = max(0.0, min(25.0, raw_pct))  # hard cap, never trust raw model output alone

        return OfferValueResponse(
            discount_pct=pct,
            offer_type="DISCOUNT",
            offer_expires_hours=24,
            minimum_order_value=0.0,
            expected_recovery_probability=0.6,
            margin_cost_estimate_pct=pct,
            reasoning=f"Price-sensitivity signals (PSS={features.pss_score}) "
                      f"support a {pct:.1f}% recovery discount within merchant margin limits.",
            fallback=False
        )
    except Exception:
        return OfferValueResponse(
            discount_pct=0.0,
            offer_type="NUDGE",
            offer_expires_hours=24,
            minimum_order_value=0.0,
            expected_recovery_probability=0.0,
            margin_cost_estimate_pct=0.0,
            reasoning="Inference error - defaulting to safe no-discount nudge.",
            fallback=True
        )