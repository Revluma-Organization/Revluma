# REV-AUTHORIZED-DATA-001 — bounded authorized Shopify resources

Date: 2026-11-06
Branch: `arena/8d08f2c7-revluma`

## Implemented boundary

The merchant-capability API exposes fixed-query readers for 28 supported Shopify Admin GraphQL resources. A merchant selects a resource ID and pagination controls; the server owns the GraphQL document, shop domain, API version, access token, resource-specific scopes, and metafield owner type. Every read checks organization/store ownership and `currentAppInstallation.accessScopes`.

The existing distributed-lock sync workflow also reconciles each granted resource independently. `commerce_resource_records` stores tenant-scoped JSON snapshots. A successful full read atomically replaces the resource snapshot, deletes stale source IDs, and writes source/fetched/created/updated/deleted counts plus page counts to `sync_domain_state`. A failure is isolated to that resource and does not block core order/customer/product sync. Sync is enabled by default and can be disabled with `AUTHORIZED_RESOURCE_SYNC_ENABLED=false`.

Rev context v2 includes bounded resource counts, freshness, and at most eight samples for selected tenant stores. The gateway's 16 KB limit remains authoritative. Customer privacy export/redaction covers customer-owned snapshots, and full shop redaction deletes all resource snapshots.

## Failure behavior

- Maximum 100 records per request and 100 pages (10,000 records) per full sync.
- Stalled pagination, duplicate/missing IDs, missing root connections, and unfinished nested connections fail closed.
- Partial source data is not knowingly persisted as a complete snapshot.
- Missing live scopes produce a skip, not simulated consent or an empty successful dataset.
- GraphQL/user errors and transport failures retain the prior snapshot and record a failed ledger.
- Legacy `price-rules` is blocked: Shopify removed that public GraphQL surface in API 2026-10. Current discounts use `discount-nodes`.
- Protected/customer approval, Shopify plan restrictions, ungranted scopes, pixels, and Sidekick packaging/deployment remain external gates.

## Local evidence

- 56/56 focused tests passed after the final catalog/privacy changes, including fixed queries, tenant/scope enforcement, pagination bounds, nested-incomplete rejection, atomic replacement/stale deletion, reconciliation, Rev bounds, guarded actions, and privacy handling.
- Prisma WASM DMMF validation passed: 78 models; snapshot model has eight fields.
- `git diff --check` passed.

## Not established by this document alone

This is implementation evidence, not universal production verification. Post-deploy CI, migration status, deployed SHA, real per-resource sync ledgers, and external scope/plan/approval state are required before changing resource verification states. Nested connections beyond their fixed bounds and resources above 10,000 records remain explicit coverage limitations; no universal 100% claim is made.
