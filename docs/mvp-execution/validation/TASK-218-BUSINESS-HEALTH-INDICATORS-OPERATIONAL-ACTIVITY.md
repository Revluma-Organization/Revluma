# Task 218 validation

## Rebase note

Main moved twice while this task was in flight: Task 216 (Command Center operational
briefing) merged as `58defb6`, replacing `Overview.tsx` with a six-section
`useCommandCenter`-driven hierarchy, and Task 217 (evidence-backed priority findings,
#371) merged as `4ac2a33`, layering the priority-finding section into that same page.
Because the local clone carries disjoint shallow histories, a three-way rebase was
impossible, so the Task 218 commit was cherry-picked onto each new main — final
baseline `4ac2a33` — with the frontend re-landed in the new hierarchy and re-validated
at each step. `command-center-v1` and Task 216's 16 Command Center
tests are untouched in their assertions; the only change to Task 216's test file is the
page-level API mock (which must answer the two store-scoped Task 218 routes with
contract-shaped payloads) and the refresh assertion, which is tightened to *that*
endpoint (exactly 2 calls, still the last call) because the Task 218 panels each fetch
once at mount. All evidence below was collected on the post-rebase tree.

## Automated evidence

Backend (Node 22, `Backend/`, run with the repository test env — JWT/cookie/Shopify
encryption keys set by `scripts/run-tests.js`):

```
node src/services/businessHealth.test.js            # tests 52 / pass 52 / fail 0
node src/services/operationalActivity.test.js       # tests 25 / pass 25 / fail 0
node src/services/businessHealthRepository.test.js  # tests 11 / pass 11 / fail 0
node src/services/operationalActivityRepository.test.js  # tests 6 / pass 6 / fail 0
```

Coverage of the acceptance surface (all deterministic, no network):

- A–L business-health semantics: healthy requires complete evidence; per-indicator
  `insufficient_history` under partial/stale/unavailable coverage; absent data →
  `value: null` + `unavailable` (never a zero); overall = worst supported state across
  complete indicators; no complete indicator → overall `insufficient_history` with an
  honest explanation.
- Thresholds: revenue −10%/−40%, orders −20%/−50%, product OOS share 20%/50% (share
  denominator = available + unavailable + oos), boundary values (exactly at threshold →
  the worse class), change-from-zero and unknown base → `change_pct: null` (no NaN, no
  fabricated 0).
- Money: 2dp rounding without precision fabrication; `null` preserved; currency carried,
  components (gross/net/refunded) never merged across currencies; conversion rate only
  when `completed + abandoned > 0` (one decimal, else null).
- Integration indicator: all 12 canonical states mapped (closed set), never numeric;
  revoked/disconnected can never render as a business-healthy integration.
- Contract validation: wrong `contract_version`, missing category, count mismatch, bad
  status/data-quality/value types all rejected at the boundary (500 path, no emit).
- Activity feed: 14-day window boundary (day-13 kept, day-15 dropped); dedup by stable
  `event_id` across sources; cursor round-trip (opaque, unforgeable ordering,
  `occurred_at|event_id`); limit default 20 / max 100 / invalid → default; `total`
  reflects the full windowed set so "N remaining" is truthful; `never_run`/`running`/
  `queued` domains are not events; finding `detail` is the closed type code only
  (free-text description asserted absent); lifecycle `reason_code` only (raw
  error payloads asserted absent); one repository source failing degrades the feed
  (other sources still surface) instead of failing the request.
- Tenant scoping and API gating: cross-tenant/unknown store → 404 (no existence leak),
  unauthenticated → 401, `Cache-Control: no-store`, contract-invalid → 500.

Full backend per-file run (`find src -name '*.test.js'`, each file executed
individually with the same test-env variables `scripts/run-tests.js` injects, 2026-11-08,
final rebased tree): **105 files — 105 pass, 0 fail**. During the intermediate
rebase (on `58defb6`) the run showed exactly one failure —
`src/tests/task215SyncProgressApi.test.js` (test 7, `POST
/stores/:id/sync-retry is 409 already_in_progress when a job is running` —
`202 !== 409`), reproduced **identically on a clean `git stash` tree** of the base
(with no Task 218 files present), proving it pre-existing, not caused by this additive
change; it was a test bug (fixed past timestamps + replayed idempotency state) and was
fixed upstream by Task 217's #371, so it no longer reproduces on `4ac2a33`. Task 216/217
suites (`commandCenterService` 25/25, `orderTransactionBudget`, `priorityFindingService`)
pass on this tree.

Dashboard (`Frontend/Dashboard/`, post-rebase tree):

```
./node_modules/typescript/bin/tsc --noEmit   # exit 0 (clean)
npx vitest run                               # Test Files 43 passed (43) · Tests 627 passed (627)
                                             #   = Task 216+217 baseline 614 + 13 Task 218 (3 page + 5 + 5 component)
npx vite build                               # ✓ built in ~7s (pre-existing chunk-size warning only)
```

Task 218 frontend tests: 3 Command Center page tests (sections bound to the briefing's
store; sections hidden without a store context; no investigate action without a
connected integration) + `BusinessHealthPanel` 5 (five indicator cards from the
store-scoped contract; fail-closed on a foreign contract; fail-closed on a version
mismatch; capability-gated investigate action; progressive disclosure) +
`OperationalActivityPanel` 5 (closed labels; cursor pagination appending without
losing items; fail-closed on a foreign contract; honest empty window; navigation only
to existing routes).

## Active-store read-only baseline

Not executed in this environment: the sandbox has no egress to the live Shopify store,
the Render/Python service, or `revluma.vercel.app`, and no authenticated merchant
session was available. (Task 216 separately recorded that the production Render host
reports its service suspended.) No production row, deployment identity, or
authenticated read is claimed here.

## Required acceptance after deployment

1. Deploy the merged revision (Render backend + Vercel dashboard) and record the exact
   deployed revision ids.
2. Authenticated read-only: `GET /api/v1/stores/:storeId/business-health` and
   `GET /api/v1/stores/:storeId/business-activity` on the active store; confirm the
   contract version, indicator values against the store's real Shopify data, coverage
   reasons, and (if applicable) an honest `insufficient_history`/`unavailable` state.
3. Browser: Command Center renders **Business health** (five cards) between Business
   situation and Priority findings, and **Operational history** (load-more feed) after
   the activity/evidence grid; both bound to the header's store; "Load more"
   paginates; links navigate to real routes; "Investigate with Rev" only for a
   connected store.
4. Cross-tenant probe (second org's token → 404) on the deployed API.
5. Record results here and update the audit register status.

Until 1–5 complete, this task's status is
**IMPLEMENTED LOCALLY — NOT PRODUCTION VERIFIED**.

## CI result

PR #370 (head `3dc0cae`, final rebased tree) — **all 7 required checks passed**:

| Check | Result |
| --- | --- |
| Backend test suite | pass (24s) |
| Dashboard suite and production build | pass (2m8s) |
| Prisma bootstrap, financial and security regressions | pass (2m6s) |
| backend | pass (36s) |
| dashboard | pass (2m21s) |
| Vercel | pass |
| Vercel Preview Comments | pass |

Merged to main as `9e2cca4` (2026-11-08).