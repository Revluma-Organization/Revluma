# TASK 200 — Checkout evidence retrieval

Status: **MERGED; ADDITIVE DATABASE MIGRATIONS AND DASHBOARD DEPLOYED; AUTHENTICATED END-TO-END PRODUCTION VERIFICATION PENDING**.

## Source and lifecycle contract

Shopify Admin GraphQL `abandonedCheckouts` is an observed incomplete-checkout resource, not a universal checkout-start feed. The implementation uses unfiltered, fully paginated retrieval, verifies current `read_orders` access, completes every nested line-item connection, and fails closed on malformed pages, repeated cursors, missing identities or duplicate records. Shopify also requires the merchant staff `manage_abandoned_checkouts` permission; an authorization failure remains an explicit coverage state.

Only `completedAt` or the Task 199 exact checkout/order relationship proves completion. Only the `abandonedCheckouts` resource proves abandonment. Pending webhook records and legacy age-based records remain `unknown`; the scheduler no longer promotes old checkouts by age. Weak time, total, product or customer similarity never establishes conversion. Missing source records are marked `source_state=unavailable` only after complete reconciliation and are retained as history.

## Evidence and metrics

`python/src/intelligence/checkout_evidence.py` is the canonical read path for both `cart_observations` and `checkout_observations`. It provides:

- observed, completed, explicitly abandoned, unknown, incomplete, unavailable and conflicting populations;
- observed completion and abandonment rates over `completed + explicitly abandoned` records, with unknown lifecycle excluded and zero denominators unavailable;
- source-created daily activity in the merchant timezone and previous-period/year-over-year windows;
- historical product, variant, SKU, quantity and discounted-line evidence without current-catalog substitution;
- per-currency recorded abandoned-checkout totals with explicit financial components and unsupported shipping;
- PII-minimized individual records, exact order links, coverage, authorization, reconciliation and freshness explanations.

Recorded abandoned-checkout value is not paid revenue, guaranteed loss or recoverable revenue. No abandonment cause is inferred. Checkout coverage is certified only after unfiltered root and nested pagination, scope verification, reconciliation and a successful retrieval reaching the requested period end. Current source exposure cannot recover deleted records or prove all checkout starts.

## Persistence and transport

The additive migration stores checkout name/resource/source timestamps, completion and observation timestamps, retrieval state, subtotal/discount/tax/duties/tax inclusion and historical line identity/pricing/currency. Shipping remains null because `AbandonedCheckout` does not expose it. Sync and webhooks preserve prior verified financial values when a payload omits them and reject invalid line financial evidence instead of silently dropping it. The GraphQL transport has three-attempt bounded retries for throttling, 429, transient 5xx and transient network errors; other failures are not retried.

## Verification evidence

- Task 200 Python fixture tests: 5 passed; disposable PostgreSQL test skips locally without `TASK200_DATABASE_URL` and runs where CI supplies the disposable database.
- Full Python suite: **1612 passed, 10 skipped** with a non-production dummy `DATABASE_URL` used only to construct the lazy SQLAlchemy engine.
- Backend focused checkout/retry/acquisition tests: **11/11** and **13/13** passed.
- Full Backend runner: **80 test files passed** using an explicitly local, uncommitted Prisma import shim because Prisma engine download is blocked. This is not migration or live-database evidence.
- `npx prisma generate` was attempted with the repository-pinned Prisma version and failed before generation because `binaries.prisma.sh` is not reachable from the sandbox.

## Merge and production boundary

PR #338 passed every GitHub check, including the real-PostgreSQL checkout test, Prisma bootstrap/drift checks, backend, Python, dashboard and all isolated checkout/order workflows, and was merged as `0b42c8bbacf6f855e227adcea7ecfea5716c48e7`. Supabase migrations `20261107094201_task199_order_evidence` and `20261107094219_task200_checkout_evidence` executed successfully; read-back verified the new checkout, line-item and order columns. Vercel production deployment `dpl_dt7VSjDKSfB3RdZcHNmbmWKzh6bS` is `READY`/`PROMOTED` at the merge SHA and aliases `revluma.vercel.app`.

Authenticated Shopify/Rev verification is still outstanding. The active store is `revluma-test-store-v1.myshopify.com` (one active authorized store row), but its last checkout synchronization predates the merge (`2026-11-07T09:18:17Z`), its ledger checkpoint is still empty, and its 35 historical cart rows have no new source-resource/source-created values. That legacy ledger is deliberately not certified as Task 200 coverage. Render backend/Python deployment identity and a fresh authenticated acquisition could not be established from the available connections; no Render credential or merchant access token was available or requested. Fixtures, mocked transports, health responses and the migrated schema are not live checkout evidence.
