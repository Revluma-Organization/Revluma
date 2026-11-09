# Task 223 validation — conversation submission, loading and evidence

## Acceptance mapping

| Area | Automated evidence |
|---|---|
| Empty, whitespace, wrong type, NUL, exact/oversize bounds | Backend validator table; page whitespace/oversize scenarios |
| Double-click, Enter/click, uncertain retry, edited/new turn IDs | Page submission scenarios; unique database acceptance constraint/service race tests |
| 401/403/404/409/429/5xx/network/malformed | Typed stream and page failure scenarios; no false completed answer |
| Prepared/accepted/processing/completed/failed | Meta/final sequencing; accepted draft clearing; persisted terminal outcomes; explicit failures |
| Real-only investigation loading | Plan/step/evidence tests; no-step/no-running/no-percentage timeline scenarios |
| Adaptive structured and concise answers | Existing `RevAnswerView`, `RevPresentation`, response-mode/adaptation and upstream suites retained |
| Evidence/uncertainty/provenance | Existing evidence/claim suites plus Task 223 provenance, freshness and fail-closed validation scenarios |
| Tenant/store/finding continuity | Accepted lookup/ownership/reuse tests and retained page/Backend isolation suites |
| Accessibility/responsiveness | Full workspace at 320/375/430/600/768/1024/1280/1440/1920; 44px Send, live regions, keyboard and existing focus/reduced-motion/table/long-answer suites |
| Read-only/security | `execute:true` rejection, no execute transport, scoped UUID SQL, cross-tenant ownership tests, existing security suite required in CI |

New scenario total: **131** (47 Backend + 84 Dashboard). Existing upstream tests are additional, not counted toward this new floor.

## Commands and local results

Run from the repository unless a directory is stated.

- `Frontend/Dashboard: npm test -- --run src/pages/Task223Submission.test.tsx src/lib/revStreamTask223.test.ts src/components/rev/Task223Lifecycle.test.tsx src/components/rev/RevAnswerMode.test.tsx` — **80/80 pass** (75 new Task 223 Dashboard scenarios + 5 existing mode scenarios).
- `Frontend/Dashboard: npm test -- --run src/pages/RevIntell.test.tsx src/lib/revStream.test.ts` — **139/139 pass**.
- `Backend: node --test src/services/__tests__/revSubmission.test.js src/controller/__tests__/revConversation.contract.test.js src/services/__tests__/revInvestigation.contract.test.js` — **67/67 pass**.
- `Frontend/Dashboard: npx tsc --noEmit` — **pass**.
- `Frontend/Dashboard: npm run build` — **pass**; existing large-chunk warning only.
- `git diff --check` — **pass**.
- Final full Dashboard run — **52 files, 886/886 tests pass**. Earlier intermediate failures were an old compact `1/2` expectation and jsdom initial-animation visibility assertions; both test expectations were corrected without weakening product behavior.
- Changed-file ESLint excluding the legacy `RevIntell.tsx` baseline — **pass**. That page reports the same **12 pre-existing `no-explicit-any` errors** when linted from `HEAD`; no new lint error was introduced.
- `Backend: npm test` — **environment-blocked locally** at missing `.prisma/client/default`, not a passing run.
- `Backend: npm run prisma -- generate` — **environment-blocked** because `binaries.prisma.sh` is not an allowed egress host. No migration-applied or full-backend local claim is made.

## Final integrated CI / migration / deployment evidence

PR **#378**, initial commit `be99f55`: Dashboard suite/build, `dashboard`, Vercel preview and task025–030 passed; all three backend-invoking checks failed on one regression in `revTenantIsolation.test.js`: `/rev/chat` routed `READ_ONLY` through middleware instead of its prior direct 403 JSON response. The shared validator call was wrapped with the compatible JSON error response. Local `node --test src/tests/revTenantIsolation.test.js` now passes **8/8**, and focused Backend remains **67/67**. A follow-up CI run is required; this is not yet a green-CI or deployment claim.

## Production acceptance boundary

No authenticated production browser session for `revluma-test-store-v1.myshopify.com` is available in this environment. The sandbox also lacks general production egress and a real browser. Consequently:

- jsdom width scenarios are automated behavior/CSS checks, not pixel-level screenshots.
- Unit/integration mocks do not prove migration application, RLS behavior or provider health in production.
- Public health/authentication checks, Vercel READY/PROMOTED and CI cannot substitute for the merchant journeys.
- Final status must remain **PARTIALLY VERIFIED** unless exact deployed revisions and real authenticated submission → investigation → structured/simple answer → evidence/freshness/limitations → finding continuity → retry/navigation journeys are observed.
