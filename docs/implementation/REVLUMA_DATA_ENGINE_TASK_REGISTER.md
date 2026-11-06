# Commerce data engine — task register

Research 2026-11-05; updated 2026-11-06. Status describes this branch
(`arena/720ddf38-revluma`) and the observations listed — not deployment state
unless stated. Evidence links are commits/tests/docs on this branch.

| ID | Priority | Task | Status / evidence |
|---|---|---|---|
| DE-001 | P0 | Fail closed on missing monetary amounts in Shopify coverage certification | DONE (code+tests, CI pending on release PR): 39422b6 `intelligenceShopifyCoverageProducer.js` — exact-decimal compare, malformed money/duplicate IDs/excluded timestamps reject; `intelligenceShopifyCoverageProducer.test.js`. Production evidence: outstanding |
| DE-002 | P0 | Nested line-item completeness (orders + checkouts) | DONE (code+tests; CI gate): 39422b6 — full nested pagination, fail-closed before writes, cycle/page caps, updatedAt consistency; `shopifyNestedLineCompleteness.test.js`, `intelligenceShopifyPagination.test.js` |
| DE-003 | P0 | Webhook integrity: HMAC, duplicates, ordering, privacy topics | DONE for delivery safety (39422b6: `WEBHOOK_DELIVERY_PENDING`, processed-only duplicates, store/topic identity) and privacy workflow (d5f8e0a: durable data_request/redact/shop_redact, RLS). OPEN: retention/purge of delivery logs; uninstall data lifecycle; live redelivery drill |
| DE-004 | P0 | `write_discounts` scope review | OPEN (blocked on business review): scope present in install record, unused in code. Safe reduction requires merchant reauthorization review; deliberately NOT changed in this release. No new write scopes added; `read_products` added (read-only) |
| DE-005 | P1 | Live `currentAppInstallation.accessScopes` + source parity on test store | BLOCKED (external): no credentialed Shopify/Render shell access. OAuth record + aggregate Supabase counts recorded in REVLUMA_SHOPIFY_DATA_COVERAGE_AUDIT.md. Any "verified scopes" claim would be fabrication |
| DE-006 | P1 | Tenant-scoped domain coverage, checkpoints, stale/failure handling | PARTIAL: `intelligence_order_coverage` window attestations (init-sync deletes/re-mints), store `syncing` interrupted-run detection, scheduler locks. OPEN: per-domain checkpoints/coverage intervals; full delete-propagation tombstoning; DLQ for webhooks; duplicate `webhook_registrations` rows in production (observed, untouched) |
| DE-007 | P1 | Canonical relationships (orders/items/customers/products/refunds/fulfillments) | PARTIAL: products implemented (626fb51: paginated, decimal-safe, webhook re-read). OPEN: refunds/returns tables; fulfillments; line-level refund attribution; inventory locations |
| DE-008 | P2 | Metrics, evidence, Rev retrieval, cross-tenant tests | PARTIAL: metric registry + Decimal engine + claim grades (e759dac, 104 python tests pass); evidence contracts tested. OPEN: end-to-end Rev answer audit on new metrics; two-live-org isolation E2E |
| DE-009 | P3 | Additional interfaces (ShopifyQL, marketing, B2B, payments, metaobjects) | OPEN: capability register kept current (docs/research/SHOPIFY_COMPLETE_DATA_ACCESS_CAPABILITY_REGISTER.md). Nothing enabled; eligibility verification required first |
| DE-010 | P0 | Production certification | NOT CERTIFIED — see REVLUMA_DATA_ENGINE_PRODUCTION_CERTIFICATION.md. Conditions enumerated there; to be updated post-merge with deploy IDs |
| DE-011 | P1 | Product catalogue ingestion (was the one core domain with no path) | DONE (code+tests; deploy pending): 626fb51 `productSync.js`, sync stage, products webhooks, `read_products` OAuth union; 8/8 tests. Production `products` count 0 at audit; should populate on first post-merge scheduled sync — VERIFY post-deploy |
| DE-012 | P2 | Privacy retention lifecycle (uninstall sweep, artifact access, log purge) | OPEN — in controls doc §2 |

## Delivery notes preserved from prior audits

- Nested pages without `pageInfo` cannot certify completeness — rejected by
  design (DE-002).
- `last_synced_at` is not a completeness certificate; attestations are deleted
  at each sync pass start.
- `refreshing_scopes`/ACCESS_DENIED on products/customers downgrades only on
  explicit field-level denial; everything else stays fatal.
- Coverage claims cite a 14-day window only; lifetime claims are impossible
  without `read_all_orders` (DE-005).
- 2026-11-06 production: 197 processed webhook deliveries, 0 pending/failed;
  duplicate registration rows observed (2× active per topic); scheduler
  `business-state` job failed with `INTELLIGENCE_UNAVAILABLE` (visible in
  `/ready`) — separate investigation required, no evidence linking it to this
  branch.

## Definition of done for the next increment

DE-005 executed (read-only live scope/parity check) → DE-006 checkpoints →
DE-007 refunds → DE-010 re-review with post-deploy evidence.
