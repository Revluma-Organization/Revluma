# Task 225 validation

## Scenario coverage

**177 new scenarios defined**: 100 backend/service/API/security scenarios and 77
Dashboard/navigation/component scenarios, including twelve viewport cases. They
cover setup/returning/multi-store state, authorization versus sync, partial and
failed readiness, insufficient history, capability limits, invalid contracts,
tenant-scoped endpoint invariants, OAuth ordering/replay/secret exclusion, safe
returns, finding continuity, session/service failure, accessible controls and all
requested widths. Existing OAuth, integration recovery, finding-resolution,
submission, Command Center and Rev suites provide additional regression coverage;
they are not counted in the 177.

## Commands and results

- `node --test src/services/__tests__/task225MerchantJourney.test.js`:
  **100/100 passed**.
- New Dashboard focused run: **77/77 passed**.
- Focused Backend plus Task 214 recovery, finding resolution and Task 223
  submission: **227/227 passed** (Prisma-dependent install suite excluded locally
  because generated client/engine download is unavailable).
- `npx tsc --noEmit`: passed.
- `npm run build`: passed; existing chunk-size warnings only.
- Changed-file lint: new files clean; `RevIntell.tsx` retains its 12 pre-existing
  `no-explicit-any` errors.
- `node --check` and `git diff --check`: passed.

Final full Dashboard: **54 files, 963/963 tests passed** on the final local tree.
Initial regression failures were corrected, not hidden. CI, commit, merge and
deployment results are recorded below when available.

## Production acceptance checklist

The following remain **unverified** until exercised with an authenticated merchant
on the deployed revision:

- Shopify consent, cancellation, invalid/stale state, callback retry and exact
  return on `revluma-test-store-v1.myshopify.com`.
- Real resource synchronization and readiness reconstruction.
- Actual first briefing, no-finding/limited-history states and evidence identity.
- Real finding-to-Rev first response and Command Center restoration after refresh,
  back/forward and later login.
- Real-browser overflow/focus/screen-reader checks at all requested widths.
- Production backend revision, tenant/RLS behavior and absence of mock data.

Public route checks and synthetic automated scenarios do not satisfy those gates.
Status at implementation: **IMPLEMENTED AND LOCALLY VALIDATED — CI, DEPLOYMENT AND
AUTHENTICATED PRODUCTION ACCEPTANCE PENDING**.
