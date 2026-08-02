"""
Revluma ML Serving API — Locust Load Test Suite.

Simulates 500 concurrent users exercising all five prediction endpoints.
Run headlessly:
    locust -f tests/load/locustfile.py --headless -u 500 -r 50 \
           --run-time 60s --host http://127.0.0.1:8000 \
           --html tests/load/report.html

The ML_INTERNAL_KEY environment variable must be set to match the value
configured on the running uvicorn server (see README below).
"""

import os
import random

from locust import HttpUser, task, between


# ---------------------------------------------------------------------------
# Load the key from environment so it is never hardcoded.
# During local load testing, set ML_INTERNAL_KEY=revluma-load-test-key in
# the shell before running locust, matching the value used to start uvicorn.
# ---------------------------------------------------------------------------
_INTERNAL_KEY = os.environ.get("ML_INTERNAL_KEY", "revluma-load-test-key")

# NOTE: convert_underscores=False is set in api.py's Header dependency,
# so the server expects the literal header name with an underscore, not hyphen.
_HEADERS = {
    "x_internal_key": _INTERNAL_KEY,
    "Content-Type": "application/json",
}


def _abandonment_payload() -> dict:
    """Generate a realistic abandonment prediction request payload."""
    return {
        "scroll_depth_pct": round(random.uniform(10.0, 100.0), 2),
        "tab_switch_count": random.randint(0, 10),
        "time_on_page_ms": random.randint(5000, 300_000),
        "checkout_step_reached": random.randint(0, 5),
        "failed_payment_attempt": random.choice([True, False]),
        "cart_item_add_count": random.randint(1, 8),
        "cart_item_remove_count": random.randint(0, 3),
    }


def _sensitivity_payload() -> dict:
    """Generate a realistic sensitivity classification request payload."""
    return {
        "past_orders_with_coupon_pct": round(random.uniform(0.0, 1.0), 3),
        "visited_coupon_page": random.choice([True, False]),
        "searched_discount_terms": random.choice([True, False]),
        "cursor_hesitation": random.randint(0, 20),
        "abandoned_at_shipping_reveal": random.choice([True, False]),
        "checkout_step_reached": random.randint(0, 5),
        "scroll_depth_pct": round(random.uniform(10.0, 100.0), 2),
        "tab_switch_count": random.randint(0, 10),
    }


def _churn_payload() -> dict:
    """Generate a realistic churn risk scoring request payload."""
    return {
        "past_orders_total": random.randint(1, 50),
        "days_since_last_purchase": random.randint(1, 180),
        "avg_order_value": round(random.uniform(10.0, 250.0), 2),
        "purchase_frequency_trend": random.choice([-1, 0, 1]),
        "rfm_recency_score": random.randint(1, 5),
        "rfm_frequency_score": random.randint(1, 5),
        "rfm_monetary_score": random.randint(1, 5),
        "customer_ltv": round(random.uniform(0.0, 5000.0), 2),
    }


def _send_time_payload() -> dict:
    """Generate a realistic send timing request payload."""
    return {
        "local_hour_of_session": random.randint(0, 23),
        "day_of_week_session": random.randint(0, 6),
        "channel": random.choice(["email", "sms", "whatsapp"]),
        "recovery_action": random.choice(
            ["DISCOUNT", "FRICTION_FIX", "HYBRID", "NUDGE", "SOFT_NUDGE"]
        ),
        "cart_value_tier": random.choice(["low", "medium", "high"]),
        "customer_timezone_offset": random.randint(-12, 14),
    }


def _offer_value_payload() -> dict:
    """Generate a realistic offer value optimisation request payload."""
    return {
        "pss_score": random.randint(0, 100),
        "css_score": random.randint(0, 100),
        "tss_score": random.randint(0, 100),
        "cursor_hesitation": random.randint(0, 20),
        "past_orders_total": random.randint(1, 50),
        "past_orders_with_coupon_pct": round(random.uniform(0.0, 1.0), 3),
        "days_since_last_purchase": random.randint(1, 180),
        "avg_order_value": round(random.uniform(10.0, 250.0), 2),
        "visited_coupon_page": random.choice([True, False]),
        "searched_discount_terms": random.choice([True, False]),
    }


class RevlumaMLUser(HttpUser):
    """
    Simulates a backend caller exercising the Revluma ML API.

    Each virtual user waits 0.1–0.5 s between requests, modelling
    the bursting behaviour of a Node backend fan-out during a checkout
    spike. All five endpoints are weighted equally.
    """

    wait_time = between(0.1, 0.5)

    @task(1)
    def predict_abandonment(self):
        """Test the M1 abandonment probability endpoint."""
        self.client.post(
            "/predict/abandonment-probability",
            json=_abandonment_payload(),
            headers=_HEADERS,
            name="/predict/abandonment-probability",
        )

    @task(1)
    def predict_sensitivity(self):
        """Test the M2 customer sensitivity classifier endpoint."""
        self.client.post(
            "/predict/shopper-sensitivity",
            json=_sensitivity_payload(),
            headers=_HEADERS,
            name="/predict/shopper-sensitivity",
        )

    @task(1)
    def predict_churn(self):
        """Test the M4 churn risk scorer endpoint."""
        self.client.post(
            "/predict/churn-risk",
            json=_churn_payload(),
            headers=_HEADERS,
            name="/predict/churn-risk",
        )

    @task(1)
    def predict_send_time(self):
        """Test the M3 sequence send timing endpoint."""
        self.client.post(
            "/predict/send-time",
            json=_send_time_payload(),
            headers=_HEADERS,
            name="/predict/send-time",
        )

    @task(1)
    def predict_offer_value(self):
        """Test the M5 offer value optimiser endpoint."""
        self.client.post(
            "/predict/offer-value",
            json=_offer_value_payload(),
            headers=_HEADERS,
            name="/predict/offer-value",
        )

    @task(1)
    def health_check(self):
        """Test the health endpoint (no auth required)."""
        self.client.get("/health", name="/health")
