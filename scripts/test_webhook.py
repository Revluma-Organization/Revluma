import os
import sys
import requests
import json
from dotenv import load_dotenv

load_dotenv()

STORE_ID = os.getenv('STORE_UUID')
if not STORE_ID:
    print('❌ STORE_UUID not set in .env')
    sys.exit(1)

PYTHON_SERVICE_URL = os.getenv('PYTHON_SERVICE_URL', 'http://localhost:8000')

# The FastAPI webhook endpoint
WEBHOOK_URL = f"{PYTHON_SERVICE_URL}/api/webhooks/woocommerce/{STORE_ID}"

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
    print(f"   Store ID: {STORE_ID}")
    try:
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
    except requests.exceptions.ConnectionError:
        print(f"❌ Connection error: Could not reach {WEBHOOK_URL}")
        print("   Make sure the FastAPI server is running:")
        print("   uvicorn src.serving.api:app --host 0.0.0.0 --port 8000 --reload")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    test_webhook()