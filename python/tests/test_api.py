import pytest
from types import SimpleNamespace
from fastapi.testclient import TestClient
from src.serving import api as serving_api
from src.serving.api import app, verify_internal_caller

# Bypass the internal key authentication for tests
async def override_verify_internal_caller():
    pass

app.dependency_overrides[verify_internal_caller] = override_verify_internal_caller

# Set up test client
client = TestClient(app)

headers = {}


@pytest.fixture(autouse=True)
def disable_external_model_loading(monkeypatch):
    """API unit tests must never resolve models from MLflow or the network."""
    monkeypatch.setattr(serving_api, "_load_model", lambda _model_name: None)
    monkeypatch.setattr(
        serving_api,
        "_predict_churn",
        lambda _customer_id, _features, _merchant_id: {
            "churn_probability": 0.5,
            "churn_tier": "AT_RISK",
            "win_back_urgency": "MEDIUM",
            "primary_churn_signal": "none_detected",
            "engagement_decay_score": 0.0,
            "recommended_channel": "email",
            "offer_required": False,
            "escalate_to_human": False,
            "fallback": True,
            "model_version": "fallback",
        },
    )

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "models_loaded" in data
    assert "status" in data


def test_orchestrate_forwards_scheduler_trigger_context(monkeypatch):
    captured = {}

    class FakeSession:
        def close(self):
            captured["session_closed"] = True

    def fake_orchestrate(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            to_dict=lambda: {
                "success": True,
                "response_type": "analysis",
                "orchestrator_mode": "Briefing",
            }
        )

    monkeypatch.setattr(serving_api, "_Session", FakeSession)
    monkeypatch.setattr(serving_api, "_orchestrate", fake_orchestrate)
    response = client.post(
        "/orchestrate",
        json={
            "organization_id": "11111111-1111-1111-1111-111111111111",
            "user_id": "22222222-2222-2222-2222-222222222222",
            "message": "Prepare the morning briefing",
            "trigger_type": "scheduler",
            "trigger_priority": "high",
            "context_payload": {"schedule": "morning_briefing"},
        },
    )

    assert response.status_code == 200
    assert response.json()["orchestrator_mode"] == "Briefing"
    assert captured["trigger_type"] == "scheduler"
    assert captured["trigger_priority"] == "high"
    assert captured["context_payload"] == {"schedule": "morning_briefing"}
    assert captured["session_closed"] is True


def test_orchestrate_rejects_an_unknown_trigger_type():
    response = client.post(
        "/orchestrate",
        json={
            "organization_id": "11111111-1111-1111-1111-111111111111",
            "user_id": "22222222-2222-2222-2222-222222222222",
            "message": "Run an analysis",
            "trigger_type": "webhook",
        },
    )

    assert response.status_code == 422


def test_orchestrate_rejects_oversized_trigger_context():
    response = client.post(
        "/orchestrate",
        json={
            "organization_id": "11111111-1111-1111-1111-111111111111",
            "user_id": "22222222-2222-2222-2222-222222222222",
            "message": "Analyze the alert",
            "trigger_type": "alert",
            "context_payload": {"details": "x" * 17_000},
        },
    )

    assert response.status_code == 422


def test_orchestrate_rejects_image_without_media_type():
    response = client.post(
        "/orchestrate",
        json={
            "organization_id": "11111111-1111-1111-1111-111111111111",
            "user_id": "22222222-2222-2222-2222-222222222222",
            "message": "Review this ad",
            "image_base64": "aW1hZ2U=",
        },
    )

    assert response.status_code == 422


def test_orchestrate_rejects_invalid_image_encoding():
    response = client.post(
        "/orchestrate",
        json={
            "organization_id": "11111111-1111-1111-1111-111111111111",
            "user_id": "22222222-2222-2222-2222-222222222222",
            "message": "Review this ad",
            "image_base64": "not valid base64!",
            "image_media_type": "image/png",
        },
    )

    assert response.status_code == 422


def test_orchestrate_rejects_unsupported_image_media_type():
    response = client.post(
        "/orchestrate",
        json={
            "organization_id": "11111111-1111-1111-1111-111111111111",
            "user_id": "22222222-2222-2222-2222-222222222222",
            "message": "Review this ad",
            "image_base64": "aW1hZ2U=",
            "image_media_type": "image/svg+xml",
        },
    )

    assert response.status_code == 422


def test_internal_morning_briefings_returns_sanitized_job_totals(monkeypatch):
    monkeypatch.setattr(
        serving_api,
        "_run_morning_briefings",
        lambda: {"total": 4, "success": 3, "failed": 1, "errors": []},
        raising=False,
    )

    response = client.post("/internal/morning-briefings")

    assert response.status_code == 200
    assert response.json() == {
        "total": 4,
        "success": 3,
        "failed": 1,
        "error": "partial_failure",
    }

def test_abandonment_valid():
    response = client.post("/predict/abandonment-probability", json={
        "scroll_depth_pct": 50.0,
        "tab_switch_count": 2,
        "time_on_page_ms": 15000,
        "cursor_hesitation": 4,
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


def test_abandonment_rejects_hesitation_above_trained_range():
    response = client.post(
        "/predict/abandonment-probability",
        json={"cursor_hesitation": 11},
        headers=headers,
    )
    assert response.status_code == 422

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


def test_churn_normalizes_legacy_names_and_forwards_request_context(monkeypatch):
    captured = {}

    def record_prediction(customer_id, feature_vector, merchant_id):
        captured.update({
            "customer_id": customer_id,
            "feature_vector": feature_vector,
            "merchant_id": merchant_id,
        })
        return {
            "churn_probability": 0.15,
            "churn_tier": "HEALTHY",
            "win_back_urgency": "LOW",
            "primary_churn_signal": "none_detected",
            "engagement_decay_score": 0.0,
            "recommended_channel": "email",
            "offer_required": False,
            "escalate_to_human": False,
            "fallback": False,
            "model_version": "m4-v1.0",
        }

    monkeypatch.setattr(serving_api, "_predict_churn", record_prediction)
    response = client.post(
        "/predict/churn-risk",
        json={
            "sms_click_rate": 0.2,
            "sms_click_rate_30d": 0.4,
            "site_visit_frequency_delta": -3,
            "browse_to_cart_trend": -1,
        },
        headers={
            "X-Customer-ID": "customer-1",
            "X-Merchant-ID": "merchant-1",
        },
    )

    assert response.status_code == 200
    assert captured["customer_id"] == "customer-1"
    assert captured["merchant_id"] == "merchant-1"
    assert captured["feature_vector"]["sms_click_rate_30d"] == 0.4
    assert captured["feature_vector"]["site_visit_delta"] == -3
    assert captured["feature_vector"]["browse_to_cart_conversion_trend"] == -1

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


def test_send_time_delegates_full_contract_and_internal_context(monkeypatch):
    captured = {}

    def fake_predict(customer_id, features, merchant_id, *, model):
        captured.update(
            customer_id=customer_id,
            features=features,
            merchant_id=merchant_id,
            model=model,
        )
        return {
            "send_at": "2026-09-03T18:30:00+00:00",
            "send_at_utc": "2026-09-03T18:30:00+00:00",
            "confidence": 0.7,
            "reasoning_layer": "personalised",
            "channel": "sms",
            "fallback": False,
        }

    monkeypatch.setattr(serving_api, "_predict_timing", fake_predict)
    response = client.post(
        "/predict/send-time",
        json={
            "channel": "sms",
            "recovery_action": "TRUST_REASSURE",
            "cart_value_tier": "premium",
            "historical_open_probabilities": [0.6] * 24,
            "history_data_points": 4,
            "days_since_last_purchase": 12,
        },
        headers={"X-Customer-ID": "customer-1", "X-Merchant-ID": "merchant-1"},
    )

    assert response.status_code == 200
    assert captured["customer_id"] == "customer-1"
    assert captured["merchant_id"] == "merchant-1"
    assert captured["features"]["recovery_action"] == "TRUST_REASSURE"
    assert captured["features"]["cart_value_tier"] == "premium"


def test_send_time_rejects_partial_open_probability_array():
    response = client.post(
        "/predict/send-time",
        json={"historical_open_probabilities": [0.5] * 23},
        headers=headers,
    )

    assert response.status_code == 422

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
