# REVLUMA — TASK 024: Persist verified order-to-checkout relationship

## A. Task identification
Task 024/406; Phase 1 Reliable Data Foundation; Workstream 1B; CRITICAL backend implementation. Date 2026-10-30. Branch `fix/mvp-task-024-verified-checkout-order-persistence`. Baseline `main` source service blob `0a042e3f61aee62cbca84e05938e606036394f50`; baseline main commit from prior audits `8349de91cdaeff8b786ccc5f3ba0286c5b9f5a0b` (not freshly resolved). Implementation commits `f5f8abd643c664747529f9ae59f468bf871bfbd2`, `30758e40b26e393c66bf9a25a7296c9eec8d3e36`; final documentation SHA pending. Production SHA unverified; NOT DEPLOYED.

## B. Previous evidence reviewed
Locked backlog Task 024, central README, audit register, implementation decisions, source `commerceWebhookService.js`, Prisma models, prior Task 022 test harness and Task 023 integration failures. Earlier Tasks 017–019 documented ambiguous identifier matches; Task 023 PR #218 documented 21/35 coupon fallback safety failures, including verified-FK reassignment REV-FIND-023-05. Earlier reports 001–021 were not all individually fetched in this run; no fabricated review claim. Main audit register may not reflect earlier open unmerged PRs.

## C. Initial implementation state
Existing `upsertOrder` performed merchant-scoped `abandoned_carts.findFirst` for three identifiers, chose most recent of potentially conflicting candidates, fell back to `sequence_sends.metadata.discount_code`, and wrote order FK and checkout `status:'recovered'` plus `recovery_status:'recovered'`. No guard against reassigning an existing order FK. Existing Prisma FK already persisted relationship but not safely.

## D. Existing Prisma relationship structure
`orders.id UUID PK`, `orders.store_id UUID`, `orders.external_order_id String`, `orders.abandoned_cart_id UUID?` FK to `abandoned_carts.id`, `orders.session_id String?`, `orders.recovery_status String?`; `@@unique([store_id,external_order_id])`. `abandoned_carts.id UUID PK`, `store_id UUID`, `external_cart_id String?`, `session_id String?`, `status String?`, `recovered_at DateTime?`; nonunique `@@index([store_id,external_cart_id])`. No separate relationship table or checkout order FK; multiple orders can reference one checkout (Task 027), and DB FK alone does not enforce same-store (application check required). Checkout may exist without order; order FK nullable supports order-first. Checkout deletion behavior depends on Prisma default referential action; no migration created.

## E. Persistence contract
Persist only one unique same-store authoritative checkout identifier candidate. No coupon/email/customer/amount/time-only FK. Existing FK may not be silently reassigned. Compare-and-set conditional `orders.updateMany({where:{id,store_id,abandoned_cart_id:null}})` guarantees no overwrite; retry reads existing FK and accepts only identical value. FK persists in PostgreSQL and is retrievable by fresh Prisma session. Persistence itself must not alter checkout lifecycle or claim recovered revenue. Entire `upsertOrder` transaction atomic.

## F. Matching evidence requirements
The current checkout table stores one source identifier `external_cart_id`, chosen from checkout payload `checkout_id || id || cart_token || checkout_token`; order identifiers `checkout_id`, `checkout_token`, `cart_token` are treated as exact strings without JS Number conversion. Distinct IDs are queried together. **Only exactly one matching checkout row is accepted; 0 or 2+ results do not persist.** This is a conservative guard, not a proof of source-namespace equivalence. Exact Shopify checkout-token/cart-token provenance remains incomplete (Task 028). Conflicting authoritative evidence with only one candidate cannot always be detected; Task 026 owns comprehensive conflict detection. No token uniqueness inferred from index.

## G. Selected design
Reuse existing FK; no migration. Alternatives rejected: new relationship table (unnecessary), coupon-based ranking (unsafe), unconditional update (races), DB-wide uniqueness on checkout FK (Task 027 scope and possible existing data). Atomic compare-and-set and single transaction selected. Rollback: revert application commit; no schema rollback. Previously incorrect FKs are not automatically repaired.

## H. Implementation details
`Backend/src/services/commerceWebhookService.js`, `upsertOrder`: replaced `findFirst` and coupon fallback with merchant-scoped `findMany(take:2)`, unambiguous single candidate, atomic `updateMany` with null-FK guard, explicit `CHECKOUT_RELATIONSHIP_CONFLICT` on attempted reassignment. Removed independent checkout status/recovered-at and order recovered attribution mutation from persistence. Preserved existing order `recovery_status` on subsequent upsert rather than forcing `completed`. Existing customer/order items processing unchanged.

## I. Merchant isolation
Query `abandoned_carts` with persisted `store_id`; conditional update `orders` with persisted `store_id`. Candidate checkout's persisted store is selected, not caller-supplied unchecked ID. Cross-store identifiers are not eligible.

## J. Idempotency
If order FK already equals candidate ID, skip FK rewrite and return without conflict. Duplicate order external ID uses existing `@@unique([store_id,external_order_id])` upsert.

## K. Concurrency safety
PostgreSQL conditional `updateMany` is a single compare-and-set statement, not read-then-unconditional-write. Competing candidates cannot both overwrite FK. Concurrent identical upserts may experience unrelated Prisma transaction serialization/write conflicts; test evidence required before claiming retry robustness.

## L. Transaction safety
All order/customer/items/FK changes occur in existing Prisma `$transaction`; explicit conflict throws, rolling back transaction. No dual relationship field updates; FK is authoritative.

## M. Historical sync compatibility
Existing `upsertOrder` reusable by historical ingestion, no new queue. Order-first remains null until an existing order-processing path replays after checkout arrives; no automatic order-first reconciliation scheduler (Task 025/028/031/045). Existing persisted FK preserved on subsequent upserts.

## N. Migration details
No Prisma schema changes, migration or production database writes. Existing FK reused.

## O. Existing data compatibility
No existing merchant rows altered. Existing weak-signal links are not automatically identified or corrected. Same-store cannot be enforced at DB FK level without additional schema design; current writes enforce merchant-scoped lookup. Existing duplicate `external_cart_id` records result in no new association.

## P. Test environment
GitHub Actions Node 22 + disposable pgvector PostgreSQL 16 on localhost DB `task024`; `TASK024_ISOLATED_DB=true`; `npm ci`, `CREATE EXTENSION vector`, `npx prisma db push --skip-generate --accept-data-loss` **only on disposable database**, `node src/tests/task024VerifiedPersistence.integration.js`. No Shopify or production DB connection.

## Q. Test execution
PENDING CI — do not infer PASS from source inspection.

## R. Persistence validation matrix
| Test | Scenario | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|
| TC024-01 | Exact checkout ID | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-02 | Checkout token | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-03 | Cart token | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-04 | Missing checkout | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-05 | Missing order | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-06 | Order-first arrival | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-07 | Checkout-first arrival | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-08 | Duplicate persistence | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-09 | Duplicate webhook | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-10 | Concurrent identical writes | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-11 | Concurrent conflicting writes | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-12 | Cross-merchant | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-13 | Forged merchant | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-14 | Email-only | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-15 | Customer-only | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-16 | Amount-only | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-17 | Time-only | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-18 | Coupon-only | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-19 | Combined weak | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-20 | Subsequent updates | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-21 | Historical reimport | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-22 | Transaction failure | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-23 | Fresh session durability | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-24 | Conflicting authoritative evidence | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-25 | Lifecycle isolation | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |
| TC024-26 | Revenue attribution isolation | Required safety behavior | PENDING CI | GitHub Actions | NOT RUN |

## S. Performance review
One indexed store/external-ID `findMany(take:2)`, conditional order PK update; avoids sequence-send JSON scan. No new index. At most two rows fetched to identify ambiguity. Existing order/customer upsert and item queries remain unchanged.

## T. Failure handling
Conflicting FK throws `CHECKOUT_RELATIONSHIP_CONFLICT`; transaction rollback. No PII in error string. DB failures propagate, not silently claimed successful. Full transient failure retries not added.

## U. Findings
REV-FIND-023-01 coupon-only unsafe FK: **RESOLVED — CODE** on this branch; verification pending. REV-FIND-023-02 arbitrary coupon candidate: **RESOLVED — CODE** on this branch; verification pending. REV-FIND-023-05 verified-FK reassignment: **RESOLVED — CODE** on this branch; verification pending. REV-FIND-017-01/02 ambiguous and conflicting identifier evidence: **PARTIALLY ADDRESSED IN CODE**; comprehensive policy Task 026 remains OPEN. REV-FIND-018-01 checkout-token provenance and REV-FIND-019-01 identifier slot loss: OPEN Task 028. No false claim of live merchant incident or production remediation.

## V. Future dependencies
Task 025 unresolved relationship recording; Task 026 conflicting authoritative matches; Task 027 multiple orders claiming one checkout; Task 028 source identifier provenance; Tasks 029/030 checkout lifecycle; Tasks 046/047 attribution semantics; Task 049 regression. None started.

## W. Limitations
Synthetic test fixtures do not prove real Shopify ID namespace equivalence; source checkout stores one identifier; no production revision alignment; no live merchant data audit; no complete concurrent webhook replay infrastructure validation. Existing historical false relationships remain untouched. Checkout-token match only if its value equals stored external_cart_id; no new source token fields introduced.

## X. Final status
**PARTIAL — IMPLEMENTED, TEST VERIFICATION PENDING — NOT DEPLOYED.** Update only after actual CI evidence.

## Y. Version control
Branch `fix/mvp-task-024-verified-checkout-order-persistence`, PR pending; commits listed in A. Test file `Backend/src/tests/task024VerifiedPersistence.integration.js`; workflow `.github/workflows/task024-verified-persistence.yml`; report and central audit register.

## Z. Deployment status
**NOT MERGED, NOT DEPLOYED.** No production DB changes, Shopify mutations, migrations or release authorization.
