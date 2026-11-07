# Task 202 — validation record

Date: 2026-11-07. Branch: `arena/603881e0-revluma`.

## Local behavioral evidence

The focused fixture suite verifies:

- arbitrary rolling N-day periods, named/current quarters and months, partial metadata and equal-elapsed non-overlapping comparisons;
- rejection of future and reversed ranges;
- authorized direct finding lookup, source-run provenance and bounded underlying orders;
- resolved, stale and missing findings not being represented as current problems;
- product identity, distinct variants, per-location quantities, historical order lines and finding references;
- missing inventory not becoming an out-of-stock claim and ambiguous names not selecting an arbitrary product;
- organization predicates on every finding/product query;
- Node verified/unverified timezone context and explicit fallback disclosure;
- order comparisons no longer failing because AOV evidence and measurement amounts disagree.

Full local Python result: **1620 passed, 11 skipped**. Full Backend result: **80 test files passed**. These are local results with synthetic fixtures/mocks, not production verification. The Backend run used an uncommitted local Prisma import shim because engine download is blocked.

## Disposable PostgreSQL coverage

`python/tests/test_task_202_evidence_postgres.py` creates an isolated schema with two organizations, identical external product identifiers and separate findings. It executes the real SQL for direct finding authorization, cross-tenant rejection, supporting orders, product/variant/inventory joins, synchronization coverage and order-line aggregation. It requires CI's disposable PostgreSQL service; a local skip is not database evidence.

## Production acceptance still required

After merge and deployment, record the deployed revisions and execute authenticated read-only checks on `revluma-test-store-v1.myshopify.com` for:

1. a latest/current finding and a direct finding UUID, including lifecycle, evidence lineage and limitations;
2. a product/variant response and an inventory response that preserve missing-coverage semantics;
3. rolling, current-quarter and previous-period questions with correct half-open merchant-timezone windows and non-overlapping comparisons;
4. explicit fallback behavior if the persisted timezone is unavailable;
5. no cross-tenant/reference leakage, merchant writes or unsupported causal language.

No production success is claimed in this local record. The retired store must not be used.
