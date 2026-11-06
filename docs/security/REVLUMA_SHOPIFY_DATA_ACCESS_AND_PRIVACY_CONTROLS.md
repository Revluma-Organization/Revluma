# Shopify data access and privacy controls

Research 2026-11-05; implementation state 2026-11-06. Applies to the Shopify
integration of `revluma-test-store-v1.myshopify.com` and any future merchant.
Normative requirements Shopify imposes: [privacy law compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)
— the app must handle `customers/data_request`, `customers/redact`, `shop/redact`.

## 1. Token & credential storage

- Access tokens are stored **encrypted** in `stores.access_token`
  (AES-256-GCM via `utils/encryption.js`; key from `SHOPIFY_TOKEN_ENCRYPTION_KEY`).
  Tokens are decrypted in-memory per request only and never logged, never
  returned by any API, never included in evidence payloads.
- Webhook authenticity: `X-Shopify-Hmac-Sha256` verified over the **raw** request
  body before parsing (`verifyShopifySignature`); mismatch ⇒ 401, no processing.
- OAuth callback: state nonce validation, scope union rebuilt at install; the
  `write_discounts` scope in the record is **unused by application code** —
  flagged for a separate reviewed reduction (with merchant re-consent impact
  analysis). It is not removed in this release because removal changes the
  merchant-facing grant surface and requires reauthorization review.
- Temporary diagnostic instrumentation (`TASK013_CHECKOUT_FIELD_CAPTURE`,
  `TASK014_ORDER_FIELD_CAPTURE`) logs **field names and types only**, is
  env-gated, and is restricted to the test store. It never emits values. These
  are opt-in debug aids, not telemetry; they should be removed once the order
  financial audit closes.

## 2. Mandatory privacy webhooks (implemented — d5f8e0a)

`customers/data_request` / `customers/redact` / `shop/redact` now have a durable,
auditable workflow (`privacyWebhookService.processPrivacyRequest`):

1. **Recorded before work** in `privacy_requests` (`request_key` = idempotent
   dedupe key `provider:topic:store_id:shopify_request_id_or_body_digest`).
2. **Idempotent**: a `processed` redelivery short-circuits; `failed` requests
   may be retried; concurrent claims race safely on the unique `request_key`.
3. **customers/data_request** compiles a tenant-scoped export artifact
   (customer profile incl. consent fields, orders, line items, cart pointers)
   stored on the request row's `result` as counts + references. **Nothing is
   emailed or transmitted** — retrieval is an operator action outside this
   code path, and the artifact contains only the requesting shop's data.
4. **customers/redact** erases direct identifiers (email, phone, name),
   session/event linkage, ML session features, churn/sensitivity observations,
   and checkout/cart pointers for exactly the verified store + customer.
5. **shop/redact** deletes all store-scoped business data in FK-safe order in a
   single transaction and redacts the `stores` row (token and scopes revoked,
   status `redacted`).
6. **Auditability**: `audit_logs` rows record action + counts only (e.g.
   `customers_redacted: 1`), never PII or tokens.
7. **Failure**: exceptions mark the request `failed` (visible, retryable) and
   the webhook delivery `failed` (Shopify retries) — the topic is never
   acknowledged while unactioned.
8. RLS on `privacy_requests` enabled; API roles revoked (migration
   `20261105230000_add_privacy_requests`).

**Not yet implemented (open):** uninstall-triggered retention/deletion schedule
for non-privacy-request data beyond the above; export delivery channel for
data-request artifacts to merchants (manual, by design); automated purge of
`webhook_deliveries` history; `app/uninstall` data-lifecycle review.

## 3. Data minimization

- Customers: email, phone, full name (needed for RFM/comms); no addresses are
  persisted. `ltv`/RFM are derived. `consent_email`, `consent_sms`,
  `consent_updated_at` track source consent with timestamps.
- Orders: financial source fields only (`total`, `subtotal`, `discount_amount`,
  `refunded_total`, `currency`, coupon codes). No payment instruments, no
  gateway metadata.
- Evidence payloads reference IDs, not identities; customer identity appears
  only inside privacy-request artifacts.

## 4. Tenant isolation (verified + limits)

- `anon`/`authenticated` PostgREST roles hold zero table grants
  (`20261104170000_supabase_data_api_lockdown`); RLS enabled on
  `privacy_requests`; `rev_is_org_member()` is the only policy helper.
- Every backend commerce query filters by `store_id`/`organization_id`; webhook
  claims verify `x-shopify-shop-domain` → store (else 401/404) and re-verify
  store identity at claim time (cross-store `delivery_id` cannot replay).
- Redaction paths hard-scope by `store_id`.
- **Limitation:** testing used one live store; cross-tenant verification is at
  unit/integration level, not a second live merchant. Live two-org E2E remains open.

## 5. Webhook security matrix

| Control | Implementation |
|---|---|
| Authenticity | HMAC-SHA256, raw body, fixed-time hex compare |
| Replay/dedupe | `webhook_deliveries (provider, delivery_id)` durable claim; only `processed` ⇒ 200 duplicate |
| Store binding | Domain header → store lookup; claim re-checks store/topic |
| Failure visibility | `failed` state + 5xx → Shopify retry; pending state blocks ack |
| Topic allowlist | Explicit required topics; unknown topics → `failed`, not silently dropped |

## 6. Logging

Structured JSON logs carry IDs, counts, reason codes, HTTP statuses and ≤5
sanitized Shopify error messages. Never: tokens, PII values, raw bodies,
personal data from webhook payloads (violations would be a bug — report).

## 7. Data access matrix (who can see what)

| Subject | Access |
|---|---|
| Shopify (platform) | Source of truth; we hold an encrypted, scoped read grant |
| Revluma backend | Service role; explicit store/org filters |
| Revluma employees via DB console | Supabase dashboard access, least-privilege (Supabase team); no app bypass |
| Merchant (frontend) | Own org/store data only via authenticated API; RLS/grant lockdown applies |
| Other merchants | Nothing — enforced at query layer |
| Rev (LLM) | Only evidence/metric payloads assembled server-side; no raw PII in prompts beyond what the answer needs |
| Rev convl. memory | Tenant+user+store scoped; correctable/expiring; never shares across stores |

## 8. Shopify approvals & merchant authorizations (external, open)

- `read_all_orders` — **not granted**; required for >60-day history; requires
  Shopify review. Not claimed.
- Protected customer data — `read_customers` is in the install record; the
  protected-customer-data review/approval state of the app is **NOT VERIFIED**
  and requires Shopify confirmation before marketing to EU/UK merchants.
- Shopify Payments scopes in the install record — eligibility/approval
  unverified; no code path uses them.
- Scope reduction of `write_discounts` — proposed, not executed; requires
  separate review + merchant reauthorization.
