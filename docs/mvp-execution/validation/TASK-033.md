# TASK 033 — Abandonment-then-purchase validation

**Status: PARTIAL — 33/33 Task033 grouped checks PASS; prior-task regression suites PASS. Full 70-scenario certification still has explicit gaps; no production deployment or live merchant data changes.**
**Phase:** 1. **Workstream:** 1B. **Branch:** `test/mvp-task-033-abandonment-then-purchase`.
**Scope:** Shopify-only read-only lifecycle verification. Authorized Task033 branch-only correction to Command Center metric query; no production deployment or live merchant data changes.

## A–E. Identification, prior evidence, checkout creation and classifier
The approved backlog identifies Task 033 as abandonment-then-purchase. Reviewed source paths: `Backend/src/services/commerceWebhookService.js`, `checkoutInactivity.js`, and `schedulerService.js`. Prior Task031/032 regression work exists but Task032 was explicitly deferred without full certification. `upsertAbandonedCart` writes initial `pending` status, preserving source identifiers. `promoteInactiveCheckouts` updates pending checkouts with `recovered_at: null` and `updated_at <= now - 15 minutes`, scoped to active Shopify stores.

## F–W. Threshold, reconciliation, lifecycle, safety, metrics and attribution
The helper `isCheckoutInactive` uses an inclusive 900,000ms boundary. The scheduler persists abandonment only for pending, unrecovered Shopify checkouts older than 15 minutes. Order reconciliation uses exact merchant-scoped source identifiers, records unresolved/conflicting cases, and enforces single-checkout ownership.

The Command Center defect originally recorded as REV-FIND-0113 was corrected on this Task033 branch: `dashboardController.getKpis` no longer includes `status = 'recovered'` in the active-abandonment count. The regression invokes the real `getKpis` controller against disposable PostgreSQL data and verifies active carts, revenue-at-risk, and Revluma-attributed recovered revenue independently.

Rev Intelligence evidence was also checked against `python/src/intelligence/business_state.py`: its revenue query aggregates persisted orders within the reporting window, and its cart query filters to `status = 'abandoned'`, `recovered_at IS NULL`, and the 48-hour window with deduplication. Task033 integration tests execute corresponding SQL against the same disposable fixture and assert that the completed purchase is retained once in order revenue but excluded from active abandonment evidence.

Historical Shopify sync is exercised through the actual `syncAbandonedCheckouts` and `syncOrders` functions with a controlled mocked GraphQL transport, covering historical checkout → later purchase, live checkout → historical order, and repeated sync idempotency. Additional tests cover conflicting and ambiguous identifiers, weak-signal-only non-matches, large IDs, forged merchant context, classifier write failure, and a fresh Node process reconciling persisted checkout state.

The initial failing Command Center metric assertion was fixed and now passes. REV-FIND-0113 is resolved in code and isolated CI, not production-deployed. Synthetic GraphQL transport is not a real Shopify provider delivery, and a fresh Node process is not a full Render service restart.

## X–Z. Environment, implementation and execution
Disposable pgvector PostgreSQL 16, Node 22, Prisma `db push`. Workflow: `.github/workflows/task033-abandonment-then-purchase.yml`. Test: `Backend/src/tests/task033AbandonmentThenPurchase.integration.js`. Latest verified commit **e9b67acfdcada46303bb1a6ac3e063fa6e9a0c33**. Task033: **33/33 PASS**, GitHub Actions run **41199612927**. Earlier-task isolated regressions in the same run: Task032 **15/15**, Task025 **28/28**, Task026 **40/40**, Task027 **40/40**, Task028 **44/44**, Task029 **45/45**, Task030 **50/50**, Task031 **15/15**. Complete Backend tests: **28 test files PASS**, run **41199612949**. Backend refresh regression: **SUCCESS**, run **41199612939**. All three workflows completed successfully. Tests use disposable databases and synthetic payloads; no production database or Shopify store was mutated.

## AA. Acceptance matrix
All 70 scenarios are tracked below. **NOT RUN** means the precise acceptance requirement lacks recorded passing evidence, even when a grouped test mentions the case ID. A grouped PASS is not a substitute for individually verified requirements.

| Scenario | Status | Evidence |
|---|---|---|
| TC033-01 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041588576 |
| TC033-02 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041588576 |
| TC033-03 | PASS | Inclusive 15-minute boundary and recent activity; run 41199612927 |
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
| TC033-14 | PASS | Recent activity prevents abandonment; run 41199612927 |
| TC033-15 | PASS | Scheduler persists abandonment; run 41199612927 |
| TC033-16 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041588576 |
| TC033-17 | PASS | TC033-17-exact-checkout-id-matching-after-abandonment; CI PASS run 41041588576 |
| TC033-18 | PASS | Checkout token linkage in lifecycle; run 41199612927 |
| TC033-19 | PASS | Safe cart-token reconciliation; run 41199612927 |
| TC033-20 | PASS | Ambiguous cart token and conflicting identifiers rejected; run 41199612927 |
| TC033-21 | PARTIAL | TC033-21-22-23-24-25-weak-evidence-never-completes; specific acceptance path not fully exercised |
| TC033-22 | PARTIAL | TC033-21-22-23-24-25-weak-evidence-never-completes; specific acceptance path not fully exercised |
| TC033-23 | PARTIAL | TC033-21-22-23-24-25-weak-evidence-never-completes; specific acceptance path not fully exercised |
| TC033-24 | PARTIAL | TC033-21-22-23-24-25-weak-evidence-never-completes; specific acceptance path not fully exercised |
| TC033-25 | PARTIAL | TC033-21-22-23-24-25-weak-evidence-never-completes; specific acceptance path not fully exercised |
| TC033-26 | PASS | Conflicting strong identifiers remain unresolved; run 41199612927 |
| TC033-27 | PASS | Second order cannot claim an already-owned checkout; run 41199612927 |
| TC033-28 | PARTIAL | TC033-21-22-23-24-25-weak-evidence-never-completes; specific acceptance path not fully exercised |
| TC033-29 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041588576 |
| TC033-30 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041588576 |
| TC033-31 | PASS | Source identifier preservation; run 41199612927 |
| TC033-32 | PASS | Order source timestamp is used for completion; run 41199612927 |
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
| TC033-44 | PASS | Forged cross-merchant checkout reference rejected; run 41199612927 |
| TC033-45 | PASS | invalid store checkout persistence failure; isolated DB CI PASS run 41041588576 |
| TC033-46 | PASS | Injected classifier persistence failure preserves pending state; run 41199612927 |
| TC033-47 | PASS | invalid store order persistence failure; isolated DB CI PASS run 41041588576 |
| TC033-48 | PARTIAL | Transaction rollback tested with injected failure; not a full DB outage/restart scenario |
| TC033-49 | PASS | fresh Prisma client durability; isolated DB CI PASS run 41041588576 |
| TC033-50 | PASS | Fresh backend Node process completes persisted checkout; run 41199612927 (not full Render restart) |
| TC033-51 | PASS | Historical checkout sync then later live purchase; mocked GraphQL, run 41199612927 |
| TC033-52 | PASS | Live checkout then historical order sync; mocked GraphQL, run 41199612927 |
| TC033-53 | PASS | Repeated historical sync idempotency; mocked GraphQL, run 41199612927 |
| TC033-54 | FAIL | Real dashboard count predicate test; CI run 41198665146: 11 completed/recovered carts counted as active abandonment; REV-FIND-0113.
| TC033-58 | PARTIAL | TC033-54-55-56-58-59-active-abandonment-and-order-financial-integrity; specific acceptance path not fully exercised |
| TC033-55 | PASS | Actual Command Center risk query and Rev Intelligence active-cart evidence verified; run 41199612927 |
| TC033-56 | PASS | Rev Intelligence order revenue query retains completed order once; run 41199612927 |
| TC033-57 | PASS | TC033-37-38-57-duplicate-purchase-and-checkout-do-not-duplicate; CI PASS run 41041588576 |
| TC033-58 | PARTIAL | TC033-54-55-56-58-59-active-abandonment-and-order-financial-integrity; specific acceptance path not fully exercised |
| TC033-59 | FAIL | Active outstanding opportunity count is incorrect for completed/recovered status; REV-FIND-0113.
| TC033-60 | PASS | Checkout/order source identifiers and completion timestamp preserved; run 41199612927 |
| TC033-61 | PASS | Large Shopify identifier preserved exactly; run 41199612927 |
| TC033-62 | PASS | Missing identifiers do not create links; run 41199612927 |
| TC033-63 | PASS | Invalid identifiers rejected without fabricated link; run 41199612927 |
| TC033-64 | NOT RUN | No direct passing acceptance evidence |
| TC033-65 | PASS | Task029 45/45 and Task030 50/50 regressions; run 41199612927 |
| TC033-66 | PASS | Task031 15/15 order-first regression; run 41199612927 |
| TC033-67 | PASS | Task032 15/15 checkout-first regression; run 41199612927 |
| TC033-68 | NOT RUN | No direct passing acceptance evidence |
| TC033-69 | NOT RUN | No direct passing acceptance evidence |
| TC033-70 | PASS | TC033-70-deterministic-repeatable-fixtures; CI PASS run 41041588576 |

## AB–AF. Defects, findings, dependencies and limitations
REV-FIND-0113 is resolved in branch code and verified by the actual Command Center endpoint regression. Failure-path tests include checkout persistence rejection, order persistence rejection, classifier write failure, and transaction rollback. Historical sync is tested through actual sync functions with mocked Shopify GraphQL transport. A fresh Node process performs completion after the checkout is persisted. Remaining certification limitations: TC033-48's full database-outage/restart semantics, TC033-64's entire Task017–027 history (Tasks025–028 are covered; earlier Task017–024 are not re-run in this workflow), and TC033-68/69 privacy/retention-specific acceptance assertions are not evidenced. Real Shopify provider deliveries and a full Render service restart are not simulated by these disposable tests.

## AG–AH. Status and version control
**PARTIAL — 33/33 TASK033 GROUPED TESTS AND ALL INCLUDED PRIOR-TASK REGRESSION SUITES PASS; FULL 70-SCENARIO CERTIFICATION HAS EXPLICIT REMAINING GAPS.** Branch `test/mvp-task-033-abandonment-then-purchase`. PR, merge and deployment pending. No production data or deployment changes authorized. Task034 must not start under this task's instructions.
\n\n## Confirmed finding\n\n- **REV-FIND-0113 — HIGH — OPEN:** Command Center `getKpis` counts completed checkouts (`abandoned_carts.status = 'recovered'`) as active abandoned carts. Evidence: `Backend/src/controller/dashboardController.js` `totalAbandoned` predicate; test `TC033-54-55-58-59-real-dashboard-metric-query-integrity`; CI run 41198665146, observed count 11 when expected 0. Order persistence stores `recovery_status = 'completed'`. This violates the requirement that completed checkouts leave outstanding abandonment metrics. **Not fixed** because the approved Task033 scope explicitly prohibits production code changes. Requires a separately authorized production-code correction and regression verification.\n\n## Final status\n\n**PARTIAL — ISOLATED CI VERIFIED; NOT PRODUCTION VERIFIED.** Task033 33/33 grouped checks, Task025–032 included regressions, Backend tests and refresh regression pass. Remaining matrix gaps are listed above. REV-FIND-0113 is resolved in branch code but not deployed. PR #231 remains draft/open, unmerged and undeployed.\n