# Task 230 — validation in progress

## Original Tasks 336–340 mapping

| Original | Journey coverage | Current status |
|---|---|---|
| 336 | Revenue comparison and evidence | Existing synthetic evidence/orchestration regressions run; real period/currency/coverage acceptance unverified. |
| 337 | Checkout investigation | Existing synthetic checkout evidence regressions run; real Shopify availability/lifecycle unverified. |
| 338 | Operational priority and selected-finding handoff | Existing contracts inspected; authenticated priority and evidence chain unverified. |
| 339 | Follow-up and context continuity | Router decision regression added; comprehensive multi-turn/store isolation remains unverified. |
| 340 | Cross-workspace and return navigation | Return control, sanitized route preservation and timeout-race regressions added; real-browser matrix and session restoration unverified. |

## Executed checks

- Dashboard full `npm test`: 58 files, 1,388 passed; includes three new navigation/race tests. Focused Rev/Command Center/hook suite: 280 passed. TypeScript `npx tsc --noEmit` passed; lint passed with 21 warnings; build passed with chunk-size warning.
- Python full `DATABASE_URL=...placeholder... python -m pytest -q tests`: 2,338 passed, 11 skipped, 16 warnings using isolated local dependencies and CI-style placeholder DSN. Skipped PostgreSQL tests are not a live database test. The four targeted revenue, checkout, orchestration and recommendation files passed 141 before the two new routing tests were added; the updated orchestration file passed 53.
- These numbers are existing broad regressions, not the required 180 *new or strengthened meaningful Task 230 scenarios* across the specified categories. Only five Task 230 scenarios have been added so far; the category minima remain unmet.
- A full local Python run without the CI-style placeholder DSN had four environment-configuration failures; with the placeholder it passed as above. GitHub CI for this task has not run. Task 229 PR checks belong to a different branch and do not certify Task 230.

## Acceptance blockers

No authenticated browser session or authorized production merchant investigation has been available. No fresh production answers, comparison periods, checkout records, operational priorities, accessibility/viewport or multi-tab acceptance are claimed. No deployment or deployed revision for Task 230 exists. Full tenant/store switch, selected-finding topic change, concurrent cross-workspace tests, production DB evidence, required scenario matrix, CI and release gates remain open. Task 228 is also unfinished and uncommitted; Task 229 PR #387 was open at inspection.

## CI follow-up

Draft PR #388 at commit `c69c0c6`: Dashboard suite/build, dashboard workflow, Python regressions, Prisma/bootstrap financial/security checks and Vercel preview checks passed. These checks certify that commit only, not the production journey or the outstanding Task 230 scenario matrix.
