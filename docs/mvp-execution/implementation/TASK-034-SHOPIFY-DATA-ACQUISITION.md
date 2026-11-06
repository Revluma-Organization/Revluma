# TASK 034 — Shopify Data Acquisition Completeness (Execution Block 2)

**Date:** 2026-11-06 | **Branch:** `arena/166f7cc9-revluma` | **Baseline:** origin/main `7feee76` | **Deployment:** #312 merged, Render deploy pending at time of writing (see live-state addendum in docs/shopify-resource-coverage-register.md)

## Scope closed in this block

| Capability | Evidence | Status |
|---|---|---|
| Store identity & plan ingestion (`shop`) + domain reconciliation (primary/myshopify, SSL signal, stale-host removal) | new `services/storeProfileSync.js`, wired into orchestrator, ledger domain `store_domains`, tests 3/3 `storeProfileSync.test.js` | IMPLEMENTED, TESTED, **not deployed** |
| Migration `20261106133003_store_profiles` (`store_profiles` + `store_domains`, RLS, zero policies) | additive non-destructive | merged to main w/ this PR; not applied to prod (prestart on Render) |
| Order enrichment ingestion: business scalars, transactions, refunds, fulfillments | `services/orderEnrichment.js`, migration `20261106133002_commerce_event_graph`, `orderEnrichment.test.js` 4/4 | IMPLEMENTED, TESTED, **not deployed** |
| GraphQL shape drift fallback (connection↔legacy list) for `transactions` and `fulfillments` | in-process per-family cache; ACCESS_DENIED → recordDegraded; anything else → recordFailure (consistent with products/customers semantics) | TESTED (fallback pin) |
| Post-persistence enrichment wiring (GraphQL sync loop AND webhook `orders/*` branch, best-effort `admin_graphql_api_id`/numeric gid derivation, fire-and-forget isolation) | `shopifySync.js` `syncOrders`, `commerceWebhookService.js` | IMPLEMENTED, node --check |
| Checkout-completion lineage preserved; refund-scoped transactions stored ONLY in `order_refunds.transactions` (no double counting) | schema + tests | TESTED |
| Tags sanitation; invalid `processedAt/closedAt` timestamps dropped (never persisted); error prose (card-declination wording) never persisted — structured codes only | `orderEnrichment.js` | TESTED |
| Domain capability catalog (`services/domainCatalog.js`): required scopes, approvals, implementation status, restrictions for all 18 targeted domains; used by admin endpoint | `domainCatalog.js`, `coverageCatalog.test.js` 3/3 | IMPLEMENTED, TESTED |
| Coverage endpoint extended: status derivation `NOT_REQUESTED/PERMISSION_MISSING/APPROVAL_REQUIRED/UNSUPPORTED_BY_SHOPIFY/NOT_IMPLEMENTED/NOT_YET_SYNCED/SYNCING/FAILED/DEGRADED/INCOMPLETE/COMPLETE`, recorded scopes, missing scopes, restrictions, counts, freshness — never COMPLETE by scope existence | `adminSyncCoverageController.js` | IMPLEMENTED (schema-shared; frontend unchanged) |
| Explicit UNAVAILABLE / BLOCKED register in `docs/shopify-resource-coverage-register.md` (22 rows × scope/approval/impl/persistence/verification/restrictions) | doc | merged with this PR |
| Reconciliation skeleton (`scripts/reconcileResourceCounts.js`): DB counts + ledger freshness + explicit NOT VERIFIED source parity | script | IMPLEMENTED |
| ORDER pipeline additive columns: presentment_currency, display_fulfillment_status, processed_at, closed_at, source_name, test_flag, tax/shipping/duties/total_received, tags | migration + orders model | TESTED via suites |

## Deliberately NOT in this block (explicit)

Inventory items/levels/locations (`read_inventory`+`read_locations`); Markets/contextual pricing (`read_markets`); customer journey attribution (`customerJourneySummary` shape risk); orders duties/tax lines/discount allocations per line; metafields; returns/fulfillmentOrders; `read_all_orders`; bulk operations; Web Pixel behavioural capture; ShopifyQL; refunds restock value; refund transactions into `order_transactions` (STORED ONLY inside refunds JSON by design); production webhook subscription changes for new topics (approval-gated); tag/attribution on customers/Abandoned checkout line duties.

The directive's completion definition requires **all** of those for the final gate; none is reachable from a merge — several are externally blocked or plan-gated. This block is the maximum honest increment.

## Production prerequisites (unchanged)

1. **Render manual deploy of `main`** for service `revluma-backend-vrsd` (auto-deploy evidently not landing merges; `/ready` still served `node_build=55639425b3f5` at 2026-11-06T14:00Z although PR #310/#311 merged before then). Prestart applies the three new migrations.
2. Post-deploy: trigger/let v1 re-sync run; inspect `/admin/.../sync-coverage`; confirm products/variants ledger rows flip to `ok` after the (already merged) F-001 fix; confirm enrichment ledger rows (`transactions`, `refunds`, `fulfillments`, `store_domains`) appear; watch scheduler logs for `shopify_product_sync_*`, `order_enrichment_*`, `sync_domain_state_unavailable`.
3. Any failure surfaces as ledger `error_code` with tenant scope — no automatic remediation is authorized.

## Blockers (explicitly NOT resolvable by engineering)

- Production deployment (above); Shopify `read_all_orders` application + protected-customer-data approval; `write_pixels` + Web Pixel extension; conflicted-domain pair; PRODUCTS_* + new topic remote subscription approval; deduplication/reconciliation writes for stale cancelled rows & duplicate cart identities; CBC→GCM rekey; P6 live session.

## Test evidence (local, engine-free where applicable)

`orderEnrichment` 4/4 · `storeProfileSync` 3/3 · `coverageCatalog` 3/3 · `productSync` 9/9 · `reconciliation` 7/7 · `syncDomainState` 7/7 · `productVariantPersistence` 3/3 · `fetchFamily` fallback pinned · full local non-engine suite 57/57 pass. 6 engine-dependent suites remain CI-only locally; CI run for this PR is the authoritative gate.

**Honest bottom line: this is execution block 2, not definition-of-done. Nothing from this block is production-verified until the Render redeploy lands and v1 is re-synced.**
