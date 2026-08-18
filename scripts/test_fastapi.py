import requests

# Test health endpoint
resp = requests.get("http://localhost:8000/health")
print("Health:", resp.status_code, resp.json() if resp.ok else resp.text)

# Test webhook endpoint (expecting 404 or 405 since it's GET)
resp = requests.get("http://localhost:8000/api/webhooks/woocommerce/17c85879-fd24-4274-b456-a00c6efc5e3e")
print("Webhook GET:", resp.status_code)