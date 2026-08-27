import pytest
from fastapi.testclient import TestClient
from src.serving.api import app, verify_internal_caller

# Bypass the internal key authentication for tests
async def override_verify_internal_caller():
    pass

app.dependency_overrides[verify_internal_caller] = override_verify_internal_caller

# Set up test client
client = TestClient(app)

headers = {}

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "models_loaded" in data
    assert "status" in data

def test_abandonment_valid():
    response = client.post("/predict/abandonment-probability", json={
        "scroll_depth_pct": 50.0,
        "tab_switch_count": 2,
        "time_on_page_ms": 15000,
        "checkout_step_reached": 2,
        "failed_payment_attempt": False,
        "cart_item_add_count": 3,
        "cart_item_remove_count": 0
    }, headers=headers)
    assert response.status_code == 200

def test_abandonment_empty():
    response = client.post("/predict/abandonment-probability", json={}, headers=headers)
    # Pydantic will fill defaults, so it should be 200
    assert response.status_code == 200

def test_abandonment_out_of_range():
    response = client.post("/predict/abandonment-probability", json={
        "scroll_depth_pct": 150.0  # Invalid, max is 100
    }, headers=headers)
    assert response.status_code == 422 # Pydantic validation error

def test_sensitivity_valid():
    response = client.post("/predict/shopper-sensitivity", json={
        "past_orders_with_coupon_pct": 0.5,
        "visited_coupon_page": True,
        "searched_discount_terms": False,
        "cursor_hesitation": 1,
        "abandoned_at_shipping_reveal": False,
        "checkout_step_reached": 3,
        "scroll_depth_pct": 80.0,
        "tab_switch_count": 0
    }, headers=headers)
    assert response.status_code == 200

def test_churn_valid():
    response = client.post("/predict/churn-risk", json={
        "past_orders_total": 5,
        "days_since_last_purchase": 30,
        "avg_order_value": 150.0,
        "purchase_frequency_trend": 0,
        "rfm_recency_score": 4,
        "rfm_frequency_score": 3,
        "rfm_monetary_score": 5,
        "historical_aov_trend": 0,
        "email_open_rate_30d": 0.2,
        "email_open_rate_90d": 0.3,
        "email_open_rate_delta": -0.1,
        "sms_click_rate_30d": 0.1,
        "site_visit_frequency_30d": 5.0,
        "site_visit_frequency_90d": 15.0,
        "site_visit_delta": 0.0,
        "browse_to_cart_conversion_trend": 0,
        "coupon_dependency_score": 0.2,
        "return_rate": 0.0,
        "support_contact_frequency_90d": 0,
        "discount_seeking_escalation": 0,
        "unsubscribe_risk_score": 0.1,
        "customer_ltv": 750.0
    }, headers=headers)
    assert response.status_code == 200

def test_send_time_valid():
    response = client.post("/predict/send-time", json={
        "local_hour_of_session": 14,
        "day_of_week_session": 2,
        "channel": "email",
        "recovery_action": "DISCOUNT",
        "cart_value_tier": "high",
        "customer_timezone_offset": -5
    }, headers=headers)
    assert response.status_code == 200

def test_offer_value_valid():
    response = client.post("/predict/offer-value", json={
        "pss_score": 75,
        "css_score": 20,
        "tss_score": 10,
        "cursor_hesitation": 2,
        "past_orders_total": 1,
        "past_orders_with_coupon_pct": 0.0,
        "days_since_last_purchase": 5,
        "avg_order_value": 45.0,
        "visited_coupon_page": False,
        "searched_discount_terms": False
    }, headers=headers)
    assert response.status_code == 200

def test_all_null_input():
    response = client.post("/predict/abandonment-probability", json=None, headers=headers)
    # Unprocessable entity due to missing body
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Sensitivity edge cases (P2.6)
# ---------------------------------------------------------------------------

def test_sensitivity_empty():
    """Empty body should succeed: all Pydantic fields have defaults."""
    response = client.post("/predict/shopper-sensitivity", json={}, headers=headers)
    assert response.status_code == 200


def test_sensitivity_out_of_range():
    """past_orders_with_coupon_pct must be 0.0-1.0; 2.0 should return 422."""
    response = client.post("/predict/shopper-sensitivity", json={
        "past_orders_with_coupon_pct": 2.0  # above max
    }, headers=headers)
    assert response.status_code == 422


def test_sensitivity_all_null():
    """Null body should return 422 (body is required even if fields are optional)."""
    response = client.post("/predict/shopper-sensitivity", json=None, headers=headers)
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Churn edge cases (P2.6)
# ---------------------------------------------------------------------------

def test_churn_empty():
    """Empty body should succeed: all Pydantic fields have defaults."""
    response = client.post("/predict/churn-risk", json={}, headers=headers)
    assert response.status_code == 200


def test_churn_out_of_range():
    """rfm_recency_score must be 1-5; 0 should return 422."""
    response = client.post("/predict/churn-risk", json={
        "rfm_recency_score": 0  # below min of 1
    }, headers=headers)
    assert response.status_code == 422


def test_churn_all_null():
    """Null body should return 422."""
    response = client.post("/predict/churn-risk", json=None, headers=headers)
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Send-time edge cases (P2.6)
# ---------------------------------------------------------------------------

def test_send_time_empty():
    """Empty body should succeed: all Pydantic fields have defaults."""
    response = client.post("/predict/send-time", json={}, headers=headers)
    assert response.status_code == 200


def test_send_time_invalid_channel():
    """channel must be email|sms|whatsapp; anything else should return 422."""
    response = client.post("/predict/send-time", json={
        "channel": "telegram"  # not in allowed pattern
    }, headers=headers)
    assert response.status_code == 422


def test_send_time_all_null():
    """Null body should return 422."""
    response = client.post("/predict/send-time", json=None, headers=headers)
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Offer-value edge cases including hard-gate verification (P2.6)
# ---------------------------------------------------------------------------

def test_offer_value_empty():
    """Empty body should succeed: all Pydantic fields have defaults."""
    response = client.post("/predict/offer-value", json={}, headers=headers)
    assert response.status_code == 200


def test_offer_value_trust_gate():
    """tss_score >= 60 must return offer_type=TRUST_SIGNAL with discount_pct=0.0."""
    response = client.post("/predict/offer-value", json={
        "pss_score": 80,
        "css_score": 80,
        "tss_score": 65  # triggers TRUST_SIGNAL gate
    }, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["offer_type"] == "TRUST_SIGNAL"
    assert data["discount_pct"] == 0.0


def test_offer_value_nudge_gate():
    """pss_score < 35 AND css_score < 35 must return offer_type=NUDGE, discount_pct=0.0."""
    response = client.post("/predict/offer-value", json={
        "pss_score": 20,
        "css_score": 20,
        "tss_score": 10
    }, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["offer_type"] == "NUDGE"
    assert data["discount_pct"] == 0.0


def test_offer_value_out_of_range():
    """pss_score must be 0-100; -1 should return 422."""
    response = client.post("/predict/offer-value", json={
        "pss_score": -1  # below min of 0
    }, headers=headers)
    assert response.status_code == 422


def test_offer_value_all_null():
    """Null body should return 422."""
    response = client.post("/predict/offer-value", json=None, headers=headers)
    assert response.status_code == 422
