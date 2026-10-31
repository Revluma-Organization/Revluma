# TASK 033 — Abandonment-then-purchase validation

**Status: PARTIAL — 18/18 lifecycle checks passed on commit 9d50b6c1; metric-query integrity test added on 0d64652a and pending CI. Full TC033-01–70 evidence remains outstanding.**
**Phase:** 1. **Workstream:** 1B. **Branch:** `test/mvp-task-033-abandonment-then-purchase`.
**Scope:** Shopify-only read-only lifecycle verification; no production code changes.

## A–E. Identification, prior evidence, checkout creation and classifier
The approved backlog identifies Task 033 as abandonment-then-purchase. Reviewed source paths: `Backend/src/services/commerceWebhookService.js`, `checkoutInactivity.js`, and `schedulerService.js`. Prior Task031/032 regression work exists but Task032 was explicitly deferred without full certification. `upsertAbandonedCart` writes initial `pending` status, preserving source identifiers. `promoteInactiveCheckouts` updates pending checkouts with `recovered_at: null` and `updated_at <= now - 15 minutes`, scoped to active Shopify stores.

## F–W. Threshold, reconciliation, lifecycle, safety, metrics and attribution
The helper `isCheckoutInactive` uses an inclusive 900,000ms boundary. The scheduler performs a database `updateMany` and excludes recovered records; the order service performs source-identifier-based matching and persists checkout ownership. The new integration suite tests checkout persistence, actual scheduler promotion, subsequent order reconciliation, stale updates, duplicate deliveries, and weak identity evidence. These claims were verified for the tested paths by 16/16 grouped integration checks; remaining acceptance paths require separate evidence. The existing `recovered` status means a completed purchase in current storage; it is not proof of a Revluma-attributed campaign recovery. Actual Command Center and Rev Intelligence metric query behavior was not covered by the 18 prior checks. A new test now exercises the Command Center abandoned-cart count predicate against the completed `core` checkout. Source inspection identifies a concrete mismatch: the controller counts `status: 'recovered'` as an active abandoned cart, while purchase persistence writes the order with `recovery_status: 'completed'`; this must be confirmed by the new disposable-DB test. Rev Intelligence query coverage remains unverified.

## X–Z. Environment, implementation and execution
Disposable pgvector PostgreSQL 16, Node 22, Prisma `db push` in `.github/workflows/task033-abandonment-then-purchase.yml`. Test: `Backend/src/tests/task033AbandonmentThenPurchase.integration.js`. Command: `node src/tests/task033AbandonmentThenPurchase.integration.js`. CI result: **PASS, 18/18 grouped checks**, GitHub Actions run **41043686354**, commit **9d50b6c1**. Task032 regression: **15/15 PASS**, same run. Backend tests and refresh regression PASS. Backend tests and backend refresh regression also PASS. Grouped checks are not interchangeable with full individual scenario evidence.

## AA. Acceptance matrix
All 70 scenarios are tracked below. **NOT RUN** means the precise acceptance requirement lacks recorded passing evidence, even when a grouped test mentions the case ID.

| Scenario | Status | Evidence |
|---|---|---|
| TC033-01 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041588576 |
| TC033-02 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041588576 |
| TC033-03 | PARTIAL | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; specific acceptance path not fully exercised |
| TC033-04 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041588576 |
| TC033-05 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041588576 |
| TC033-06 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041588576 |
| TC033-07 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041588576 |
| TC033-08 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041588576 |
| TC033-09 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041588576 |
| TC033-10 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041588576 |
| TC033-11 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041588576 |
| TC033-12 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041588576 |
| TC033-13 | PASS | TC033-03-04-05-06-07-08-09-10-11-12-13-threshold-boundaries; CI PASS run 41041588576 |
| TC033-14 | PARTIAL | TC033-14-recent-activity-prevents-abandonment; specific acceptance path not fully exercised |
| TC033-15 | PARTIAL | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; specific acceptance path not fully exercised |
| TC033-16 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041588576 |
| TC033-17 | PASS | TC033-17-exact-checkout-id-matching-after-abandonment; CI PASS run 41041588576 |
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
| TC033-29 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041588576 |
| TC033-30 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041588576 |
| TC033-31 | NOT RUN | No direct passing acceptance evidence |
| TC033-32 | NOT RUN | No direct passing acceptance evidence |
| TC033-33 | PARTIAL | TC033-33-34-35-36-41-stale-and-repeated-classifier-cannot-reopen; specific acceptance path not fully exercised |
| TC033-34 | PARTIAL | TC033-33-34-35-36-41-stale-and-repeated-classifier-cannot-reopen; specific acceptance path not fully exercised |
| TC033-35 | PARTIAL | TC033-33-34-35-36-41-stale-and-repeated-classifier-cannot-reopen; specific acceptance path not fully exercised |
| TC033-36 | PARTIAL | TC033-33-34-35-36-41-stale-and-repeated-classifier-cannot-reopen; specific acceptance path not fully exercised |
| TC033-37 | PASS | TC033-37-38-57-duplicate-purchase-and-checkout-do-not-duplicate; CI PASS run 41041588576 |
| TC033-38 | PASS | TC033-37-38-57-duplicate-purchase-and-checkout-do-not-duplicate; CI PASS run 41041588576 |
| TC033-39 | PASS | concurrent scheduler and purchase; isolated DB CI PASS run 41041588576 |
| TC033-40 | PASS | concurrent order reconciliation; isolated DB CI PASS run 41041588576 |
| TC033-41 | PARTIAL | TC033-33-34-35-36-41-stale-and-repeated-classifier-cannot-reopen; specific acceptance path not fully exercised |
| TC033-42 | PASS | cross-merchant isolation; isolated DB CI PASS run 41041588576 |
| TC033-43 | PASS | overlapping identifiers across merchants; isolated DB CI PASS run 41041588576 |
| TC033-44 | NOT RUN | No direct passing acceptance evidence |
| TC033-45 | PASS | invalid store checkout persistence failure; isolated DB CI PASS run 41041588576 |
| TC033-46 | NOT RUN | No direct passing acceptance evidence |
| TC033-47 | PASS | invalid store order persistence failure; isolated DB CI PASS run 41041588576 |
| TC033-48 | NOT RUN | No direct passing acceptance evidence |
| TC033-49 | PASS | fresh Prisma client durability; isolated DB CI PASS run 41041588576 |
| TC033-50 | NOT RUN | No direct passing acceptance evidence |
| TC033-51 | NOT RUN | No direct passing acceptance evidence |
| TC033-52 | NOT RUN | No direct passing acceptance evidence |
| TC033-53 | NOT RUN | No direct passing acceptance evidence |
| TC033-54 | PARTIAL | New dashboard metric query test on commit 0d64652a; CI pending; existing controller predicate includes status recovered in outstanding count |
| TC033-55 | PARTIAL | At-risk aggregate predicate excludes recovered status; pending direct assertion in new metric test |\n| TC033-58 | PARTIAL | TC033-54-55-56-58-59-active-abandonment-and-order-financial-integrity; specific acceptance path not fully exercised |
| TC033-55 | PARTIAL | TC033-54-55-56-58-59-active-abandonment-and-order-financial-integrity; specific acceptance path not fully exercised |
| TC033-56 | PARTIAL | TC033-54-55-56-58-59-active-abandonment-and-order-financial-integrity; specific acceptance path not fully exercised |
| TC033-57 | PASS | TC033-37-38-57-duplicate-purchase-and-checkout-do-not-duplicate; CI PASS run 41041588576 |
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
| TC033-70 | PASS | TC033-70-deterministic-repeatable-fixtures; CI PASS run 41041588576 |

## AB–AF. Defects, findings, dependencies and limitations
No product defect is confirmed by the 16 passing Task033 grouped checks. Failure-path tests use invalid-store foreign-key rejection; they do not simulate a database outage or transactional rollback under partial writes. Concurrent scheduler/order and duplicate order paths, cross-merchant identifiers, and fresh-client persistence have passed. Remaining gaps include production metric query integrity, full historical sync, actual process restart, transaction-level database failure injection, and explicit regressions TC033-64–67. Do not invent or close finding IDs without reproductions. Task032 remains deferred and is not retroactively certified.

## AG–AH. Status and version control
**PARTIAL — 16/16 GROUPED TESTS VERIFIED; FULL 70-SCENARIO CERTIFICATION INCOMPLETE.** Branch `test/mvp-task-033-abandonment-then-purchase`. PR, merge and deployment pending. No production data or deployment changes authorized. Task034 must not start under this task's instructions.
