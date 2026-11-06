# PR #321 production completion — inventory and fulfillment acquisition

**Date:** 2026-11-06  
**Baseline:** `e44d475ed6845307d9342e6f0f20648554c3d7d8` (PR #321)  
**Store:** `revluma-test-store-v1.myshopify.com`  
**Shopify Admin API:** `2026-10`

## Baseline evidence and root causes

Read-only production checks against the deployed `e44d475ed684` Node build and Supabase established:

| Observation | Evidence |
|---|---|
| Inventory GraphQL acquisition and upserts ran | 26 `inventory_items`, 28 `inventory_levels`, and 2 `locations` persisted for the authorized store |
| Inventory run still failed | ledger `inventory.status=failed`, `error_code=ReferenceError`, `error_details=nestedLevelsIncomplete is not defined`, `retry_count=3` |
| Fulfillment GraphQL acquisition ran | one `order_fulfillments` row with a valid tenant-scoped order relationship and `SUCCESS` status |
| Fulfillment batch ledger was wrong | ledger reported zero discovered records because the final order had zero fulfillments and each order overwrote the same store/domain row |
| Other baseline domains were healthy | products 17, variants 26, customers 12, orders 4 in the current acquisition window; transactions/refunds/locations `ok` |

Root causes were an undefined reconciliation guard in `inventorySync.js`, per-order rather than per-run enrichment ledger writes, missing inserted/updated accounting, and pagination implementations that could treat a missing cursor as successful termination or report a page ceiling as success.

## Corrections

- Acquire **all** inventory-item pages and every nested `inventoryLevels` page before any inventory write.
- Require explicit `hasNextPage=false`; fail on absent/repeating cursors, malformed nodes/pageInfo/quantities/location IDs, and independent outer/nested page ceilings.
- Retain bounded independent Prisma upserts (no reintroduction of long interactive transactions or P2028-prone behavior).
- Compute inserted/updated/deleted counts from tenant-scoped pre-write identities; record outer plus nested pages and structured completion logs.
- Delete stale levels/items only after complete acquisition; all stale sweeps include `store_id`.
- Apply the same fail-closed cursor and page-ceiling rules to fulfillment connections.
- Aggregate transactions/refunds/fulfillments across the entire order batch. Any failed order makes that domain failed; permission-limited orders make it degraded; a successful empty result remains `ok` with zero records.
- Require a tenant-scoped parent order before fulfillment acquisition/persistence.
- Reset current-attempt counters on `running`, and force `pagination_complete=false` on failed/degraded states while preserving the last successful timestamp for freshness diagnostics.
- Keep `Fulfillment.lineItems` and `trackingCompany` out of GraphQL. `line_items` remains an empty persisted JSON array; fulfillment-order/line-item allocation is **not** claimed.

No schema or migration change is required. Existing composite uniqueness keys provide idempotency and tenant isolation.

## Automated verification

Executed locally with Node's test runner:

- `inventorySync.test.js`: 15/15 passed — valid responses, outer and nested pages, active/inactive/legacy locations, multiple locations/stores, empty snapshots, stale reconciliation, missing/repeating cursors, both ceilings, malformed structures, API failures, upsert failure, permission denial, idempotency, and quantity updates.
- `orderEnrichment.test.js`: 14/14 passed — supported fulfillment fields/tracking, multiple pages, empty source, missing parent, API/database failures, duplicate handling, cursor/ceiling failures, multi-store isolation, and aggregate/partial-failure ledger states.
- Combined focused run with `syncDomainState.test.js`: **36/36 passed, 0 failed, 0 skipped**.
- `syncDomainState.test.js`: 7/7 passed in the combined pre-change compatibility run.

The sandbox cannot download Prisma engines from `binaries.prisma.sh` (TLS/network restriction), so the repository-wide local runner stops at an engine-dependent suite. This is not counted as a passing full-suite run. GitHub Actions Prisma bootstrap, backend suite, release candidate checks, and frontend build are required merge gates.

## Production verification — implementation build `65c97bf93611`

PR #322 merged as `65c97bf93611188cf1d593bf5bcb3790e5a62ba0`; all backend, Prisma/bootstrap, financial/security/Python, dashboard, and Vercel checks passed. Render `/ready` subsequently reported `node_build=65c97bf93611`, database/Python/Redis ready. The normal scheduled orchestration completed at 16:49:21Z on 2026-11-06:

| Domain | Source/persisted evidence | Pages | Ledger/write evidence |
|---|---|---|---|
| Inventory | 26 items / 28 levels persisted; `records_updated=54` (=26+28), `records_inserted=0`, `records_deleted=0` | 27 = 1 outer + 26 nested first pages | `ok`, `pagination_complete=true`, last success 16:48:46Z; no P2028/ReferenceError |
| Fulfillments | 1 source row persisted with `SUCCESS` status and a valid parent order; 0 inserts / 1 update | 4 = one per acquired order | `ok`, `pagination_complete=true`, last success 16:48:06Z |
| Locations (initial) | 2 active locations persisted | 1 | `ok`, 0 inserts / 2 updates |
| Existing domains | products 17, variants 26, customers 12, orders 4, transactions 10, refunds 2, abandoned checkouts 8 | domain-specific | all `ok`; no regression observed |

The full set of 26 distinct inventory-item IDs independently present in Shopify-derived `product_variants.inventory_item_external_id` exactly matched `inventory_items.external_id` (zero missing/extra). RLS remained enabled with zero public policies on all four new tables. The zero-insert/nonzero-update run also demonstrated idempotency against the baseline identities.

### Additional defect found by relationship reconciliation

Two valid levels referenced location `93369139389`, absent from the two-row location snapshot. Shopify's 2026-10 `locations` query is active-only by default; `includeInactive:true` and `includeLegacy:true` are required for complete coverage. The follow-up change adds both flags and an inactive-location regression test. Final verification of the resulting three-location/zero-orphan snapshot is pending deployment of this follow-up; the earlier two-location result is not represented as complete location coverage.

Render management access is unavailable in this environment (`render` connector unsupported). Node's exact build is exposed by `/ready`; Python operational readiness is exposed there too, but Python's exact deployed Git SHA cannot be independently read through the available tools. This is recorded as an external verification limitation, not silently marked verified.
