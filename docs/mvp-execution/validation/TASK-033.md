# TASK 033 — Abandonment-then-purchase validation

**Status: PARTIAL — awaiting execution and full TC033-01–70 evidence.**
**Phase:** 1. **Workstream:** 1B. **Branch:** `test/mvp-task-033-abandonment-then-purchase`.
**Scope:** Shopify-only read-only lifecycle verification; no production code changes.

## A–E. Identification, prior evidence, checkout creation and classifier
The approved backlog identifies Task 033 as abandonment-then-purchase. Reviewed source paths: `Backend/src/services/commerceWebhookService.js`, `checkoutInactivity.js`, and `schedulerService.js`. Prior Task031/032 regression work exists but Task032 was explicitly deferred without full certification. `upsertAbandonedCart` writes initial `pending` status, preserving source identifiers. `promoteInactiveCheckouts` updates pending checkouts with `recovered_at: null` and `updated_at <= now - 15 minutes`, scoped to active Shopify stores.

## F–W. Threshold, reconciliation, lifecycle, safety, metrics and attribution
The helper `isCheckoutInactive` uses an inclusive 900,000ms boundary. The scheduler performs a database `updateMany` and excludes recovered records; the order service performs source-identifier-based matching and persists checkout ownership. The new integration suite tests checkout persistence, actual scheduler promotion, subsequent order reconciliation, stale updates, duplicate deliveries, and weak identity evidence. These claims remain *unverified test expectations* until CI completes. The existing `recovered` status means a completed purchase in current storage; it is not proof of a Revluma-attributed campaign recovery. Actual Command Center and Rev Intelligence metric query behavior is not yet proven by these tests.

## X–Z. Environment, implementation and execution
Disposable pgvector PostgreSQL 16, Node 22, Prisma `db push` in `.github/workflows/task033-abandonment-then-purchase.yml`. Test: `Backend/src/tests/task033AbandonmentThenPurchase.integration.js`. Command: `node src/tests/task033AbandonmentThenPurchase.integration.js`. CI result: **PENDING**; do not infer PASS from committed code.

## AA. Acceptance matrix
All 70 scenarios are tracked below. **NOT RUN** means the precise acceptance requirement lacks recorded passing evidence, even when a grouped test mentions the case ID.

| Scenario | Status | Evidence |
|---|---|---|
| TC033-01 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-02 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-03 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-04 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-05 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-06 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-07 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-08 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-09 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-10 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-11 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-12 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-13 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-14 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-15 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-16 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-17 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-18 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-19 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-20 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-21 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-22 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-23 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-24 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-25 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-26 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-27 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-28 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-29 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-30 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-31 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-32 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-33 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-34 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-35 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-36 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-37 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-38 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-39 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-40 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-41 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-42 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-43 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-44 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-45 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-46 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-47 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-48 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-49 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-50 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-51 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-52 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-53 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-54 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-55 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-56 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-57 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-58 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-59 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-60 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-61 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-62 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-63 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-64 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-65 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-66 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-67 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-68 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-69 | NOT RUN | No confirmed per-scenario CI evidence yet |
| TC033-70 | NOT RUN | No confirmed per-scenario CI evidence yet |

## AB–AF. Defects, findings, dependencies and limitations
No product defect is confirmed by an executed Task033 test yet. Potential gaps include race conditions between scheduler promotion and order completion, production metric query integrity, full historical sync, process restart, injected database failures, and explicit regressions TC033-64–67. Do not invent or close finding IDs without reproductions. Task032 remains deferred and is not retroactively certified.

## AG–AH. Status and version control
**PARTIAL — VALIDATION NOT YET VERIFIED.** Branch `test/mvp-task-033-abandonment-then-purchase`. PR, merge and deployment pending. No production data or deployment changes authorized. Task034 must not start under this task's instructions.
