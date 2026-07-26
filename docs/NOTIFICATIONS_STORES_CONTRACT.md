# Notifications & Stores API – Technical Contract

**Version:** 1.0  
**Created on:** 2026-07-23  
**Authors:** OMAH THANKGOD (Python-Backend)  
**Audience:** AFOLABI (Node.js-Backend) & Frontend Team  
**Purpose:** Define the exact behavior of the Notifications and Stores APIs so the backend response exactly matches what the frontend expects.

---

## 1. Overview

This document defines the **contract** for the Notifications and Stores APIs. It specifies exactly how the Node.js backend must implement each endpoint, including request/response formats, database queries, authentication requirements, and frontend integration behavior.

---

## 2. Endpoint 1 — Get Notifications

### Endpoint Information

| Field | Value |
| --- | --- |
| **HTTP Method** | `GET` |
| **Endpoint URL** | `/api/v1/notifications` |
| **Authentication** | Bearer Token (JWT) via `authenticateToken` middleware |
| **Query Parameters** | `limit` (optional, default: `20`) |

### Query Parameters

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `limit` | integer | ❌ No | `20` | Maximum number of notifications to return. Must be between `1` and `100` |

**Example Request:**

GET /api/v1/notifications?limit=10

### Database Query

**Requirements:**
1. Retrieve notifications belonging **only** to the authenticated user.
2. Order results by `created_at` in **descending** order (newest first).
3. Limit the number of returned records using the supplied `limit` value.
4. Derive the `unread` field from `read_at`:
   - `unread = true` if `read_at IS NULL`
   - `unread = false` if `read_at IS NOT NULL`

**Prisma Query:**
```javascript
const notifications = await prisma.notification.findMany({
  where: { userId: authenticatedUserId },
  orderBy: { createdAt: 'desc' },
  take: limit,
  select: {
    id: true,
    type: true,
    message: true,
    readAt: true,
    createdAt: true,
  }
});

const transformed = notifications.map(n => ({
  id: n.id,
  type: n.type,
  message: n.message,
  unread: n.readAt === null,
  created_at: n.createdAt,
}));

Response Contract
HTTP Status: 200 OK

Response Body:
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "47b6b102-85f0-47f9-bae8-b7b61e21be68",
        "type": "store_connected",
        "message": "WooCommerce store connected successfully",
        "unread": true,
        "created_at": "2026-07-23T14:30:00.000Z"
      },
      {
        "id": "a1b2c3d4-85f0-47f9-bae8-b7b61e21be68",
        "type": "sync_completed",
        "message": "Customer sync completed for WooCommerce store",
        "unread": false,
        "created_at": "2026-07-22T10:15:00.000Z"
      }
    ]
  }
}

"Field Definitions"
Field|	            Type|	            Description|
-------------------------------------------------------------------------
- id|	        string (UUID)|       	Unique notification identifier|
---------------------------------------------------------------------------
- type|	        string|        	 Notification category/type (e.g., store_connected, sync_completed, error)
-------------------------------------------------------------------------------------
- message|	    string|     	Human-readable notification message|
-------------------------------------------------------------------------------------
- unread|	    boolean|   	true if notification has not been read (read_at IS NULL)
-------------------------------------------------------------------------------------
- created_at|   string (ISO 8601)|   	Timestamp when the notification was created
-------------------------------------------------------------------------------------

Notes:
- The unread field is derived from read_at – do not store a separate unread column.
- Additional fields (e.g., link, category) may be included if used by the frontend.


3. "Endpoint 2 — Get Unread Notification Count"
Endpoint Information

Field	Value
HTTP Method|	                GET
------------------------------------------------------------------------------
Endpoint URL        	/api/v1/notifications/unread-count
-------------------------------------------------------------------------------
Authentication      	Bearer Token (JWT) via authenticateToken middleware
---------------------------------------------------------------------------------

Example Request:
GET /api/v1/notifications/unread-count

Database Query
Requirements:

1. Count all notifications that:
- Belong to the authenticated user.
- Have read_at IS NULL (unread).

2. Return the count as a single integer.

Prisma Query:
const count = await prisma.notification.count({
  where: {
    userId: authenticatedUserId,
    readAt: null
  }
});

Response Contract
HTTP Status: 200 OK

Response Body:
{
  "success": true,
  "data": {
    "count": 5
  }
}

Field Definitions:

Field	    Type	        Description
------------------------------------------------------------------------------------
count|	integer|	  Total number of unread notifications for the authenticated user
-------------------------------------------------------------------------------------

Notes:
- If the user has no unread notifications, return count: 0.
- This endpoint is used to display the notification badge count in the UI.



4. "Endpoint 3 — Mark Notification as Read"
Endpoint Information

Field	Value
HTTP Method	            PATCH
Endpoint URL	        /api/v1/notifications/:id/read
Authentication	        Bearer Token (JWT) via authenticateToken middleware
Path Parameter	        id (UUID) – the notification ID

Example Request:
PATCH /api/v1/notifications/47b6b102-85f0-47f9-bae8-b7b61e21be68/read

Database Operation
Requirements:
- Update the notification with the given id.
- Set read_at to the current timestamp (NOW()).
- Security: Ensure the notification belongs to the authenticated user before updating.
- If the notification does not exist or belongs to another user, return 404 Not Found.

Prisma Query:
const notification = await prisma.notification.updateMany({
  where: {
    id: notificationId,
    userId: authenticatedUserId
  },
  data: {
    readAt: new Date()
  }
});

if (notification.count === 0) {
  // Return 404 – not found or not owned by user
}

Response Contract
HTTP Status: 200 OK

Response Body:
{
  "success": true
}

Error Responses:

Status	                    Code	                     Message
------------------------------------------------------------------------------------
404 Not Found	    NOTIFICATION_NOT_FOUND	 "Notification not found or already read"
-------------------------------------------------------------------------------------
401 Unauthorized	UNAUTHORIZED	            "Authentication required"
-------------------------------------------------------------------------------------

Notes:
- The endpoint should be idempotent – calling it multiple times on the same notification should not cause an error.
- No additional data is required in the response body.


5. "Endpoint 4 — Get Connected Stores"
Endpoint Information

Field       	Value
HTTP Method	    GET
-----------------------------------------------------------------------
Endpoint URL	/api/v1/stores
-----------------------------------------------------------------------
Authentication	Bearer Token (JWT) via authenticateToken middleware
-----------------------------------------------------------------------

Example Request:
GET /api/v1/stores


Database Query
Requirements:
- Retrieve the authenticated user's organization.
- Obtain the corresponding organization_id.
- Return every store belonging to that organization.
- Never include sensitive credentials (access_token, consumer_key, etc.).
- Include only the following fields:

id

platform

shop_domain

status

installed_at

last_synced_at

Prisma Query:
const user = await prisma.user.findUnique({
  where: { id: authenticatedUserId },
  include: {
    organizations: {
      include: {
        stores: {
          select: {
            id: true,
            platform: true,
            shop_domain: true,
            status: true,
            installed_at: true,
            last_synced_at: true,
            // Exclude: access_token, consumer_key, etc.
          }
        }
      }
    }
  }
});

const stores = user.organizations.flatMap(org => org.stores);

Response Contract
HTTP Status: 200 OK

Response Body:
{
  "success": true,
  "data": {
    "stores": [
      {
        "id": "47b6b102-85f0-47f9-bae8-b7b61e21be68",
        "platform": "woocommerce",
        "shop_domain": "https://revluma.local",
        "status": "active",
        "installed_at": "2026-07-23T14:30:00.000Z",
        "last_synced_at": "2026-07-23T14:45:00.000Z"
      },
      {
        "id": "a1b2c3d4-85f0-47f9-bae8-b7b61e21be68",
        "platform": "shopify",
        "shop_domain": "xxxxxxxxx",
        "status": "error",
        "installed_at": "2026-07-22T10:15:00.000Z",
        "last_synced_at": "2026-07-22T10:30:00.000Z"
      }
    ]
  }
}

Field Definitions

Field	             Type	                    Description
-------------------------------------------------------------------------

id	             string (UUID)	                Unique store identifier
---------------------------------------------------------------------------
platform	     string	        E-commerce platform name (woocommerce, shopify, etc.)
-------------------------------------------------------------------------------------
shop_domain 	string	            Store URL (including protocol)
-------------------------------------------------------------------------------------
status	        string          	Store status (active, inactive, error, syncing)
-------------------------------------------------------------------------------------
installed_at	string (ISO 8601)	Timestamp when the store was first connected
------------------------------------------------------------------------------------
last_synced_at	string (ISO 8601)	Timestamp of the last successful data sync
------------------------------------------------------------------------------------


Notes:
- Sensitive fields (e.g., access_token, consumer_key, consumer_secret) must never be included in the response.
- The status field is used by the frontend's ConnectBanner component (see below).

6. "Frontend Integration Notes — ConnectBanner Component"
ConnectBanner Behavior

The frontend's ConnectBanner component displays a banner prompting the user to connect a store.

Visibility Rules:
- The banner should be visible when no connected store has a status of 'active'.

- The banner should be hidden as soon as any store in the returned stores array has a status of 'active'.

Why This Matters

The endpoint returns the full list of connected stores so the frontend can:
- Determine if at least one store is active (hide the banner).
- Show all connected stores in a list or dropdown.
- Display the status of each store (e.g., "active", "error", "syncing").

Frontend Logic:
const hasActiveStore = stores.some(store => store.status === 'active');
// If true → hide ConnectBanner
// If false → show ConnectBanner

Example Scenarios
Stores Returned	                        Has Active?	                  Banner Visible?
-------------------------------------------------------------------------------------
[] (no stores)|	                        ❌ No|	                ✅ Show banner
-------------------------------------------------------------------------------------
[{ status: "error" }, { status: "inactive" }]|	❌ No|               	✅ Show banner
------------------------------------------------------------------------------------
[{ status: "active" }]|     	✅ Yes|	                            ❌ Hide banner
-------------------------------------------------------------------------------------
[{ status: "error" }, { status: "active" }]|	✅ Yes|	        ❌ Hide banner
-------------------------------------------------------------------------------------
[{ status: "syncing" }]|	❌ No (syncing is not active)|	✅ Show banner
------------------------------------------------------------------------------------


7. "Error Responses"

401 Unauthorized
Returned when authenticateToken fails.
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required. Please provide a valid Bearer token."
  }
}

404 Not Found

Returned when a notification or store cannot be found.
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Notification not found"
  }
}

500 Internal Server Error

Returned for database failures or unexpected exceptions.
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Failed to retrieve notifications. Please try again."
  }
}