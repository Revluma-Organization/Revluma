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

## Production deploy evidence (live, read-only, 2026-11-06 ~15:30Z)

- Migrations `20261106133002_commerce_event_graph`, `…033_store_profiles`, `…033004_inventory_locations` **applied to production at 14:42:22 / 14:42:23 / 14:42:24Z** by the prestart on the deployed build.
- New tables present and populating: `order_transactions` **10 rows** (idempotent upserts accumulate — no duplicates by construction of (store_id, external_id) key), `locations` **6 rows across both conflicted-domain staging rows** (org `09ff67bf…` + org `91d88743…` — the SAME Shopify store connected twice; 2 locations each), `inventory_items`/`inventory_levels`/`order_refunds`/`order_fulfillments`/`store_profiles`/`store_domains` = 0 rows pending the TASK-036 fix build.
- v1 ledger at ~15:00Z: products/variants/customers/orders/abandoned_checkouts/locations/transactions = `ok` (transactions = first production evidence); refunds/fulfillments retry×4 + inventory/store_domains retry×1 with `SHOPIFY_GRAPHQL_ERROR` — all field-level drift fixed in this PR's predecessor (#319). Re-ledger after next deploy.
- `bys-user-store-923319-1ifggjsw` (retired store) shows no syncs and no writes — untouched, as mandated.
- Conflicted-domain pair (`6340092e…` vs `009e5c86…`, the same Shopify store connected under two orgs) is a known data-ambiguity cell; inventory rows now exist for BOTH rows (distinct store ids). No attribution or merge decision made — human-gated.
- `/ready` could NOT be probed from the sandbox used for this work (SSL_ERROR_SYSCALL to onrender.com); all build-version claims rest on DB-observable evidence (`_prisma_migrations`) and store ledger rows, not on the HTTP path.

## What this does NOT verify

The fixes are merged but NOT yet running in production. `$SHOPIFY_INVENTORY_SYNC` and enrichment re-verification (refund/fulfillment persistence live) only after the next deploy + re-sync; do not claim `ok` until the ledger flips. Registry `inventory.*` and enrichment domains remain `not_verified` until then. No production writes were performed for this diagnosis; all fixes are code + CI.
