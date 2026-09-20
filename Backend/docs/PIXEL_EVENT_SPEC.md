# Pixel Event Contract

`POST /api/v1/events/ingest` accepts a public storefront event. The request
must include `store_tracking_key`, not a raw store UUID.

```json
{
  "id": "evt_01J123456789",
  "store_tracking_key": "<server-issued-signed-key>",
  "session_id": "session_123",
  "anonymous_id": "anon_123",
  "customer_id": "optional-store-scoped-customer-uuid",
  "event_type": "ADD_TO_CART",
  "timestamp": "2026-09-20T12:00:00.000Z",
  "platform": "shopify",
  "page": { "url": "https://shop.example/products/a", "referrer": "https://google.com" },
  "device": { "type": "mobile", "user_agent": "browser user agent" },
  "payload": {}
}
```

Supported event types are `PAGE_VIEW`, `PRODUCT_VIEW`, `ADD_TO_CART`,
`REMOVE_FROM_CART`, `CHECKOUT_STARTED`, `CHECKOUT_STEP`, `PAYMENT_ATTEMPT`,
`PURCHASE`, `COUPON_FIELD_VISITED`, `COUPON_ATTEMPT`, `SEARCH`, and
`SESSION_START`.

The backend validates the event, resolves the store from the signed key,
persists `source = pixel`, `source_event_id = id`, and `received_at`, then
returns an acknowledgement. Repeating the same event ID for the same store is
idempotent. Feature computation is asynchronous and must consume committed
events; the browser request never waits for Python inference.