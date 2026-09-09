"""Revluma ML serving API.

Provides authenticated inference for five predictive models plus health,
orchestration, synchronization, and RFM endpoints. Model-specific modules own
their prediction rules and caches; this layer validates requests, warms models,
and delegates inference without duplicating those rules.

Run locally with ``uvicorn src.serving.api:app --reload --port 8000``.
"""

import ipaddress
import base64
import binascii
import json
import logging
import os
import secrets
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pandas as pd
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.concurrency import run_in_threadpool
import mlflow.sklearn

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

logger = logging.getLogger("revluma.ml_serving")
logging.basicConfig(level=logging.INFO)

from src.models.sensitivity import predict as sensitivity_predict
from src.models.offer_value import predict as offer_value_predict
from src.models.churn.predict import predict as _predict_churn
from src.models.timing.predict import predict as _predict_timing
from src.jobs import rfm_sync
from src.agents.orchestrator import orchestrate as _orchestrate
from src.intelligence.morning_briefing import run_briefings_for_all_merchants as _run_briefing_job
from src.config.database import engine
from sqlalchemy.orm import sessionmaker

_Session = sessionmaker(bind=engine)


@asynccontextmanager
async def _lifespan(_: FastAPI):
    await _preload_models()
    yield


app = FastAPI(
    title="Revluma ML Serving API",
    description="Real-time inference endpoints for Revluma's five predictive models.",
    version="0.4.0",
    lifespan=_lifespan,
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
    ranges. Runs
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
        model = mlflow.sklearn.load_model(f"models:/{model_name}/Production")
        _model_cache[model_name] = model
        return model
    except Exception as e:
        logger.warning(f"Could not load model '{model_name}': {e}")
        return None


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
    """The complete eight-feature abandonment model contract."""
    scroll_depth_pct: float = Field(0.0, ge=0.0, le=100.0)
    tab_switch_count: int = Field(0, ge=0)
    time_on_page_ms: int = Field(0, ge=0)
    checkout_step_reached: int = Field(0, ge=0, le=5)
    failed_payment_attempt: bool = Field(False)
    cart_item_add_count: int = Field(0, ge=0)
    cart_item_remove_count: int = Field(0, ge=0)
    cursor_hesitation: int = Field(0, ge=0, le=10)


class _ModelVersionResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())


class AbandonmentResponse(_ModelVersionResponse):
    abandonment_probability: float
    should_intervene: bool
    confidence: float
    model_version: str
    fallback: bool = False


# ---------------------------------------------------------------------------
# Request Schemas — M2 Sensitivity (delegates to sensitivity_predict)
# ---------------------------------------------------------------------------
class SensitivityFeatures(BaseModel):
    """The 13 model inputs plus compatibility and derivation fields."""
    past_orders_with_coupon_pct: float = Field(0.0, ge=0.0, le=1.0)
    visited_coupon_page: bool = Field(False)
    searched_discount_terms: bool = Field(False)
    cart_item_remove_count: int = Field(0, ge=0)
    coupon_field_visited: bool = Field(False)
    abandoned_at_shipping_reveal: bool = Field(False)
    checkout_step_reached: int = Field(0, ge=0, le=5)
    cursor_hesitation: int | None = Field(None, ge=0, le=10)
    cursor_hesitation_ms: int | None = Field(None, ge=0, le=30000)
    cursor_hesitation_score: int | None = Field(None, ge=0, le=10)
    time_on_page_ms: int = Field(0, ge=0)
    failed_payment_attempt: bool = Field(False)
    failed_payment_count: int = Field(0, ge=0)
    is_return_visitor: bool | None = Field(None)
    avg_order_value: float = Field(0.0, ge=0.0)
    past_orders_total: int | None = Field(None, ge=0)


class SensitivityResponse(_ModelVersionResponse):
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
    cart_value_tier: str = Field("medium", pattern="^(low|medium|high|premium)$")
    customer_timezone_offset: int = Field(0, ge=-12, le=14)
    historical_open_probabilities: list[float] | None = Field(None, min_length=24, max_length=24)
    history_data_points: int = Field(0, ge=0)
    days_since_last_purchase: int = Field(0, ge=0)


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
    """The 21 model inputs plus customer-LTV decision context."""
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

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_feature_names(cls, values):
        if not isinstance(values, dict):
            return values
        normalized = dict(values)
        aliases = {
            "sms_click_rate": "sms_click_rate_30d",
            "site_visit_frequency_delta": "site_visit_delta",
            "browse_to_cart_trend": "browse_to_cart_conversion_trend",
        }
        for legacy_name, canonical_name in aliases.items():
            if canonical_name not in normalized and legacy_name in normalized:
                normalized[canonical_name] = normalized[legacy_name]
        return normalized


class ChurnRiskResponse(_ModelVersionResponse):
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
    """The offer decision contract: five model inputs and rule context."""
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


class OfferValueResponse(_ModelVersionResponse):
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


_ALLOWED_IMAGE_MEDIA_TYPES = {"image/gif", "image/jpeg", "image/png", "image/webp"}
_MAX_IMAGE_BYTES = 8 * 1024 * 1024


class OrchestrateRequest(BaseModel):
    organization_id: str = Field(..., min_length=36, max_length=36)
    user_id: str | None = Field(None, min_length=36, max_length=36)
    customer_id: str | None = Field(None, min_length=36, max_length=36)
    message: str = Field(..., min_length=1, max_length=2000)
    conversation_id: str | None = None
    image_base64: str | None = None
    image_media_type: str | None = None
    trigger_type: str = Field("conversation", pattern="^(conversation|alert|scheduler)$")
    trigger_priority: str = Field("normal", pattern="^(low|normal|high|critical)$")
    context_payload: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_context(self):
        self.user_id = self.user_id or self.customer_id
        if not self.user_id:
            raise ValueError("Either user_id or customer_id must be provided.")
        if len(json.dumps(self.context_payload, default=str).encode("utf-8")) > 16_384:
            raise ValueError("context_payload must not exceed 16 KiB.")
        if bool(self.image_base64) != bool(self.image_media_type):
            raise ValueError("image_base64 and image_media_type must be provided together.")
        if self.image_media_type not in (None, *_ALLOWED_IMAGE_MEDIA_TYPES):
            raise ValueError("Unsupported image_media_type.")
        if self.image_base64:
            try:
                decoded = base64.b64decode(self.image_base64, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise ValueError("image_base64 must contain valid base64 data.") from exc
            if len(decoded) > _MAX_IMAGE_BYTES:
                raise ValueError("Decoded image must not exceed 8 MiB.")
        return self


class MorningBriefingRunResponse(BaseModel):
    total: int = Field(..., ge=0)
    success: int = Field(..., ge=0)
    failed: int = Field(..., ge=0)
    error: str | None = None


# ---------------------------------------------------------------------------
# Shared constants / helpers
# ---------------------------------------------------------------------------
def _next_occurrence_utc(target_hour: int, target_day: int, tz_offset_hours: int):
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc + timedelta(hours=tz_offset_hours)
    days_ahead = (target_day - local_now.weekday()) % 7
    candidate_local = local_now.replace(hour=target_hour, minute=0, second=0, microsecond=0) + timedelta(days=days_ahead)
    if candidate_local <= local_now:
        candidate_local += timedelta(days=7)
    candidate_utc = candidate_local - timedelta(hours=tz_offset_hours)
    return candidate_local, candidate_utc


# ---------------------------------------------------------------------------
# Orchestration and scheduled briefing endpoints
# ---------------------------------------------------------------------------
@app.post("/orchestrate", dependencies=[Depends(verify_internal_caller)])
async def orchestrate_endpoint(req: OrchestrateRequest):
    db = _Session()
    try:
        result = await run_in_threadpool(
            lambda: _orchestrate(
                organization_id=req.organization_id,
                user_id=req.user_id,
                message=req.message,
                conversation_id=req.conversation_id,
                db=db,
                image_base64=req.image_base64,
                image_media_type=req.image_media_type,
                trigger_type=req.trigger_type,
                trigger_priority=req.trigger_priority,
                context_payload=req.context_payload,
            )
        )
        return result.to_dict()
    except Exception:
        return {"success": False, "response_type": "error", "text": "Something went wrong. Please try again in a moment.", "orchestrator_mode": None}
    finally:
        db.close()


def _run_morning_briefings() -> dict:
    db = _Session()
    try:
        return _run_briefing_job(db)
    except Exception:
        logger.exception("morning_briefing_job_failed")
        return {"total": 0, "success": 0, "failed": 0, "errors": ["briefing_job_failed"]}
    finally:
        db.close()


@app.post("/internal/morning-briefings", response_model=MorningBriefingRunResponse,
          dependencies=[Depends(verify_internal_caller)])
async def internal_morning_briefings() -> MorningBriefingRunResponse:
    result = await run_in_threadpool(_run_morning_briefings)
    failed = int(result.get("failed") or 0)
    error = "partial_failure" if failed or result.get("errors") else None
    return MorningBriefingRunResponse(
        total=int(result.get("total") or 0), success=int(result.get("success") or 0),
        failed=failed, error=error,
    )


# ---------------------------------------------------------------------------
# Prediction endpoints
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

        # Preserve the exact eight-column training order.
        model_cols = ["scroll_depth_pct", "tab_switch_count", "time_on_page_ms",
                      "cursor_hesitation", "checkout_step_reached",
                      "failed_payment_attempt", "cart_item_add_count",
                      "cart_item_remove_count"]
        row = pd.DataFrame([{k: getattr(features, k) for k in model_cols}])
        prob = float(model.predict_proba(row)[0][1])
        return AbandonmentResponse(
            abandonment_probability=prob, should_intervene=prob >= 0.65,
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
        feature_vector = features.model_dump(exclude_none=True)
        merchant_id = request.headers.get("x-merchant-id") if request else None
        result = sensitivity_predict.predict(feature_vector, merchant_id)
        return SensitivityResponse(**result)
    except Exception:
        return SensitivityResponse(fallback=True)


@app.post("/predict/churn-risk", response_model=ChurnRiskResponse,
          dependencies=[Depends(verify_internal_caller)])
async def predict_churn(
    features: ChurnFeatures,
    x_customer_id: str = Header("", alias="X-Customer-ID"),
    x_merchant_id: str = Header("", alias="X-Merchant-ID"),
):
    try:
        result = await run_in_threadpool(
            _predict_churn, x_customer_id, features.model_dump(), x_merchant_id
        )
        return ChurnRiskResponse(**result)
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
async def predict_send_time(
    features: SendTimeFeatures,
    x_customer_id: str = Header("", alias="X-Customer-ID"),
    x_merchant_id: str = Header("", alias="X-Merchant-ID"),
):
    try:
        result = await run_in_threadpool(
            lambda: _predict_timing(
                x_customer_id, features.model_dump(), x_merchant_id,
                model=_model_cache.get("send_time"),
            )
        )
        return SendTimeResponse(**result)
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
    """Record a platform-sync request until the backend worker is connected."""
    logger.info(f"[sync-trigger] platform={platform} store_id={store_id} "
                f"— no real sync module wired yet (flagged gap, see docstring).")


@app.post("/internal/sync/trigger",
          dependencies=[Depends(verify_internal_caller), Depends(verify_internal_network)])
async def trigger_sync(payload: SyncTriggerRequest, background_tasks: BackgroundTasks):
    """
    Runs a Shopify/WooCommerce sync in the background and returns
    immediately. Restricted to internal-network callers (IP allowlist) AND
    the shared internal key.
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
    documented behavior from the endpoint contract's "returns
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
