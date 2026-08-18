# scripts/test_webhook.py

import requests
import json

# Use your actual store UUID from the database
STORE_ID = "17c85879-fd24-4274-b456-a00c6efc5e3e"

# The FastAPI webhook endpoint - use HTTP, not HTTPS
WEBHOOK_URL = f"http://localhost:8000/api/webhooks/woocommerce/{STORE_ID}"  # ← Changed to http

# Sample order payload (simplified version of what WooCommerce sends)
SAMPLE_ORDER = {
    "id": 12345,
    "parent_id": 0,
    "number": "12345",
    "order_key": "wc_order_abc123",
    "created_via": "checkout",
    "version": "8.0.0",
    "status": "processing",
    "currency": "USD",
    "date_created": "2026-08-18T14:30:00",
    "date_modified": "2026-08-18T14:30:00",
    "discount_total": "0.00",
    "discount_tax": "0.00",
    "shipping_total": "0.00",
    "shipping_tax": "0.00",
    "cart_tax": "0.00",
    "total": "25.00",
    "total_tax": "0.00",
    "customer_id": 9999,
    "billing": {
        "first_name": "John",
        "last_name": "Doe",
        "company": "",
        "address_1": "123 Main St",
        "address_2": "",
        "city": "Anytown",
        "state": "CA",
        "postcode": "12345",
        "country": "US",
        "email": "john.doe@example.com",
        "phone": "555-123-4567"
    },
    "shipping": {
        "first_name": "John",
        "last_name": "Doe",
        "company": "",
        "address_1": "123 Main St",
        "address_2": "",
        "city": "Anytown",
        "state": "CA",
        "postcode": "12345",
        "country": "US"
    },
    "payment_method": "stripe",
    "payment_method_title": "Credit Card (Stripe)",
    "transaction_id": "",
    "customer_ip_address": "192.168.1.1",
    "customer_user_agent": "Mozilla/5.0...",
    "coupon_lines": [],
    "line_items": [
        {
            "id": 1,
            "name": "Test Product",
            "product_id": 100,
            "variation_id": 0,
            "quantity": 1,
            "tax_class": "",
            "subtotal": "25.00",
            "subtotal_tax": "0.00",
            "total": "25.00",
            "total_tax": "0.00",
            "taxes": [],
            "meta_data": []
        }
    ],
    "tax_lines": [],
    "shipping_lines": [],
    "fee_lines": [],
    "refunds": [],
    "meta_data": [],
    "date_created_gmt": "2026-08-18T14:30:00",
    "date_modified_gmt": "2026-08-18T14:30:00"
}

# Headers – WooCommerce sends these
HEADERS = {
    "Content-Type": "application/json",
    "x-wc-webhook-topic": "order.created",
    "x-wc-webhook-source": "https://revluma.local",
    "x-wc-webhook-signature": "dummy_signature_here"
}

def test_webhook():
    print(f"🚀 Sending webhook to {WEBHOOK_URL}")
    response = requests.post(
        WEBHOOK_URL,
        json=SAMPLE_ORDER,
        headers=HEADERS
    )
    print(f"Status: {response.status_code}")
    try:
        print(f"Response: {response.json()}")
    except:
        print(f"Raw response: {response.text}")

if __name__ == "__main__":
    test_webhook()