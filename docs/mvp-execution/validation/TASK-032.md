# TASK 032 — Checkout-first event delivery validation

**Status: PARTIAL — NOT YET EXECUTED / NOT PRODUCTION VERIFIED**

**Baseline:** `cfbb1f5dc10b032688a001f2f014ac7498f4c70d` (merged Task031). **Branch:** `test/mvp-task-032-checkout-first-delivery`. **Scope:** Shopify-only read-only validation. No production code changes.

## A. Identification
Task032, Phase 1, Workstream 1B.

## B. Previous evidence
Task031 report and source services are the immediate baseline; other prior reports still require detailed review.

## C. Initial state
Pending specific execution evidence; do not infer PASS from code inspection.

## D. Processing architecture
Actual service entry points: `upsertAbandonedCart` (checkout) and `upsertOrder` (order) in `Backend/src/services/commerceWebhookService.js`.

## E. Event contract
Expected: absent → checkout-only persisted → order persisted, authoritative match, recovered checkout.

## F. Checkout persistence
Pending specific execution evidence; do not infer PASS from code inspection.

## G. Order persistence
Pending specific execution evidence; do not infer PASS from code inspection.

## H. Matching evidence
Source checkout ID, checkout token and guarded cart token are considered; weak customer/amount/time evidence is insufficient.

## I. Relationship persistence
Pending specific execution evidence; do not infer PASS from code inspection.

## J. Unresolved behavior
Pending specific execution evidence; do not infer PASS from code inspection.

## K. Conflict handling
Pending specific execution evidence; do not infer PASS from code inspection.

## L. Checkout ownership
Existing order reconciliation checks checkout ownership under PostgreSQL advisory transaction lock.

## M. Completion precedence
Pending specific execution evidence; do not infer PASS from code inspection.

## N. Stale-event protection
Pending specific execution evidence; do not infer PASS from code inspection.

## O. Merchant isolation
Pending specific execution evidence; do not infer PASS from code inspection.

## P. Idempotency
Pending specific execution evidence; do not infer PASS from code inspection.

## Q. Concurrency
Pending specific execution evidence; do not infer PASS from code inspection.

## R. Historical sync
Pending specific execution evidence; do not infer PASS from code inspection.

## S. Durability
Pending specific execution evidence; do not infer PASS from code inspection.

## T. Metric integrity
Pending specific execution evidence; do not infer PASS from code inspection.

## U. Revenue attribution
Pending specific execution evidence; do not infer PASS from code inspection.

## V. Test environment
Disposable pgvector PostgreSQL 16 configured via `.github/workflows/task032-checkout-first.yml`.

## W. Test implementation
`Backend/src/tests/task032CheckoutFirst.integration.js` contains 12 grouped assertions, representing a subset of the 60 contract cases.

## X. Test execution
CI run not yet observed. No assertion is certified PASS before execution.

## Y. Validation matrix
See per-case statuses below.

## Z. Product defects
Pending specific execution evidence; do not infer PASS from code inspection.

## AA. Test defects
Pending specific execution evidence; do not infer PASS from code inspection.

## AB. Findings
Pending specific execution evidence; do not infer PASS from code inspection.

## AC. Dependencies
Pending specific execution evidence; do not infer PASS from code inspection.

## AD. Limitations
Many matrix cases lack dedicated executable assertions; full contract not certified.

## AE. Final status
PARTIAL pending CI, remaining scenarios, and defect triage.

## AF. Version control
Branch contains test, CI and documentation only. No merge or deployment authorized.

### TC032-01–60 acceptance ledger

| Case | Status | Evidence / outstanding work |
|---|---|---|
| TC032-01 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-02 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-03 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-04 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-05 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-06 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-07 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-08 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-09 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-10 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-11 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-12 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-13 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-14 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-15 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-16 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-17 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-18 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-19 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-20 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-21 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-22 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-23 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-24 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-25 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-26 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-27 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-28 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-29 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-30 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-31 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-32 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-33 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-34 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-35 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-36 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-37 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-38 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-39 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-40 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-41 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-42 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-43 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-44 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-45 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-46 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-47 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-48 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-49 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-50 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-51 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-52 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-53 | NOT RUN | Grouped isolated assertion authored; await CI execution |
| TC032-54 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-55 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-56 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-57 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-58 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-59 | NOT RUN | Dedicated acceptance coverage not yet implemented |
| TC032-60 | NOT RUN | Dedicated acceptance coverage not yet implemented |

No production credentials, merchant records, Shopify state or deployment modified. Do not begin Task033 before Task032 closure.
