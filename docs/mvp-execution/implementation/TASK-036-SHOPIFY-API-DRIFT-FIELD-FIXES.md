# TASK 036 — Shopify 2026-10 API drift: field-level fixes from live ledger evidence

**Date:** 2026-11-06 · **Branch:** `arena/80070c73-revluma` · **Trigger:** production ledger `error_details` read from `store_sync_domain_states` after the deploy that applied migrations 20261106133002–33004 and the re-sync at 14:58–15:00Z.

## Production evidence (read-only, 2026-11-06 ~15:00Z, v1)

| Domain | Status | Detail |
|---|---|---|
| transactions | `ok` (2/2, pagination complete) | first production-verified order-transaction enrichment |
| locations | `ok` (2/2, pagination complete) | inventory block ran; scope consent present |
| products / variants / customers / orders / abandoned_checkouts | `ok` (17/26/12/4/8) | unchanged, still clean |
| refunds | `failed` ×4, `SHOPIFY_GRAPHQL_ERROR`: `Field 'id' doesn't exist on type 'OrderTransactionConnection'` | refund transactions are connection-shaped in 2026-10 |
| fulfillments | `failed` ×4, `SHOPIFY_GRAPHQL_ERROR`: `Field 'trackingCompany' doesn't exist on type 'Fulfillment'` | tracking moved to `trackingInfo`; literal field removed |
| inventory | `failed` ×1, `SHOPIFY_GRAPHQL_ERROR`: `Field 'weight' doesn't exist on type 'InventoryItem'` | weight moved into `measurement.weight` |
| store_domains | `failed` ×1, `SHOPIFY_GRAPHQL_ERROR`: `Field 'countryName' doesn't exist on type 'ShopAddress'` | countryName dropped from ShopAddress; keep countryCodeV2 only |

## Fix (this PR)

- **refunds**: nested `transactions(first: 100) { nodes { id kind status amountSet { shopMoney { amount currencyCode } } processedAt } }`; `mapRefundRow` accepts list or `{nodes}` connection (defensive, connection-first for forward compat).
- **fulfillments**: removed literal `trackingCompany` from both connection and list fallback queries; `tracking_company` now derives from `trackingInfo[0].company` (documented 2026-10 shape).
- **inventory**: `weight { value unit }` → `measurement { weight { value unit } }` (2026-10 shape); mapping reads `measurement.weight`.
- **storeProfileSync**: `shopAddress { countryCodeV2 city zip }` (drop `countryName`); `country_name` persists as NULL with code comment (country_code unaffected).
- Tests: `storeProfileSync` fixture updated; local engine-free suites with full deps installed (`npm ci --ignore-scripts`): `orderEnrichment` 4/4, `storeProfileSync` 3/3, `universalCoverage` 5/5, `coverageCatalog` 3/3, `capabilityDiffer` 4/4, `syncDomainState` 7/7. CI is the authoritative gate.

## What this does NOT verify

The fixes are merged but NOT yet running in production. `$SHOPIFY_INVENTORY_SYNC` and enrichment re-verification (refund/fulfillment persistence live) only after the next deploy + re-sync; do not claim `ok` until the ledger flips. Registry `inventory.*` and enrichment domains remain `not_verified` until then. No production writes were performed for this diagnosis; all fixes are code + CI.
