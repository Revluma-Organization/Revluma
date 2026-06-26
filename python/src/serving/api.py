"""
Revluma ML Serving API
========================
FastAPI skeleton with placeholder route stubs for all five model endpoints.

All routes follow the pattern:
    1. Receive session/customer identifiers
    2. Pull precomputed features from Redis Feature Store
    3. Load the relevant merchant-specific model
    4. Return prediction + metadata
uvicorn src.serving.api:app --reload --port 8000
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(
    title="Revluma ML Serving API",
    description="Real-time inference endpoints for Revluma's five predictive models.",
    version="0.1.0"
)


# ---------------------------------------------------------------------------
# Request / Response schemas (stubs — expand in Week 4)
# ---------------------------------------------------------------------------

class SessionRequest(BaseModel):
    session_id: str
    customer_id: str
    merchant_id: str


class AbandonmentResponse(BaseModel):
    abandonment_probability: float
    should_intervene: bool
    confidence: float
    model_version: str


class SensitivityResponse(BaseModel):
    pss_score: int
    css_score: int
    classification: str       # price_sensitive | convenience_sensitive | dual_sensitive | neutral | ambiguous
    recovery_action: str      # DISCOUNT | FRICTION_FIX | HYBRID | NUDGE | SOFT_NUDGE
    model_version: str


class ChurnRiskResponse(BaseModel):
    churn_score: float
    risk_level: str           # low | medium | high
    trigger_winback: bool
    customer_segment: str     # champion | loyal | at_risk | hibernating | lost
    model_version: str


class SendTimeResponse(BaseModel):
    best_send_hour: int       # 0–23 local time
    best_send_day: int        # 0–6 (0=Monday)
    confidence: float
    fallback_used: bool
    model_version: str


class OfferValueResponse(BaseModel):
    recommended_discount_pct: int
    confidence: float
    model_version: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    """Basic health check — used by Docker and Railway/Render deployment."""
    return {"status": "ok", "service": "revluma-ml-serving"}


@app.post("/predict/abandonment-probability", response_model=AbandonmentResponse)
async def predict_abandonment(request: SessionRequest):
    """
    M1 — Abandonment Probability Predictor

    Scores a live checkout session for abandonment risk.
    Called every 60 seconds by the session monitoring job.

    Features pulled from Redis:
        scroll_depth_checkout_pct, tab_switch_count_session,
        time_on_checkout_step_sec, checkout_step_abandoned,
        failed_payment_attempt

    Returns abandonment_probability (0.0–1.0) and whether to intervene.
    """
    # TODO Week 4: pull features from Redis, load M1, return prediction
    raise HTTPException(status_code=501, detail="Not implemented yet — Week 4")


@app.post("/predict/shopper-sensitivity", response_model=SensitivityResponse)
async def predict_sensitivity(request: SessionRequest):
    """
    M2 — Price vs. Convenience Sensitivity Classifier

    Classifies a shopper's sensitivity profile and outputs PSS + CSS scores.
    Must run BEFORE /predict/offer-value (M5 depends on PSS/CSS output).

    Features pulled from Redis:
        scroll_depth_checkout_pct, tab_switch_count_session,
        checkout_step_abandoned, cursor_hesitation_ms_on_price_field,
        past_orders_with_coupon_pct, visited_coupon_page,
        searched_discount_terms, abandoned_at_shipping_reveal

    Returns PSS score, CSS score, classification, and recommended recovery action.
    """
    # TODO Week 4: pull features from Redis, load M2, return prediction
    raise HTTPException(status_code=501, detail="Not implemented yet — Week 4")


@app.post("/predict/churn-risk", response_model=ChurnRiskResponse)
async def predict_churn(request: SessionRequest):
    """
    M4 — Churn Risk Scorer

    Scores a customer's churn probability. Typically called by the daily
    cron job, not in real-time session flow.

    Features pulled from Redis / customer_crm:
        past_orders_total, days_since_last_purchase,
        avg_order_value, purchase_frequency_trend,
        rfm_recency_score, rfm_frequency_score, rfm_monetary_score

    Returns churn_score (0–100). Score > 61 triggers 3-touch win-back sequence.
    """
    # TODO Week 4: pull features, load M4, return prediction
    raise HTTPException(status_code=501, detail="Not implemented yet — Week 4")


@app.post("/predict/send-time", response_model=SendTimeResponse)
async def predict_send_time(request: SessionRequest):
    """
    M3 — Optimal Send-Time Predictor

    Predicts the best hour and day to send a recovery message to this customer.
    Called at the point a recovery message is queued, before Channel Dispatcher sends.

    Features pulled from Redis / recovery_events:
        local_hour_of_session, day_of_week_session,
        email_open_hour_history, email_click_hour_history,
        sms_response_hour_history

    Returns best_send_hour (0–23 local) and best_send_day (0–6).
    Falls back to 10 AM / 7 PM defaults at MVP launch (no training data yet).
    """
    # TODO Week 4: pull features, load M3, return prediction
    raise HTTPException(status_code=501, detail="Not implemented yet — Week 4")


@app.post("/predict/offer-value", response_model=OfferValueResponse)
async def predict_offer_value(request: SessionRequest):
    """
    M5 — Offer Value Optimizer

    Determines the minimum discount percentage needed to convert a shopper.
    Must run AFTER /predict/shopper-sensitivity (M2).

    Features pulled from Redis:
        pss_score, css_score, cursor_hesitation_ms_on_price_field,
        past_orders_total, past_orders_with_coupon_pct,
        days_since_last_purchase, avg_order_value, visited_coupon_page,
        searched_discount_terms, failed_coupon_attempt

    Returns recommended_discount_pct.
    """
    # TODO Week 4: pull features, load M5, return prediction
    raise HTTPException(status_code=501, detail="Not implemented yet — Week 4")
