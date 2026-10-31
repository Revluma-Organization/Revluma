# Task 198 — Verify Revenue Evidence Retrieval

**Status:** PASS — CI VERIFIED; PR OPEN / NOT MERGED  
**PR:** [#233](https://github.com/Revluma-Organization/Revluma/pull/233)  
**Branch:** `feat/task-198-revenue-evidence-verification`  
**Last inspected head:** `29a2240a1e3b746f39c01022516cf373a6e021e3`  
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


## Latest PR-head verification — 2026-10-31 (NOT CERTIFIED)

**Inspected PR head:** `bf4246664931bf7b7fc8055d5587f88cb3f9fa61`  
**PR merge test SHA:** `d27852b1149774d99d8164fe525091cf14547810`  
**PR:** [#233](https://github.com/Revluma-Organization/Revluma/pull/233) (open, draft, not merged)

### Latest GitHub Actions evidence

Runs below were returned by the PR-head workflow-run lookup. Job logs confirm the merge SHA above.

| Workflow | Run ID | Conclusion | Run URL |
|---|---:|---|---|
| Backend tests | 41206714885 | SUCCESS | https://github.com/Revluma-Organization/Revluma/actions/runs/41206714885 |
| Task 024 | 41206714924 | SUCCESS | https://github.com/Revluma-Organization/Revluma/actions/runs/41206714924 |
| Task 025 | 41206714926 | SUCCESS | https://github.com/Revluma-Organization/Revluma/actions/runs/41206714926 |
| Task 026 | 41206714974 | SUCCESS | https://github.com/Revluma-Organization/Revluma/actions/runs/41206714974 |
| Task 027 | 41206716538 | SUCCESS | https://github.com/Revluma-Organization/Revluma/actions/runs/41206716538 |
| Task 028 | 41206714803 | SUCCESS | https://github.com/Revluma-Organization/Revluma/actions/runs/41206714803 |
| Task 029 | 41206714845 | SUCCESS | https://github.com/Revluma-Organization/Revluma/actions/runs/41206714845 |
| Task 030 | 41206714870 | SUCCESS | https://github.com/Revluma-Organization/Revluma/actions/runs/41206714870 |
| Task 031 | 41206714950 | SUCCESS | https://github.com/Revluma-Organization/Revluma/actions/runs/41206714950 |
| Task 032 | 41206714921 | SUCCESS | https://github.com/Revluma-Organization/Revluma/actions/runs/41206714921 |
| Rev Python regression tests | 41206715095 | FAILURE | https://github.com/Revluma-Organization/Revluma/actions/runs/41206715095 |

Task 024–032 each had one completed integration job and all steps in that job succeeded. These isolated task workflows do not substitute for the full revenue evidence/PostgreSQL test.

### Python job failure and skipped tests

Run 41206715095 failed during `Initialize the real application schema with Prisma migrations`. PostgreSQL returned SQLSTATE `42P01`: `relation "merchant_memories" does not exist` while applying migration `202609220002_add_zero_touch_automation`. Python compile checks, Task 198 PostgreSQL revenue integration, Gemini/routing/web research regressions, and the complete Python suite were skipped because initialization failed. None of those skipped checks is a pass.

A direct schema/baseline comparison found 63 Prisma models versus 23 tables in `0_baseline/migration.sql`. The baseline omits `merchant_memories`, although migration 202609220002 requires it. The checked-in migration history therefore does not currently initialize the complete Prisma schema from an empty database. Do not repair this by editing an already-applied historical baseline or by treating a mocked schema as actual-schema proof. Safe migration-history reconciliation and a successful disposable PostgreSQL run remain mandatory.

### Frontend workflow results

The independent frontend job in run 41206715095 produced:
- Vite build: SUCCESS.
- Dashboard tests: SUCCESS — 9 test files, 29 tests.
- Tooling TypeScript check: SUCCESS.
- Dashboard lint: FAILURE — 34 errors, 16 warnings, across dashboard files.
- Application TypeScript check: FAILURE — TS5103, invalid `--ignoreDeprecations` value in `tsconfig.app.json`.

The workflow correctly failed its aggregate quality gate. These are not Vercel quota errors. The Vite build is verified independently, but lint/type-check acceptance remains open. No frontend files were changed as part of this inspection.

### Updated acceptance status

- Backend CI and Task 024–032 isolated workflows: verified passing on the PR merge ref.
- Actual Prisma/PostgreSQL revenue integration: NOT RUN; schema initialization failed first.
- Python compile and full Python regression suite: SKIPPED after schema initialization failure.
- Node authenticated tenant boundary: backend suite passed, but controller/service-boundary assertions still require source-level review before claiming every Task 198 security criterion.
- Frontend build: PASS; frontend lint and app type-check: FAIL.
- Vercel preview deployment: no new deployment was triggered; quota limitation remains separate from build status.
- PR remains draft; no merge, deployment, production schema change, or production data mutation.

**Current status remains IN PROGRESS — NOT CERTIFIED.** No mandatory acceptance criterion is waived by these results.


## Final blocker elimination — 2026-10-31

**Status: PASS — CI VERIFIED; PR OPEN / NOT MERGED.**  
**Verified PR head:** `29a2240a1e3b746f39c01022516cf373a6e021e3`  
**Base:** `96aa4cfe7be09743e697b8346bb7565fd179deb3`  
**PR:** https://github.com/Revluma-Organization/Revluma/pull/233 (open, draft, not merged).

### Blockers fixed

- Repaired the disposable PostgreSQL bootstrap. The previous shell heredoc transformed the dollar-quoted PL/pgSQL block into invalid `DO $`; the replacement uses idempotent role-existence checks and ordinary `CREATE ROLE` statements.
- Added a forward-only organization-slug reconciliation migration because the historical baseline omitted the current required `organizations.slug` field. Existing non-empty slugs are retained; missing values are deterministically backfilled before the unique, non-null constraint is applied.
- Kept historical baseline migration files unchanged. The clean-database test now executes the baseline from a disposable normalized copy and deploys the complete checked-in migration chain; no `prisma db push` fallback is present in the migration-verification workflow.
- Fixed the zero-order-value test to compare decimal numeric value rather than requiring a two-decimal string representation for every currency.

### Verification on the exact PR head

| Workflow | Run | Result |
|---|---:|---|
| Rev Python regression tests (real migration chain + revenue integration + full Python suite + frontend quality) | 41210437152 | **SUCCESS** |
| Task 198 actual Prisma schema + revenue integration + full Python suite | 41210437215 | **SUCCESS** |
| Backend tests | 41210437180 | **SUCCESS** |
| Backend refresh regression | 41210437235 | **SUCCESS** |
| Dashboard authentication regression | 41210437162 | **SUCCESS** |
| Task 024 verified-persistence reconciliation | 41210437245 | **SUCCESS** |
| Task 025 unresolved reconciliation | 41210437221 | **SUCCESS** |
| Task 026 conflicts reconciliation | 41210437194 | **SUCCESS** |
| Task 027 ownership reconciliation | 41210437175 | **SUCCESS** |
| Task 028 source identifier preservation | 41210437229 | **SUCCESS** |
| Task 029 checkout completion precedence | 41210437239 | **SUCCESS** |
| Task 030 delayed checkout event protection | 41210437231 | **SUCCESS** |
| Task 031 order-first delivery diagnostic | 41210437198 | **SUCCESS** |
| Task 032 checkout-first delivery diagnostic | 41210437310 | **SUCCESS** |

The Rev Python workflow completed the real Prisma migration initialization, migration status/checksum verification, Python compilation, Task 198 disposable PostgreSQL revenue integration tests, Gemini/routing/web research regressions, and the full Python suite. Full Python result: **606 passed, 1 skipped, 34 warnings**. The single skip is the explicitly opt-in paid/network-dependent live LLM judge benchmark; it requires `RUN_LIVE_LLM_JUDGE=1` and `ANTHROPIC_API_KEY`, so it is intentionally not run in ordinary CI. Targeted Task 198 PostgreSQL integration: **3 passed**. Gemini/routing/web research regressions: **19 passed**.

The separate actual-Prisma-schema workflow also completed schema initialization, the Task 198 actual-schema PostgreSQL integration, and the full Python suite successfully (606 passed, 1 skipped). This is additional evidence; it does not replace the real migration-chain run above.

Frontend quality on this head: Vite production build passed; ESLint completed with **0 errors and 13 warnings**; application TypeScript check passed; tooling TypeScript check passed; dashboard tests passed (**9 files, 29 tests**); aggregate frontend gate passed.

All nine Task 024–032 workflows, backend tests, backend refresh regression and dashboard authentication regression passed on this exact SHA. There are no failed or pending required workflows in the 14-run PR-head set.

### Scope and limitations

- CI verifies the isolated PostgreSQL migration chain and real-schema revenue query behavior, including organization isolation, currency separation, period boundaries, cancellation filtering, trusted coverage and zero/unknown distinctions.
- One optional live LLM-as-judge benchmark remains skipped by design because it consumes a paid external API key; it is not a Task 198 deterministic acceptance test.
- No Shopify production-store comparison, production database migration, production deployment, or live merchant data mutation was performed. Those remain post-merge/release validation steps requiring the normal authorization path.
- PR #233 remains draft/open. No merge or deployment was performed.

**Task 198 CI acceptance is PASS.** Do not describe this as production deployment or live-store verification.
