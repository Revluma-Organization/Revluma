# REVLUMA — TASK 028 SOURCE IDENTIFIER PRESERVATION

## A. Task identification
Task 028/406; Phase 1, Workstream 1B; 2026-10-30. Branch `feat/mvp-task-028-source-identifiers`; stacked on Task027 PR #222; PR #223 OPEN/UNMERGED. Production revision alignment not verified. Node 22 CI; Prisma 6.19.3; PostgreSQL. No deployment.

## B–D. Prior evidence and identifier inventory
Reviewed Task024–027 implementations and Task027 production/Shopify read-only audit. Earlier Task018–023 findings concern ambiguity and typed matching. Source inventory:

| Source | Shopify source path | Type | Before | New storage | Matching | Limitations |
|---|---|---|---|---|---|---|
| Order identity | order.id / GraphQL order.id | string/GID | orders.external_order_id | unchanged | store + order identity | historical GraphQL GID normalized by externalId |
| Checkout ID | checkout.id or checkout_id | string/GID | abandoned_carts.external_cart_id (mixed) | abandoned_carts.source_checkout_id; orders.source_checkout_id when supplied | typed checkout ID | Shopify webhook id removed in newer API versions |
| Checkout token | checkout.token; order.checkout_token; GraphQL order.checkoutToken | string | sometimes mixed external_cart_id | source_checkout_token per resource | typed token | sensitive; no live checkout.token pair verified |
| Cart token | checkout.cart_token; order.cart_token; GraphQL order.cartToken | string | sometimes mixed external_cart_id | source_cart_token per resource | typed cart token | can collide; no uniqueness asserted |
| Event/delivery ID | webhook header | string | existing webhook_deliveries | unchanged | delivery dedup | per-row source event provenance not yet persisted |

## E–G. Semantics and schema
Original source strings preserved without Number conversion; invalid objects and unsafe numeric values rejected. Three separate nullable text columns on orders and abandoned_carts; merchant-scoped indexes on checkout columns. Existing external_cart_id remains unchanged for compatibility. No backfill of mixed historical identifiers; no new event archive. Typed matching now uses the corresponding columns, never treats a cart token as a checkout token.

## H–K. Lifecycle, persistence, update safety, provenance
Order webhook upsert stores supplied checkout ID/token/cart token. Checkout webhook upsert stores checkout ID from payload.checkout_id or payload.id, token from payload.checkout_token or payload.token, and cart token separately. Sparse updates retain existing non-null evidence. Incompatible non-null updates throw SOURCE_IDENTIFIER_CONFLICT and rollback rather than silently overwriting. Historical order GraphQL query now selects checkoutToken and cartToken and passes them to the common upsert. Historical abandoned-checkout GraphQL ID is preserved as original GID. Source-event topic/event IDs are not yet durably associated with each identifier, an outstanding provenance limitation. No payload archival.

## L–O. Previous task integrations
Task024 verified FK persists independently of source evidence. Task025 unresolved ledger still stores only one bounded generic source_identifier, so multiple typed conflicting source identifiers are retrievable from orders but not immutable snapshots. Task026 typed checkout-ID/checkout-token/cart-token lookup now detects contradictory strong/cart evidence; Task027 ownership lock and second-claim rejection unchanged. Real Shopify pairing and universal writer enforcement remain Task027 pending findings.

## P–S. Isolation, privacy, migration and compatibility
All lookup predicates include store_id. No diagnostic endpoint added. Raw tokens are stored in restricted database columns because exact matching requires them; never log raw token values. Existing customer PII tables unaffected. Migration `20261030093000_task028_source_identifiers` adds nullable columns and three indexes, no destructive changes. Real production migration prohibited. Legacy rows remain null in new columns until supported source replay; therefore legacy matches will not automatically resolve through typed lookups. This is a rollout/compatibility risk, not a PASS.

## T–V. Test environment and validation matrix
Disposable PostgreSQL 16 pgvector service via `.github/workflows/task028-identifiers.yml`; Node22; npm ci; Prisma db push; Task025 SQL migration; Task028 migration replay on legacy-shaped schema; synthetic data only. Tests in `Backend/src/tests/task028Identifiers.integration.js`. **CI evidence pending.** No scenario may be marked PASS until CI run and individual outcomes are inspected.

| Scenario | Status | Evidence |
|---|---|---|
| TC028-01 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-02 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-03 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-04 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-05 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-06 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-07 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-08 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-09 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-10 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-11 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-12 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-13 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-14 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-15 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-16 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-17 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-18 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-19 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-20 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-21 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-22 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-23 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-24 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-25 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-26 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-27 | NOT RUN — test not yet authored | Needs isolated test or supported N/A evidence |
| TC028-28 | NOT RUN — test not yet authored | Needs isolated test or supported N/A evidence |
| TC028-29 | NOT RUN — test not yet authored | Needs isolated test or supported N/A evidence |
| TC028-30 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-31 | NOT RUN — test not yet authored | Needs isolated test or supported N/A evidence |
| TC028-32 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-33 | NOT RUN — test not yet authored | Needs isolated test or supported N/A evidence |
| TC028-34 | NOT RUN — test not yet authored | Needs isolated test or supported N/A evidence |
| TC028-35 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-36 | NOT RUN — test not yet authored | Needs isolated test or supported N/A evidence |
| TC028-37 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-38 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-39 | NOT RUN — test not yet authored | Needs isolated test or supported N/A evidence |
| TC028-40 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-41 | NOT RUN | CI scenario authored; awaiting execution |
| TC028-42 | NOT RUN — test not yet authored | Needs isolated test or supported N/A evidence |
| TC028-43 | NOT RUN — test not yet authored | Needs isolated test or supported N/A evidence |
| TC028-44 | NOT RUN | CI scenario authored; awaiting execution |

## W–Z. Performance, findings, dependencies, limitations
Three merchant-scoped indexes avoid broad scans. No event-archive growth. REV-FIND-028-01 HIGH: legacy mixed external_cart_id not safely backfillable; Task049. REV-FIND-028-02 HIGH: durable source event provenance not attached to each identity; Task048. REV-FIND-028-03 HIGH: unresolved case snapshot insufficient for multiple conflicting identifiers; Task049. REV-FIND-028-04 HIGH: full 44-scenario regression coverage incomplete; must complete Task028 before PASS. Real Shopify checkout-token source pair not verified; Task027 remains PARTIAL. No unauthorized production mutation.

## AA–AB. Status and version control
**PARTIAL — IMPLEMENTED, TESTS AND FULL PROVENANCE VERIFICATION PENDING; NOT DEPLOYED.** PR #223 open and stacked on #222. Baseline previous Task027 branch. Code commits 0a1cc837, 7973218a, 914dd518, 2bf302a9, a58b83b6. No merge, deployment or production migration. Do not proceed to Task029 until user authorizes.
