# REVLUMA — TASK 020: Reject matches based only on customer identity

## A. Task identification
Task 020 of 406; Phase 1 Reliable Data Foundation, Workstream 1B Checkout/Order Integrity. 2026-10-30. Repository `Revluma-Organization/Revluma`; inspected main-based branch `test/task-020-customer-identity-rejection`; base main commit `8349de91cdaeff8b786ccc5f3ba0286c5b9f5a0b` as recorded by Task 019 PR, **not independently verified current production revision**. Inspected service blob `0a042e3f61aee62cbca84e05938e606036394f50`; schema blob `61b1754fa05dde437a262a6d9fc9cbbe7b8bbbd7`. Shopify API 2026-10 from prior engineering records, not reverified live. Node 22 CI; Prisma ^6.19.3; pgvector PostgreSQL 16.

## B. Previous evidence reviewed
Main: `docs/mvp-execution/README.md`, `audit-register.md`, `implementation-decisions.md`. Task 019 report from separate unmerged branch `test/task-019-cart-token-validation`, real PostgreSQL 15 PASS / 5 FAIL; inherited REV-FIND-017-01/02 and REV-FIND-018-02. Tasks 013–014 sanitized Shopify payload evidence referenced via Task 019, **not independently recovered raw paired customer ID evidence**. Reports 001–019 on multiple separate unmerged branches; missing reports are **REPORT UNAVAILABLE — PRIOR EXECUTION NOT VERIFIED**, not reconstructed or claimed reviewed. Prior Task 020 test coverage not found in main branch's known Task 019-only suite; full repository-wide search not established.

## C. Customer identity semantics
Shopify `payload.customer.id` and `payload.customer_id` are customer-identity input hints used by `customerData()` to produce external customer ID. They are **not** checkout IDs, checkout tokens, cart tokens, or order IDs. The internal `customers.id` is a store-scoped UUID. Checkout `payload.id` is an external checkout identifier; order `payload.id` is an external order identifier. Checkout customer may be null (guest). Backend synthesizes customer external ID `order:${payload.id}` for orders lacking a Shopify customer ID, and synthetic redacted email if missing. No actual customer PII recorded. Per-topic Shopify customer-ID presence/null counts and equivalence between correlated real Shopify order/checkout records **UNVERIFIED**.

| Field | Source | Meaning | Nullable | Actual backend usage | Evidence |
|---|---|---|---|---|---|
| `customer.id` | order/checkout payload | Shopify customer identity candidate | Yes | `customerData` → store-scoped `customers.external_id` | source `commerceWebhookService.js` |
| `customer_id` | payload | alternate customer identity candidate | Yes | fallback in `customerData` | source |
| `customers.id` | database | internal customer UUID | No | order FK, optional cart FK | Prisma schema |
| `checkout_id`, `checkout_token`, `cart_token` | order | checkout/cart identity candidates | Yes | exact `external_cart_id` lookup | source |

## D. Database representation
`customers`: `id` UUID PK; `store_id` UUID FK; `external_id` String; `@@unique([store_id,external_id])`; email indexed, not globally unique. `abandoned_carts`: `store_id`, optional `customer_id` UUID FK, optional `external_cart_id`, status, `recovered_at`; `@@index([store_id,external_cart_id])` nonunique. `orders`: `store_id`, required `customer_id` UUID FK, optional `abandoned_cart_id` UUID FK, `recovery_status`; unique store+external_order_id. One customer can own multiple orders/checkouts. Multiple internal customers with equivalent profile email are permitted if external IDs differ; uniqueness is on store/external_id. No schema changes.

## E. Existing customer matching logic
`upsertOrder` in `Backend/src/services/commerceWebhookService.js` calls `customerData`, upserts a customer, then upserts order by `(store_id,external_order_id)`. Checkout association uses only `[payload.checkout_id,payload.cart_token,payload.checkout_token]` filtered nonblank, `abandoned_carts.findFirst({store_id,external_cart_id:{in:identifiers}},orderBy:{updated_at:'desc'})`. If no match and coupon code exists, a sequence-send discount metadata fallback can locate a cart by ID, scoped to store. **CUSTOMER-ONLY MATCHING NOT IMPLEMENTED in inspected order reconciliation function**; customer FK is assigned to order but not used in cart lookup. `upsertAbandonedCart` assigns optional customer FK and selects checkout by external ID. The absence of customer-only matching in these inspected functions is static evidence, not universal proof of every backend path.

## F. Matching priority
Exact candidate set checkout ID/cart token/checkout token is queried together without deterministic authority priority; most recently updated matching cart wins. Coupon fallback only if no identifier match and coupon exists. Customer identity **does not participate in checkout candidate selection**. Earlier conflicting-identifier and duplicate-candidate findings remain OPEN; Task 020 does not fix or re-audit them.

## G. Customer-only isolation
All TC020 tests except TC020-16/17 deliberately provide **no** `checkout_id`, `checkout_token`, or `cart_token` on orders, and use checkout `id` only to store distinct checkout rows. No discount codes, coupon fallback, email matching or product/time/amount matching algorithms are supplied. TC020-16 intentionally includes a verified `checkout_id` to prove customer identity does not override it. TC020-17 first establishes a relationship via authoritative ID then retries same order with only customer identity to test preservation. Test-only fixtures never change production logic.

## H. Test environment
GitHub Actions isolated `pgvector/pgvector:pg16` service, database `task020`, `DATABASE_URL` localhost, `TASK020_ISOLATED_DB=true` guard. Synthetic UUIDs, customer IDs, emails `.invalid`, orders, carts, merchants; cleanup by deleting test stores/org/user. No production DB, live Shopify, live webhooks, production synchronization, migration or deployment. Test workflow is branch-only and PR-triggered.

## I. Existing test coverage
Existing `Backend/src/tests/task019CartToken.integration.js` is on separate unmerged PR #214 and focuses on cart tokens, not isolated customer-only rejection. Backend Node test runner `Backend/scripts/run-tests.js` is a custom test harness; full backend regression CI is separately triggered on PR. This task adds 22 independent actual Prisma/PostgreSQL assertions.

## J. Test execution
Commands: `npm ci`; `CREATE EXTENSION vector` in disposable PostgreSQL; `npx prisma db push --skip-generate --accept-data-loss`; `node src/tests/task020CustomerIdentity.integration.js`. Actual CI run and results to append after execution.

## K. Customer identity rejection matrix
| Test ID | Scenario | Expected | Actual | Status |
|---|---|---|---|---|
| TC020-01 | Same customer no checkout ID | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-02 | Multiple checkouts same customer | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-03 | Single checkout same customer | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-04 | Previously abandoned checkout | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-05 | Mixed lifecycle states | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-06 | Repeated purchases | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-07 | Same customer and product | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-08 | Same customer and amount | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-09 | Same customer and timestamps | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-10 | Different customer IDs | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-11 | Missing customer ID | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-12 | Null customer IDs | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-13 | Guest checkout | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-14 | Customer profile changes | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-15 | Cross-merchant customer collision | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-16 | Conflicting authoritative ID | No customer-only false match/state mutation; authoritative ID takes precedence | Pending isolated CI | NOT RUN |
| TC020-17 | Existing verified relationship | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-18 | Duplicate customer records | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-19 | Repeated customer-only processing | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-20 | Abandonment safety | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-21 | Recovered revenue safety | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |
| TC020-22 | Unresolved relationship | No customer-only false match/state mutation | Pending isolated CI | NOT RUN |

## L. Merchant isolation
TC020-15 tests identical external Shopify customer ID across two stores; asserts no cross-store FK, no state mutation. DB scoping `store_id` in customer upsert and checkout lookup.

## M. Checkout lifecycle safety
`upsertOrder` marks only a matched cart `recovered` and sets `recovered_at`; no matched cart means no checkout mutation. TC020-04/05/20 explicitly assert abandonment, mixed states and timestamps remain unchanged. Task 029/030 lifecycle correctness outside customer-only scenario not audited.

## N. Revenue attribution safety
On an unmatched order, `orders.recovery_status='completed'` and `abandoned_cart_id=null`; a confirmed `recovered` classification requires matched cart in inspected path. TC020-21 asserts these persisted fields; aggregate Command Center/Rev Intelligence downstream calculations were **not independently executed** and remain a verification limitation. Do not equate `completed` order status with recovered checkout revenue.

## O. Unresolved relationship handling
An order is persisted with null `abandoned_cart_id`; no explicit unresolved reason, candidate evidence or retry queue was established in inspected path. Future Task 025 addresses tracking; no implementation in Task 020.

## P. Findings
No customer-only fallback is implemented in the inspected reconciliation function. Reuse REV-FIND-017-01/02 for existing identifier conflict/ambiguity risks, not customer-only defects. `REV-FIND-020-01` (LOW, missing production correlation verification): raw real Shopify customer ID pairing/guest prevalence and broader backend reconciliation path coverage not verified; map to Task 049 / backlog mapping required for production correlation. This is **missing verification**, not a demonstrated production defect. No new matching behavior authorized.

## Q. Future dependencies
Task 021 email-only, Task 022 amount/time-only, Task 023 coupon fallback, Task 025 unresolved tracking, Task 026 conflicting identifier resolution, Task 049 regression. These are references only; none started.

## R. Limitations
Synthetic isolated tests cannot prove all real Shopify payload variations, current production revision, or downstream metric correctness. Existing main audit register shows Tasks 015–019 NOT STARTED because reports are on unmerged branches. This task does not overwrite historical rows or claim they are merged.

## S. Final status
**IN PROGRESS** until actual isolated CI run and results verified.

## T. Changes made
Only test file `Backend/src/tests/task020CustomerIdentity.integration.js`, test-only workflow `.github/workflows/task020-customer-identity.yml`, this report and audit register. No production logic/schema/infra changes.

## U. Version control
Branch `test/task-020-customer-identity-rejection`; PR and final commit to append. No merge/deploy.
