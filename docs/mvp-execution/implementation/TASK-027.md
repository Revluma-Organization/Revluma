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
PENDING GitHub Actions validation; report to be updated with observed runs and results.

## Z. Validation matrix
See matrix of 42 scenarios; 40 runnable tests and two conditional NOT APPLICABLE cases pending evidence.

## AA. Performance review
Ownership query where store_id+abandoned_cart_id take:2; recommend dedicated composite index after production cardinality audit if needed; lock serializes checkout-specific claims, not all merchants.

## AB. Findings
REV-FIND-027-01 (CRITICAL): existing orders.abandoned_cart_id allowed competing claims; guarded in application with advisory lock, CI pending. REV-FIND-027-02 (MEDIUM): no verified live Shopify exception/cardinality and no live historical duplicate aggregate; no blanket unique constraint. REV-FIND-027-03 (MEDIUM): direct SQL/other writers can bypass advisory-lock protocol; requires cross-writer audit before production readiness.

## AC. Future dependencies
Task028 identifier provenance; Tasks029–030 lifecycle; Task048 logs; Task049 full regression; production review of cardinality and legacy data before any future unique migration.

## AD. Limitations
No real paired Shopify checkout/order evidence; no production aggregate counts; cannot prove exception absence; application-level lock protocol does not protect bypassing writers.

## AE. Final status
PARTIAL — implementation pending isolated CI; NOT DEPLOYED.

## AF. Version control and deployment
PR pending; stacked on Task026 #221, Task025 #220, Task024 #219. No merge, deploy, production migration, merchant writes or Shopify mutation.

| Test ID | Scenario | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|
| TC027-01 | First verified checkout claim | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-02 | Same order repeats claim | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-03 | Distinct order second claim | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-04 | Duplicate created event | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-05 | Updated event | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-06 | Historical same order | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-07 | Historical distinct order | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-08 | Concurrent identical | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-09 | Concurrent different | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-10 | Preexisting ownership | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-11 | Ownership race | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-12 | Duplicate internal order representation | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-13 | Distinct authoritative Shopify orders | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-14 | Shared email | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-15 | Shared customer ID | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-16 | Shared amount | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-17 | Shared timestamp | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-18 | Shared coupon | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-19 | Shared cart token | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-20 | Checkout token collision | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-21 | Checkout ID collision | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-22 | Cross merchant checkout rejected | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-23 | Same external ID across merchants | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-24 | Forged merchant context | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-25 | Existing claim preserved | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-26 | Rejected order preserved | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-27 | Conflict recorded | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-28 | Conflict idempotency | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-29 | Transaction rollback | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-30 | Database lock enforced | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-31 | Fresh database session | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-32 | No false checkout completion | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-33 | No duplicate checkout attribution | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-34 | Order revenue preserved | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-35 | Historical replay repeated | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-36 | Order first | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-37 | Checkout first | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-38 | Missing identifier | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-39 | Conflicting identifiers | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-40 | Existing invalid historical claims detected | Safe ownership enforcement | Pending execution | GitHub Actions Task027 | NOT RUN |
| TC027-41 | Legitimate cardinality exception | Safe ownership enforcement | Not applicable pending verified exception or new migration | No verified exception/new migration | NOT APPLICABLE |
| TC027-42 | Production migration compatibility | Safe ownership enforcement | Not applicable pending verified exception or new migration | No verified exception/new migration | NOT APPLICABLE |
