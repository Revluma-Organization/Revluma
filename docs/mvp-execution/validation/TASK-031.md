# TASK 031 — Test order-first event delivery
**Phase:** 1 Reliable Data Foundation · **Workstream:** 1B Checkout/Order Integrity · **Date:** 2026-10-30
**Branch:** test/mvp-task-031-order-first-delivery
**Baseline:** main at branch creation (after Task030 closure); production SHA not independently established for this task.
**Status:** FAIL — critical product defect confirmed in isolated PostgreSQL; no production changes. No production data changed.

## A–E. Task identification, prior evidence, implementation and event processing
Approved backlog confirms Task031 as validation only. Inspected README, audit register, implementation decisions, Task030 isolated test and commerce webhook service; previous Task002–029 reports referenced by audit register but not all individually re-reviewed. Shopify webhook controller verifies HMAC, resolves merchant, claims delivery, then invokes processCommerceWebhook. The order branch invokes upsertOrder; checkout branch invokes upsertAbandonedCart. shopifySync imports both using these same service functions.

## F–H. Order-first lifecycle and matching
`upsertOrder` creates the order and preserves typed checkout ID/token/cart token. It records an unresolved reconciliation case when checkout does not exist. It performs authoritative merchant-scoped candidate matching **only when processing an order**. `upsertAbandonedCart` inserts or updates the checkout and returns it, **without querying existing unresolved orders or invoking order reconciliation**. Thus the required later-checkout reconciliation is not triggered by checkout arrival alone. This is a source-confirmed gap; CI reproduction is pending. Repeated order webhook or sync might reconcile, but the task forbids assuming retries occur.

## I–Q. Lifecycle, stale events, isolation, idempotency, concurrency, history, metrics and revenue
Order-path completion and stale-event protection were implemented in Tasks029–030. They depend on an established relationship; missing checkout-triggered reconciliation prevents those protections from applying to an order-first checkout until an order is reprocessed. Merchant filters exist in order candidate lookup and checkout upsert. Duplicate checkout writes use advisory locks. Historical sync calls both service functions; ordering and retry behavior remain unverified. No false recovered revenue is allowed; detailed metrics not yet validated for order-first.

## R–T. Test environment, implementation and execution
New isolated PostgreSQL diagnostic: `Backend/src/tests/task031OrderFirst.integration.js`. Three assertions cover durable order-first persistence, checkout-arrival reconciliation, and repeated checkout reconciliation. Dedicated CI `.github/workflows/task031-order-first.yml` creates disposable PostgreSQL + pgvector and executes `node src/tests/task031OrderFirst.integration.js`. **Executed GitHub Actions run 41027685312, job 123969599483, commit 1552a2525c07b38d538f855883a5bb098bf092b0: 1 PASS / 2 FAIL / 3 total.** Disposable pgvector PostgreSQL 16, Prisma db push succeeded. Backend tests and backend refresh regression both passed on same commit. The test intentionally fails when the product does not reconcile on later checkout. It must not be weakened to achieve green CI.

## U. Required 55-scenario matrix
All entries must be updated with actual execution results and DB evidence. Initial status:
| Test | Status | Evidence / blocker |
|---|---|---|
| TC031-01 | FAIL | CI run 41027685312: order FK null after later checkout; expected checkout UUID |
| TC031-02 | PASS | CI run 41027685312: persisted order, source checkout token retained, no fabricated checkout |
| TC031-03 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-04 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-05 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-06 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-07 | FAIL | CI run 41027685312: duplicate checkout delivery leaves order FK null |
| TC031-08 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-09 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-10 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-11 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-12 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-13 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-14 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-15 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-16 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-17 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-18 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-19 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-20 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-21 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-22 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-23 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-24 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-25 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-26 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-27 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-28 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-29 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-30 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-31 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-32 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-33 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-34 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-35 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-36 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-37 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-38 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-39 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-40 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-41 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-42 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-43 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-44 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-45 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-46 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-47 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-48 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-49 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-50 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-51 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-52 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-53 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-54 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |
| TC031-55 | NOT RUN | Requires isolated PostgreSQL execution and source-specific fixture |

## V–X. Defects, test defects and findings
**REV-FIND-029-02** (reuse existing audit finding; do not allocate duplicate): checkout-arrival path lacks order-first reconciliation trigger. Severity HIGH / potentially CRITICAL. Evidence: `commerceWebhookService.js` `upsertOrder` performs matching, `upsertAbandonedCart` only upserts checkout, `processCommerceWebhook` checkout branch returns without reconciliation. **Status OPEN; source-confirmed and database-reproduced.** Related approved follow-up must be assigned before closure; Task031 prohibits broad production rewrite.
Test defects: none confirmed; fixture validity and CI setup must be assessed after execution.

## Y–Z. Dependencies and limitations
Task031 cannot PASS until later-checkout reconciliation, ownership, weak/conflicting evidence, concurrent events, merchant isolation, metrics and relevant regressions are verified. No production claims from test evidence.

## AA–AB. Final status and version control
**FAIL / VALIDATED IN ISOLATED TEST ENVIRONMENT — NOT PRODUCTION VERIFIED.** Branch: test/mvp-task-031-order-first-delivery. Test implementation commit: 08a3127378cda936204d98d743a072aea8633d01. CI commit: d695554294034ef755cf3a17bbd35b0a601f7a5e. PR/merge/deploy pending. No production merchant data, migrations, or Shopify state changed. Do not begin Task032.

## Post-fix verification — 2026-10-30
Commit 47ec2608d16d4501621b577a270588fa5b3e1489; GitHub Actions Task031 run 41028769202 / job 123973174125: **9 PASS, 0 FAIL** against isolated PostgreSQL. The nine actual test names are TC031-02-order-durable-without-checkout, TC031-01-order-first-later-checkout-reconciles, TC031-03-unrelated-checkout-does-not-claim-order, TC031-04-order-first-idempotent-repeated-checkout, TC031-05-second-order-cannot-claim-owned-checkout, TC031-06-cross-merchant-identity-isolation, TC031-08-cancelled-order-does-not-mark-recovered, TC031-09-replay-does-not-reopen-recovered, TC031-07-duplicate-checkout-still-reconciles. These are diagnostic test labels and **do not** correspond one-to-one with the original required TC031-01..55 contract. Existing Task025–030 CI suites, backend tests and backend refresh regression all passed at same commit. Remaining original 55-case matrix entries are not automatically PASS. This is **validated in isolated test environment, not production verified**. The earlier confirmed defect REV-FIND-029-02 is corrected for the tested order-first path; full acceptance remains PARTIAL pending full contract coverage and production review.
