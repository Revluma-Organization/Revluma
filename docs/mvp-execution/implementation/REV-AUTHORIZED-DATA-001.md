# REV-AUTHORIZED-DATA-001 — bounded authorized Shopify resources

Date: 2026-11-06
Branch: `arena/3946cbd4-revluma`

## Implemented boundary

The merchant-capability API exposes fixed-query readers for 27 supported Shopify Admin GraphQL resources. A merchant selects a resource ID and pagination controls; the server owns the GraphQL document, shop domain, API version, access token, resource-specific scopes, and owner-based metafield paths. Every read checks organization/store ownership and `currentAppInstallation.accessScopes`.

The existing distributed-lock sync workflow also reconciles each granted resource independently. `commerce_resource_records` stores tenant-scoped JSON snapshots. A successful full read atomically replaces the resource snapshot, deletes stale source IDs, and writes source/fetched/created/updated/deleted counts plus page counts to `store_sync_domain_states`. A failure is isolated to that resource and does not block core order/customer/product sync. Sync is enabled by default and can be disabled with `AUTHORIZED_RESOURCE_SYNC_ENABLED=false`.

Rev context v2 includes bounded resource counts, freshness, and at most eight samples for selected tenant stores. The gateway's 16 KB limit remains authoritative. Customer privacy export/redaction covers customer-owned snapshots, and full shop redaction deletes all resource snapshots.

## Failure behavior

- Live API reads are bounded to 100 root records per request. Full sync follows all root and nested cursors without a record-count ceiling.
- Full sync streams inactive batches and atomically activates only a complete run; active snapshots remain available during ingestion.
- Stalled pagination, duplicate/missing IDs, missing root connections, and unfinished nested connections fail closed.
- Partial source data is not knowingly persisted as a complete snapshot.
- Missing live scopes produce a skip, not simulated consent or an empty successful dataset.
- GraphQL/user errors and transport failures retain the prior snapshot and record a failed ledger.
- Legacy `price-rules` and saved `analytics.reports` are blocked because their public query roots were removed. Current discounts use `discount-nodes`; ShopifyQL execution is a separate restricted surface.
- Protected/customer approval, Shopify plan restrictions, ungranted scopes, pixels, and Sidekick packaging/deployment remain external gates.

## Local evidence

- Focused tests cover fixed queries, tenant/scope enforcement, complete nested pagination, 101-page reads, staged atomic activation, stale deletion, reconciliation, Rev bounds, guarded actions, and privacy handling.
- Production migration `20261106220000_authorized_resource_snapshots` is applied; the staged-snapshot migration is subject to the release-candidate gate.
- `git diff --check` passed.

## Not established by this document alone

This is implementation evidence, not universal production verification. Post-deploy CI, migration status, deployed SHA, real per-resource sync ledgers, and external scope/plan/approval state are required before changing resource verification states. No universal 100% claim is made: unsupported query roots, ungranted scopes, plan/approval restrictions, pixels, and Sidekick packaging remain external boundaries.
