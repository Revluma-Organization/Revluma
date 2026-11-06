# Revluma — Shopify Data Resource & Field Coverage Register

**Version:** 2026-11-06 (TASK-034) · **API:** Admin GraphQL `2026-10` · **Store baseline:** revluma-test-store-v1.myshopify.com
Only `IMPLEMENTED` + `PRODUCTION_VERIFIED` rows meet the directive's final acceptance criteria. Everything else is labelled honestly. No row is COMPLETE by scope existence alone.

| # | Domain | Required scope(s) | Approval beyond OAuth | Implementation (file) | Persistence | Verification | Notes / restrictions |
|---|--------|-------------------|----------------------|----------------------|-------------|--------------|----------------------|
| 1 | Store identity & plan (`shop`) | none | none | `services/storeProfileSync.js` + ledger `store_domains` | `store_profiles`, `store_domains` (RLS) | IMPLEMENTED only — not production-verified | `shop.email` = owner contact, not customer PII |
| 2 | Store domains (primary/myshopify/ssl/plan) | none | none | same as above; stale domains reconciled out | `store_domains` | IMPLEMENTED only | `.myshopify.com` handled as a **configuration signal**, never as proof of lost sales |
| 3 | Products (catalogue, options, SEO, media) | `read_products` | none | `services/productSync.js` | `products.dimensions` JSONB | IMPLEMENTED; pre-existing; deploy-pending | F-001 fixed 2026-11-06 (PR #310); scalar-money normalizer fixed (PR #311) |
| 4 | Product variants (price/compare-at/SKU/barcode/weight/options) | `read_products` | none | `productSync.js` + variant pagination LOCAL expansion | `product_variants` table, RLS | TESTED locally; **not production-verified** | per-product vanished rows reconciled; exact decimal precision |
| 5 | Inventory items / levels / locations | `read_inventory`, `read_locations` | none | `services/inventorySync.js` + migration `20261106133004_inventory_locations` (3 additive tables, RLS) | `locations`, `inventory_items`, `inventory_levels` (quantities typed JSONB, stale-sweep only on pagination-complete) | IMPLEMENTED; **not deployed** (this PR) | scope widening now requested at install; existing installs see `REQUIRES_ADDITIONAL_SCOPES` until re-consent; ACCESS_DENIED degrades ledger loudly |
| 6 | Markets & contextual pricing | `read_markets` | plan-gated | **NOT IMPLEMENTED** | — | NOT_IMPLEMENTED | `contextualPricing(context:)` root coverage collapses per market; eligibility unproven |
| 7 | Customers | `read_customers` | protected customer data | `shopifySync.js` → `customers.upsert` | `customers` (consent, state, tags absent) | IMPLEMENTED; deploy-pending; protected-data **UNKNOWable** here | guests distinct from customer records; first/last purchase timestamps NOT yet maintained |
| 8 | Orders (identity, totals, net/refund-aware) | `read_orders` | `read_all_orders` for >60d history | `shopifySync.js` → `upsertOrder` / `cancelOrder` | `orders` (+ additive outcome columns: presentment_currency, display_fulfillment_status, processed_at, closed_at, source_name, test_flag, tax/shipping/duties/total_received, tags) | IMPLEMENTED; deploy-pending | financial semantics pinned by tests + python parity |
| 9 | Order line items | `read_orders` | none | nested `lineItems(first:250)` + `completeLineItems` re-fetch on truncation | `order_items` | IMPLEMENTED; deploy-pending | duties/tax lines/discount allocations not persisted; `fulfillmentStatus`/discountAllocations NOT yet mapped |
| 10 | Payment transactions | `read_orders` | none | `services/orderEnrichment.js` (E2; connection↔legacy fallback) | `order_transactions` table, RLS | IMPLEMENTED + TESTED; not production-verified | kind/status/gateway/amount/parent/error_code; raw card data never requested/stored; connection-vs-list API-shape drift absorbed in-process |
| 11 | Refunds & refund line items | `read_orders` | none | `orderEnrichment.js` (E3) | `order_refunds` table, RLS (line items + refund transactions as JSON) | IMPLEMENTED + TESTED; not production-verified | no double-counting: refund-scoped transactions stay in `order_refunds.transactions`; restock type captured |
| 12 | Fulfillments (status, tracking, location, line items) | `read_orders` | none | `orderEnrichment.js` (E4; same fallback) | `order_fulfillments` table, RLS | IMPLEMENTED + TESTED; not production-verified | fulfilment orders & returns need additional scopes — **NOT IMPLEMENTED, documented** |
| 13 | Abandoned checkouts | `read_checkouts` | none | `shopifySync.js` → `upsertAbandonedCart` | `abandoned_carts` (+ items) | IMPLEMENTED; prod has **5 duplicate identity groups** (preview tool ready, apply gated) | checkout-scoped; ≠ visitor denominator; canonical identity tooling shipped (tests) |
| 14 | Customer journey attribution | `read_orders` | plan/channel-dependent | **NOT IMPLEMENTED** | — | NOT_IMPLEMENTED | `customerJourneySummary` fields not requested — deliberate (shape risk + low leak-ROI first) |
| 15 | Discount nodes / applications | `read_discounts` | none | **NOT IMPLEMENTED** | — | NOT_IMPLEMENTED | read-only scope; no force-granted write_discounts (PR #310) |
| 16 | Web pixel behavioural events | `write_pixels` (+`read_customer_events`) | merchant consent + extension deploy | Web Pixel spec only (`docs/PIXEL_EVENT_SPEC.md`) | none | **UNAVAILABLE — production would see 0 events regardless of queries** | separate behavioural capability; do not confuse with ordinary Admin API access |
| 17 | ShopifyQL / Shopify analytics | `read_analytics`, `read_reports` | plan-dependent (`ShopifyQL` ≈ Plus/Advanced) | **NOT IMPLEMENTED** | — | NOT_IMPLEMENTED | verification requires per-store plan check — do not substitute assumptions |
| 18 | Metafields (products/orders/customers) | `read_products`/`read_customers`/`read_orders` | none | **NOT IMPLEMENTED** | — | NOT_IMPLEMENTED | selection after data-contract stability |
| 19 | Bulk operations (large stores) | (scopes as per resource) | none | pagination active (`fetchConnection`), no Bulk Operations yet | — | PARTIAL | documented dependency; current ceiling ≈ MAX_SYNC_PAGES; resumable rows not quota-tested at scale |
| 20 | Webhook subscriptions (drift baseline) | (callbacks; admin POST create) | remote mutations approval-gated | `shopifyWebhookService.js` reconciliation verifier | `webhook_registrations`, `webhook_deliveries` | IMPLEMENTED; production creation untouched (approval) | reconciliation covers topics; PRODUCTS_* and new inventory/fulfillment topics **not** auto-registered (gated) |
| 21 | Conflicted domain pair | — | merchant resolution | none | none | **BLOCKED (data ambiguity)** | fail-closed webhook resolution; never attribute silently |
| 22 | Provenance for enrichment rows | — | none | `synced_at` on every new table; ledger `store_id` scoping | new tables + `store_sync_domain_states` | TESTED (unit) | full transformation-version column deferred to next contract pass |
| 23 | Read-time freshness/currency metadata | — | none | `store_sync_domain_states` + `/admin/.../sync-coverage` statuses | admin endpoint | IMPLEMENTED | granularity per-domain incl. pagination_complete |

## Explicit UNAVAILABLE/BLOCKED ledger

- **UNAVAILABLE_FROM_SHOPIFY**: competitor price/catalogue data (external), advertising ROI (external platforms), SEO/indexing (Search Console/Data API — external), off-platform reviews/reputation, browser behaviour without a Web Pixel.
- **BLOCKED_BY_SHOPIFY_APPROVAL / BLOCKED_BY_MERCHANT_AUTHORIZATION**: `read_all_orders` (history depth > 60 days), protected customer data (addresses/full names), `write_pixels` + Web Pixel extension deployment, analytics scopes plan-verified, PRODUCTS_* webhook remote registration, refund/returns scopes, conflicted-domain pair.
- **NOT_YET_VERIFIED_LIVE**: every row above whose status says so — the canonical Render service has not yet served the new build at the time of writing (see TASK-034).

## Live state update (2026-11-06T14:05Z, read-only SQL)

- `/ready`: `node_build=7feee764c3d1`; db+redis+python `beta_ready`; scheduler completing.
- `_prisma_migrations`: `20261106133000`/`…133001` applied 14:01Z.
- **v1 production catalogue now holds 17 products and 26 product_variants** — exact Shopify baseline; the single store's catalogue pipeline is production-proven end-to-end for the first time.
- Ledger rows on v1 (14:02–14:03Z): products ok/17, variants ok/26, customers ok/12, orders ok/4 (latest window), abandoned_checkouts ok/8 — all `pagination_complete=true`, retries 0, zero errors.
- v1 full order-event graph (transactions/refunds/fulfillments) **not yet available**: PR #312 merged but undeployed at this timestamp — no `order_transactions`/`order_refunds`/`order_fulfillments`/`store_profiles`/`store_domains` tables in production; verifying requires the next deploy + re-sync.

## Universal mandate addendum (2026-11-06, TASK-035, `arena/e4b00d26-revluma`)

- New: universal registry (`services/resourceRegistry.js`, 46 resources incl. `orders`,`transactions`,`refunds`,`fulfillments`,`webhooks`,`abandoned_checkouts`), schema-drift differ + admin endpoints (`schema-drift`, `universal-coverage` — see TASK-035). Registry `verification.live_read` rows are still only evidence-backed AFTER deployed runtime re-verification — deployment target unmerged at time of writing.
- Install-time scope widen (this PR): `read_inventory`, `read_locations`. Partner-Dashboard scope list must include both BEFORE merchants re-authorize — human Partner-Dashboard action (see TASK-035 prerequisites).
- Statuses the universal report can emit: `IMPLEMENTED_VERIFIED`, `IMPLEMENTED_UNVERIFIED`, `REQUIRES_ADDITIONAL_SCOPES`, `REQUIRES_APP_APPROVAL`, `PLAN_RESTRICTED`, `SYNC_FAILED`, `ACCESS_DENIED`, `NOT_IMPLEMENTED`, `UNAVAILABLE_PLATFORM`, `RECONCILIATION_FAILED`.
- Unmatched commerce-looking schema roots are surfaced as discovery deltas only (`schema-drift`); nothing unmatched is ever persisted without a human-reviewed mapping.
- Still NOT done (explicit): bulk operations, markets, content, discounts, metafields, ShopifyQL, Web Pixels, B2B, refunds/fulfillments webhook-side enrichment beyond current state, source↔DB reconciliation runner, delete-detection pass, multi-merchant certification, all Partner-Dashboard approvals, PRODUCTS_* remote webhook topics, CBC→GCM rekey.

## Entry points (operator)

- Coverage: `GET /admin/shopify/stores/{storeId}/sync-coverage` — catalog × ledger fusion, explicit statuses incl. `PERMISSION_MISSING`-style reasoning via `missing_scopes`, `COMPLETE` only with `pagination_complete: true`.
- DB-side counts + freshness: `node scripts/reconcileResourceCounts.js` (source parity NOT available offline; see script header).
- Dedup preview (abandoned carts): `node scripts/previewAbandonedCartDedup.js` — no apply path.
- Financial reconciliation preview: `node scripts/previewFinancialReconciliation.js` — no apply path.
