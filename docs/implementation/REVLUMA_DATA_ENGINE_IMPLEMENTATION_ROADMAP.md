# Commerce data engine — implementation roadmap

Research 2026-11-05; work landed 2026-11-06. Baseline `4410460` (`origin/main`);
release work on `arena/720ddf38-revluma`. The 2026-11-05 draft of this document
and the "exhaustive implementation plan" draft were folded into this roadmap,
docs/engineering/REVLUMA_COMMERCE_DATA_INTELLIGENCE_ARCHITECTURE.md and
docs/implementation/REVLUMA_DATA_ENGINE_ACCEPTANCE_TESTS.md; the plan file was
removed to avoid two conflicting roadmaps.

## Where things stand (2026-11-06)

| Phase | Status | Evidence |
|---|---|---|
| P0 — Webhook + money integrity (from PR #299 recovery) | **Done (code + tests; CI pending on release PR)** | 39422b6: fetchConnection cycle guard; nested lineItem pagination fail-closed; decimal-exact coverage certification; `WEBHOOK_DELIVERY_PENDING` duplicate semantics; store/topic identity on claim |
| P0 — Privacy mandatory topics | **Done (code + tests; CI pending)** | d5f8e0a: `privacy_requests` durable workflow for data_request / redact / shop-redact; RLS + grants revoked; 6 workflow tests pass locally |
| P1 — Products ingestion | **Done (code + tests; deploy pending merge)** | 626fb51: paginated products + variants, fail-closed; webhook re-read/delete; `read_products` in OAuth union; 8 product-sync tests pass locally |
| P1 — Deterministic metrics + claim grades | **Done (code + tests)** | e759dac: `metric_registry.py` (`rev-metrics-v1`), `commerce_metrics.py` (Decimal); `evidence.validate_claim_grades()`; 104 python tests pass locally |
| P1 — Live verification | **Blocked (externally)** | No credentialed Shopify/Render shell access from this environment; `currentAppInstallation.accessScopes`, source-vs-store counts, second-org E2E unverified. Supabase production reads done (aggregates only) |
| P2 — Domain breadth (inventory locations, refunds, fulfillments, marketing, reports) | Open | Scopes exist in install record; no ingestion; see capability register |
| P2 — Rev wiring | Partial | Evidence architecture is in place; end-to-end Rev answer audits per new metrics not re-certified in this release |
| P0 — Production certification | **Not certified** | See REVLUMA_DATA_ENGINE_PRODUCTION_CERTIFICATION.md — verdict is explicit and conditional |

## Phased plan (remaining)

1. **Release this branch** (PR → CI green → merge → backend/frontend deploy via
   existing mechanisms → verify `/ready`, Vercel status, live product sync on
   the test store). The product domain is the first end-to-end new ingestion;
   its first scheduled run post-deploy should be watched (new `product_sync`
   stage in logs).
2. **Live reconciliation pass** (needs credentials): compare
   `currentAppInstallation.accessScopes` vs `granted_scopes`; compare Shopify
   order/product/customer counts vs local for `revluma-test-store-v1`; record
   in REVLUMA_SHOPIFY_DATA_COVERAGE_AUDIT.md; reconcile duplicate
   `webhook_registrations` rows.
3. **Refund/transaction modeling** (P2): additive tables; financial separation
   rules as in REVLUMA_MERCHANT_BUSINESS_CANONICAL_DATA_MODEL.md; certification
   extension from "recorded order value" to refund-aware windows.
4. **Inventory/locations** (P2): location-level availability; no inventory
   value until unit-cost discipline exists.
5. **read_all_orders + protected data approvals** (external): request only via
   the Shopify Partner flow; until then, order history claims stay 60-day-bounded.
6. **Retention/deletion lifecycle**: uninstall sweep, delivery-log purge,
   privacy artifact access-control review.
7. **Two-org production E2E** once a second merchant installs (or a sandbox
   twin exists): full isolation + redaction drill.
8. **Sidekick App Data extension** (exploration only): would surface Revluma
   evidence inside Shopify admin; requires Shopify app review; not scheduled.

## Dependencies and gates

- No metric claim ships without registry entry; no unavailable metric ships
  with a value.
- No new domain ships without: tenant-scoped schema + tests, webhook/backfill
  semantics, deletion behavior, freshness column, fail-closed ingestion.
- No production claim without CI + deploy verification + (for data claims)
  live reconciliation evidence.

## Rejected approaches (do not revisit silently)

- JS `Number` for money (fixed in certification path; ingestion fixed for
  products; order `unit_price`/`line_total` still arrive via Prisma Decimal —
  audit ingestion rounding separately, tracked in task register).
- Trusting webhook bodies for product writes (refetch-by-id instead).
- Acknowledging privacy webhooks without a durable workflow (was a P0; fixed).
- Rounding source-vs-store comparison to two decimals (exact decimal equality now).
- Silent `write_discounts` retention — kept for now but explicitly flagged;
  do not add *more* write scopes.
