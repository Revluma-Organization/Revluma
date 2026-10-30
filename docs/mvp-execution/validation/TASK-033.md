# TASK 033 — Abandonment-then-purchase validation

**Status: PARTIAL — 10/10 grouped integration checks PASS, full TC033-01–70 evidence outstanding.**
**Phase:** 1. **Workstream:** 1B. **Branch:** `test/mvp-task-033-abandonment-then-purchase`.
**Scope:** Shopify-only read-only lifecycle verification; no production code changes.

## A–E. Identification, prior evidence, checkout creation and classifier
The approved backlog identifies Task 033 as abandonment-then-purchase. Reviewed source paths: `Backend/src/services/commerceWebhookService.js`, `checkoutInactivity.js`, and `schedulerService.js`. Prior Task031/032 regression work exists but Task032 was explicitly deferred without full certification. `upsertAbandonedCart` writes initial `pending` status, preserving source identifiers. `promoteInactiveCheckouts` updates pending checkouts with `recovered_at: null` and `updated_at <= now - 15 minutes`, scoped to active Shopify stores.

## F–W. Threshold, reconciliation, lifecycle, safety, metrics and attribution
The helper `isCheckoutInactive` uses an inclusive 900,000ms boundary. The scheduler performs a database `updateMany` and excludes recovered records; the order service performs source-identifier-based matching and persists checkout ownership. The new integration suite tests checkout persistence, actual scheduler promotion, subsequent order reconciliation, stale updates, duplicate deliveries, and weak identity evidence. These claims remain *unverified test expectations* until CI completes. The existing `recovered` status means a completed purchase in current storage; it is not proof of a Revluma-attributed campaign recovery. Actual Command Center and Rev Intelligence metric query behavior is not yet proven by these tests.

## X–Z. Environment, implementation and execution
Disposable pgvector PostgreSQL 16, Node 22, Prisma `db push` in `.github/workflows/task033-abandonment-then-purchase.yml`. Test: `Backend/src/tests/task033AbandonmentThenPurchase.integration.js`. Command: `node src/tests/task033AbandonmentThenPurchase.integration.js`. CI result: **PASS, 10/10 grouped checks**, GitHub Actions run **41041134068**, commit **32caa0f6**. Backend tests and backend refresh regression also PASS. Grouped checks are not interchangeable with full individual scenario evidence.

## AA. Acceptance matrix
All 70 scenarios are tracked below. **NOT RUN** means the precise acceptance requirement lacks recorded passing evidence, even when a grouped test mentions the case ID.

| Scenario | Status | Evidence |
|---|---|---|
| TC033-01 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041134068 |
| TC033-02 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041134068 |
| TC033-03 | PARTIAL | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; specific acceptance path not fully exercised |
| TC033-04 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041134068 |
| TC033-05 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041134068 |
| TC033-06 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041134068 |
| TC033-07 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041134068 |
| TC033-08 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041134068 |
| TC033-09 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041134068 |
| TC033-10 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041134068 |
| TC033-11 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041134068 |
| TC033-12 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041134068 |
| TC033-13 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041134068 |
| TC033-14 | PARTIAL | TC033-14-recent-activity-prevents-abandonment; specific acceptance path not fully exercised |
| TC033-15 | PARTIAL | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; specific acceptance path not fully exercised |
| TC033-16 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041134068 |
| TC033-17 | PASS | TC033-17-exact-checkout-id-matching-after-abandonment; CI PASS run 41041134068 |
| TC033-18 | PARTIAL | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; specific acceptance path not fully exercised |
| TC033-19 | NOT RUN | No direct passing acceptance evidence |
| TC033-20 | NOT RUN | No direct passing acceptance evidence |
| TC033-21 | PARTIAL | TC033-21-22-23-24-25-weak-evidence-never-completes; specific acceptance path not fully exercised |
| TC033-22 | PARTIAL | TC033-21-22-23-24-25-weak-evidence-never-completes; specific acceptance path not fully exercised |
| TC033-23 | PARTIAL | TC033-21-22-23-24-25-weak-evidence-never-completes; specific acceptance path not fully exercised |
| TC033-24 | PARTIAL | TC033-21-22-23-24-25-weak-evidence-never-completes; specific acceptance path not fully exercised |
| TC033-25 | PARTIAL | TC033-21-22-23-24-25-weak-evidence-never-completes; specific acceptance path not fully exercised |
| TC033-26 | NOT RUN | No direct passing acceptance evidence |
| TC033-27 | NOT RUN | No direct passing acceptance evidence |
| TC033-28 | PARTIAL | TC033-21-22-23-24-25-weak-evidence-never-completes; specific acceptance path not fully exercised |
| TC033-29 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041134068 |
| TC033-30 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041134068 |
| TC033-31 | NOT RUN | No direct passing acceptance evidence |
| TC033-32 | NOT RUN | No direct passing acceptance evidence |
| TC033-33 | PARTIAL | TC033-33-34-35-36-41-stale-and-repeated-classifier-cannot-reopen; specific acceptance path not fully exercised |
| TC033-34 | PARTIAL | TC033-33-34-35-36-41-stale-and-repeated-classifier-cannot-reopen; specific acceptance path not fully exercised |
| TC033-35 | PARTIAL | TC033-33-34-35-36-41-stale-and-repeated-classifier-cannot-reopen; specific acceptance path not fully exercised |
| TC033-36 | PARTIAL | TC033-33-34-35-36-41-stale-and-repeated-classifier-cannot-reopen; specific acceptance path not fully exercised |
| TC033-37 | PASS | TC033-37-38-57-duplicate-purchase-and-checkout-do-not-duplicate; CI PASS run 41041134068 |
| TC033-38 | PASS | TC033-37-38-57-duplicate-purchase-and-checkout-do-not-duplicate; CI PASS run 41041134068 |
| TC033-39 | NOT RUN | No direct passing acceptance evidence |
| TC033-40 | NOT RUN | No direct passing acceptance evidence |
| TC033-41 | PARTIAL | TC033-33-34-35-36-41-stale-and-repeated-classifier-cannot-reopen; specific acceptance path not fully exercised |
| TC033-42 | NOT RUN | No direct passing acceptance evidence |
| TC033-43 | NOT RUN | No direct passing acceptance evidence |
| TC033-44 | NOT RUN | No direct passing acceptance evidence |
| TC033-45 | NOT RUN | No direct passing acceptance evidence |
| TC033-46 | NOT RUN | No direct passing acceptance evidence |
| TC033-47 | NOT RUN | No direct passing acceptance evidence |
| TC033-48 | NOT RUN | No direct passing acceptance evidence |
| TC033-49 | NOT RUN | No direct passing acceptance evidence |
| TC033-50 | NOT RUN | No direct passing acceptance evidence |
| TC033-51 | NOT RUN | No direct passing acceptance evidence |
| TC033-52 | NOT RUN | No direct passing acceptance evidence |
| TC033-53 | NOT RUN | No direct passing acceptance evidence |
| TC033-54 | PARTIAL | TC033-54-55-56-58-59-active-abandonment-and-order-financial-integrity; specific acceptance path not fully exercised |
| TC033-55 | PARTIAL | TC033-54-55-56-58-59-active-abandonment-and-order-financial-integrity; specific acceptance path not fully exercised |
| TC033-56 | PARTIAL | TC033-54-55-56-58-59-active-abandonment-and-order-financial-integrity; specific acceptance path not fully exercised |
| TC033-57 | PASS | TC033-37-38-57-duplicate-purchase-and-checkout-do-not-duplicate; CI PASS run 41041134068 |
| TC033-58 | PARTIAL | TC033-54-55-56-58-59-active-abandonment-and-order-financial-integrity; specific acceptance path not fully exercised |
| TC033-59 | PARTIAL | TC033-54-55-56-58-59-active-abandonment-and-order-financial-integrity; specific acceptance path not fully exercised |
| TC033-60 | NOT RUN | No direct passing acceptance evidence |
| TC033-61 | NOT RUN | No direct passing acceptance evidence |
| TC033-62 | NOT RUN | No direct passing acceptance evidence |
| TC033-63 | NOT RUN | No direct passing acceptance evidence |
| TC033-64 | NOT RUN | No direct passing acceptance evidence |
| TC033-65 | NOT RUN | No direct passing acceptance evidence |
| TC033-66 | NOT RUN | No direct passing acceptance evidence |
| TC033-67 | NOT RUN | No direct passing acceptance evidence |
| TC033-68 | NOT RUN | No direct passing acceptance evidence |
| TC033-69 | NOT RUN | No direct passing acceptance evidence |
| TC033-70 | PASS | TC033-70-deterministic-repeatable-fixtures; CI PASS run 41041134068 |

## AB–AF. Defects, findings, dependencies and limitations
No product defect is confirmed by an executed Task033 test yet. Potential gaps include race conditions between scheduler promotion and order completion, production metric query integrity, full historical sync, process restart, injected database failures, and explicit regressions TC033-64–67. Do not invent or close finding IDs without reproductions. Task032 remains deferred and is not retroactively certified.

## AG–AH. Status and version control
**PARTIAL — 10/10 GROUPED TESTS VERIFIED; FULL 70-SCENARIO CERTIFICATION INCOMPLETE.** Branch `test/mvp-task-033-abandonment-then-purchase`. PR, merge and deployment pending. No production data or deployment changes authorized. Task034 must not start under this task's instructions.
