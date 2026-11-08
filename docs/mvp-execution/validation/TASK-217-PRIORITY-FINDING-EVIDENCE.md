# TASK 217 validation — Priority Finding Evidence and Recommended Next Step

- Date: 2026-11-06
- Current verdict: **CI VERIFIED AND MERGED; EXACT RENDER REVISION/AUTHENTICATED PRODUCTION ACCEPTANCE PENDING**

## Executed checks

| Check | Result |
|---|---|
| `node --test Backend/src/tests/priorityFindingService.test.js Backend/src/tests/commandCenterService.test.js Backend/src/tests/intelligenceFindingsEngine.test.js Backend/src/tests/intelligenceFindingsAggregator.test.js` | **113 passed, 0 failed** |
| `npm test -- --run src/pages/Overview.test.tsx src/pages/RevIntell.test.tsx` (Dashboard) | **155 passed, 0 failed** |
| `DATABASE_URL=postgresql://test:test@localhost:5432/test .venv/bin/python -m pytest -q python/tests` | **2,336 passed, 11 skipped** |
| `npm run build && npx tsc --noEmit` (Dashboard) | **PASS** |
| `git diff --check` | **PASS** |

The first full Python run without `DATABASE_URL` produced four unrelated database-configuration failures; the documented dummy test DSN run above passed without opening that database. The full backend runner could not complete locally because Prisma generation requires an unavailable `binaries.prisma.sh` download. This is recorded as an environment limitation, not a pass. CI is required.

## Acceptance coverage

The priority suite contains 71 scenarios, including A–H, deterministic ties/input-order stability, lifecycle and timestamp boundaries, malformed evidence, unknown/failed resources, certified windows, multi-currency and missing-money handling, stable dedupe across invalid duplicates, source references, exact encoded investigation IDs, currentness invalidation and read-only recommendation constraints. Refund detector tests verify transaction-date aggregation, successful transactions, complete sync, comparison baselines, materiality/sample limits and deterministic keys. Python tests cover bounded refund retrieval, organization/store predicates, retrieval failure and Node/Python recommendation semantics. UI tests cover progressive disclosure, keyboard-native details, current vs historical states, no-priority language, lower findings, refund advice, inventory limitations and narrow-layout overflow guards.

Tenant/auth/context coverage includes organization-scoped Command Center queries, exact store ownership in finding detail, Python store/organization predicates, encoded IDs, invalidated-before-investigation behavior, and no raw payload/token/source-record fabrication. Existing Rev tenant and chat suites are included in the broader focused/Dashboard runs. No schema or RLS policy changed.

## CI and merge evidence

PR [#371](https://github.com/Revluma-Organization/Revluma/pull/371) passed all required checks on head `7c34a58`: Backend test suite (run `42492689640`), release-candidate backend/Dashboard/Python/Prisma-PostgreSQL-security jobs (run `42492689488`), isolated backend/Dashboard jobs (runs `42492689740`, `42492689634`), Python regressions (`42492689661`) and Vercel preview. It merged as `4ac2a3386bf1d05e58e375afe429f67ea502688a` on 2026-11-08. An initial red run exposed a pre-existing Task 215 fixture whose hard-coded heartbeat had aged into `stalled`; the independent gate test now clears the earlier idempotent request and uses a current heartbeat. Production retry behavior did not change; the corrected test passes 7/7 locally and full Backend CI is green.

## Production evidence and blockers

- Authoritative Node service: `https://revluma-backend-vrsd.onrender.com` (`/ready`).
- Authoritative Python service: `https://revluma-python-p7j2.onrender.com` (`/health`).
- Pre-Task-217 deployed baseline: `58defb605c05cbb4b5ab61c5794b0a05674f1593`.
- Merged Task 217 revision awaiting Render observation: `4ac2a3386bf1d05e58e375afe429f67ea502688a`. Repeated cache-busted health checks through 2026-11-08 15:14 UTC still reported the baseline revision on both services, so Task 217 Render deployment is not claimed. No Render deployment credential/connector is available in this session.
- Vercel reports a successful production deployment status for merge `4ac2a3386bf1d05e58e375afe429f67ea502688a` (deployment `J4UYET3msWaFYmmpsSzjnX4JRo88`, updated 2026-11-08 15:06 UTC). This does not establish authenticated Command Center behavior.
- Active organization: `1dc6aa19-9737-4770-a340-ff812a8b139a`; active store: `3ed79446-cb6d-4a1c-b174-9ec1ab91fe15`.
- Read-only preflight found no active-store trusted finding/coverage supporting a current priority. The expected truthful production state is therefore no defensible priority. No demo row was inserted.

Task 217 code is not production-verified until its exact revision is deployed and health-checked. Authenticated merchant browser/API acceptance and screenshots are unavailable in this session; unauthenticated 401 responses and public frontend markup cannot establish Command Center behavior. These remain explicit blockers to a “100% implemented to production grade” claim. This report will be updated with PR/CI/deployed-SHA evidence without upgrading authenticated acceptance unless it is actually observed.
