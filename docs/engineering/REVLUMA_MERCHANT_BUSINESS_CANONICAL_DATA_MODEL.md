# Revluma merchant business — canonical data model

Schema of record: `Backend/prisma/schema.prisma`. Additive migrations only;
no destructive operations on existing tables. Research 2026-11-05; production
observations 2026-11-06.

## Design rules

1. **Preserve Shopify identifiers** in `external_*` columns; Revluma's internal
   `id` is never leaked back as a Shopify ID and vice versa.
2. **Org → Store → commerce graph.** Every commerce table hangs off
   `stores(id)`; every store hangs off `organizations(id)`. Tenant scoping is
   therefore a single join away everywhere.
3. **Money is decimal-exact.** Amounts are stored as strings/Decimals end to end
   (source payload → GraphQL variables are strings; Prisma `Decimal`); never
   through JS `Number` for certification-relevant comparisons.
4. **Currency travels with every amount** (`currency`, per row where mixed
   currency is possible, e.g. `customers.ltv_currency`,
   `customers.ltv_mixed_currency` flag).
5. **Financial concepts stay separate.** `subtotal`, `discount_amount`,
   `refunded_total`, `total` are stored side-by-side; Revluma computes
   gross/net *as views over source fields* and never overwrites stored source
   values with calculated ones.
6. **Tombstones over deletes where the platform loses deletes.**
   `order_cancellation_tombstones` keeps `(store_id, external_order_id)` plus
   `cancelled_at`, `currency`, `total`, `observed_at` so certification can
   exclude cancelled orders without losing the audit trail.
7. **Freshness and provenance columns where they matter:** `last_synced_at`
   (stores), `received_at`/`processed_at` (webhook_deliveries),
   `observed_at`/`cancelled_at` (tombstones), `certified_at`
   (`intelligence_order_coverage`).

## Entity graph

```text
organizations ──< organization_members >── users
      │
      ▼
stores ──┬─< products ──< product_images / product_attributes / product_*_links
          │                 (variants: embedded in products row via productSync
          │                  as external child rows; parent_external_id set)
          ├─< orders ──< order_items
          │     │  └─ external ids: external_order_id, source_checkout_id,
          │     │     source_cart_token, abandoned_cart_id, recovery_status,
          │     │     attribution_channel, coupon_used, discount_pct
          │     ├─< order_checkout_reconciliation_cases  (ambiguity log)
          │     └─< order_cancellation_tombstones        (delete evidence)
          ├─< customers ──< orders (customer_id), abandoned_carts, events,
          │                  churn_training_observations, sensitivity_training_observations
          ├─< abandoned_carts ──< abandoned_cart_items
          ├─< webhook_registrations      (topic ↔ store ↔ Shopify subscription id)
          ├─< webhook_deliveries         (durable inbox; see sync strategy)
          ├─< privacy_requests           (d5f8e0a; request lifecycle + result)
          ├─< intelligence_order_coverage (window attestations; certification)
          ├─< intelligence_findings      (derived, evidence-linked)
          └─< store_settings
```

`payment_transactions` is **Revluma's own Paystack billing** for merchant
subscriptions — not Shopify Payments. Merchant Shopify Payments payout/dispute
data is not ingested.

## Key tables

### `stores`
`id, organization_id, platform, shop_domain, access_token (encrypted), granted_scopes, status (active|syncing|...), installed_at, last_synced_at, public_tracking_key, …`
`granted_scopes` is the install-time OAuth record — treat as a hint, not a live grant.
`status='syncing'` with a stale `updated_at` marks an interrupted run.

### `orders`
`id, store_id, customer_id, external_order_id, source_checkout_id, source_checkout_token, source_cart_token, abandoned_cart_id, total, refunded_total, subtotal, discount_amount, discount_pct, currency, coupon_used, coupon_code, recovery_status, attribution_channel, attribution_sequence_id, session_id, ordered_at, created_at`
Unique on `(store_id, external_order_id)` (enforced in sync via upsert keys).
`total` is the source-recorded order total; it is *not* profit, *not* tax,
*not* shipping, and *not* necessarily captured money.

### `order_items`
`id, order_id, store_id, external_line_item_id, external_product_id, external_variant_id, product_name, product_type, quantity, unit_price, line_total, ordered_at, created_at`
`unit_price` is a **revenue-side** price. No COGS exists anywhere in the model.

### `customers`
`id, store_id, external_id, email, full_name, phone, anonymous_id, consent_email, consent_sms, consent_updated_at, ltv, ltv_currency, ltv_mixed_currency, orders_count, rfm_recency, rfm_frequency, rfm_monetary, rfm_segment, rfm_updated_at, churn_* (model outputs, versioned), …`
PII: `email`, `phone`, `full_name` are direct identifiers — never logged, never
emitted in evidence payloads; redaction paths exist for privacy requests.
RFM/churn columns are derived and carry model versions (`churn_model_version`).

### `products`
`id, store_id, external_id, parent_external_id, name, slug, type, status, catalog_visibility, sku, price, regular_price, sale_price, on_sale, total_sales, manage_stock, stock_quantity, stock_status, …` (WooCommerce-era columns reused by the Shopify mapper; `external_id`/`parent_external_id` hold Shopify GIDs; prices preserved exactly as decimal strings.)
Variant handling: nested variant pages are fully paginated **before** writes;
a product whose nested connection truncates or changes mid-pagination aborts the
sync for that product and is retried later — fail-closed, never partial.

### `abandoned_carts` / `abandoned_cart_items`
`external_cart_id`, `source_checkout_*`, `cart_value`, `currency`, `status`,
`abandoned_at`, `recovered_at`, recovery linkage; scoring columns are derived.

### `webhook_deliveries` (durable inbox)
`id, provider, delivery_id, store_id, topic, status ('received'|'processed'|'failed'), received_at, processed_at, last_error`
Idempotency key: `(provider, delivery_id)` — plus store/topic identity verified
at claim time.

### `webhook_registrations`
`id, store_id, external_id, topic, delivery_url, status, attempt_count, …`
One row per (store, topic) registration attempt; `succeeded` rows record the
installed subscription; duplicate `active` rows exist in production and are
flagged for review (do not delete ad hoc).

### `privacy_requests` (d5f8e0a)
`id, store_id, provider, topic, request_key (idempotency), status, payload, result, attempts, last_error, received_at, processed_at, updated_at`
Lifecycle: recorded before work → processed idempotently → terminal
`processed` (with `result` counts, never PII) or `failed` (retryable).
RLS enabled; API roles revoked.

### `intelligence_order_coverage`
`store_id, organization_id, coverage_start, coverage_end, certified_at, customer_lifetime_verified, source, source_run_id`
A window attestation, minted only by a full decimal-exact pass over a 14-day
window; deleted at the start of every sync run; never implies historical or
payment completeness.

### `intelligence_findings`
Derived, evidence-linked observations Rev surfaces; carries tenant scoping and
references to the metrics/windows used.

### `order_checkout_reconciliation_cases`
Ambiguity log when a checkout maps to multiple candidate orders (or identity is
contested) — preserves evidence, never guesses; resolution is explicit.

## Tenant isolation model

- PostgREST/GraphQL (`anon`, `authenticated`) roles hold **zero** table grants
  (migration `20261104170000_supabase_data_api_lockdown`); `rev_is_org_member`
  is the single policy helper, `EXECUTE` granted to `authenticated` only.
- Backend accesses via the service role with explicit `store_id`/`organization_id`
  filters; privacy redaction and deletion paths are scoped to the verified store.
- Cross-tenant behavior is covered by focused tests (identity mismatch on claim,
  store-scoped redaction). Two live organizations were not available for
  end-to-end testing — see certification doc.

## Freshness & deletion propagation

- Orders/customers/products/checkouts: webhooks for create/update/delete +
  scheduled overlap sync + 14-day certification on each full pass.
- Deletes: `products/delete` scoped-deletes the row; order deletes surface via
  tombstones created by sync; full per-domain tombstone coverage is open (DE-006).
- Currency/timezone: windows are half-open UTC `[start, end)` everywhere.
