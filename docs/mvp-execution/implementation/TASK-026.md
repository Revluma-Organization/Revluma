# REVLUMA — TASK 026: Detect conflicting checkout matches

## A. Task identification
Task 026/406, Phase 1 Workstream 1B, 2026-10-30, branch fix/mvp-task-026-checkout-match-conflicts, parent Task025 PR #220, base Task025 final commit 2e185ac16042d87b9cf6606bb63a50313583168e; production SHA not verified.

## B. Previous evidence reviewed
Inspected Task024 and Task025 reports, Task025 source/test, schema, audit register and decisions. Historical Task017–019 and Task023 reports are not present on stacked branch (unmerged PRs); findings REV-FIND-017-01/02, REV-FIND-018-01/02, REV-FIND-019-01/02, REV-FIND-023-05 retained from earlier verified execution summaries.

## C. Initial implementation state
Task025 matcher merged three order identifiers into an IN query with take:2, correctly rejected multiple rows as ambiguous but did not classify checkout ID versus checkout token as a conflict. Persisted-FK mismatch threw inside transaction, rolling back conflict diagnostics.

## D. Shopify identifier semantics
Source order payload fields checkout_id, checkout_token, cart_token are distinct; checkout handler currently persists one external_cart_id (usually checkout ID), so real token capture remains Task028. Numeric Shopify IDs remain strings; trim whitespace only. Cart token treated weaker than checkout ID or checkout token, cannot override either; when only cart token available, a unique candidate may match per prior Task024 contract; no assertion of real-world uniqueness.

## E. Reconciliation outcomes
VERIFIED: one authoritative candidate, FK persisted. UNRESOLVED: no candidate. AMBIGUOUS: duplicate identity or weak candidate multiplicity. CONFLICT: distinct checkout records matched by checkout_id versus checkout_token or new verified candidate contradicts persisted FK. PROCESSING ERROR: thrown transaction/DB failure.

## F. Conflict invariants
Never arbitrary selection, never weaken stronger evidence, tenant scoping, immutable verified FK, durable conflict reason, deterministic classification, idempotent ledger, compare-and-set, no lifecycle or revenue mutation.

## G. Existing candidate selection
Previous IN query mixed all three signals; new independent bounded lookups per distinct value, evaluate strong signals before weak cart token; explicit candidate/duplicate/conflict classification.

## H. Early-return risks
Previous take:2 hid identifier provenance; existing FK mismatch threw before Task025 ledger could commit.

## I. Conflict categories
CONFLICTING_IDENTIFIERS used for two unique strong candidates and existing-FK mismatch. AMBIGUOUS_CANDIDATES for duplicate exact identity or weak-only multiplicity. Missing/no-match unchanged.

## J. Implementation design
Minimal service-only change; reuse Task024 FK CAS and Task025 reconciliation cases. No new table or migration.

## K. Implementation changes
Backend/src/services/commerceWebhookService.js upsertOrder matching block and recordOrderReconciliationCase preserveConflict option; Backend/src/tests/task026Conflicts.integration.js; .github/workflows/task026-conflicts.yml; documentation and audit.

## L. Task024 persistence integration
Candidate selected only if unambiguous and not contradicted; compare-and-set updateMany FK null; re-read after failed CAS; preserve existing relationship.

## M. Task025 unresolved recording
Conflict uses existing reason CONFLICTING_IDENTIFIERS and preserveConflict flag to store even if FK exists, resetting previous resolved case to unresolved conflict; same order unique constraint.

## N. Merchant isolation
Every checkout lookup filters store_id; every order update/ledger uses store_id; Task025 composite store/order FK remains.

## O. Concurrency and transaction safety
Bounded independent lookups inside order transaction; CAS null guard prevents overwrite. Concurrent transaction conflicts may cause a transient database error and retry; no false acceptance.

## P. Historical synchronization
Historical sync routes through same upsertOrder; no rewrite or destructive repair.

## Q. Checkout lifecycle safety
No checkout status/recovered_at changes; independent Shopify completion events unaffected.

## R. Revenue attribution safety
No recovered attribution, no recovery status promotion; existing independent order totals unaffected.

## S. Database migration
No new migration. Reuse Task025 additive migration in isolated CI.

## T. Existing data compatibility
No historical FK reassignment; existing verified association preserved and discrepancy recorded.

## U. Test environment
Disposable PostgreSQL 16 + Node22; task026 localhost-only guard; synthetic merchants, orders, checkout rows.

## V. Test execution
PENDING — CI execution will be appended.

## W. Conflict detection validation matrix
See 40-case matrix below; statuses updated only after observed GitHub logs.

## X. Performance review
At most three indexed merchant-scoped queries (one per distinct provided identifier), each take:2, no full scans. Existing index (store_id,external_cart_id).

## Y. Findings
REV-FIND-017-01: previously conflicting identifiers not classified; fix under test. REV-FIND-017-02: duplicate candidate ambiguity protected. REV-FIND-026-01: original FK conflict threw and lost durable evidence; fix under test.

## Z. Future dependencies
Task027 checkout claimed by multiple orders, Task028 identifier persistence/provenance, Tasks029–030 lifecycle precedence, Tasks046–047 attribution, Task048 logs, Task049 end-to-end regression.

## AA. Limitations
Real Shopify token pairs and production revision not verified; schema stores one checkout identifier; only checkout_id vs checkout_token disagreement treated authoritative, cart token considered weak; concurrent transactions may retry.

## AB. Final status
PARTIAL — implementation written, CI pending; NOT DEPLOYED.

## AC. Version control and deployment
PR pending; stacked on unmerged Task025 #220, Task024 #219; no merge, deploy, production migration or Shopify writes.

| Test | Scenario | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|
| TC026-01 | ID/token agree | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-02 | ID/token disagree | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-03 | Missing token | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-04 | Missing ID | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-05 | ID/cart token | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-06 | Token/cart token | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-07 | Duplicate exact ID | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-08 | Duplicate checkout token | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-09 | Shared cart token | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-10 | Existing FK disagreement | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-11 | Historical conflict | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-12 | Webhook conflict | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-13 | Equivalent representation | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-14 | Large numeric ID | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-15 | Null optional ID | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-16 | Empty optional ID | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-17 | Whitespace optional ID | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-18 | Weak email | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-19 | Weak customer | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-20 | Weak amount | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-21 | Weak timestamp | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-22 | Weak coupon | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-23 | Multiple weak signals | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-24 | Cross merchant ID | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-25 | Cross merchant token | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-26 | Forged merchant | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-27 | Duplicate conflict | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-28 | Concurrent identical | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-29 | Concurrent conflicting | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-30 | Conflict during write | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-31 | Conflict persistence | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-32 | Conflict dedup | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-33 | Fresh session durability | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-34 | Lifecycle safety | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-35 | Revenue safety | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-36 | Processing error | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-37 | No match | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-38 | Ambiguity | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-39 | Existing FK preserved | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
| TC026-40 | Historical reprocessing | Safe conflict-aware classification | Pending | GitHub Actions Task026 | NOT RUN |
