# REVLUMA — TASK 025: Record unresolved order-to-checkout relationships

## A. Task identification
Task 025/406; Phase 1 Reliable Data Foundation; Workstream 1B; 2026-10-30; branch fix/mvp-task-025-unresolved-reconciliation-records; parent Task024 PR #219 (not main), production SHA unverified.

## B. Previous evidence reviewed
Read source service, Prisma schema, main audit/README/decisions, Task024 report, Task024 test harness and Task023 historical findings. Other Task001–023 reports not all individually fetched; existing findings retained.

## C. Initial implementation state
No dedicated durable unresolved-case table or state in inspected main or Task024 branch; unmatched orders retained nullable FK only. Checkout events do not initiate order reconciliation.

## D. Reconciliation outcome contract
VERIFIED: persisted order FK and case RESOLVED. UNRESOLVED: null FK and durable case. ERROR: transaction fails and propagates, never misclassified as no-match.

## E. Unresolved reason classification
CHECKOUT_NOT_FOUND, MISSING_AUTHORITATIVE_IDENTIFIER, AMBIGUOUS_CANDIDATES, NO_VERIFIED_MATCH, CONFLICTING_IDENTIFIERS, MERCHANT_MISMATCH (latter three reserved for validated internal paths; current order ingestion emits first three).

## F. Data model
Add order_checkout_reconciliation_cases: id UUID, store_id, order_id, status, reason, source_identifier bounded 255, candidate_count, attempt_count, first_observed_at, last_observed_at, resolved_at, verified_checkout_id. Unique (store_id,order_id); composite order FK (store_id,order_id)->orders(store_id,id); store FK cascade. Index (store_id,status,last_observed_at).

## G. Record identity and deduplication
One case per (store_id,order_id), not nullable source ID. Distinct orders remain distinct, repeated reasons update existing record. Reasons can evolve; first observation preserved.

## H. Implementation details
commerceWebhookService upsertOrder records failed identity lookup within existing Prisma transaction. Case marked resolved only after FK persistence. No checkout-driven matching added.

## I. Merchant isolation
Merchant-scoped order lookup and composite database FK enforce case owner matches order owner.

## J. Idempotency
Unique constraint + upsert prevent duplicate cases; attempt_count counts processing attempts not unique webhook deliveries.

## K. Concurrency safety
PostgreSQL uniqueness protects against concurrent duplicate case insertion. Concurrent Prisma transaction conflicts may retry through existing delivery retry mechanism.

## L. Resolution lifecycle
RESOLVED transition only after durable FK. Existing resolved case remains resolved on stale no-identifier event because FK exists.

## M. Transaction safety
Order upsert, match, unresolved upsert and resolution share one transaction. DB failure throws and transaction rolls back.

## N. Historical synchronization compatibility
Historical order ingestion reuses upsertOrder. No new scheduler or checkout-driven flow.

## O. Migration details
Additive migration 20261030020000_task025_unresolved_reconciliation/migration.sql; create composite orders unique index, new case table with constraints and indexes; no production migration applied.

## P. Existing data compatibility
No existing case rows to rewrite; existing orders unaffected; rollout requires approved migration before backend code deploy.

## Q. Observability and privacy
No raw webhook payloads, email, phone, addresses, tokens or customer IDs in cases. Reason and bounded source ID only. Structured logging framework deferred to Task048.

## R. Test environment
GitHub Actions disposable PostgreSQL 16, Node 22, Prisma db push only localhost task025 DB, guarded opt-in; no production connection.

## S. Test execution
PENDING execution; report will be updated from actual GitHub CI.

## T. Validation matrix
All 28 required scenarios tracked below.

## U. Performance review
Indexed merchant/order upsert and merchant/status query; bounded source field; no N+1 scan.

## V. Findings
REV-FIND-025-01: unresolved cases previously had no durable diagnostic ledger; code implemented, verification pending. Existing REV-FIND-017-01/02, REV-FIND-018-01, REV-FIND-019-01 and REV-FIND-023-05 not claimed fully resolved.

## W. Future dependencies
Tasks 026,027,028,029,030,048,049. No future task implementation included.

## X. Limitations
Checkout-first alone does not attempt reconciliation. No automatic replay after late checkout; order retry resolves. Processing failures cannot be durably recorded inside their rolled-back transaction; existing webhook retry/error logs apply. Production revision and real Shopify source pairs unverified.

## Y. Final status
PARTIAL — implementation complete, isolated tests pending, not deployed.

## Z. Version control and deployment
Focused PR pending; Task024 PR #219 remains separate, unmerged. No production merge, migration or deploy authorized.

| Test ID | Scenario | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|
| TC025-01 | Order without checkout | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-02 | Checkout without order | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-03 | Missing identifier | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-04 | No verified candidate | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-05 | Ambiguous candidates | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-06 | Conflicting identifiers | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-07 | Cross-merchant | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-08 | Duplicate attempt | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-09 | Duplicate webhook | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-10 | Concurrent attempts | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-11 | Different orders | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-12 | Same IDs across merchants | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-13 | Forged merchant | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-14 | Fresh database session | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-15 | Order-first | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-16 | Checkout-first | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-17 | Historical sync | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-18 | Later verified | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-19 | Persistence failure | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-20 | Stale after resolution | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-21 | Repeated sync | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-22 | Missing references | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-23 | Invalid reason | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-24 | Sensitive exclusion | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-25 | Lifecycle safety | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-26 | Revenue safety | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-27 | DB failure | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
| TC025-28 | Resolved reprocessing | Task025 safety invariant | Pending CI | GitHub Actions Task025 | NOT RUN |
