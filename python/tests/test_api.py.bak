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
