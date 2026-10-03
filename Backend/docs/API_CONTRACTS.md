# Backend API Contracts

## Authentication

Base path: `/api/v1/auth`.

JSON responses use `{ success, data?, error?, code? }`. The frontend sends
`credentials: 'include'` so the HttpOnly refresh cookie is stored and sent.
Access tokens are returned in `data.access_token` and are sent as
`Authorization: Bearer <access_token>`.

### Google signup and login

`POST /google`

```json
{
  "credential": "<Google Identity Services ID token>",
  "terms_agreed": true,
  "organization": {
    "brand_name": "Acme",
    "storeUrl": "https://acme.example",
    "storeCategory": "Apparel",
    "country": "NG",
    "state": "Lagos"
  },
  "preferences": { "monthlyRevenue": "0-10k" }
}
```

`credential` is required. `terms_agreed: true` is required when creating a new
Google account. `organization` is optional. Success creates a session and
returns an access token plus the user object. The refresh token is sent only as
an HttpOnly cookie.

An existing password account returns `409` with
`GOOGLE_ACCOUNT_LINK_REQUIRED`. Missing, invalid, suspended, and unconfigured
requests retain their existing `400`, `401`, `403`, and `503` responses.

### Link, refresh, and logout

- `POST /google/link` requires an access token and a Google credential whose
  email matches the authenticated account.
- `POST /refresh` rotates the refresh cookie and returns a new access token.
- `POST /logout` revokes the current refresh token and clears the cookie.
- `POST /logout-all` requires an access token and revokes every session.

## Storefront events

- `POST /api/v1/events/ingest` accepts one canonical pixel event.
- `POST /api/v1/events/ingest/batch` accepts up to 1,000 canonical pixel events.
- Both require the signed `store_tracking_key`; a raw browser-supplied store ID
  is not trusted.
- A committed event receives exactly one idempotent `feature_jobs` row.

The canonical event names and envelope are defined in
`docs/PIXEL_EVENT_SPEC.md` at the repository root.

## Commerce and message webhooks

- `POST /api/v1/webhooks/shopify/:topic` verifies Shopify HMAC over raw bytes.
- `POST /api/v1/webhooks/woocommerce/:topic` verifies the configured provider
  signature over raw bytes.
- `POST /api/v1/message-webhooks/sendgrid` verifies the SendGrid ECDSA signature
  and timestamp, then accepts the documented event array.

Provider delivery IDs and message event IDs are idempotent. Unsubscribe events
revoke email consent; failures do not expose raw provider errors.

## Controlled beta automation

- `GET /api/v1/settings/beta-automation/:storeId` reads the authenticated
  store's beta policy.
- `PUT /api/v1/settings/beta-automation/:storeId` updates opt-in, allowed
  channels/actions, caps, and the store kill switch.

Only owners and administrators of the store's organization may access these
routes. The global `BETA_AUTOMATION_KILL_SWITCH` overrides every store policy
and fails closed: only the exact value `false` opens the global action gate.

## Health

- `GET /health` reports process liveness.
- `GET /ready` reports `200` only when PostgreSQL is reachable and Python
  reports all models loaded under an allowed release status. When the global
  beta action gate is open, it additionally requires the complete Shopify and
  SendGrid configuration plus connected shared Redis coordination.

## Internal integration

- `POST /internal/store-sync` requires `X-Internal-Key`, validates the store,
  and executes the Backend-owned Shopify synchronization.
- Python's compatibility `POST /internal/sync/trigger` route delegates to this
  endpoint as a background task; it no longer reports an accepted no-op.

## Data access

The Backend uses the standard Prisma Client declared by version in
`Backend/package.json`. It does not use `@prisma/adapter-pg`. Runtime queries use
`DATABASE_URL`; migrations use `DIRECT_URL`, falling back to `DATABASE_URL` only
when no direct URL is configured.
