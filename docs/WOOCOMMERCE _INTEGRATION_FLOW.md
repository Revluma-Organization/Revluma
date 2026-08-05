# WOOCOMMERCE INTEGRATION FLOW

**Version:** 1.0  
**Created on:** 2026-08-05  
**Authors:** OMAH THANKGOD (Python-Backend)  
**Audience:** AFOLABI (Node.js-Backend) & Frontend Team  
**Purpose:** .

---

## 1. Overview

This document defines how the backend handles and interacts with the frontend woocommerce connect flow and API  calls

---

## 2. Understanding the Frontend Flow

Step	Frontend Action	Backend                     Endpoint
---------------------------------------------------------------------------------
1       User clicks “Connect WooCommerce”       
endpoint: POST /api/v1/integrations/woocommerce/connect
----------------------------------------------------------------------------------
2       Backend returns a redirectUrl	            
endnpoint: (Same endpoint)
------------------------------------------------------------------------------------
3       Frontend redirects user to WooCommerce admin to generate keys              
endpoint: none
-----------------------------------------------------------------------------------  4      User generates keys and returns to frontend (with keys entered manually,or 
via callback)	 
endpoint: none                               –     
-------------------------------------------------------------------------------------
5       Frontend calls your callback endpoint with the keys    
endpoint:   POST /api/v1/integrations/woocommerce/callback     
------------------------------------------------------------------------------------    
Important: WooCommerce does not use OAuth. The merchant will manually generate Consumer Key/Secret and enter them in the frontend. The frontend will send them to /callback.


---
### Implement /api/v1/integrations/woocommerce/connect
Request:
{
  "storeUrl": "https://their-shop.com"
}



## Authentication: Bearer Token (JWT)
Validation:

- Ensure storeUrl is present and a valid URL.
- (Optional) Send a request to {storeUrl}/wp-json/wc/v3/system_status to verify it’s a WooCommerce store (if you want to catch errors early).

Response: (Return 200 OK)
{
  "redirectUrl": "https://their-shop.com/wp-admin/admin.php?page=wc-settings&tab=advanced&section=keys"
}

Note: The frontend will use this URL to redirect the user to the WooCommerce admin page where they can generate API keys.




---
### 3. Implement /api/v1/integrations/woocommerce/callback
Request:
{
  "consumerKey": "ck_...",
  "consumerSecret": "cs_..."
}

(include storeUrl – the frontend can send it again.)

## Authentication: Bearer Token (JWT)

Processing Steps:

1 Retrieve User Organization – from the JWT, get the organization_id.
2 Validate the Credentials – make a test request to:
GET {storeUrl}/wp-json/wc/v3/system_status


using Basic Auth with the provided keys. If it fails, return 400 with a clear error.

3 Create or Update the Store Record – in the stores table:

- organization_id (from Step 1)
- platform = 'woocommerce'
- shop_domain = storeUrl (store the full URL)
- access_token = consumerKey + ':' + consumerSecret
- status = 'active'
- installed_at = NOW()
- last_synced_at = NULL
- Use ON CONFLICT (organization_id, shop_domain) DO UPDATE.

4 Register WooCommerce Webhooks – This is critical. After saving the store, register webhooks pointing to the Python service:

Webhook URL: https://your-python-service.com/api/webhooks/woocommerce/{store_id}

Topics to register:

- order.created
- order.updated
- customer.created
- customer.updated
- product.created
- product.updated
- coupon.created
- coupon.updated
- refund.created
- inventory.updated
- review.created

Registration via WooCommerce REST API:
const webhookPayload = {
  topic: 'order.created',
  delivery_url: `https://your-python-service.com/api/webhooks/woocommerce/${storeId}`,
  secret: '', // optional, but you can set a secret for verification
  status: 'active'
};
await axios.post(
  `${shop_url}/wp-json/wc/v3/webhooks`,
  webhookPayload,
  { auth: { username: consumerKey, password: consumerSecret } }
);

Handle errors: If webhook registration fails, log the error but do not roll back the store creation. The user can retry later.

5 Trigger Background Sync – Fire-and-forget call to the internal Python trigger:
POST http://localhost:8000/internal/sync/trigger
Body: { store_id: store.id, platform: "woocommerce" }

This will start the full sync (customers, orders, products, coupons, etc.).

6 Return Success Response:
{
  "success": true,
  "message": "WooCommerce store connected successfully. Data synchronization started in the background.",
  "data": {
    "store_id": store.id,
    "platform": "woocommerce",
    "shop_domain": storeUrl,
    "status": "active",
    "sync_status": "pending"
  }
}



---
### 4. Environment Variables

Add to your .env:
PYTHON_SYNC_URL=http://localhost:8000   # or the actual service URL in production
Use this in the trigger call and webhook registration.


---
### 5. Testing Checklist
- POST /connect returns a redirectUrl to the WooCommerce admin page.
- POST /callback validates credentials, creates a store record, and triggers sync.
- Webhooks are successfully registered in WooCommerce.
- The Python service receives the trigger and starts sync (you’ll see logs).
- The frontend receives a success response and shows a “Store Connected” toast.
- The store appears in the GET /stores endpoint with status: 'active'.

---



Connect flow start:	POST /api/v1/integrations/woocommerce/connect → return redirect URL
------------------------------------------------------------------------------------
Credential callback:	POST /api/v1/integrations/woocommerce/callback → validate, save store, register webhooks, trigger sync
------------------------------------------------------------------------------------
Webhook registration	Use WooCommerce REST API to create webhooks pointing to https://python-service/api/webhooks/woocommerce/{store_id}
-------------------------------------------------------------------------------------
Sync trigger:	Call POST {PYTHON_SYNC_URL}/internal/sync/trigger with { store_id, platform: "woocommerce" }
-------------------------------------------------------------------------------------

Once these are implemented, the full WooCommerce integration flow (frontend → Node.js → Python sync → webhooks) will work end‑to‑end.