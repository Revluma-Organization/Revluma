# WooCommerce Connection Endpoint – Technical Contract

**Version**: 1.0  
**Author**: OMAH THANKGOD (Python-Backend)  
**Audience:**  AFOLABI (Node.js-Backend) & Python Sync Service
**Created on**: 2026-07-23  
**Purpose**: Define the exact behavior of `POST /api/v1/woocommerce/connect` so Node.js and Python services integrate without mismatch.

---

## 1. Overview

This document defines the **contract** for the WooCommerce store connection endpoint. It specifies exactly how the Node.js backend must validate credentials, store connection data, and trigger the Python synchronization service.

The goal is to ensure seamless integration between the Node.js backend and the Python sync service, eliminating ambiguity and implementation mismatches.

---

## 2. Endpoint Information

| Property | Value |
| :--- | :--- |
| **HTTP Method** | `POST` |
| **Endpoint URL** | `/api/v1/woocommerce/connect` |
| **Authentication** | Bearer Token (JWT) – `authenticateToken` middleware |
| **Content-Type** | `application/json` |

---

## 3. Request Body

The client must send a JSON payload with the following fields:

Schema
```json
{
  "shop_url": "https://xxxxxxxxxx.com",
  "consumer_key": "ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "consumer_secret": "cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}

---

Field Specifications
Field	        Type	        Required    	    Descriptions

`shop_url`| 	string|	      Yes|	               Full store URL including protocol. Example: `https://my-woo-store.com or https://revluma.local`. 
`consumer_key`|	    string|	          Yes|      	WooCommerce REST API Consumer Key

`consumer_secret`|	    string|     	Yes|       	WooCommerce REST API Consumer Secret

*Notes*: 
The `consumer_key` and `consumer_secret` are the standard WooCommerce REST API credentials generated from WooCommerce > Settings > Advanced > REST API.

---

## 4. Validation & Processing Flow

The backend MUST execute validation in this exact order. Stop and return on first failure.

"Step 1 — Validate Required Fields"
1. Check that `shop_url`, `consumer_key`, `consumer_secret` exist and are non-empty strings
2. Validate `shop_url` starts with `https://` and is a valid URL
3. If any check fails: 
   - Return `400 Bad Request`
   {
  "error": "Missing required fields: shop_url, consumer_key, consumer_secret"
}
   - Do not continue processing

"Step 2 — Validate WooCommerce Credentials"
Before storing anything in the database, send a test request to the WooCommerce REST API to verify the credentials.

1. Call `GET {shop_url}/wp-json/wc/v3/system_status` 
2. Auth: HTTP Basic Auth. Header: `Authorization: Basic {base64(consumer_key:consumer_secret)}`
3. Expected response: `200 OK` with system status JSON
4. If response is `401`, `403`, `404`, or network error:
   - Return `400 Bad Request`
   
   {
  "error": "Invalid WooCommerce credentials. Please check your Consumer Key, Consumer Secret, and store URL."
}
   - No database changes should occur if validation fails.

"Step 3 — Retrieve User Organization"
1. Using the authenticated user's JWT (from req.user), retrieve the associated organization.

2. Database query:
sql:
SELECT id FROM organizations WHERE id = user.organization_id

3. If no organization found: Return HTTP 404 Not Found with error message:
{
  "error": "Organization not found for this user."
}

 "Step 4 — Store the Connection"
Create or update the store record in the `stores`  table.

Database Table: stores:

*Table:                `stores`*
Column	               Value	Notes
`organization_id`	      Retrieved from Step 3
`platform`	            `"woocommerce"`
`shop_domain`	          Extract from shop_url (e.g., from https://example.com → example.com or keep full URL)
`access_token`	          `{consumer_key}:{consumer_secret}`	
`status`	                `"active"`	
`installed_at`	          `NOW()`	timestamp


Keep/Store the full URL (recommended)
shop_url = "https://revluma.local"  → shop_domain = "https://revluma.local"

How To Implement:
// Node.js – store exactly what you received
const shop_domain = shop_url; // no extraction

"*Rules:*
1. If a record already exists for the same organization_id and shop_domain, update the access_token and status instead of creating a duplicate.
2. Credentials MUST NOT be returned in any API response
3. Never log the credentials in plain text."


"Step 5 — Trigger Background Synchronization [Fire-and-Forget]"
After the store record has been successfully saved, trigger the Python sync service asynchronously.


1. `POST http://localhost:8000/internal/sync/trigger`
2. Content-Type: application/json
{
  "store_id": "<uuid-from-step-4>",
  "platform": "woocommerce"
}
3. This request must be fire‑and‑forget.
4. Do not await the response or wait for the sync to complete.
5. If this request fails: Log error with `store_id`. Do NOT roll back store. Do NOT fail client response
   Sync can be retried later via admin tool
6. If the request fails (e.g., Python service is down), log the error and continue.
7. Do not roll back the store creation.
8. The merchant should receive a success response regardless of sync trigger status.

"Implementation example:"
// Fire-and-forget – don't await
fetch('http://localhost:8000/internal/sync/trigger', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    store_id: store.id,
    platform: 'woocommerce'
  })
}).catch(err => {
  console.error('Sync trigger failed for store', store.id, err.message);
});


"Step 6 — Success Response"
Return a success response to the client after the store is saved and the sync is triggered.

Response Body:
*HTTP 201 Created*
{
  "success": true,
  "message": "WooCommerce store connected successfully. 
  Data synchronization started  in the background.",
  "data": {
    "store_id": "uuid",
    "platform": "woocommerce",
    "status": "active",
  }
}

HTTP Status: 200 OK
The response must be returned immediately, without waiting for the sync to complete.
---

4. Error Responses

HTTP 400 – Bad Request

Returned for client errors
"Return when:
Required fields (shop_url, consumer_key, consumer_secret) are missing.
WooCommerce credentials are invalid (validation fails).
Store URL is malformed"


{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid WooCommerce credentials. 
    Please check your Consumer Key, Consumer Secret, and store URL."
  }
}
Other codes: `INVALID_CREDENTIALS`, `INVALID_URL`, `NO_ORGANIZATION`

401 Unauthorized
Returned when `authenticateToken` fails
Return when:
The user is not authenticated (no valid JWT token).
Token has expired or is invalid.

{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required. Please provide a valid Bearer token."
  }
}

"HTTP 404 – Not Found
Return when:

The user's organization does not exist.

Example Response:

{
  "error": "Organization not found for this user."
}
"

500 Internal Server Error
Returned for DB failures(connection, constraint violation, etc.)
Unexpected exceptions
Unexpected server errors occur.
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Internal server error while connecting WooCommerce store."
  }
}

*Special Case*: If sync trigger in Step 5 fails, still return `201` with `sync_status: "failed"`. Log the error server-side.
{
  "success": true,
  "message": "WooCommerce store connected successfully. Sync trigger failed, please retry manually.",
  "data": {
    "store_id": "xxxxxxxxxxx",
    "platform": "woocommerce",
    "shop_domain": "https://xxxxxxx",
    "status": "active",
    "sync_status": "failed"
  }
}

---

5. "Security Requirements"
1. Store `access_token` encrypted at rest. Use env-based encryption key
2. Never log `consumer_key` or `consumer_secret`
3. Never return credentials in any response
4. Rate limit endpoint: 5 requests per minute per user

---

6. "Sequence Diagram"
Merchant → Node.js Backend → WooCommerce API → Database → Python Service

1. POST /api/v1/woocommerce/connect { shop_url, consumer_key, consumer_secret }
2. Validate credentials against WooCommerce REST API
3. Retrieve organization ID from JWT
4. Create/update store record in PostgreSQL
5. Fire‑and‑forget POST to /internal/sync/trigger { store_id, platform: "woocommerce" }
6. Return success response to merchant immediately
7. Python service runs sync in background (customers + orders)

7. "Important Notes for Afolabi"
Credential Storage

The access_token field must store credentials as consumer_key:consumer_secret (colon‑separated). This format is required by the Python sync service.

Python Service Dependency
The Python FastAPI service must be running and accessible at http://localhost:8000 (development) or the configured internal URL (production).

If the Python service is unreachable, log the error but do not fail the request.

Idempotency
The endpoint should be idempotent: if a merchant connects the same store twice, it should update the existing record rather than creating duplicates.

Use ON CONFLICT (organization_id, shop_domain) DO UPDATE in the SQL.

Logging
Log all validation failures and sync trigger attempts.

Never log consumer_key, consumer_secret, or full access_token in plain text.


"REQUIRED CREDENTIALS: To be uncommitted in the next 12 hours."
shop_url:	"https://revluma.local",
consumer_key:	"ck_bca406dce5b90e68d2196f5a1f028f1a4e4d8126"
consumer_secret:	"cs_6bd3a72878e48866bd640e9fe13fa2c66f96eac2"
store_id: "47b6b102-85f0-47f9-bae8-b7b61e21be68",
access_token:  "ck_bca406dce5b90e68d2196f5a1f028f1a4e4d8126:cs_6bd3a72878e48866bd640e9fe13fa2c66f96eac2"
