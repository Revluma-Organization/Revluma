# REVLUMA — TASK 027: Prevent two orders from incorrectly claiming one checkout

## A. Task identification
Task 027/406; Phase 1 Reliable Data Foundation; Workstream 1B; 2026-10-30; branch fix/mvp-task-027-checkout-order-ownership; baseline Task026 documentation commit 9ab3f2824efdc6903929aad6f7158a95e5ce71f9; production backend SHA not verified.

## B. Previous evidence reviewed
Reviewed TASK-024, TASK-025, TASK-026 implementation reports, schema, service and test fixtures. Older Task017–023 docs on separate unmerged branches; findings retained by stable IDs.

## C. Initial implementation state
Task026 allowed two distinct orders to link the same abandoned_carts row: orders.abandoned_cart_id not unique; no checkout-owner query or shared atomic lock.

## D. Shopify cardinality evidence
Source Shopify checkout_id and order.id are distinct identity fields; repeated order webhooks reuse the same order ID. Real captured paired Shopify payloads and legitimate exception investigation not sufficient to prove universal strict one-to-one. Adopt conservative non-destructive single-active-claim policy without imposing a blanket unique index. Exceptions require verified evidence and future explicit review.

## E. Order identity
orders external_order_id scoped by store_id unique; repeated events upsert same row. Two local rows with distinct external IDs cannot be proven equivalent; preserve both, reject duplicate physical FK.

## F. Checkout identity
abandoned_carts.id UUID, store_id UUID, external_cart_id optional indexed. Checkout token/cart token not separately persisted (Task028).

## G. Relationship ownership contract
Only an unambiguous Task024/026 candidate may claim; only one physical order FK per checkout accepted by this writer; existing claims preserved; second order recorded as conflict, order retained, no checkout lifecycle or recovery mutation.

## H. Existing Prisma structure
Prisma orders: @@unique([store_id,external_order_id]); abandoned_cart_id nullable UUID FK, NOT unique; abandoned_carts has orders[]; @@index([store_id,external_cart_id]); Task025 case unique store/order.

## I. Existing claim processing
Shopify webhook/historical upsert uses commerceWebhookService.upsertOrder; same service path for retries; no separate new entry point.

## J. Implementation design
PostgreSQL transaction-scoped advisory lock keyed stable checkout UUID using hashtextextended, then merchant-scoped ownership query, then existing Task024 compare-and-set; avoid unverified global uniqueness migration.

## K. Implementation changes
Backend/src/services/commerceWebhookService.js candidate branch; Backend/src/tests/task027Ownership.integration.js; .github/workflows/task027-ownership.yml; report/audit/decision.

## L. Database constraints
No new unique constraint because live Shopify cardinality and historical duplicates not verified. Advisory lock serializes this writer; existing DB FK and Task024 compare-and-set remain. Direct SQL/other writers could bypass advisory lock; documented limitation.

## M. Merchant isolation
Candidate verified with store_id; owner lookup store-scoped; cross-store collisions permitted as distinct merchants.

## N. Idempotency
Same store/external_order_id upserts one logical row; existing FK retained, no new claim.

## O. Concurrency safety
pg_advisory_xact_lock(hashtextextended(checkout_uuid::text,0)) held until transaction end; checkout ownership rechecked after acquiring lock. Hash collisions serialize extra work but do not weaken safety.

## P. Transaction safety
Ownership lookup and order FK CAS in same transaction. A thrown database error rolls back; not silently reclassified as conflict.

## Q. Conflict detection integration
Rejected second order recorded as CONFLICTING_IDENTIFIERS, reusing Task026 classification.

## R. Unresolved recording integration
Task025 recordOrderReconciliationCase called with preserveConflict true; one case per store/order, safe identifier digest only.

## S. Historical synchronization
Same upsertOrder path for historical sync and webhooks; no automatic cleanup.

## T. Checkout lifecycle safety
No checkout status or recovered_at writes in claim branch; existing independent Shopify completion evidence untouched.

## U. Revenue attribution safety
No recovered attribution writes. Rejected order's total remains in orders; checkout-attributed FK count remains one for new claims.

## V. Migration details
No migration; blanket unique index explicitly deferred pending real Shopify cardinality and production existing-data inspection.

## W. Existing data compatibility
Existing invalid multi-claims are not deleted. New candidate cannot be claimed if any other order currently owns it; no arbitrary repair.

## X. Test environment
Disposable localhost PostgreSQL pgvector16, Node22, Prisma; synthetic stores and orders; TASK027_ISOLATED_DB guard.

## Y. Test execution
PASS — VERIFIED in isolated PostgreSQL 16.15: Task027 run 40990349650 job 123850964201, 40 PASS/0 FAIL. Initial run 40990251230 was 6 PASS/34 FAIL due Prisma inability to deserialize PostgreSQL void return from pg_advisory_xact_lock; fixed by explicit ::text cast. Backend tests run 40990349597 SUCCESS, backend refresh run 40990349580 SUCCESS. Inherited Task025 run 40990349608, 28/28 PASS; Task026 run 40990349624, 40/40 PASS.

## Z. Validation matrix
40/40 runnable synthetic scenarios TC027-01..40 PASS in isolated PostgreSQL, GitHub Actions run 40990349650 job 123850964201. TC027-41 NOT APPLICABLE: no verified Shopify exception. TC027-42 NOT APPLICABLE: no new migration; production cardinality audit still pending.

## AA. Performance review
Ownership query where store_id+abandoned_cart_id take:2; recommend dedicated composite index after production cardinality audit if needed; lock serializes checkout-specific claims, not all merchants.

## AB. Findings
REV-FIND-027-01 (CRITICAL): existing orders.abandoned_cart_id allowed competing claims; guarded in application with advisory lock, RESOLVED — VERIFIED in isolated PostgreSQL, NOT DEPLOYED. REV-FIND-027-02 (MEDIUM): no verified live Shopify exception/cardinality and no live historical duplicate aggregate; no blanket unique constraint. REV-FIND-027-03 (MEDIUM): direct SQL/other writers can bypass advisory-lock protocol; requires cross-writer audit before production readiness.

## AC. Future dependencies
Task028 identifier provenance; Tasks029–030 lifecycle; Task048 logs; Task049 full regression; production review of cardinality and legacy data before any future unique migration.

## AD. Limitations
No real paired Shopify checkout/order evidence; no production aggregate counts; cannot prove exception absence; application-level lock protocol does not protect bypassing writers.

## AE. Final status
**PARTIAL — IMPLEMENTED AND VERIFIED IN ISOLATED POSTGRESQL; NOT DEPLOYED.** 40/40 Task027 tests passed, backend and refresh tests successful. Full production-ready PASS withheld: actual Shopify cardinality exceptions, production historical claims, and non-participating writers remain unverified; no DB unique constraint applied.

## AF. Version control and deployment
PR #222 OPEN, implementation commit 47c2b96117adce490774937e52a0502d035a1eae and test commit 478fd71906fa030e4bf75b8c9242107ac75fef26; stacked on Task026 #221, Task025 #220, Task024 #219. No merge, deploy, production migration, merchant writes or Shopify mutation.

| Test ID | Scenario | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|
| TC027-01 | First verified checkout claim | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-02 | Same order repeats claim | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-03 | Distinct order second claim | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-04 | Duplicate created event | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-05 | Updated event | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-06 | Historical same order | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-07 | Historical distinct order | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-08 | Concurrent identical | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-09 | Concurrent different | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-10 | Preexisting ownership | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-11 | Ownership race | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-12 | Duplicate internal order representation | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-13 | Distinct authoritative Shopify orders | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-14 | Shared email | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-15 | Shared customer ID | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-16 | Shared amount | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-17 | Shared timestamp | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-18 | Shared coupon | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-19 | Shared cart token | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-20 | Checkout token collision | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-21 | Checkout ID collision | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-22 | Cross merchant checkout rejected | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-23 | Same external ID across merchants | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-24 | Forged merchant context | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-25 | Existing claim preserved | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-26 | Rejected order preserved | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-27 | Conflict recorded | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-28 | Conflict idempotency | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-29 | Transaction rollback | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-30 | Database lock enforced | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-31 | Fresh database session | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-32 | No false checkout completion | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-33 | No duplicate checkout attribution | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-34 | Order revenue preserved | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-35 | Historical replay repeated | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-36 | Order first | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-37 | Checkout first | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-38 | Missing identifier | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-39 | Conflicting identifiers | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-40 | Existing invalid historical claims detected | Safe ownership enforcement | PASS | Run 40990349650 job 123850964201 | PASS |
| TC027-41 | Legitimate cardinality exception | Safe ownership enforcement | Not applicable pending verified exception or new migration | No verified exception/new migration | NOT APPLICABLE |
| TC027-42 | Production migration compatibility | Safe ownership enforcement | Not applicable pending verified exception or new migration | No verified exception/new migration | NOT APPLICABLE |

## Observed CI evidence and qualification
- Initial run 40990251230: 6/40 passed, 34 failed because Prisma cannot deserialize the PostgreSQL void return of pg_advisory_xact_lock. Fixed with explicit ::text cast in code and isolated rollback test.
- Final Task027 run 40990349650, job 123850964201: TASK027_SUMMARY={"passed":40,"failed":0,"total":40}. Each of 40 individual scenario IDs passed.
- Backend tests run 40990349597 SUCCESS; backend refresh regression 40990349580 SUCCESS.
- Inherited Task025 run 40990349608 28/28 PASS; Task026 run 40990349624 40/40 PASS. Total 108/108 isolated integration cases across three suites.
- Race tests assert at most one accepted physical FK; they do not guarantee both concurrent requests always complete without a transient retry. Transaction retry policy is a production limitation, not a hidden PASS.
- Existing historical double claims are seeded and detected without deletion in TC027-40; live production aggregate counts have not been read.
- A direct database writer bypassing advisory locks could still create a second FK because schema has no uniqueness on abandoned_cart_id; production-grade universal enforcement requires verifying Shopify cardinality, live duplicates and all writer paths before considering an index.

## Production read-only audit — 2026-10-30
- Source: Supabase project Revluma-Database (eu-west-1), read-only SQL via execute_sql. No row-level customer or token values extracted.
- Production schema: orders.abandoned_cart_id nullable UUID; abandoned_carts.external_cart_id text; Task025 reconciliation-case table absent because PRs #219–#222 unmerged.
- Live counts: orders 5; linked orders 3; checkouts 26; checkout IDs referenced by >1 order **0**; duplicate (store_id, external_order_id) order groups **0**; cross-store order→checkout FK **0**; duplicate (store_id, external_cart_id) checkout groups **5**, 10 rows total, max group size 2. All five groups in test store 3ed79446-cb6d-4a1c-b174-9ec1ab91fe15. These are distinct checkout-row duplicates, not duplicate order ownership. No production data modified.
- Writer search: GitHub default-branch code search for abandoned_cart_id, upsertOrder and orders.update, plus full stacked-branch inspection of Backend/src/services/commerceWebhookService.js, Backend/src/services/shopifySync.js, Backend/src/controller/commerceWebhookController.js, Backend/src/services/trainingObservationService.js and Backend/src/services/recoveryActionService.js. Checkout FK writer found in upsertOrder; shopifySync imports/calls it, webhook processor invokes it; cancellation only changes recovery_status. No second active FK writer identified in examined code. Search coverage is not a runtime audit of out-of-repo jobs, direct SQL or manually executed scripts.
- Shopify official documentation: 2026-04 breaking change removed checkout.id from checkouts/create/update and order.checkout_id from orders/create/updated etc.; Shopify says correlate checkout.token with order.checkout_token. See https://shopify.dev/changelog/posts/removed-checkout-id-from-checkouts-and-orders-webhooks . The Shopify split-carts guide describes one order with multiple fulfillment orders, **not** multiple orders per checkout: https://shopify.dev/docs/apps/build/orders-fulfillment/split-carts . Official docs do not establish a universal database-level one-checkout/one-order invariant for all order creation modes.
- Production has only 3 linked orders; no verified live multi-order checkout example, but absence in this small sample cannot prove none are legitimate. No authenticated Shopify API checkout/order pair fetched or new controlled purchase made.
- Enforcement decision: retain transaction-scoped advisory-lock and existing-FK CAS policy in PR #222; **do not add a blanket unique index** on orders.abandoned_cart_id without stronger verified cardinality evidence and review of all possible direct writers. A unique index would make ownership universal but may reject a legitimate exception; the application-level protocol covers participating writers only. The 5 duplicated checkout identifiers require Task028 provenance/dedup analysis.
- Task027 disposition: **PARTIAL — code and 108/108 tests verified, production read-only audit and repository writer inspection completed; full real Shopify cardinality and bypass-writer exclusion NOT VERIFIED**. Do not mark FULL PASS or imply deployed. Task028 may proceed as identifier provenance is the explicit dependency for the remaining real-world validation.

## Additional live Shopify and database-access verification — 2026-10-30
- Connected Shopify Admin store was explicitly verified as revluma-test-store-v1.myshopify.com. Read-only GraphQL schema introspection, validation and Admin query returned three orders (names #1001, #1002, #1004), each with distinct checkoutToken; two with cartToken. Eight abandonedCheckout Admin objects returned, but this API object does not expose checkout.token, so these are NOT authenticated matched checkout/order pairs. No order/customer/token secrets stored in this report.
- Read-only Supabase comparison against the connected test store's 26 checkout records: 0 external_cart_id exact matches to the three Shopify order checkoutToken values; 2 exact matches to two Shopify order cartToken values. Eight stored identifiers numeric; none 32 characters long. This demonstrates the current checkout identity field is insufficient for authoritative checkout-token pairing. Task028 is required to preserve source-specific identifiers and establish a real matched pair. Do not claim full Shopify cardinality verification.
- Production DB orders table: no user-defined triggers observed; relrowsecurity=true, relforcerowsecurity=true. UPDATE column grants for abandoned_cart_id include anon, authenticated, service_role and postgres. One orders_tenant_isolation RLS policy applies ALL to public roles and scopes by app.current_org_id() through stores.organization_id; with_check is null, which uses USING for applicable writes. These grants and policies alone do not prove a bypass, but they do mean a categorical claim of no external writer is unjustified. Repository search found only upsertOrder as active application FK writer in examined code; cannot rule out external service-role or direct SQL writers.
- Critical completion boundary: Task027 remains **PARTIAL**. Real Shopify orders and abandoned checkouts were inspected, but authoritative checkout.token↔order.checkoutToken pairs cannot be established with current persisted identifiers, and external privileged SQL writers cannot be exhaustively excluded. Neither missing fact can be truthfully marked FULL PASS. A database-level uniqueness constraint is deferred until verified cardinality; no production mutations were made.
