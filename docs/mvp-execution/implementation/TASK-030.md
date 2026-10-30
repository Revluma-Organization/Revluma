# TASK 030 — Prevent delayed checkout events reopening completion
**Date:** 2026-10-30 | **Phase:** 1 | **Workstream:** 1B | **Baseline:** main 858b0343d3faea4a34c80cd5979a84157113963c | **Branch:** fix/mvp-task-030-delayed-checkout-event-protection | **Production:** baseline only; TASK030 NOT DEPLOYED.

## A–D. Scope, reviewed evidence, baseline, writers
Reviewed docs/mvp-execution/implementation/TASK-024.md through TASK-029.md and the checkoutInactivity.js, commerceWebhookService.js and shopifySync.js implementation. Full reports 001–023 and all register historical entries require separate comprehensive review.
| Writer | Trigger | Lifecycle fields | Existing guard / current Task030 change |
| --- | --- | --- | --- |
| upsertAbandonedCart | checkout-created / updated via processCommerceWebhook | status, recovered_at, updated_at, abandoned_at, source identifiers | nextCheckoutStatus preserves recovered; existing source-time stale check; Task030 shared UUID advisory lock + monotonic updated_at |
| upsertOrder | order-created / updated | status recovered, recovered_at | Task029 merchant-scoped updateMany, Task027 UUID advisory lock |
| shopifySync | historical Shopify GraphQL checkouts and orders | delegates to upsertAbandonedCart/upsertOrder | same Task030 guard |
| abandonment classification | time-based pending-to-abandoned eligibility | downstream classification | review outstanding: verify exact query and writer before acceptance |
| cancelOrder | cancellation | order state | separate order logic; inspect before full acceptance |
No new webhook infrastructure or schema added.

## E–G. Timestamp and precedence
Shopify payload updated_at/created_at are resource activity times, NOT webhook receipt or delivery timestamps. lastCheckoutActivity uses payload.updated_at || updatedAt || created_at || createdAt, falling back to now for missing or invalid values. completed_at is independent completion evidence. The existing DB updated_at serves as source activity watermark; Task030 now prevents it decreasing on a delayed completion snapshot. Neither equal nor later arrival authorizes lifecycle downgrade. Verified completion (status='recovered' legacy naming) remains authoritative.

## H–P. Persistence, concurrency, and safety
The checkout upsert previously locked hashtext(store.id),hashtext(externalId), read existing, and updated by id. Order reconciliation used hashtextextended(checkout UUID,0), a different lock; concurrent read-then-write could overwrite order-established completion. Task030 first resolves the merchant-scoped checkout UUID, obtains the SAME UUID advisory transaction lock as order reconciliation, then re-reads and applies nextCheckoutStatus. Existing store/external advisory lock continues to serialize checkout creation and duplicate delivery. Locks are transaction-scoped; failed writes roll back. The completion guard remains in nextCheckoutStatus, source identifiers merged via mergeSourceEvidence; stale incomplete events return existing without changes. Non-stale independent fields can update without reopening. Existing status is preserved for missing, invalid or equal source timestamps; updated_at is monotonic. No campaign attribution, order ownership, or revenue calculations are changed.

## Q–W. Previous task compatibility, metrics, migrations
Task024–028 identity, unresolved cases, conflict checks, ownership, typed source identifiers unchanged. Task029 order completion update retained. Abandonment threshold remains 15 minutes. Completed checkouts stay outside status='abandoned' query. No migration. Historical checkout sync shares same upsert path. Real dashboard metric queries and full production Shopify lifecycle NOT YET VERIFIED. Cross-merchant scope on both identity lookup and updates retained.

## X–Z. Validation and evidence
Test environment: disposable local PostgreSQL 16 and Prisma, synthetic payloads, no production data. Added Backend/src/tests/task030DelayedEvents.integration.js and .github/workflows/task030-delayed-events.yml. 39 scenarios authored; no verified execution results yet. 11 missing scenarios remain NOT RUN. Matrix status for all 50 (never substitute authored for PASS):
| TC030-01 | AUTHORED; NOT RUN |
| TC030-02 | AUTHORED; NOT RUN |
| TC030-03 | AUTHORED; NOT RUN |
| TC030-04 | AUTHORED; NOT RUN |
| TC030-05 | AUTHORED; NOT RUN |
| TC030-06 | AUTHORED; NOT RUN |
| TC030-07 | AUTHORED; NOT RUN |
| TC030-08 | AUTHORED; NOT RUN |
| TC030-09 | AUTHORED; NOT RUN |
| TC030-10 | AUTHORED; NOT RUN |
| TC030-11 | AUTHORED; NOT RUN |
| TC030-12 | AUTHORED; NOT RUN |
| TC030-13 | AUTHORED; NOT RUN |
| TC030-14 | AUTHORED; NOT RUN |
| TC030-15 | AUTHORED; NOT RUN |
| TC030-16 | AUTHORED; NOT RUN |
| TC030-17 | AUTHORED; NOT RUN |
| TC030-18 | AUTHORED; NOT RUN |
| TC030-19 | AUTHORED; NOT RUN |
| TC030-20 | AUTHORED; NOT RUN |
| TC030-21 | NOT RUN |
| TC030-22 | NOT RUN |
| TC030-23 | AUTHORED; NOT RUN |
| TC030-24 | AUTHORED; NOT RUN |
| TC030-25 | AUTHORED; NOT RUN |
| TC030-26 | AUTHORED; NOT RUN |
| TC030-27 | NOT RUN |
| TC030-28 | AUTHORED; NOT RUN |
| TC030-29 | AUTHORED; NOT RUN |
| TC030-30 | AUTHORED; NOT RUN |
| TC030-31 | AUTHORED; NOT RUN |
| TC030-32 | AUTHORED; NOT RUN |
| TC030-33 | NOT RUN |
| TC030-34 | AUTHORED; NOT RUN |
| TC030-35 | NOT RUN |
| TC030-36 | NOT RUN |
| TC030-37 | AUTHORED; NOT RUN |
| TC030-38 | NOT RUN |
| TC030-39 | AUTHORED; NOT RUN |
| TC030-40 | AUTHORED; NOT RUN |
| TC030-41 | AUTHORED; NOT RUN |
| TC030-42 | AUTHORED; NOT RUN |
| TC030-43 | AUTHORED; NOT RUN |
| TC030-44 | NOT RUN |
| TC030-45 | AUTHORED; NOT RUN |
| TC030-46 | NOT RUN |
| TC030-47 | NOT RUN |
| TC030-48 | AUTHORED; NOT RUN |
| TC030-49 | NOT RUN |
| TC030-50 | AUTHORED; NOT RUN |
| Test | Status |
| --- | --- |
NOTE: the matrix rows above list scenario IDs and actual execution status, NOT fabricated results. CI pending.

## AA–AF. Findings, decisions, performance, limitations and release
REV-FIND-030-01 HIGH: checkout and order used different advisory locks, allowing read/write race. RESOLVED — CODE, NOT VERIFIED.
REV-FIND-030-02 MEDIUM: delayed completion could regress updated_at watermark. RESOLVED — CODE, NOT VERIFIED.
REV-FIND-030-03 HIGH: classifier, metric dependencies and full 50-scenario coverage incomplete. OPEN.
REV-DEC-0011: Share existing UUID transaction advisory lock across checkout and order mutation paths; avoid schema migration or new queue. Re-read after acquiring lock. Preserve existing source-time semantics and monotonic watermark. Alternative: unsafe pre-read or last-write-wins (rejected).
Performance: two merchant-scoped lookups and one transaction lock per existing checkout, indexed by existing store/external identity; possible lock contention on same checkout; measure with concurrent tests.
Version control: branch fix/mvp-task-030-delayed-checkout-event-protection; code commit 31856d7bbc30037177812be046ef147f54cb74fe; test commit 7f0d582150a4ee01beb4035ac876670410de7da1; PR pending; no merge/deploy.
**FINAL STATUS: PARTIAL — IMPLEMENTED, NOT VERIFIED, NOT DEPLOYED.** Task031 must not begin.

## Follow-up CI and classifier audit (2026-10-30)
Commit 5316890cc54f1e75ad4eb3a5a05c247061aa9cf5: GitHub Actions Task030 run 40997756289 **50/50 PASS**, with all eight workflows green: Task025 run 40997756150, Task026 40997756185, Task027 40997756226, Task028 40997756155, Task029 40997756292, Backend tests 40997756219, Backend refresh 40997756176. Previous 39/39 on run 40997555963. Matrix TC030-01 through TC030-50 each PASS on isolated PostgreSQL; these tests are not equivalent to live Shopify verification.
Audited schedulerService.promoteInactiveCheckouts: only pending + recovered_at null + inactivity cutoff are promoted; completed rows excluded. Audited recoveryActionService.runRecoveryActions: found pending + cutoff without recovered_at null. Added completion-evidence guard at commit ce375019d59a9f0e1af51bae9fc3087d3999d417; re-verification pending. Audited dashboardController.getCartRecovery: recovered status is grouped separately and included in historical totals; existing naming total_abandoned includes recovered historical carts, not active-abandoned count. Existing Command Center query includes recovered historical checkouts in total. This is a metric semantic issue, not proof of reopening; follow-up dedicated metric acceptance needed. Historical Shopify sync delegates to upsertAbandonedCart; live Shopify event ordering not tested. No merge/deploy. Release gate still open until final CI and metric semantics review.
