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

## Executed production checks and remaining failures

After PR #342 merged, Vercel `dpl_GuP1yWh2N8re7rEXkbf57sUTmYxc` became READY/PROMOTED at `6f37978f`. Read-only Supabase queries verified the active store profile (`America/New_York`, USD), 17 completely acquired products, 26 variants and three locations, and four Gift Card variants with separate inventory item IDs and per-location quantity objects. The store had no findings and no inventory-item/inventory-level domain-ledger rows. No merchant writes or fixtures were introduced.

Backend `/ready` was reachable and reported database/Python readiness, but `node_build=ade43ca96a71` does not include Task 202. Python SHA is not exposed. An authenticated Rev request path could not be exercised with the available connections. Therefore the production acceptance list above is **not satisfied**: deployed backend/Python revisions, direct/latest finding behavior, Rev product/inventory answers, real request-path temporal comparisons and tenant isolation remain unverified. CI's real PostgreSQL test is database integration evidence, not production verification.
