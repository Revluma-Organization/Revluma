import os
import sys
import requests
from dotenv import load_dotenv

load_dotenv()

STORE_ID = os.getenv('STORE_UUID')
if not STORE_ID:
    print('❌ STORE_UUID not set in .env')
    sys.exit(1)

PYTHON_SERVICE_URL = os.getenv('PYTHON_SERVICE_URL', 'http://localhost:8000')

# Test health endpoint
try:
    resp = requests.get(f"{PYTHON_SERVICE_URL}/health")
    print(f"Health: {resp.status_code}", resp.json() if resp.ok else resp.text)
except requests.exceptions.ConnectionError:
    print(f"❌ Connection error: Could not reach {PYTHON_SERVICE_URL}")
    print("   Make sure the FastAPI server is running:")
    print("   uvicorn src.serving.api:app --host 0.0.0.0 --port 8000 --reload")
    sys.exit(1)

# Test webhook endpoint 
    resp = requests.get(f"{PYTHON_SERVICE_URL}/api/webhooks/woocommerce/{STORE_ID}")
    print(f"Webhook GET: {resp.status_code}")
except requests.exceptions.ConnectionError:
    print(f"❌ Connection error: Could not reach {PYTHON_SERVICE_URL}")

# Optional: Test if webhook endpoint exists (POST method)
print("\n📌 Note: The webhook endpoint only accepts POST requests.")
print(f"   To test it, run: python scripts/test_webhook.py")