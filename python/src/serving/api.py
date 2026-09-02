import json
import typing
"""
Revluma ML Serving API
Real-time inference endpoints for Revluma's five predictive models.
uvicorn src.serving.api:app --reload --port 8000

#--
#newly added
#--
CORRECTIONS APPLIED (auditing the uploaded draft against the task doc's
actual P2.1 spec found several real mismatches - see chat for the full
audit table). Summary of what changed in this rewrite:

  1. AbandonmentFeatures - added cursor_hesitation,
     cart_item_add_count, and cart_item_remove_count (8 fields total).

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

from contextlib import asynccontextmanager
import asyncio
import functools
import logging
import os
import secrets
import sys
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
from fastapi import FastAPI, Depends, HTTPException, Header, Query
from pydantic import BaseModel, Field, model_validator
import mlflow.sklearn

from ..models.churn.predict import predict as _predict_churn
from ..models.churn.train import normalize_churn_features
from ..models.timing.predict import predict as _predict_timing


logger = logging.getLogger("rev.serving.api")

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manages application startup and shutdown lifecycle.
    Preloads all five ML models into the in-memory cache on startup so
    the first real request is not penalised with a cold-load latency spike.
    Never raises on missing models — that is exactly what fallback logic is for.
    """
    for name in MODEL_NAMES:
        model = _load_model(name)
        status = "loaded" if model is not None else "FALLBACK (not found)"
        logger.info(
            "model_preload_completed",
            extra={"model_name": name, "model_status": status},
        )
    yield  # Application runs here
    # Shutdown: nothing to clean up — model cache lives only in process memory.


_START_TIME = time.time()

app = FastAPI(
    title="Revluma ML Serving API",
    description="Real-time inference endpoints for Revluma's five predictive models.",
    version="0.2.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# Internal API Key Authentication (F-02)
# ---------------------------------------------------------------------------
# Only callers presenting a valid X-Internal-Key header may hit /predict/*.
# The /health endpoint remains open (needed for uptime probes / load balancers).
ML_INTERNAL_KEY = os.environ.get("ML_INTERNAL_KEY", "")

async def verify_internal_caller(
    x_internal_key: str = Header(None),
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


# ---------------------------------------------------------------------------
# Request Schemas (Pydantic)
# ---------------------------------------------------------------------------
class AbandonmentFeatures(BaseModel):
    scroll_depth_pct: float = Field(0.0, ge=0.0, le=100.0)
    tab_switch_count: int = Field(0, ge=0)
    time_on_page_ms: int = Field(0, ge=0)
    cursor_hesitation: int = Field(0, ge=0, le=10)
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
    cursor_hesitation: int = Field(0, ge=0, le=10)
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
    historical_aov_trend: int = Field(0, ge=-1, le=1)
    email_open_rate_30d: float = Field(0.0, ge=0.0, le=1.0)
    email_open_rate_90d: float = Field(0.0, ge=0.0, le=1.0)
    email_open_rate_delta: float = Field(0.0, ge=-1.0, le=1.0)
    sms_click_rate_30d: float = Field(0.0, ge=0.0, le=1.0)
    site_visit_frequency_30d: float = Field(0.0, ge=0.0)
    site_visit_frequency_90d: float = Field(0.0, ge=0.0)
    site_visit_delta: float = Field(0.0)
    browse_to_cart_conversion_trend: int = Field(0, ge=-1, le=1)
    coupon_dependency_score: float = Field(0.0, ge=0.0, le=1.0)
    return_rate: float = Field(0.0, ge=0.0, le=1.0)
    support_contact_frequency_90d: int = Field(0, ge=0)
    discount_seeking_escalation: int = Field(0, ge=0, le=1)
    unsubscribe_risk_score: float = Field(0.0, ge=0.0, le=1.0)
    customer_ltv: float = Field(0.0, ge=0.0)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_feature_names(cls, values):
        if isinstance(values, dict):
            return normalize_churn_features(values)
        return values


class SendTimeFeatures(BaseModel):
    # Legacy session fields remain accepted while the canonical M3 model scores
    # candidate send_hour/send_day values internally.
    local_hour_of_session: int = Field(12, ge=0, le=23)
    day_of_week_session: int = Field(0, ge=0, le=6)
    channel: str = Field("email", pattern="^(email|sms|whatsapp)$")
    recovery_action: str = Field(
        "SOFT_NUDGE",
        pattern="^(DISCOUNT|FRICTION_FIX|TRUST_REASSURE|HYBRID_BUNDLE|"
                "TRUST_PLUS_DEAL|FRICTION_PLUS_TRUST|FULL_PERSONALISE|"
                "HYBRID|NUDGE|SOFT_NUDGE)$"
    )
    cart_value_tier: str = Field("medium", pattern="^(low|medium|high|premium)$")
    customer_timezone_offset: int = Field(0, ge=-12, le=14)
    historical_open_probabilities: list[float] = Field(default_factory=list)
    history_data_points: int = Field(0, ge=0)
    days_since_last_purchase: int = Field(-1, ge=-1)
    failed_payment_attempt: bool = False
    risk_score: float = Field(0.0, ge=0.0, le=1.0)
    sequence_message_number: int = Field(1, ge=1, le=3)
    previous_message_sent_at: typing.Optional[datetime] = None
    previous_message_opened: bool = False
    previous_message_clicked: bool = False
    last_sms_sent_at: typing.Optional[datetime] = None
    secondary_channel: typing.Optional[str] = Field(
        None,
        pattern="^(email|sms|whatsapp)$",
    )

    @model_validator(mode="after")
    def validate_open_probability_slots(self) -> "SendTimeFeatures":
        slots = self.historical_open_probabilities
        if slots and len(slots) != 24:
            raise ValueError("historical_open_probabilities must contain exactly 24 slots")
        if any(probability < 0.0 or probability > 1.0 for probability in slots):
            raise ValueError("historical open probabilities must be between 0 and 1")
        return self


class OfferValueFeatures(BaseModel):
    pss_score: int = Field(0, ge=0, le=100)
    css_score: int = Field(0, ge=0, le=100)
    # tss_score: M2 output per the doc ("PSS + CSS + TSS"), but no real
    # backing data exists yet anywhere in the repo - see M5 train.py.
    # Defaults to 0 (not trust-blocked) so the TRUST_SIGNAL gate doesn't
    # spuriously fire until real TSS data is available.
    tss_score: int = Field(0, ge=0, le=100)
    cursor_hesitation: int = Field(0, ge=0, le=10)
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
    primary_churn_signal: str
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
# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


# ============================================================================
# Rev Intelligence — /orchestrate endpoint
# ============================================================================

from ..agents.orchestrator import orchestrate as _orchestrate
from ..intelligence.morning_briefing import (
    run_briefings_for_all_merchants as _run_briefing_job,
)
from ..config.database import engine
from sqlalchemy.orm import sessionmaker

_Session = sessionmaker(bind=engine)
_ALLOWED_IMAGE_MEDIA_TYPES = {
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
}
_MAX_IMAGE_BYTES = 8 * 1024 * 1024
_MAX_IMAGE_BASE64_CHARS = ((_MAX_IMAGE_BYTES + 2) // 3) * 4


class OrchestrateRequest(BaseModel):
    organization_id: str = Field(..., min_length=36, max_length=36)
    # Accept either user_id (platform auth context) or customer_id (ML/event context).
    # Same dual-source pattern as event.get("timestamp") or event.get("created_at").
    # Whichever is provided is normalised to user_id before reaching the orchestrator.
    user_id: typing.Optional[str] = Field(None, min_length=36, max_length=36)
    customer_id: typing.Optional[str] = Field(None, min_length=36, max_length=36)
    message: str = Field(..., min_length=1, max_length=2000)
    conversation_id: typing.Optional[str] = Field(None, min_length=36, max_length=36)
    image_base64: typing.Optional[str] = Field(
        None,
        max_length=_MAX_IMAGE_BASE64_CHARS,
    )
    image_media_type: typing.Optional[str] = Field(None)  # image/jpeg | image/png | image/webp | image/gif
    contract_version: typing.Optional[str] = Field(None)
    correlation_id: typing.Optional[str] = Field(None)
    trigger_type: str = Field(
        "conversation",
        pattern="^(conversation|alert|scheduler)$",
    )
    trigger_priority: str = Field(
        "normal",
        pattern="^(low|normal|high|critical)$",
    )
    context_payload: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def resolve_user_id(self) -> "OrchestrateRequest":
        """Normalise user_id / customer_id — accept either, resolve to user_id.

        Mirrors the timestamp dual-source pattern:
            event.get("timestamp") or event.get("created_at")
        Here:
            req.user_id or req.customer_id

        Raises ValueError if neither is supplied, so callers always get a
        clear validation error rather than a silent None.
        """
        resolved = self.user_id or self.customer_id
        if not resolved:
            raise ValueError(
                "Either user_id or customer_id must be provided."
            )
        if len(json.dumps(self.context_payload, default=str).encode("utf-8")) > 16_384:
            raise ValueError("context_payload must not exceed 16 KiB.")
        if bool(self.image_base64) != bool(self.image_media_type):
            raise ValueError(
                "image_base64 and image_media_type must be provided together."
            )
        if self.image_media_type:
            if self.image_media_type not in _ALLOWED_IMAGE_MEDIA_TYPES:
                raise ValueError("Unsupported image_media_type.")
            import base64
            import binascii

            try:
                decoded_image = base64.b64decode(self.image_base64, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise ValueError("image_base64 must contain valid base64 data.") from exc
            if len(decoded_image) > _MAX_IMAGE_BYTES:
                raise ValueError("Decoded image must not exceed 8 MiB.")
        # Normalise: always store the resolved value in user_id so all
        # downstream code (orchestrator, DB writes) remains unchanged.
        self.user_id = resolved
        return self


@app.post("/orchestrate", dependencies=[Depends(verify_internal_caller)])
async def orchestrate_endpoint(req: OrchestrateRequest):
    """
    Rev Intelligence orchestration endpoint.
    Returns multi-type response: conversational | analysis | capability | clarification | error.
    Never returns 500.
    """
    import asyncio

    db = _Session()
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None,
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
        import uuid as _uuid
        return {
            "success": False,
            "conversation_id": req.conversation_id or str(_uuid.uuid4()),
            "message_id": str(_uuid.uuid4()),
            "response_type": "error",
            "text": "Something went wrong. Please try again in a moment.",
            "situation": None, "insight": None, "implication": None,
            "recommendation": None, "confidence_score": None,
            "confidence_basis": None, "actions": [],
            "agents_used": [], "business_state_age_minutes": 0.0,
            "business_state_id": None, "warnings": [],
            "ad_evaluation": None,
            "orchestrator_mode": None,
            "correlation_id": str(_uuid.uuid4()), "latency_ms": 0,
        }
    finally:
        db.close()



class MorningBriefingRunResponse(BaseModel):
    total: int = Field(..., ge=0)
    success: int = Field(..., ge=0)
    failed: int = Field(..., ge=0)
    error: typing.Optional[str] = None


def _run_morning_briefings() -> dict:
    """Own the database session for one complete scheduled briefing run."""
    db = _Session()
    try:
        return _run_briefing_job(db)
    except Exception as exc:
        logger.error(
            "morning_briefing_job_failed",
            extra={"error_type": type(exc).__name__},
        )
        return {
            "total": 0,
            "success": 0,
            "failed": 0,
            "errors": ["briefing_job_failed"],
        }
    finally:
        db.close()


@app.post(
    "/internal/morning-briefings",
    response_model=MorningBriefingRunResponse,
    dependencies=[Depends(verify_internal_caller)],
)
async def internal_morning_briefings() -> MorningBriefingRunResponse:
    """Generate all daily briefings without blocking the API event loop."""
    result = await _run_inference(_run_morning_briefings)
    has_job_error = bool(result.get("errors"))
    failed = int(result.get("failed") or 0)
    error = None
    if has_job_error:
        error = "partial_failure" if result.get("success") else "job_failed"
    elif failed:
        error = "partial_failure"
    return MorningBriefingRunResponse(
        total=int(result.get("total") or 0),
        success=int(result.get("success") or 0),
        failed=failed,
        error=error,
    )


# ── Feature Pipeline Endpoint ─────────────────────────────────────────────────
# Called by Node.js after every event ingestion.
# Loads session events from DB, runs the S1/S2 pipeline, returns ML prediction.

class FeaturesComputeRequest(BaseModel):
    customer_id:  typing.Optional[str] = None
    anonymous_id: typing.Optional[str] = None
    session_id:   str
    store_id:     str
    merchant_id:  typing.Optional[str] = None

class FeaturesComputeResponse(BaseModel):
    success:    bool
    session_id: str
    prediction: typing.Optional[dict] = None
    fallback:   bool = False
    error:      typing.Optional[str] = None

@app.post(
    "/api/features/compute",
    response_model=FeaturesComputeResponse,
    dependencies=[Depends(verify_internal_caller)],
)
async def compute_features(req: FeaturesComputeRequest) -> FeaturesComputeResponse:
    """
    Triggered by Node.js after a pixel event is saved.
    Loads all session events, runs the full S1/S2 feature pipeline,
    runs ML inference, and returns a real-time prediction.
    """
    import asyncio

    db = _Session()
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: _run_feature_pipeline(req, db)
        )
        return result
    except Exception:
        logger.exception(
            "feature_pipeline_failed",
            extra={"error_type": type(e).__name__},
        )
        return FeaturesComputeResponse(
            success=False,
            session_id=req.session_id,
            fallback=True,
            error=str(e),
        )
    finally:
        db.close()


def _run_feature_pipeline(req: FeaturesComputeRequest, db) -> FeaturesComputeResponse:
    """
    Synchronous feature pipeline runner.
    Imports pipeline functions from David's S1/S2 implementation.
    """
    try:
        from sqlalchemy import text
        import pandas as pd

        # Load raw events for this session from DB
        rows = db.execute(text("""
            SELECT
                id, store_id, session_id, event_type,
                customer_id, anonymous_id, payload,
                created_at
            FROM events
            WHERE session_id = :session_id
              AND store_id   = :store_id
            ORDER BY created_at ASC
            LIMIT 200
        """), {"session_id": req.session_id, "store_id": req.store_id}).fetchall()

        if not rows:
            return FeaturesComputeResponse(
                success=True,
                session_id=req.session_id,
                prediction=None,
                fallback=False,
            )

        # Convert to list of dicts for the pipeline
        events = []
        for r in rows:
            payload = r[6] or {}
            if isinstance(payload, str):
                import json
                try:
                    payload = json.loads(payload)
                except Exception:
                    payload = {}
            events.append({
                "id":           str(r[0]),
                "store_id":     str(r[1]),
                "session_id":   str(r[2]),
                "event_type":   r[3],
                "customer_id":  str(r[4]) if r[4] else None,
                "anonymous_id": str(r[5]) if r[5] else None,
                "payload":      payload,
                "created_at":   r[7].isoformat() if r[7] else None,
            })

        # Import David's pipeline entry point
        try:
            from ..features.pipeline import compute_feature_vector
            from ..features.event_processor import parse_raw_event

            # Parse raw events through S2 processor
            parsed_events = [parse_raw_event(e) for e in events]
            parsed_events = [e for e in parsed_events if e is not None]

            if not parsed_events:
                return FeaturesComputeResponse(
                    success=True,
                    session_id=req.session_id,
                    prediction=None,
                    fallback=True,
                )

            # Compute full 30-feature vector through S1 pipeline
            feature_vector = compute_feature_vector(parsed_events)

        except ImportError as ie:
            # Pipeline not yet available — return graceful fallback
            logger.warning(
                "feature_pipeline_import_failed",
                extra={"error_type": type(ie).__name__},
            )
            return FeaturesComputeResponse(
                success=True,
                session_id=req.session_id,
                prediction=None,
                fallback=True,
            )

        # Run M1 abandonment prediction on the feature vector
        prediction = None
        try:
            if _models.get("abandonment"):
                from ..models.abandonment.predict import predict_abandonment
                pred = predict_abandonment(feature_vector)
                if pred.get("probability", 0) > 0.65:
                    prediction = {
                        "show_offer":       True,
                        "offer_type":       "recovery_incentive",
                        "abandonment_prob": pred.get("probability"),
                        "confidence":       pred.get("confidence"),
                        "fallback":         pred.get("fallback", False),
                    }
                else:
                    prediction = {
                        "show_offer":       False,
                        "abandonment_prob": pred.get("probability"),
                        "confidence":       pred.get("confidence"),
                    }
        except Exception as me:
            logger.exception(
                "m1_inference_failed",
                extra={"error_type": type(me).__name__},
            )
            prediction = {"show_offer": False, "fallback": True}

        return FeaturesComputeResponse(
            success=True,
            session_id=req.session_id,
            prediction=prediction,
            fallback=False,
        )

    except Exception:
        logger.exception(
            "feature_pipeline_inner_failed",
            extra={"error_type": type(e).__name__},
        )
        return FeaturesComputeResponse(
            success=False,
            session_id=req.session_id,
            fallback=True,
            error=str(e),
        )




# ── UUID format validator ────────────────────────────────────────────────────
import re as _re
_UUID_RE = _re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', _re.I)

def _validate_uuid(value: str, field: str) -> None:
    if not _UUID_RE.match(value):
        raise HTTPException(status_code=400, detail=f"Invalid {field} format.")

# ── Morning Briefing Endpoint ─────────────────────────────────────────────────

class BriefingResponse(BaseModel):
    success:                bool
    briefing:               typing.Optional[dict] = None
    error:                  typing.Optional[str]  = None

@app.post(
    "/briefing/generate",
    response_model=BriefingResponse,
    dependencies=[Depends(verify_internal_caller)],
)
async def generate_morning_briefing(
    organization_id: str = Query(..., min_length=36, max_length=36),
) -> BriefingResponse:
    """
    Generate (or return cached) morning briefing for an organisation.
    Called by Node.js on first dashboard load of the day.
    Returns the 6-section MorningBriefing as a dict.
    """
    import asyncio
    _validate_uuid(organization_id, "organization_id")
    db = _Session()
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: _generate_briefing(organization_id, db)
        )
        return result
    finally:
        db.close()


def _generate_briefing(organization_id: str, db) -> BriefingResponse:
    try:
        from ..intelligence.morning_briefing import generate_briefing
        briefing = generate_briefing(organization_id, db)
        return BriefingResponse(success=True, briefing=briefing.to_dict())
    except Exception as e:
        logger.exception(
            "briefing_generation_failed",
            extra={"error_type": type(e).__name__},
        )
        return BriefingResponse(success=False, error=str(e))




# ── Proactive Anomaly Alert Endpoint ─────────────────────────────────────────
# Called automatically after every Business State rebuild.
# If anomalies are detected, POST to Node.js to create notifications.

class AnomalyAlertRequest(BaseModel):
    organization_id: str
    user_ids:        typing.List[str]  # users in this org to notify

class AnomalyAlertResponse(BaseModel):
    success:  bool
    alerts:   typing.List[dict] = []
    error:    typing.Optional[str] = None

@app.post(
    "/api/alerts/check",
    response_model=AnomalyAlertResponse,
    dependencies=[Depends(verify_internal_caller)],
)
async def check_anomalies(req: AnomalyAlertRequest) -> AnomalyAlertResponse:
    """
    Checks current Business State for anomalies and returns structured alerts.
    Node.js calls this after each Business State rebuild, then creates
    notifications for the org's users via the existing notifications table.
    """
    import asyncio
    db = _Session()
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: _check_anomalies(req, db)
        )
        return result
    finally:
        db.close()


def _check_anomalies(req: AnomalyAlertRequest, db) -> AnomalyAlertResponse:
    try:
        from ..intelligence.business_state import load_current_business_state
        state = load_current_business_state(req.organization_id, db)
        if not state:
            return AnomalyAlertResponse(success=True, alerts=[])

        alerts = []

        # Revenue anomaly
        if state.revenue_anomaly and state.revenue_delta_pct is not None:
            direction = "dropped" if state.revenue_delta_pct < 0 else "spiked"
            pct = abs(state.revenue_delta_pct)
            alerts.append({
                "type":       "revenue_anomaly",
                "severity":   "high" if pct > 30 else "medium",
                "message":    f"Revenue {direction} {pct:.1f}% compared to yesterday. Rev has more details.",
                "action_url": "/dashboard/rev-intell",
            })

        # Cart abandonment anomaly
        if state.cart_anomaly and state.abandoned_cart_value is not None:
            val = float(state.abandoned_cart_value)
            alerts.append({
                "type":       "cart_anomaly",
                "severity":   "high",
                "message":    f"Cart abandonment rate spiked. ${val:,.0f} in carts at risk. Ask Rev why.",
                "action_url": "/dashboard/cart-recovery",
            })

        # High churn risk
        if state.churn_risk_count and state.churn_risk_count >= 10:
            alerts.append({
                "type":       "churn_risk",
                "severity":   "medium",
                "message":    f"{state.churn_risk_count} customers showing early churn signals.",
                "action_url": "/dashboard/customers",
            })

        return AnomalyAlertResponse(success=True, alerts=alerts)

    except Exception as e:
        logger.exception(
            "anomaly_check_failed",
            extra={"error_type": type(e).__name__},
        )
        return AnomalyAlertResponse(success=False, error=str(e))


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

        feature_vector = pd.DataFrame([features.model_dump()])
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

        feature_vector = pd.DataFrame([features.model_dump()])
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
async def predict_churn(
    features: ChurnFeatures,
    x_customer_id: str = Header("", alias="X-Customer-ID"),
    x_merchant_id: str = Header("", alias="X-Merchant-ID"),
) -> ChurnRiskResponse:
    result = await _run_inference(
        _predict_churn,
        x_customer_id,
        features.model_dump(),
        x_merchant_id,
    )
    return ChurnRiskResponse(**result)


@app.post("/predict/send-time", response_model=SendTimeResponse,
          dependencies=[Depends(verify_internal_caller)])
async def predict_send_time(
    features: SendTimeFeatures,
    x_customer_id: str = Header("", alias="X-Customer-ID"),
    x_merchant_id: str = Header("", alias="X-Merchant-ID"),
) -> SendTimeResponse:
    # Startup owns registry access; requests only read the in-memory cache.
    model = _model_cache.get("send_time")
    result = await _run_inference(
        lambda: _predict_timing(
            x_customer_id,
            features.model_dump(),
            x_merchant_id,
            model=model,
        )
    )
    return SendTimeResponse(**result)


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


# ---------------------------------------------------------------------------
# S4 - RFM sync (internal, called by the Node backend after a store sync)
#
# RevIntell_AI_LLM_Team_Tasks.txt:312 - "the Node.js layer calls
# POST /internal/rfm-sync with { store_id }. Samuel's RFM sync runs. This is
# automatic. No manual triggering."
#
# Until this existed, rfm_sync was reachable only from its CLI entry point, so
# rfm_segment was never repopulated after a store sync - which is what leaves
# ml_signals empty in production and blocks the M4-driven paths in the
# retention agent and the VIP/LTV paths in the customer agent.
# ---------------------------------------------------------------------------

from ..jobs.rfm_sync import run as _run_rfm_sync


class RfmSyncRequest(BaseModel):
    store_id: str = Field(..., min_length=1,
                          description="UUID of the store/merchant to process")


class RfmSyncResponse(BaseModel):
    processed_count:      int
    failed_customer_ids:  typing.List[str]
    segment_distribution: typing.Dict[str, int]
    success:              bool = False
    failed_count:         int = 0
    error:                typing.Optional[str] = None


@app.post("/internal/rfm-sync", response_model=RfmSyncResponse,
          dependencies=[Depends(verify_internal_caller)])
async def internal_rfm_sync(request: RfmSyncRequest) -> RfmSyncResponse:
    """Recalculate RFM scores and segments for every customer in one store.

    Thin wrapper over the S4 job. `rfm_sync.run` opens and closes its own
    connection and never raises. A missing DATABASE_URL, failed connection,
    partial customer failure, or failed commit is represented by `success`,
    `failed_count`, and a sanitized `error` code. Backend callers must inspect
    those fields even though the failsafe endpoint still returns HTTP 200.

    The job is blocking (psycopg2, plus a loop over every customer in the
    store), so it is offloaded to the thread pool rather than run on the event
    loop. Without that, one large store would stall every other request in
    flight.
    """
    result = await _run_inference(_run_rfm_sync, request.store_id)
    return RfmSyncResponse(**result)
