# Revluma — data synchronization strategy

Research 2026-11-05; production observations 2026-11-06. Scope: ingestion,
incremental sync, webhooks, reconciliation, backfills, failure handling.
Implementation: `Backend/src/services/shopifySync.js`, `productSync.js`,
`shopifyWebhookService.js`, `commerceWebhookService.js`,
`commerceWebhookController.js`, `schedulerService.js`, `schedulerLocks.js`,
`shopifySyncRecovery.js`, `intelligenceShopifyCoverageProducer.js`.

## Lifecycle

```text
install ──► initial sync (syncShopifyStore) ──► scheduled incremental sync
              │                                     (schedulerService + locks)
              ▼                                        ▲
webhooks (12 required topics) ──────────────────────────┘
              │
              ▼
   overlap reconciliation (order_sync re-reads a trailing window;
   coverage certification re-attests only on a full pass)
```

### Initial sync

`syncShopifyStore(store)`:
1. Set `stores.status='syncing'` (record previous `last_synced_at`; a stale
   `syncing` marks an interrupted run). **Delete any prior coverage
   attestation** — no sync pass may inherit a stale certificate.
2. `webhook_reconciliation` — reconcile 12 required subscriptions with Shopify
   (list → create/delete per topic, record in `webhook_registrations`). A failed
   subscription stays visible (warn) and does not block ingestion.
3. `product_sync` — paginated products + nested variants (fail-closed); an
   explicit Shopify `ACCESS_DENIED` on the products field downgrades to
   `shopify_product_sync_permission_limited` for legacy installs lacking
   `read_products`. Every other failure is fatal.
4. `customer_sync` — same pattern; explicit customers-field denial downgrades.
5. `order_sync` — orders + nested line items; fail-closed on truncation.
6. `abandoned_checkout_sync` — `abandonedCheckouts` + nested items.
7. On orders+checkouts success: `status='active'`, `last_synced_at=now`.
8. Coverage certification attempted (fail-closed; failure → warn only).
9. RFM recompute (deferred, non-fatal).

### Incremental sync

- **Scheduled** (`schedulerService` + `schedulerLocks`): overlap window
  re-read of orders; corrects missed changes without webhooks.
- **Webhooks** (authoritative re-read, never trust the body for writes):
  `products/create|update|delete` → `syncProductById`/`deleteProduct`;
  orders/checkouts/customers → upsert paths in `commerceWebhookService`;
  order webhooks never overwrite independently verified state with a stale
  snapshot (monotonic/advisory-lock guards at checkout linkage points).

### Webhook durability contract

`webhook_deliveries(provider, delivery_id)` is a durable inbox:

- **Before processing:** row inserted with `status='received'`
  (`claimDelivery`). Duplicates: an existing `processed` row ⇒ HTTP 200
  `duplicate: true`; an existing `received`/`failed`-but-still-claimed row
  ⇒ `WEBHOOK_DELIVERY_PENDING` ⇒ non-2xx ⇒ Shopify retries. A `failed` row may
  be reclaimed for retry (state reset to `received`).
- **Store identity verified per claim** — a delivery is bound to the store that
  HMAC-verified and matched `x-shopify-shop-domain`; cross-store delivery IDs
  cannot claim rows.
- **On success:** `status='processed'`, `processed_at` set. Business-data
  commit precedes `processed` — a crash mid-process leaves `received`, so
  Shopify redelivers.
- **On failure:** `status='failed'` with `last_error` code only (never PII);
  routed to `next(error)` → 5xx → Shopify retries with Shopify's backoff.
- **Signature:** HMAC-SHA256 over the **raw body**, comparison on fixed-length
  hex (`safeCompareHex`); 401 on mismatch; 400 if body is not the raw buffer.
- **Registration truth:** `webhook_registrations` rows; 12 required topics
  enforced by `shopifyWebhookService` (order/customer/checkout/product +
  app/uninstalled).

**Known gaps (open, tracked in DE-006/DE-010):** no dedicated dead-letter queue
(terminal failures live on `webhook_deliveries.status='failed'` + logs);
`webhook_registrations` in production contains two `active` rows per topic
(duplicate subscriptions or re-registration artifacts) pending reconciliation;
no delivery-retention/purge job yet; products/create webhook handler re-reads
but does not yet coalesce bursts.

### Reconciliation & backfill

- **Order overlap:** trailing window re-read on each scheduled run; dedupe by
  `(store_id, external_order_id)`; tombstones for orders gone from the source.
- **Coverage windows:** 14-day decimal-exact certification per pass; attestation
  deleted at pass start (no stale certs).
- **Backfill:** full history requires `read_all_orders` (not granted; 60-day
  default). Backfill machinery for when approval lands is the same pipeline
  with a widened initial window; no special code path exists yet, by design.

### Deletion & privacy propagation

- `products/delete` → scoped `deleteMany` for the store.
- `orders/*` → upserts/cancel handling + tombstone detection on sync.
- Mandatory privacy topics (`customers/data_request`, `customers/redact`,
  `shop/redact`) → durable `privacy_requests` workflow (d5f8e0a): recorded
  before work, idempotent across redeliveries, redaction/erasure scoped to the
  verified store, audit log entries with counts only, terminal `processed` or
  retryable `failed`. See docs/security/REVLUMA_SHOPIFY_DATA_ACCESS_AND_PRIVACY_CONTROLS.md.
- `app/uninstalled` → topic subscribed; stores row is handled by existing
  uninstall path; retention/deletion after uninstall beyond privacy redaction
  is tracked separately (open).

### Rate limits & backpressure

- GraphQL 30s timeout, explicit error mapping; pagination caps (100 pages
  root; nested pages must terminate or the sync aborts).
- Webhook 429/5xx → `failed` + Shopify retry; `WEBHOOK_DELIVERY_PENDING`
  prevents double-processing under redelivery storms.
- Advisory transaction locks serialize checkout→order linkage per checkout UUID.

### Observability

- Structured logs: `shopify_setup_stage {stage, outcome, count}`,
  `shopify_webhook_*`, `commerce_webhook_*`, `shopify_order_coverage_*`,
  `shopify_interrupted_sync_detected`, `shopify_product_sync_permission_limited`.
- `/ready` exposes scheduler state (visible failure: `business-state` job
  `INTELLIGENCE_UNAVAILABLE`, 2026-11-06 05:35Z — investigate separately).
- Alertable conditions: any `*_failed` webhook topic, coverage unverified
  after a full sync, stale `status='syncing'`.
