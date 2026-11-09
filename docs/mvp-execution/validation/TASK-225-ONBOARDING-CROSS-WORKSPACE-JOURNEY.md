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
Initial regression failures were corrected, not hidden. Final PR head `9236a2a` passed Backend, Prisma/bootstrap/security, Dashboard,
Vercel preview and repository checks. PR **#381** merged at `2026-11-09T08:05:24Z`
as **`1371597be8d55cb0815a1d5337fec5a5d3734541`**. Post-merge Backend run
**42583455546** passed. Vercel production **`dpl_DPLfVzRyfD8uJNBNghgvQ23Re3Wo`**
is **READY/PROMOTED** to `revluma.vercel.app` with `gitSource.sha` exactly the
Task 225 merge SHA. No separate backend deployment revision was exposed.

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
Final status: **IMPLEMENTED, CI VERIFIED, MERGED, FRONTEND DEPLOYED — PARTIALLY VERIFIED / PRODUCTION BACKEND AND AUTHENTICATED ACTIVE-STORE ACCEPTANCE PENDING**.
