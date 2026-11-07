# REV-AUTHORIZED-DATA-001 — bounded authorized Shopify resources

Date: 2026-11-07
Branch: `arena/73274e0d-revluma`

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
- Production migrations `20261106220000_authorized_resource_snapshots` and `20261106233000_streaming_authorized_snapshots` are applied.
- `git diff --check` passed.

## Production verification — 2026-11-07

Render readiness reported deployed build `34e81c7aa72d`, with database, Redis, Python, and scheduler ready. A scheduler-recovered sync of store `3ed79446-cb6d-4a1c-b174-9ec1ab91fe15` produced fresh resource ledgers between `00:15` and `00:20 UTC`. All 20 granted authorized-resource readers listed below returned `status=ok` and `pagination_complete=true`; zero-result resources are valid empty source snapshots, not missing-scope successes.

| Resource | Records | Production evidence |
| --- | ---: | --- |
| `collections` | 3 | Complete pagination; reconciled active snapshots |
| `content.pages` | 2 | Complete pagination; reconciled active snapshots |
| `content.blogs` | 1 | Run `074f2fd2-7ffd-4060-97fd-d34702beb9b9`; one active blog, zero source articles, nested pagination complete, zero reconciliation errors |
| `customer.addresses` | 12 | Complete nested pagination; reconciled active snapshots |
| `customer.metafields` | 12 | Complete nested pagination; reconciled active snapshots |
| `discount-nodes` | 5 | Run `0fbd5007-8ad7-4338-a0f9-98fb7140605f`; five active nodes, three code-bearing types with one code each, nested pagination complete, zero reconciliation errors |
| `bulk-operations` | 0 | Complete pagination; valid empty snapshot |
| `draft-orders` | 11 | Complete nested line-item pagination; reconciled active snapshots |
| `marketing-events` | 0 | Complete pagination; valid empty snapshot |
| `metafields.customers` | 12 | Complete nested pagination; reconciled active snapshots |
| `metafields.orders` | 4 | Complete nested pagination; reconciled active snapshots |
| `metafields.products` | 17 | Complete nested pagination; reconciled active snapshots |
| `metafields.shop` | 1 | Complete nested pagination; reconciled active snapshots |
| `order.fulfillment_orders` | 1 | Complete nested line-item pagination; reconciled active snapshots |
| `order.returns` | 4 | Complete nested return and line-item pagination; reconciled active snapshots |
| `order.risk` | 4 | Complete risk reads; reconciled active snapshots |
| `product.media` | 17 | Complete nested media pagination; reconciled active snapshots |
| `shop.shipping_configuration` | 1 | Complete pagination; reconciled active snapshots |
| `shop.taxes` | 1 | Complete pagination; reconciled active snapshots |
| `themes` | 3 | Complete pagination; reconciled active snapshots |

The same cycle also succeeded for products (17), variants (26), customers (12), orders (4), inventory (26 across 27 pages), locations (3), fulfillments (1), refunds (2), transactions (10), and store domains (1). Registry version `2026-11-07.v6` records only these observed successes.

## Remaining boundaries

This evidence does not establish universal 100% Shopify coverage. Unsupported query roots, ungranted scopes, plan/approval restrictions, pixels, and Sidekick packaging remain external boundaries. Legacy `price-rules` and saved `analytics.reports` remain blocked; resources without fresh successful ledgers remain unverified. Verification applies to the identified production store and deployed implementation, not every Shopify plan or merchant configuration.
