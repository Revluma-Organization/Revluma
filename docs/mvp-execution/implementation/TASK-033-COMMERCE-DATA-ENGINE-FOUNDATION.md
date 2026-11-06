# TASK 033 — COMMERCE DATA ENGINE FOUNDATION (Phase 0 closure → Phase 1 start)

**Date:** 2026-11-06 | **Workstream:** Data engine (EXECUTION under NONSTOP mandate of 2026-11-06) | **Branch:** `arena/b715741f-revluma` | **Production:** PR #310 merged (`0d2fb7f` ≈ `cfa87da`); **deploy with this task pending — see §Blockers**

## Scope (implemented and tested)

| Capability | Mechanism | Status |
|---|---|---|
| Per-domain sync state ledger (Phase 0.3) | New table `store_sync_domain_states` (migration `20261106133000_store_sync_domain_states`), Prisma model, `services/syncDomainState.js`, wired into `shopifySync.js` for products/variants/customers/orders/abandoned_checkouts/webhooks (attempt→success/failure/degraded, retry counting, error truncation to 500 chars, checkpoint JSON merge, freshness seconds, **telemetry failures never throw into sync**) | TESTED (7/7 `syncDomainState.test.js`); wired; **not deployed/not verified live** |
| Admin per-domain coverage endpoint (Phase 0.3 / 8.1 substrate) | `GET /admin/shopify/stores/:storeId/sync-coverage` (admin-key gated, no-store, no tokens/customer data); completeness='complete' only when all required domains report `ok` with `pagination_complete=true` | IMPLEMENTED; not wired to frontend |
| Normalized product variants (Phase 1.8) | New table `product_variants` (migration `20261106133001_product_variants`), model, `mapVariant` + `upsertProductVariants` (idempotent upsert, per-product removal of vanished rows, cascade delete with product delete), wired in both `syncProducts` and webhook re-fetch paths; variants ledger row recorded | TESTED (3/3 `productVariantPersistence.test.js` incl. reconciliation + MoneyV2 pin); 7/7 productSync suites |
| Variant query expansion (Phase 1.5) | VARIANT_FIELDS now also selects `availableForSale`, `selectedOptions{name,value}`, `inventoryItem{id tracked requiresShipping …}` — still through `inventoryItem.measurement.weight` (F-001 pin relaxed to permit the extension, still forbids variant-level `weight`) | TESTED |
| Variant money normalizer defect | GraphQL money scalars are **decimal strings** (fixtures always pass strings); `moneyString` previously returned null for every variant price, silently nulling per-variant pricing (catalogue `price` survived only via `priceRangeV2` fallback). Now accepts scalar string/number **and** `MoneyV2` objects, still rejects non-decimals loudly | TESTED (moneyv2 + scalar pins) |
| Abandoned-cart dedup planning (Phase 0.5) | `scripts/previewAbandonedCartDedup.js` + pure `scripts/lib/dedupPlan.js`: canonical checkout identity (numeric GID tail > opaque token), earliest-row keep rule, cross-tenant isolation, **no delete path exists in the script**; SQL printed preview-only | TESTED (4/4 `cartDedupPlan.test.js`); **production dedup itself BLOCKED_APPROVAL** |
| Stale cancelled-order reconciliation (Phase 0.4) | `scripts/previewFinancialReconciliation.js`: reports stale cancelled rows (incl. v1 `18973892706493` class), over-refunded rows, NULL-refund history counts; SQL preview-only, **no apply mode** | TESTED (script); **bulk financial write BLOCKED_APPROVAL** |
| F-001 completion (PR #310 follow-ups) | productGraphQL failure counters continue beyond plain permission-denied; fixtures/regression pins | TESTED (9/9 + 7/7) |

## What is NOT done (explicit)

- Production deploy of #310 + this task. **Canonical service still runs `node_build=55639425b3f5`** (checked 2026-11-06T13:15Z, `/ready` scheduler completing, build unchanged since #308/#309 era). Render auto-deploy is not landing merges or requires manual trigger.
- Inventory/locations/markets/contextualPricing (Phase 1.9/1.10), refunds/transactions/returns/fulfillments (5.2–5.4), journey attribution (5.6), full orders line-item mapping for duties/risk/test-flag (5.1 partial), stale-record reconciliation for orders (refunds line-level rounding), ShopifyQL eligibility (5.12), bulk operations/resumable checkpoints for large stores (5.13), pixel extension + browser harness (Phase 2), external evidence adapters (Phase 3), certification gates B–F, frontend coverage surface, webhook subscription hardening execution.
- Phase 0.3 does **not** make customer/order sync failures non-fatal except the existing products ladder (this task does not change failure semantics of orders/checkouts; they stay fatal-but-ledgered, which is the required observable behaviour).
- `stores.last_synced_at` semantics unchanged by design; the ledger is the completeness authority.

## Verification evidence (this environment)

- Local suites: `productSync` 9/9, `shopifyProductSync.reconciliation` 7/7, `syncDomainState` 7/7, `cartDedupPlan` 4/4, `productVariantPersistence` 3/3, `intelligenceFindingsAggregator` 4/4, `intelligenceFindingsEngine` 5/5, `shopifyGraphqlOrderTotals` 13/13, `orderMoneyReconciliation` 13/13, `shopifyWebhookService` assertions pass.
- DB-importing suites (integration, financialIntegrity.integration, shopifyNestedLineCompleteness): not runnable here (`.prisma/client` unreachable — binaries.prisma.sh off-network); CI runs them.
- `prisma validate` not runnable here for the same reason; migration SQL written by hand mirroring repo conventions; CI task028/prisma job gates.
- Live production facts re-checked this task: `/ready` 200 but build hash unchanged; previous read-only SQL evidence (scopes, cart dupes, RLS 67/25, stale cancelled order row) unchanged.

## Blockers (exact, per §2.2)

1. **BLOCKED_EXTERNAL — production deploy of #310 + this PR.** Required action (Render, manual or configured): service `revluma-backend-vrsd` → Manual Deploy → latest `main`. Post-deploy verification for me to run: `GET /ready` build hash ≠ `55639425b3f5`; `prisma migrate deploy` applies `20261106133000` + `…133001`; then trigger v1 re-sync and inspect ledger rows + `/admin/.../sync-coverage`. Until then, **no** statement in the audit/checklist may claim production verification of the catalogue pipeline or ledger.
2. **BLOCKED_APPROVAL — stale financial rows** (`previewFinancialReconciliation.js` output) and **abandoned-cart dedup** (`previewAbandonedCartDedup.js` output, 5 live duplicate groups): remediation writes. Preview files are run with `DATABASE_URL` set. Rollback: none required (untouched rows); remediation must be taken as a tenant-scoped, Shopify-re-derived apply after approval.
3. **BLOCKED_EXTERNAL — live scope verification of new ingestion** (v1 re-consent for `write_pixels`; protected-customer-data approval; `read_all_orders`): Partner/approval path, out of scope for code.
4. **BLOCKED_EXTERNAL — Render service logs** not reachable from this environment; scheduler/backup signals via `/ready` only.

## Approval-gated items referenced (never executed)

Cart dedup apply; financial row rewrite; PRODUCTS_* webhook registration; conflicted-domain pair (`6340092e…/009e5c86…`); rekey apply; R-10; live P6 session; protected-data + `read_all_orders` approvals; admin endpoint exposure hardening review (key rotation). Stop hooks engaged.

## Deployment steps (exact)

1. Merge this PR.
2. Render → `revluma-backend-vrsd` → Manual Deploy → latest main commit. Confirm `/ready` shows a new `node_build` and `database_ready:true`.
3. Confirm migrations applied: admin coverage endpoint returns domains after next v1 sync (`POST /admin/shopify/stores/{id}/sync-coverage` with admin key) or `prisma migrate status` in service shell.
4. Trigger/confirm v1 background sync; expect `products`, `variants`, `customers`, `orders`, `abandoned_checkouts` ledger rows with `status='ok'` and `pagination_complete=true`; `products` catalogue must now hold 17 products + 26 variants (subject to source changes).
5. If products remain `failed` with a new error, attach `error_code`/`error_details` — do NOT downgrade; the catalogue is currently the canonical broken domain.
