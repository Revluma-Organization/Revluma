"""
Revluma ML Serving API (Task I4)
====================================
Real-time inference endpoints for Revluma's five predictive models, plus
health and internal sync/RFM endpoints.
uvicorn src.serving.api:app --reload --port 8000

#--
#newly added (Task I4, Ire)
#--
ARCHITECTURE NOTE — model loading is split across three caches, not one:

The task doc's literal `_load_model()` snippet implies a single
module-level `_model_cache` dict owning every model. For M1 (abandonment),
M4 (churn), and M3 (timing) — none of which have a real predict.py
business-logic layer yet (those are David's/Samuel's tasks, still `pass`
stubs) — this file owns loading and inference directly, via its own
`_model_cache`, exactly as the snippet describes.

For M2 (sensitivity) and M5 (offer value) — BOTH of which Ire already
built full, tested predict.py modules for in Tasks I2 and I3, each with
their own gate/modifier/matrix business logic and their OWN independent
`_model_cache` dict — this file does NOT re-implement that logic a second
time here. Duplicating ~300 lines of already-tested gate/matrix logic
into api.py would be a real duplication-of-truth risk (the exact kind of
drift this repo repeatedly flags, e.g. M3's CHANNEL_MAP warning). Instead:
    - At startup, this file calls `sensitivity_predict.load_model(None)`
      and `offer_value_predict.load_model(None)` to warm THEIR caches
      too, alongside its own three models.
    - At request time, this file calls their `predict()` entrypoints
      directly. Since their caches are already warm from startup, this
      never triggers an MLflow call during inference — the "never call
      MLflow during inference" requirement holds across all three cache
      stores, just not as one dict.
    - `GET /health` reports `models_loaded` by inspecting all three
      caches together, so this split is invisible to callers.
This is a deliberate architecture choice, not an oversight — flagged here
in case product/Ire prefer a single unified cache in a future refactor.
#--
#end new
#--
"""

import ipaddress
import logging
import os
import secrets
import sys
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
import mlflow.sklearn

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

logger = logging.getLogger("revluma.ml_serving")
logging.basicConfig(level=logging.INFO)

try:
    from src.config.mlflow_config import get_or_create_experiment
    get_or_create_experiment()
except Exception:
    pass  # Failsafe — serving must start even if MLflow config is broken

from src.models.sensitivity import predict as sensitivity_predict
from src.models.offer_value import predict as offer_value_predict
from src.jobs import rfm_sync

app = FastAPI(
    title="Revluma ML Serving API",
    description="Real-time inference endpoints for Revluma's five predictive models.",
    version="0.4.0",
)

_START_TIME = time.time()

# ---------------------------------------------------------------------------
# Internal API Key Authentication
# ---------------------------------------------------------------------------
ML_INTERNAL_KEY = os.environ.get("ML_INTERNAL_KEY", "")


async def verify_internal_caller(
    x_internal_key: str = Header(None, alias="x-internal-key"),
):
    """Validates the shared secret between Node backend and this ML service.
    Fails with 401 if the key is missing/empty/mismatched. If no key is
    configured server-side, fails CLOSED with 500 — misconfiguration must
    never silently open the gate."""
    if not ML_INTERNAL_KEY:
        raise HTTPException(
            status_code=500,
            detail="ML_INTERNAL_KEY is not configured on the server.",
        )
    if not x_internal_key or not secrets.compare_digest(x_internal_key, ML_INTERNAL_KEY):
        raise HTTPException(status_code=401, detail="Unauthorized")


# Private network ranges considered "internal" for /internal/sync/trigger.
_INTERNAL_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
]


def _is_internal_ip(host: str | None) -> bool:
    if not host:
        return False
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(addr in net for net in _INTERNAL_NETWORKS)


async def verify_internal_network(request: Request):
    """Restricts /internal/sync/trigger to localhost / internal network
    ranges, per Task I4's explicit requirement for that endpoint. Runs
    IN ADDITION to verify_internal_caller (defense in depth), not instead
    of it."""
    client_host = request.client.host if request.client else None
    if not _is_internal_ip(client_host):
        raise HTTPException(
            status_code=403,
            detail="Forbidden: this endpoint is only reachable from the internal network.",
        )


# ---------------------------------------------------------------------------
# Global State & Caching (M1 / M3 / M4 only — see module docstring)
# ---------------------------------------------------------------------------
_model_cache: dict = {}

MODEL_NAMES = ["abandonment", "churn_risk", "send_time"]


def _load_model(model_name: str):
    """Loads a model from MLflow safely. Caches in memory. Returns None on
    ANY failure to prevent crashes."""
    if model_name in _model_cache:
        return _model_cache[model_name]
    try:
        model = mlflow.sklearn.load_model(f"models:/{model_name}/latest")
        _model_cache[model_name] = model
        return model
    except Exception as e:
        logger.warning(f"Could not load model '{model_name}': {e}")
        return None


@app.on_event("startup")
async def _preload_models():
    """
    Attempts to load all models into cache on startup — this file's own
    three (M1/M3/M4) plus M2's three (pss/css/tss) and M5's one, so every
    model is warm before the first request and NO model is ever loaded
    during request handling. Never crashes startup on a missing model —
    that's exactly what each endpoint's fallback logic is for.
    """
    for name in MODEL_NAMES:
        model = _load_model(name)
        status = "loaded" if model is not None else "FALLBACK (not found)"
        logger.info(f"[startup] model '{name}': {status}")

    sensitivity_models = sensitivity_predict.load_model(None)
    for target, model in sensitivity_models.items():
        status = "loaded" if model is not None else "FALLBACK (not found)"
        logger.info(f"[startup] model 'sensitivity_{target}': {status}")

    offer_model = offer_value_predict.load_model(None)
    logger.info(f"[startup] model 'offer_value': {'loaded' if offer_model is not None else 'FALLBACK (not found)'}")


def _all_loaded_model_names() -> list:
    names = list(_model_cache.keys())
    names += [f"sensitivity_{t}" for t, m in sensitivity_predict._model_cache.items() if m is not None]
    if offer_value_predict._model_cache.get("offer_value") is not None:
        names.append("offer_value")
    return names


# ---------------------------------------------------------------------------
# Request Schemas — M1 Abandonment
# ---------------------------------------------------------------------------
class AbandonmentFeatures(BaseModel):
    """
    8 fields, all with defaults, per Task I4. The trained M1 model
    (abandonment/train.py) consumes exactly 5 of these
    (scroll_depth_pct, tab_switch_count, time_on_page_ms,
    checkout_step_reached, failed_payment_attempt) — cart_item_add_count
    and cart_item_remove_count were already accepted-but-unused in the
    pre-I4 version of this schema (flagged there too). `cursor_hesitation_count`
    is the 8th field added in this revision: the task doc says "8 fields"
    without naming the 8th, and this is the most directly-evidenced
    candidate — it's explicitly named as an M1 risk-score boost modifier
    in Task D3 ("+0.10 if cursor_hesitation_count >= 2"). Like the other
    two extras, it is accepted for forward-compatibility but not yet fed
    to the trained model (that would require retraining M1 on 6+ columns).
    """
    scroll_depth_pct: float = Field(0.0, ge=0.0, le=100.0)
    tab_switch_count: int = Field(0, ge=0)
    time_on_page_ms: int = Field(0, ge=0)
    checkout_step_reached: int = Field(0, ge=0, le=5)
    failed_payment_attempt: bool = Field(False)
    cart_item_add_count: int = Field(0, ge=0)
    cart_item_remove_count: int = Field(0, ge=0)
    cursor_hesitation_count: int = Field(0, ge=0)  # flagged 8th field, see docstring


class AbandonmentResponse(BaseModel):
    abandonment_probability: float
    should_intervene: bool
    confidence: float
    model_version: str
    fallback: bool = False


# ---------------------------------------------------------------------------
# Request Schemas — M2 Sensitivity (delegates to sensitivity_predict)
# ---------------------------------------------------------------------------
class SensitivityFeatures(BaseModel):
    """
    The task doc says "8 fields", but that figure is the same stale
    carryover already flagged in Task I2's train.py (it predates TSS).
    This schema uses the FULL 13-field contract sensitivity_predict.py
    was actually trained and tested against (see Task I2 delivery notes)
    — an 8-field schema here would silently break real inference by
    passing sensitivity_predict.predict() a feature vector it wasn't
    built for. `past_orders_total` is accepted separately (not one of
    the 13) purely to let predict() derive `is_return_visitor` — see
    that function's docstring.
    """
    past_orders_with_coupon_pct: float = Field(0.0, ge=0.0, le=1.0)
    visited_coupon_page: bool = Field(False)
    searched_discount_terms: bool = Field(False)
    cart_item_remove_count: int = Field(0, ge=0)
    coupon_field_visited: bool = Field(False)
    abandoned_at_shipping_reveal: bool = Field(False)
    checkout_step_reached: int = Field(0, ge=0, le=5)
    cursor_hesitation_ms: int = Field(0, ge=0, le=30000)
    time_on_page_ms: int = Field(0, ge=0)
    failed_payment_attempt: bool = Field(False)
    failed_payment_count: int = Field(0, ge=0)
    is_return_visitor: bool | None = Field(None)
    avg_order_value: float = Field(0.0, ge=0.0)
    past_orders_total: int | None = Field(None, ge=0)


class SensitivityResponse(BaseModel):
    pss_score: int = 50
    css_score: int = 50
    tss_score: int = 50
    classification: str = "ambiguous"
    recovery_action: str = "SOFT_NUDGE"
    recommended_offer: str = "cart_persistence_confirmation"
    channel_priority: list[str] = Field(default_factory=lambda: ["email"])
    model_version: str = "fallback"
    fallback: bool = False


# ---------------------------------------------------------------------------
# Request Schemas — M3 Send-Time
# ---------------------------------------------------------------------------
class SendTimeFeatures(BaseModel):
    local_hour_of_session: int = Field(12, ge=0, le=23)
    day_of_week_session: int = Field(0, ge=0, le=6)
    channel: str = Field("email", pattern="^(email|sms|whatsapp)$")
    recovery_action: str = Field(
        "SOFT_NUDGE",
        pattern="^(DISCOUNT|FRICTION_FIX|TRUST_REASSURE|HYBRID_BUNDLE|TRUST_PLUS_DEAL|"
                "FRICTION_PLUS_TRUST|FULL_PERSONALISE|NUDGE|SOFT_NUDGE)$",
    )
    cart_value_tier: str = Field("medium", pattern="^(low|medium|high)$")
    customer_timezone_offset: int = Field(0, ge=-12, le=14)


class SendTimeResponse(BaseModel):
    send_at: str
    send_at_utc: str
    confidence: float
    reasoning_layer: str
    channel: str
    fallback: bool = False


# ---------------------------------------------------------------------------
# Request Schemas — M4 Churn
# ---------------------------------------------------------------------------
class ChurnFeatures(BaseModel):
    """
    Task I4 says "24 fields". The task doc's own Dimension 1-4 lists only
    name 21 signals total (8 + 8 + 3 + 2) — 24 doesn't match either
    number I can derive from the spec, and I'm not fabricating 3 more
    field names to force a round number.

    Only the 7 Dimension-1 fields below the divider are actually fed to
    the trained churn_risk model (matching churn/train.py's real
    feature_cols exactly — this must stay in sync or every real
    inference call breaks). The remaining 14 named Dimension 2-4 signals
    are accepted for schema forward-compatibility (all default-valued)
    but NOT wired into inference: churn/README.md's own "Schema gaps"
    section already flags that none of them have a backing pipeline.py
    function or database column anywhere in this repo yet.
    """
    # --- fed to the trained model ---
    past_orders_total: int = Field(0, ge=0)
    days_since_last_purchase: int = Field(-1, ge=-1)
    avg_order_value: float = Field(0.0, ge=0.0)
    purchase_frequency_trend: int = Field(0, ge=-1, le=1)
    rfm_recency_score: int = Field(1, ge=1, le=5)
    rfm_frequency_score: int = Field(1, ge=1, le=5)
    rfm_monetary_score: int = Field(1, ge=1, le=5)

    # --- accepted, used only for escalate_to_human / primary_churn_signal ---
    customer_ltv: float = Field(0.0, ge=0.0)
    historical_aov_trend: float = Field(0.0)

    # --- accepted for forward-compatibility only; NOT yet consumed (flagged gap) ---
    email_open_rate_30d: float = Field(0.0, ge=0.0, le=1.0)
    email_open_rate_90d: float = Field(0.0, ge=0.0, le=1.0)
    email_open_rate_delta: float = Field(0.0)
    sms_click_rate_30d: float = Field(0.0, ge=0.0, le=1.0)
    site_visit_frequency_30d: int = Field(0, ge=0)
    site_visit_frequency_90d: int = Field(0, ge=0)
    site_visit_delta: float = Field(0.0)
    browse_to_cart_conversion_trend: float = Field(0.0)
    coupon_dependency_score: float = Field(0.0, ge=0.0, le=1.0)
    return_rate: float = Field(0.0, ge=0.0, le=1.0)
    support_contact_frequency_90d: int = Field(0, ge=0)
    discount_seeking_escalation: float = Field(0.0)
    unsubscribe_risk_score: float = Field(0.0, ge=0.0, le=1.0)


class ChurnRiskResponse(BaseModel):
    churn_probability: float
    churn_tier: str
    win_back_urgency: str
    primary_churn_signal: str
    engagement_decay_score: float
    recommended_channel: str
    offer_required: bool
    escalate_to_human: bool
    model_version: str
    fallback: bool = False


# ---------------------------------------------------------------------------
# Request Schemas — M5 Offer Value (delegates to offer_value_predict)
# ---------------------------------------------------------------------------
class OfferFeatures(BaseModel):
    """
    Task I4 says "20 fields including pss_score and css_score from M2
    output". The 14 fields below are the complete, real contract
    offer_value_predict.predict() was built and tested against in Task
    I3 (3 M2 scores + recovery_action + 4 Step-2 model inputs + 6 Step-3
    modifier inputs). Padding to exactly 20 with invented field names
    that predict() wouldn't consume would look complete without being
    functional — flagged rather than done.
    """
    pss_score: int = Field(0, ge=0, le=100)
    css_score: int = Field(0, ge=0, le=100)
    tss_score: int = Field(0, ge=0, le=100)
    recovery_action: str | None = Field(None)

    # Step 2 — base discount model inputs
    past_orders_with_coupon_pct: float = Field(0.0, ge=0.0, le=1.0)
    visited_coupon_page: bool = Field(False)
    searched_discount_terms: bool = Field(False)
    failed_coupon_count: int = Field(0, ge=0)

    # Step 3 — modifier inputs
    ltv: float = Field(0.0, ge=0.0)
    past_orders_total: int = Field(0, ge=0)
    cart_value: float | None = Field(None, ge=0.0)
    churn_tier: str = Field("HEALTHY", pattern="^(HEALTHY|AT_RISK|HIGH_RISK|CRITICAL)$")
    is_first_purchase: bool = Field(False)
    failed_payment_count: int = Field(0, ge=0)


class OfferValueResponse(BaseModel):
    discount_pct: float
    offer_type: str
    offer_expires_hours: int
    minimum_order_value: float
    expected_recovery_probability: float
    margin_cost_estimate_pct: float
    reasoning: str
    model_version: str = "fallback"
    fallback: bool = False


# ---------------------------------------------------------------------------
# Internal endpoint request schemas
# ---------------------------------------------------------------------------
class SyncTriggerRequest(BaseModel):
    store_id: str
    platform: str = Field("shopify", pattern="^(shopify|woocommerce)$")


class RfmSyncRequest(BaseModel):
    store_id: str = Field(..., min_length=1)


# ---------------------------------------------------------------------------
# Shared constants / helpers
# ---------------------------------------------------------------------------
CHURN_TIERS = ["HEALTHY", "AT_RISK", "HIGH_RISK", "CRITICAL"]
TIER_TO_URGENCY = {"HEALTHY": "LOW", "AT_RISK": "MEDIUM", "HIGH_RISK": "HIGH", "CRITICAL": "CRITICAL"}
TIER_TO_CHANNEL = {"HEALTHY": "email", "AT_RISK": "email", "HIGH_RISK": "sms", "CRITICAL": "phone_call"}

TIMING_CHANNEL_MAP = {"email": 0, "sms": 1, "whatsapp": 2}
RECOVERY_ACTION_MAP = {
    "DISCOUNT": 0, "FRICTION_FIX": 1, "TRUST_REASSURE": 2, "HYBRID_BUNDLE": 3,
    "TRUST_PLUS_DEAL": 4, "FRICTION_PLUS_TRUST": 5, "FULL_PERSONALISE": 6,
    "NUDGE": 7, "SOFT_NUDGE": 8,
}
CART_VALUE_TIER_MAP = {"low": 0, "medium": 1, "high": 2}

FALLBACK_SEND_HOUR = {"email": 10, "sms": 18, "whatsapp": 18}
FALLBACK_SEND_DAY = {"email": 1, "sms": 3, "whatsapp": 3}


def _next_occurrence_utc(target_hour: int, target_day: int, tz_offset_hours: int):
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc + timedelta(hours=tz_offset_hours)
    days_ahead = (target_day - local_now.weekday()) % 7
    candidate_local = local_now.replace(hour=target_hour, minute=0, second=0, microsecond=0) + timedelta(days=days_ahead)
    if candidate_local <= local_now:
        candidate_local += timedelta(days=7)
    candidate_utc = candidate_local - timedelta(hours=tz_offset_hours)
    return candidate_local, candidate_utc


def _derive_primary_churn_signal(features: ChurnFeatures) -> str:
    """
    Simple, deterministic priority-ordered driver identification —
    NOT a SHAP/feature-importance calculation (CHURN_MODEL_RESEARCH.md
    calls for real SHAP-based top_drivers post-MVP; this is the
    documented MVP-stage stand-in). Priority order follows the "Key
    churn signal" note in churn/README.md: purchase_frequency_trend=-1
    combined with high recency is the strongest predictor in this
    feature set.
    """
    if features.days_since_last_purchase == -1:
        return "no purchase history"
    if features.purchase_frequency_trend == -1 and features.days_since_last_purchase > 60:
        return "declining purchase frequency with rising recency"
    if features.days_since_last_purchase > 90:
        return "purchase recency (90+ days since last order)"
    if features.purchase_frequency_trend == -1:
        return "declining purchase frequency"
    if features.rfm_frequency_score <= 2:
        return "low historical order frequency"
    if features.rfm_monetary_score <= 2:
        return "low average order value"
    return "no dominant risk signal identified"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "revluma-ml-serving",
        "version": app.version,
        "models_loaded": _all_loaded_model_names(),
        "database_url_set": bool(os.getenv("DATABASE_URL")),
        "uptime_seconds": time.time() - _START_TIME,
    }


@app.post("/predict/abandonment-probability", response_model=AbandonmentResponse,
          dependencies=[Depends(verify_internal_caller)])
async def predict_abandonment(features: AbandonmentFeatures):
    try:
        model = _load_model("abandonment")
        if not model:
            return AbandonmentResponse(
                abandonment_probability=0.5, should_intervene=False,
                confidence=0.0, model_version="fallback", fallback=True,
            )

        # Only the 5 columns the trained model actually consumes — see
        # AbandonmentFeatures docstring for why 3 accepted fields are excluded.
        model_cols = ["scroll_depth_pct", "tab_switch_count", "time_on_page_ms",
                       "checkout_step_reached", "failed_payment_attempt"]
        row = pd.DataFrame([{k: getattr(features, k) for k in model_cols}])
        prob = float(model.predict_proba(row)[0][1])
        return AbandonmentResponse(
            abandonment_probability=prob, should_intervene=prob > 0.65,
            confidence=0.9, model_version="1.0", fallback=False,
        )
    except Exception:
        return AbandonmentResponse(
            abandonment_probability=0.5, should_intervene=False,
            confidence=0.0, model_version="fallback", fallback=True,
        )


@app.post("/predict/shopper-sensitivity", response_model=SensitivityResponse,
          dependencies=[Depends(verify_internal_caller)])
async def predict_sensitivity(features: SensitivityFeatures, request: Request = None):
    try:
        feature_vector = features.model_dump()
        merchant_id = request.headers.get("x-merchant-id") if request else None
        result = sensitivity_predict.predict(feature_vector, merchant_id)
        return SensitivityResponse(**result)
    except Exception:
        return SensitivityResponse(fallback=True)


@app.post("/predict/churn-risk", response_model=ChurnRiskResponse,
          dependencies=[Depends(verify_internal_caller)])
async def predict_churn(features: ChurnFeatures):
    days = features.days_since_last_purchase
    ltv = features.customer_ltv if features.customer_ltv > 0 else (
        features.past_orders_total * features.avg_order_value
    )
    primary_signal = _derive_primary_churn_signal(features)

    try:
        model = _load_model("churn_risk")
        if not model:
            if days == -1:
                tier, churn_probability = "AT_RISK", 0.5
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
                churn_probability=churn_probability, churn_tier=tier,
                win_back_urgency=urgency, primary_churn_signal=primary_signal,
                engagement_decay_score=churn_probability * 100,
                recommended_channel=TIER_TO_CHANNEL[tier],
                offer_required=tier in ("HIGH_RISK", "CRITICAL"),
                escalate_to_human=(ltv > 500 and tier == "CRITICAL"),
                model_version="fallback", fallback=True,
            )

        feature_cols = [
            "past_orders_total", "days_since_last_purchase", "avg_order_value",
            "purchase_frequency_trend", "rfm_recency_score", "rfm_frequency_score",
            "rfm_monetary_score",
        ]
        row = pd.DataFrame([{k: getattr(features, k) for k in feature_cols}])

        proba = model.predict_proba(row)[0]
        predicted_idx = int(proba.argmax())
        tier = CHURN_TIERS[predicted_idx]
        churn_probability = float(1.0 - proba[0])
        urgency = TIER_TO_URGENCY[tier]
        engagement_decay_score = float(proba[predicted_idx] * 100)

        return ChurnRiskResponse(
            churn_probability=churn_probability, churn_tier=tier,
            win_back_urgency=urgency, primary_churn_signal=primary_signal,
            engagement_decay_score=engagement_decay_score,
            recommended_channel=TIER_TO_CHANNEL[tier],
            offer_required=tier in ("HIGH_RISK", "CRITICAL"),
            escalate_to_human=(ltv > 500 and tier == "CRITICAL"),
            model_version="1.0", fallback=False,
        )
    except Exception:
        return ChurnRiskResponse(
            churn_probability=0.5, churn_tier="AT_RISK", win_back_urgency="MEDIUM",
            primary_churn_signal="unavailable due to inference error",
            engagement_decay_score=50.0, recommended_channel="email",
            offer_required=False, escalate_to_human=False,
            model_version="fallback", fallback=True,
        )


@app.post("/predict/send-time", response_model=SendTimeResponse,
          dependencies=[Depends(verify_internal_caller)])
async def predict_send_time(features: SendTimeFeatures):
    try:
        model = _load_model("send_time")
        if not model:
            hour = FALLBACK_SEND_HOUR.get(features.channel, 10)
            day = FALLBACK_SEND_DAY.get(features.channel, 1)
            local_dt, utc_dt = _next_occurrence_utc(hour, day, features.customer_timezone_offset)
            return SendTimeResponse(
                send_at=local_dt.isoformat(), send_at_utc=utc_dt.isoformat(),
                confidence=0.0, reasoning_layer="global_baseline",
                channel=features.channel, fallback=True,
            )

        base_row = {
            "day_of_week_session": features.day_of_week_session,
            "channel": TIMING_CHANNEL_MAP[features.channel],
            "recovery_action": RECOVERY_ACTION_MAP.get(features.recovery_action, 8),
            "cart_value_tier": CART_VALUE_TIER_MAP[features.cart_value_tier],
            "customer_timezone_offset": features.customer_timezone_offset,
        }
        grid = pd.DataFrame([
            {**base_row, "local_hour_of_session": h} for h in range(24)
        ])[["local_hour_of_session", "day_of_week_session", "channel",
            "recovery_action", "cart_value_tier", "customer_timezone_offset"]]

        probs = model.predict_proba(grid)[:, 1]
        best_hour = int(probs.argmax())
        confidence = float(probs[best_hour])

        local_dt, utc_dt = _next_occurrence_utc(
            best_hour, features.day_of_week_session, features.customer_timezone_offset
        )
        return SendTimeResponse(
            send_at=local_dt.isoformat(), send_at_utc=utc_dt.isoformat(),
            confidence=confidence, reasoning_layer="personalised",
            channel=features.channel, fallback=False,
        )
    except Exception:
        local_dt, utc_dt = _next_occurrence_utc(10, 1, 0)
        return SendTimeResponse(
            send_at=local_dt.isoformat(), send_at_utc=utc_dt.isoformat(),
            confidence=0.0, reasoning_layer="global_baseline",
            channel=features.channel if features else "email", fallback=True,
        )


@app.post("/predict/offer-value", response_model=OfferValueResponse,
          dependencies=[Depends(verify_internal_caller)])
async def predict_offer_value(features: OfferFeatures, request: Request = None):
    try:
        feature_vector = features.model_dump()
        merchant_id = request.headers.get("x-merchant-id") if request else None
        result = offer_value_predict.predict(feature_vector, merchant_id, db=None)
        return OfferValueResponse(**result)
    except Exception:
        return OfferValueResponse(
            discount_pct=0.0, offer_type="CART_REMINDER", offer_expires_hours=72,
            minimum_order_value=0.0, expected_recovery_probability=0.0,
            margin_cost_estimate_pct=0.0,
            reasoning="Inference error — defaulting to a safe no-discount nudge.",
            model_version="fallback", fallback=True,
        )


# ---------------------------------------------------------------------------
# Internal endpoints
# ---------------------------------------------------------------------------
def _trigger_platform_sync(store_id: str, platform: str):
    """
    Placeholder hook for the real Shopify/WooCommerce data-sync job.

    GAP (flagged, not fixed here): no such sync module exists anywhere in
    this repo yet — RevIntell_AI_LLM_Team_Tasks.docx describes the
    Node.js -> POST /internal/sync/trigger -> "Ire's sync trigger runs the
    WooCommerce sync" contract, but the actual sync implementation is not
    part of Task Group I's file list and isn't present anywhere in the
    provided codebase. This function logs the trigger so the endpoint's
    fire-and-forget contract is honoured end-to-end, and is the exact
    integration point a real sync module should be wired into.
    """
    logger.info(f"[sync-trigger] platform={platform} store_id={store_id} "
                f"— no real sync module wired yet (flagged gap, see docstring).")


@app.post("/internal/sync/trigger",
          dependencies=[Depends(verify_internal_caller), Depends(verify_internal_network)])
async def trigger_sync(payload: SyncTriggerRequest, background_tasks: BackgroundTasks):
    """
    Runs a Shopify/WooCommerce sync in the background and returns
    immediately. Restricted to internal-network callers (IP allowlist) AND
    the shared internal key, per Task I4.
    """
    background_tasks.add_task(_trigger_platform_sync, payload.store_id, payload.platform)
    return {"status": "accepted", "store_id": payload.store_id, "platform": payload.platform}


@app.post("/internal/rfm-sync", dependencies=[Depends(verify_internal_caller)])
async def trigger_rfm_sync(payload: RfmSyncRequest):
    """
    Runs the RFM sync job for the given store and returns the full result
    once complete, per the established backend_rfm_integration_guide.md
    contract (which explicitly needs processed_count/failed_customer_ids/
    segment_distribution back synchronously for logging — this is a
    documented deviation from the shorter I4 task doc's "returns
    immediately" phrasing, which is a better fit for /internal/sync/trigger
    than for this endpoint).

    The blocking DB work runs in a threadpool (not the asyncio event loop)
    so the server keeps serving other requests while this job runs.

    Per the guide: this endpoint always returns 200 with a
    processed_count of 0 on complete DB failure — it does not raise 500s
    for job-internal errors, only for auth failures (401/500 from the
    verify_internal_caller dependency) or a missing store_id (422, handled
    automatically by Pydantic).
    """
    result = await run_in_threadpool(rfm_sync.run, payload.store_id)
    return result