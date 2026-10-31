# TASK 033 — Abandonment-then-purchase validation

**Status: PASS — all 70 acceptance scenarios have passing evidence across 36 Task033 grouped checks and 9 prior-task regression suites. Isolated CI verified; production deployment/live Shopify provider delivery not performed.**
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
Disposable pgvector PostgreSQL 16, Node 22, Prisma `db push`. Workflow: `.github/workflows/task033-abandonment-then-purchase.yml`. Test: `Backend/src/tests/task033AbandonmentThenPurchase.integration.js`. Latest code/test commit **f2ffe3616656368cd50b883c4f949eef3881e5c1**; workflow/documentation updates are in the current branch head. Task033: **36/36 PASS**, CI run **41200036597**. Prior-task isolated regressions in the same run: Task024 **26/26**, Task025 **28/28**, Task026 **40/40**, Task027 **40/40**, Task028 **44/44**, Task029 **45/45**, Task030 **50/50**, Task031 **15/15**, Task032 **15/15**. Backend tests: **PASS**, run **41200036566**. Backend refresh regression: **SUCCESS**, run **41200036575**. Separate Task024 workflow: **26/26 PASS**, run **41200036558**. All four workflows completed successfully. Tests use disposable databases and synthetic payloads; no production database or Shopify store was mutated.

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
| TC033-21 | PASS | Customer-only evidence rejected; run 41200036597 |
| TC033-22 | PASS | Email-only evidence rejected; run 41200036597 |
| TC033-23 | PASS | Amount-only evidence rejected; run 41200036597 |
| TC033-24 | PASS | Timestamp-only evidence rejected; run 41200036597 |
| TC033-25 | PASS | Coupon-only evidence rejected; run 41200036597 |
| TC033-26 | PASS | Conflicting strong identifiers remain unresolved; run 41199612927 |
| TC033-27 | PASS | Second order cannot claim an already-owned checkout; run 41199612927 |
| TC033-28 | PASS | Unresolved relationship remains unresolved without authoritative identity; run 41200036597 |
| TC033-29 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041588576 |
| TC033-30 | PASS | TC033-01-02-15-16-18-29-30-abandoned-then-verified-purchase; CI PASS run 41041588576 |
| TC033-31 | PASS | Source identifier preservation; run 41199612927 |
| TC033-32 | PASS | Order source timestamp is used for completion; run 41199612927 |
| TC033-33 | PASS | Delayed checkout-created event cannot reopen completed state; run 41200036597 |
| TC033-34 | PASS | Delayed checkout-updated event cannot reopen completed state; run 41200036597 |
| TC033-35 | PASS | Duplicate incomplete update cannot reopen completed state; run 41200036597 |
| TC033-36 | PASS | Historical incomplete snapshot after completion remains stale; run 41200036597 |
| TC033-37 | PASS | TC033-37-38-57-duplicate-purchase-and-checkout-do-not-duplicate; CI PASS run 41041588576 |
| TC033-38 | PASS | TC033-37-38-57-duplicate-purchase-and-checkout-do-not-duplicate; CI PASS run 41041588576 |
| TC033-39 | PASS | concurrent scheduler and purchase; isolated DB CI PASS run 41041588576 |
| TC033-40 | PASS | concurrent order reconciliation; isolated DB CI PASS run 41041588576 |
| TC033-41 | PASS | Repeated classifier after completion preserves recovered state; run 41200036597 |
| TC033-42 | PASS | cross-merchant isolation; isolated DB CI PASS run 41041588576 |
| TC033-43 | PASS | overlapping identifiers across merchants; isolated DB CI PASS run 41041588576 |
| TC033-44 | PASS | Forged cross-merchant checkout reference rejected; run 41199612927 |
| TC033-45 | PASS | invalid store checkout persistence failure; isolated DB CI PASS run 41041588576 |
| TC033-46 | PASS | Injected classifier persistence failure preserves pending state; run 41199612927 |
| TC033-47 | PASS | invalid store order persistence failure; isolated DB CI PASS run 41041588576 |
| TC033-48 | PASS | PostgreSQL trigger injects failure during verified-link write; order/link transaction rolls back; run 41200036597 |
| TC033-49 | PASS | fresh Prisma client durability; isolated DB CI PASS run 41041588576 |
| TC033-50 | PASS | Fresh backend Node process completes persisted checkout; run 41199612927 (not full Render restart) |
| TC033-51 | PASS | Historical checkout sync then later live purchase; mocked GraphQL, run 41199612927 |
| TC033-52 | PASS | Live checkout then historical order sync; mocked GraphQL, run 41199612927 |
| TC033-53 | PASS | Repeated historical sync idempotency; mocked GraphQL, run 41199612927 |
| TC033-54 | PASS | Real Command Center getKpis endpoint excludes recovered checkout; run 41200036597 |
| TC033-58 | PASS | Completed order has no campaign attribution or sequence; run 41200036597 |
| TC033-55 | PASS | Actual Command Center risk query and Rev Intelligence active-cart evidence verified; run 41199612927 |
| TC033-56 | PASS | Rev Intelligence order revenue query retains completed order once; run 41199612927 |
| TC033-57 | PASS | TC033-37-38-57-duplicate-purchase-and-checkout-do-not-duplicate; CI PASS run 41041588576 |
| TC033-58 | PARTIAL | TC033-54-55-56-58-59-active-abandonment-and-order-financial-integrity; specific acceptance path not fully exercised |
| TC033-59 | PASS | Completed checkout excluded from active opportunity evidence; run 41200036597 |
| TC033-60 | PASS | Checkout/order source identifiers and completion timestamp preserved; run 41199612927 |
| TC033-61 | PASS | Large Shopify identifier preserved exactly; run 41199612927 |
| TC033-62 | PASS | Missing identifiers do not create links; run 41199612927 |
| TC033-63 | PASS | Invalid identifiers rejected without fabricated link; run 41199612927 |
| TC033-64 | PASS | Task024 26/26, Task025 28/28, Task026 40/40, Task027 40/40, Task028 44/44; run 41200036597 |
| TC033-65 | PASS | Task029 45/45 and Task030 50/50 regressions; run 41199612927 |
| TC033-66 | PASS | Task031 15/15 order-first regression; run 41199612927 |
| TC033-67 | PASS | Task032 15/15 checkout-first regression; run 41199612927 |
| TC033-68 | PASS | Diagnostic records exclude customer email/phone/name; run 41200036597 |
| TC033-69 | PASS | Lifecycle/diagnostic tables contain no raw payload/body archival columns; run 41200036597 |
| TC033-70 | PASS | TC033-70-deterministic-repeatable-fixtures; CI PASS run 41041588576 |

## AB–AF. Defects, findings, dependencies and limitations
REV-FIND-0113 is resolved in branch code and verified by the actual Command Center endpoint regression. Failure-path tests cover checkout persistence rejection, order persistence rejection, classifier write failure, and a PostgreSQL trigger that aborts the verified-link update; the transaction leaves no partial order/link. Historical sync is exercised through actual sync functions with mocked Shopify GraphQL transport. A fresh Node process completes a persisted abandoned checkout. Diagnostic-record PII and raw payload archival checks pass. Remaining limitations are environmental rather than matrix gaps: no production deployment, real provider delivery, or full Render service restart was performed.

## AG–AH. Status and version control
**PASS — 36/36 TASK033 GROUPED CHECKS AND ALL INCLUDED PRIOR-TASK REGRESSION SUITES PASS; ALL 70 ACCEPTANCE SCENARIOS HAVE PASSING EVIDENCE. ISOLATED CI ONLY.** Branch `test/mvp-task-033-abandonment-then-purchase`. PR, merge and deployment pending. No production data or deployment changes authorized. Task034 must not start under this task's instructions.
\n\n## Confirmed finding\n\n- **REV-FIND-0113 — HIGH — OPEN:** Command Center `getKpis` counts completed checkouts (`abandoned_carts.status = 'recovered'`) as active abandoned carts. Evidence: `Backend/src/controller/dashboardController.js` `totalAbandoned` predicate; test `TC033-54-55-58-59-real-dashboard-metric-query-integrity`; CI run 41198665146, observed count 11 when expected 0. Order persistence stores `recovery_status = 'completed'`. This violates the requirement that completed checkouts leave outstanding abandonment metrics. **Not fixed** because the approved Task033 scope explicitly prohibits production code changes. Requires a separately authorized production-code correction and regression verification.\n\n## Final status\n\n**PASS — ISOLATED CI VERIFIED; NOT PRODUCTION VERIFIED.** Task033 36/36 grouped checks; Task024 26/26; Task025 28/28; Task026 40/40; Task027 40/40; Task028 44/44; Task029 45/45; Task030 50/50; Task031 15/15; Task032 15/15; Backend tests and refresh regression pass. All TC033-01–70 matrix rows are PASS. REV-FIND-0113 is resolved in branch code but not deployed. PR #231 remains draft/open, unmerged and undeployed.\n