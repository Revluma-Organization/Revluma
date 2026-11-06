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

- `inventorySync.test.js`: 14/14 passed — valid responses, outer and nested pages, multiple locations/stores, empty snapshots, stale reconciliation, missing/repeating cursors, both ceilings, malformed structures, API failures, upsert failure, permission denial, idempotency, and quantity updates.
- `orderEnrichment.test.js`: 14/14 passed — supported fulfillment fields/tracking, multiple pages, empty source, missing parent, API/database failures, duplicate handling, cursor/ceiling failures, multi-store isolation, and aggregate/partial-failure ledger states.
- Combined focused run: **28/28 passed, 0 failed, 0 skipped**.
- `syncDomainState.test.js`: 7/7 passed in the combined pre-change compatibility run.

The sandbox cannot download Prisma engines from `binaries.prisma.sh` (TLS/network restriction), so the repository-wide local runner stops at an engine-dependent suite. This is not counted as a passing full-suite run. GitHub Actions Prisma bootstrap, backend suite, release candidate checks, and frontend build are required merge gates.

## Production verification

Pending final merge/deploy and a fresh scheduled orchestration run. This section must be replaced with actual ledger, source/persistence, commit, and health evidence before completion is claimed. The authorized internal sync endpoint remains protected; no credentials or merchant data are recorded here.
