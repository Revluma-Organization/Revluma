"""
Revluma ML Serving API
========================
Real-time inference endpoints for Revluma's five predictive models.
uvicorn src.serving.api:app --reload --port 8000
"""

import os
import sys
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import mlflow.sklearn

# Setup MLflow configuration
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))
try:
    from src.config.mlflow_config import get_or_create_experiment
    get_or_create_experiment()
except Exception:
    pass # Failsafe

app = FastAPI(
    title="Revluma ML Serving API",
    description="Real-time inference endpoints for Revluma's five predictive models.",
    version="0.1.0"
)

# ---------------------------------------------------------------------------
# Global State & Caching
# ---------------------------------------------------------------------------
_model_cache: dict = {}

def _load_model(model_name: str):
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
    checkout_step_reached: int = Field(0, ge=0, le=5)
    failed_payment_attempt: int = Field(0, ge=0, le=1)

class SensitivityFeatures(BaseModel):
    coupon_usage_pct: float = Field(0.0, ge=0.0, le=100.0)
    visited_coupon_page: int = Field(0, ge=0, le=1)
    searched_discount_terms: int = Field(0, ge=0, le=1)
    cursor_hesitation: float = Field(0.0, ge=0.0)
    abandoned_at_shipping_reveal: int = Field(0, ge=0, le=1)
    checkout_step_reached: int = Field(0, ge=0, le=5)
    scroll_depth_pct: float = Field(0.0, ge=0.0, le=100.0)
    time_on_page_ms: float = Field(0.0, ge=0.0)

class SendTimeFeatures(BaseModel):
    local_hour_of_session: int = Field(12, ge=0, le=23)
    day_of_week_session: int = Field(0, ge=0, le=6)
    email_open_hour_history: int = Field(12, ge=0, le=23)
    email_click_hour_history: int = Field(12, ge=0, le=23)
    sms_response_hour_history: int = Field(12, ge=0, le=23)

class ChurnFeatures(BaseModel):
    past_orders_total: int = Field(0, ge=0)
    days_since_last_purchase: int = Field(-1, ge=-1)
    avg_order_value: float = Field(0.0, ge=0.0)
    purchase_frequency_trend: int = Field(0, ge=-1, le=1)
    rfm_recency_score: int = Field(1, ge=1, le=5)
    rfm_frequency_score: int = Field(1, ge=1, le=5)
    rfm_monetary_score: int = Field(1, ge=1, le=5)

class OfferValueFeatures(BaseModel):
    pss_score: int = Field(0, ge=0, le=100)
    css_score: int = Field(0, ge=0, le=100)
    cursor_hesitation: float = Field(0.0, ge=0.0)
    past_orders_total: int = Field(0, ge=0)
    past_orders_with_coupon_pct: float = Field(0.0, ge=0.0, le=100.0)
    days_since_last_purchase: int = Field(-1, ge=-1)
    avg_order_value: float = Field(0.0, ge=0.0)
    visited_coupon_page: int = Field(0, ge=0, le=1)
    searched_discount_terms: int = Field(0, ge=0, le=1)
    failed_coupon_count: int = Field(0, ge=0)


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
    churn_score: float
    risk_level: str
    trigger_winback: bool
    customer_segment: str
    model_version: str
    fallback: bool = False

class SendTimeResponse(BaseModel):
    best_send_hour: int
    best_send_day: int
    confidence: float
    fallback_used: bool
    model_version: str

class OfferValueResponse(BaseModel):
    recommended_discount_pct: int
    confidence: float
    model_version: str
    fallback: bool = False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "revluma-ml-serving"}

@app.post("/predict/abandonment-probability", response_model=AbandonmentResponse)
async def predict_abandonment(features: AbandonmentFeatures):
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
        prob = float(model.predict_proba(feature_vector)[0][1])
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

@app.post("/predict/shopper-sensitivity", response_model=SensitivityResponse)
async def predict_sensitivity(features: SensitivityFeatures):
    try:
        pss_model = _load_model("sensitivity_pss")
        css_model = _load_model("sensitivity_css")
        
        if not pss_model or not css_model:
            return SensitivityResponse(fallback=True)
            
        feature_vector = pd.DataFrame([features.dict()])
        pss_prob = float(pss_model.predict_proba(feature_vector)[0][1])
        css_prob = float(css_model.predict_proba(feature_vector)[0][1])
        
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


@app.post("/predict/churn-risk", response_model=ChurnRiskResponse)
async def predict_churn(features: ChurnFeatures):
    try:
        model = _load_model("churn_risk")
        if not model:
            # Algorithmic fallback using CHURN_MODEL_RESEARCH.md principles
            days = features.days_since_last_purchase
            if days == -1:
                prob = 0.5
            elif days <= 30:
                prob = 0.15
            elif days <= 60:
                prob = 0.45
            elif days <= 90:
                prob = 0.70
            else:
                prob = 0.90
                
            risk_level = "HEALTHY" if prob <= 0.30 else "AT_RISK" if prob <= 0.60 else "HIGH_RISK" if prob <= 0.80 else "CRITICAL"
            
            return ChurnRiskResponse(
                churn_score=prob,
                risk_level=risk_level,
                trigger_winback=prob > 0.60,
                customer_segment="unknown",
                model_version="fallback",
                fallback=True
            )
            
        feature_vector = pd.DataFrame([features.dict()])
        prob = float(model.predict_proba(feature_vector)[0][1])
        risk_level = "HEALTHY" if prob <= 0.30 else "AT_RISK" if prob <= 0.60 else "HIGH_RISK" if prob <= 0.80 else "CRITICAL"
        
        return ChurnRiskResponse(
            churn_score=prob,
            risk_level=risk_level,
            trigger_winback=prob > 0.60,
            customer_segment="calculated",
            model_version="1.0",
            fallback=False
        )
    except Exception:
        return ChurnRiskResponse(
            churn_score=0.5,
            risk_level="AT_RISK",
            trigger_winback=False,
            customer_segment="unknown",
            model_version="fallback",
            fallback=True
        )


@app.post("/predict/send-time", response_model=SendTimeResponse)
async def predict_send_time(features: SendTimeFeatures):
    try:
        model = _load_model("send_time")
        if not model:
            return SendTimeResponse(
                best_send_hour=10,
                best_send_day=0,
                confidence=0.0,
                fallback_used=True,
                model_version="fallback"
            )
            
        feature_vector = pd.DataFrame([features.dict()])
        pred = model.predict(feature_vector)[0]
        return SendTimeResponse(
            best_send_hour=int(pred.get("hour", 10)),
            best_send_day=int(pred.get("day", 0)),
            confidence=0.8,
            fallback_used=False,
            model_version="1.0"
        )
    except Exception:
        return SendTimeResponse(
            best_send_hour=10,
            best_send_day=0,
            confidence=0.0,
            fallback_used=True,
            model_version="fallback"
        )


@app.post("/predict/offer-value", response_model=OfferValueResponse)
async def predict_offer_value(features: OfferValueFeatures):
    try:
        model = _load_model("offer_value")
        if not model:
            # Algorithmic fallback based on sensitivity scores
            pct = 15 if features.pss_score >= 60 else 5
            return OfferValueResponse(
                recommended_discount_pct=pct,
                confidence=0.0,
                model_version="fallback",
                fallback=True
            )
            
        feature_vector = pd.DataFrame([features.dict()])
        pct = int(model.predict(feature_vector)[0])
        return OfferValueResponse(
            recommended_discount_pct=pct,
            confidence=0.9,
            model_version="1.0",
            fallback=False
        )
    except Exception:
        return OfferValueResponse(
            recommended_discount_pct=10,
            confidence=0.0,
            model_version="fallback",
            fallback=True
        )
