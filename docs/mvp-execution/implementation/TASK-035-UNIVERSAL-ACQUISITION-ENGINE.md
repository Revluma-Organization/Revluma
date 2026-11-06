# TASK 035 — Universal Acquisition Engine (message-6 execution block)

**Date:** 2026-11-06 · **Branch:** `arena/e4b00d26-revluma` · **Baseline:** origin/main `d03bbef` · **Deployment:** unmerged at time of writing (this PR merges AFTER #313 live-state addendum)

## Scope of this block

| Capability | Evidence | Status |
|---|---|---|
| Universal resource registry (`services/resourceRegistry.js`, v2026-11-06.v1): ~46 entries across store/catalogue/inventory/customers/B2B/orders/payments/checkouts/discounts/markets/content/metafields/web-pixels/analytics/bulk/webhooks with surface, scopes, approval, planRestrictions, restrictions, acquisition status, verification basis, declared query roots | new service; exports `REGISTRY`, `REGISTRY_VERSION` | IMPLEMENTED, unit-tested |
| Pattern-based scope acquisition REQUIRES registry cross-check | doc + this block | DOCUMENTED |
| Schema↔registry drift differ (`services/capabilityDiffer.js`): pure comparator; SCHEMA_UNAVAILABLE / GAPS_FOUND / REGISTRY_CONSISTENT; never asserts coverage | new service + pin tests | IMPLEMENTED, TESTED |
| Admin drift endpoint `GET /admin/shopify/stores/:storeId/schema-drift` — runs introspection, returns gap report; 502 + honest note when introspection blocked; findings are discovery deltas, never ingestion claims | controller + admin route wiring | IMPLEMENTED (endpoint repeats nothing sensitive) |
| Admin reconciliation endpoint `GET /admin/shopify/stores/:storeId/reconciliation` — source-vs-DB comparison: products total (count endpoint) + 25-sample existence checks for products/orders/customers; per-metric verdicts MATCH | MISSING | NOT_VERIFIED | NOT_APPLICABLE; total parity deliberately NOT claimed for orders/customers windows | controller + admin wiring | IMPLEMENTED (read-only) |
| Admin universal-coverage endpoint `GET /admin/shopify/stores/:storeId/universal-coverage` — registry × recorded granted scopes × sync ledger; statuses IMPLEMENTED_VERIFIED / IMPLEMENTED_UNVERIFIED / REQUIRES_ADDITIONAL_SCOPES / REQUIRES_APP_APPROVAL / PLAN_RESTRICTED / SYNC_FAILED / ACCESS_DENIED / NOT_IMPLEMENTED / UNAVAILABLE_PLATFORM / RECONCILIATION_FAILED; per-row reconciliation field NULL until a genuine re-read comparison runs | controller + `services/universalCoverage.js` (pure) + route | IMPLEMENTED, TESTED |
| Inventory acquisition (`read_inventory`): `inventory_items` + `inventory_levels` (quantities as typed JSONB, item×location unique, stale-row reconciliation only when pagination complete, loud page ceiling error) | `services/inventorySync.js` | IMPLEMENTED; **not deployed** |
| Locations acquisition (`read_locations`): `locations` table, address snapshot, stale reconciliation | same service + migration `20261106133004_inventory_locations` | IMPLEMENTED; **not deployed** |
| Orchestrator wiring: inventory/locations as non-fatal stages with `degraded` on ACCESS_DENIED (consistent with products/customers semantics); ledger domains `inventory`,`locations` pre-existed | `shopifySync.js` | IMPLEMENTED, node --check |
| Install-time scope widening: `read_inventory`, `read_locations` added to forced base (nothing unused); future domains get scopes ONLY with their shipping PRs (phase gates recorded in registry) | `utils/shopify.js` | IMPLEMENTED |
| Prisma models + migration `20261106133004_inventory_locations` (3 additive tables, RLS enabled, zero policies) | `prisma/schema.prisma` | IMPLEMENTED |
| Domain catalog updated: inventory/locations → implementation `implemented` (NOT_YET_PRODUCTION-VERIFIED restriction recorded) | `domainCatalog.js` | IMPLEMENTED |

## Deliberately NOT in this block (explicit)

Bulk Operations (needs per-merchant approval path design); metafields (data-contract stability); markets/content/analytics/discounts scopes (phase-gated to their PRs); refunds/fulfillments GraphQL *webhook-side* enrichment; reconciliation runner (`scripts/` source-vs-DB parity) — schema only, execution next block; delete-detection beyond stale-sweep; multi-merchant certification (needs a second merchant store — AUTHORIZATION required); PRODUCTS_* remote webhook topics; anything requiring Partner-Dashboard action.

## Honesty contract for the "universal" mandate

- 100% of *applicable, supported, authorized, technically accessible* = the target. NOT 100% of Shopify.
- Fictional counters are forbidden by construction: the new coverage report merges registry (built?) × ledger (ran?) × consented scopes (allowed?) — a row can only be `IMPLEMENTED_VERIFIED` when a ledger row says `ok` with `pagination_complete` AND registry `verification: live_read`. One dev store cannot and must not certify the universe — the report says so explicitly in its `disclaimer`.
- Approval gates are row-level, not section-level: protected customer data, `read_all_orders`, `write_pixels`, `read_payment_settings`, `read_price_lists`, `read_companies`, ShopifyQL plan gates — all remain `not_implemented` with the exact blocker as the restriction text; `merchant re-consent` is documented below.
- Merchant re-consent is REQUIRED: new stores get both scopes at install; EXISTING production installs (v1) will see `inventory`/`locations` ledgers land with status `degraded` + `ACCESS_DENIED` until the merchant re-authorizes. This is honest and expected; the coverage report will render it `REQUIRES_ADDITIONAL_SCOPES`. **DEPLOY ORDER: build ships with the scope widening; Partner-dashboard app scope list must include `read_inventory` and `read_locations` BEFORE merchants re-reinstall — this is a Partner-Dashboard action, not something code can do.**

## Evidence

- Local engine-free suites pass: `universalCoverage` 5/5, `capabilityDiffer` 4/4, `coverageCatalog` 3/3 (node:test). `node --check` clean on all touched files. Backend deps are not installed in this sandbox; CI is the authoritative gate (prisma bootstrap + all suites).
- No production writes performed. No remote webhook registrations. No secrets touched.

## Prerequisites before ANY claim of production-verified inventory

1. Partner Dashboard app configured with `read_inventory`, `read_locations` (human, Partner Dashboard).
2. Render deploy of this PR (auto; verify `/ready` `node_build` flips).
3. v1 re-sync with merchant re-consent (passwordless reauth), or accept ledger `degraded ACCESS_DENIED` as the honest current state.
4. Verify: tables exist; ledger rows flip `inventory`,`locations` → `ok`; counts sane; coverage endpoint renders `IMPLEMENTED_UNVERIFIED`→`IMPLEMENTED_VERIFIED` only after registry basis flips to `live_read` (deliberately NOT done in this PR — verification requires deployed runtime evidence).

## Honest bottom line

This is an execution block toward message-6, not its completion definition. Nothing from it is production-verified yet; most of the registry remains `not_implemented`; approval-gated surfaces remain approval-gated. The universal endpoint REPORTS that truth per store — which is the point of "100% visibility", not fictional guarantees.
