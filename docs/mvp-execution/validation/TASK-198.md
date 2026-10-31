# Task 198 — Verify Revenue Evidence Retrieval

**Status:** IN PROGRESS — NOT CERTIFIED  
**PR:** [#233](https://github.com/Revluma-Organization/Revluma/pull/233)  
**Branch:** `feat/task-198-revenue-evidence-verification`  
**Last inspected head:** `eec437690e67f9a6a8e78fb846e42c7f8e3834d1`  
**Production:** unchanged; no merge or deployment performed.

## Scope and contract

Task 198 verifies revenue evidence retrieval for Rev Intelligence. The code-level envelope currently declares `contract_version: "1.0"` in `python/src/intelligence/seven_day_evidence.py`. It returns organization scope, request ID, UTC half-open period, generated timestamp, status, evidence items, warnings and errors.

The Task 197 contract artifact exists on this PR branch at `docs/rev-intelligence/REV-EVIDENCE-RETRIEVAL-CONTRACT.md`. Its contract-definition criteria are checked; source-specific retrieval verification (Tasks 198–203) and runtime enforcement remain explicitly open. The audit register now records Task 197 as CONTRACT DEFINED — SOURCE-SPECIFIC VERIFICATION PENDING. Task 198's revenue envelope is compared against that normative contract, not treated as a substitute for it.

The implementation deliberately reports persisted Shopify order totals as recorded order values. It does not independently claim gross revenue, net revenue, captured/settled payments, or a separate refund-value ledger. Merchant-local dates are not inferred because store timezone is not persisted.

## Implementation changes on this branch

- Preserve Shopify money as decimal strings through GraphQL mapping and Prisma Decimal handling.
- Reject amounts whose fractional precision or magnitude cannot be preserved by the application's `DECIMAL(10,2)` order column.
- Fail closed for absent/malformed refund collections and contradictory over-refunds; do not turn an over-refund into a verified zero.
- Compare Shopify historical order totals to persisted totals using Prisma Decimal equality rather than floating-point rounding.
- Restrict revenue retrieval to active/connected/syncing Shopify stores belonging to the authenticated organization.
- Preserve the Node correlation ID through the Python request model, API endpoint and orchestrator into revenue evidence request IDs.
- Refuse unsupported relative reporting periods rather than silently replacing them with seven days; treat explicit UTC today as day-to-date and yesterday as a completed UTC calendar day.
- Add real-Prisma-schema PostgreSQL integration coverage, controller/merchant-context authentication tests, coverage-producer decimal tests, and zero-value evidence tests.
- Update Task 024–032 synthetic order fixtures to explicitly represent Shopify's empty refund collection where no refunds exist.
- Update Task 024 expectations where later Task 026/027/029 behavior superseded the original assertions: conflict cases are persisted instead of thrown, and verified order-to-checkout relationships mark the checkout recovered. The original negative/no-match lifecycle checks remain.

## Verification evidence observed

### CI run on prior inspected head

The run below is from an earlier branch commit, not the current head. It is diagnostic evidence only and is not a final pass.

| Workflow | Run | Result |
|---|---:|---|
| Task 024 | 41205020992 | FAIL — 18/26; stale expectations for later conflict/completion behavior and incorrectly typed checkout-token fixtures |
| Task 025 | 41205020896 | SUCCESS |
| Task 026 | 41205020967 | FAIL — 0/40; order fixtures omitted `refunds: []` |
| Task 027 | 41205020915 | FAIL — 3/40; order fixtures omitted `refunds: []` |
| Task 028 | 41205020941 | FAIL — 16/44; order fixtures omitted `refunds: []` |
| Task 029 | 41205020901 | FAIL — 2/45; order fixtures omitted `refunds: []` |
| Task 030 | 41205020939 | FAIL — 37/50; order fixtures omitted `refunds: []` |
| Task 031 | 41205020893 | SUCCESS |
| Task 032 | 41205020970 | SUCCESS |
| Backend test suite | 41205020881 | SUCCESS |
| Backend workflow | 41205020886 | SUCCESS |
| Independent frontend build | 41205020887 | SUCCESS |
| Python regressions | 41205020887 | FAIL — real Prisma migration initialization stopped at legacy baseline migration |

### PostgreSQL migration blocker

The first real-schema CI attempt found 13 Prisma migrations but failed applying `0_baseline` with Prisma P3018 and the driver error `string contains embedded null`. The checked-in baseline also begins with a non-SQL dotenv diagnostic line. The baseline file has not been edited in the repository because changing an already-applied historical migration would risk checksum incompatibility in existing environments.

The CI workflow was changed to execute a disposable copy of the baseline SQL through PostgreSQL, mark that baseline as applied in the disposable database, and then let Prisma deploy the remaining migrations. This is intended to preserve the repository migration contents while obtaining the exact PostgreSQL failure location. The rerun on the latest head is pending and must be inspected before the actual-schema integration can be certified.

### Vercel quota

GitHub commit status for `a55decb0db3fb2db2ef101a00d1d29b6f7fa82c5` reported Vercel: `Deployment rate limited — retry in 24 hours.` This is an explicit deployment-quota failure, not evidence of a Vite build failure. The independent Vercel-equivalent Vite build passed in run 41205020887. Vercel project inspection was denied by the connected Vercel API (403), so no further project-side deployment details are claimed.

## Remaining acceptance work

- Obtain a successful run of the real Prisma schema initialization and actual-schema PostgreSQL revenue integration.
- Inspect all workflows triggered by the latest head and fix in-scope failures; rerun the complete suite after corrections.
- Verify all Task 024–032 workflows pass with the updated, non-weakened expectations.
- Verify Python tests, API correlation handoff, period handling, revenue evidence and AI response grounding on the current head.
- Review the complete current PR diff and changed-file list.
- Record final test totals, run URLs, job results, skips and exact final SHA.
- Confirm the independent frontend build remains green on the final head.
- Keep Vercel deployment-quota status separate from build status.
- Update this report and the audit register only from final run evidence.

## Production test plan after independent review

1. Merge only after PR review and explicit authorization.
2. Deploy through the normal controlled release path only after separate authorization.
3. On a designated test Shopify store, verify current order totals, full/partial/multiple refunds, cancelled orders, currency, historical coverage, sync freshness and 7/30-day/explicit-UTC reporting.
4. Compare recorded order values against Shopify Admin order records per currency; do not assert gross/net revenue without a separately verified source.
5. Verify tenant isolation with two distinct test organizations/stores.
6. Inspect Rev Intelligence output for provenance, period, currency, freshness, coverage and explicit unknown/unsupported states.
7. Confirm no production data or customer state is mutated by the read-only evidence retrieval.

## Merge and deployment

PR #233 remains open and draft. No merge, production deployment, production schema change or production data change has been performed.
