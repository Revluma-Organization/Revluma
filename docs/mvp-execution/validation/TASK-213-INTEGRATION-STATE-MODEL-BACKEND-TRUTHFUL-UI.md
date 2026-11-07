# TASK 213 — Validation: integration state model and backend-truthful UI

**Status:** implementation verification complete on branch; production
acceptance (authenticated merchant session) is the human runbook step,
consistent with Tasks 201–212.

**Decision:** REV-DEC-0021. **Design/audit:**
`diagnostics/TASK-213-INTEGRATION-STATE-MODEL-BACKEND-TRUTHFUL-UI.md`.
**Baseline:** `e465a6d` (main, Tasks 197–212).

## Deterministic coverage matrix

| Surface | Artifact | Count | Coverage |
|---|---|---:|---|
| Python keystone | `python/tests/test_rev_integration_state.py` | 57 | 12-state matrix (all states reachable), the 35-scenario acceptance set, precedence invariants (revoked never connected; disconnected never synchronizing; active sync never conceals auth failure; historical success never implies health; unknown never silently connected; unsupported resources are limits, not failures), `scope_list_recorded` convention, token non-leakage, `canonical_state_summary` projection + golden pin |
| Golden | `python/scripts/gen_integration_state_golden.py` → `Backend/src/services/__tests__/revIntegrationState.golden.json` | 29 + 6 | Python-generated reference for the Node mirror: all 12 states, precedence edges, revocation with stale syncs, rollups; `expected_summary` per case pins the compact projection on both runtimes; token sentinel asserted absent |
| Node mirror | `Backend/src/services/__tests__/revIntegrationState.test.js` | 42 | Byte-level parity vs the golden (full state + summary), contract constants closed sets, validator fail-closed rejections, credential-regex guard |
| Product API | `Backend/src/tests/revIntegrationStateApi.test.js` | 8 | Real controller with mocked DB module: contract shape + actual states, single-store 200, cross-tenant 404 without existence leak, unknown id 404, 403 without membership, empty org → `[]`, revoked → `authorization_revoked`, `GET /stores` additive `integration_state` with token stripped |
| Python evidence | `python/tests/test_rev_integration_evidence.py` (new 3) | 48 total | Canonical block present + compact shape + credential-free; tracks revocation; stale sync → `limited_access` (not failure, not connected); all Task 201 evidence tests unchanged and passing |
| Node evidence | `Backend/src/tests/revIntegrationEvidenceService.test.js` (new 2) | 19 total | Canonical block present/compact/credential-free; tracks revocation; all Task 201 mirror tests unchanged and passing |
| Rev tool | (covered by evidence + full Python suite) | — | `_integration` availability follows the canonical worst state; `canonical_states` in diagnostics |
| Frontend lib | `Frontend/Dashboard/src/lib/integrationState.test.ts` | 15 | Normalizer fail-closed (unknown version, out-of-set status, missing identity, malformed sub-blocks, credential material, non-objects), closed-set recognition, worst-state rollup order-independence, provider filtering, label/style completeness, **green accent reserved for `connected` only** |
| Frontend hook | `Frontend/Dashboard/src/hooks/useIntegrationStates.test.ts` | 7 | Normalized states + store-id index, invalid blocks dropped, malformed response → error (never connected), 15s active cadence, 60s idle cadence (45s = no refetch), focus refetch, manual refetch |
| Frontend page | `Frontend/Dashboard/src/pages/Integrations.test.tsx` | 9 | Green only for `connected`; `limited_access` never rendered `Connected`; worst-state aggregation across stores; **invalid canonical block with a connected store → `Status unknown`, never green**; failed states endpoint with store records → `Status unknown`; per-store fallback to the additive block; honest empty state; retry flow |

## Regression results (this branch)

- Python full suite: 2324 passed, 11 skipped; the only failures are 6
  pre-existing failures (4 `test_db_diagnostics`, 2 `test_api`) that also
  fail on clean `e465a6d` (environment-dependent, unrelated to this task —
  each verified by stash/run/pop).
- Node rev* suites: `revIntegrationState.test.js` 42/42,
  `revIntegrationEvidenceService.test.js` 19/19,
  `revIntegrationStateApi.test.js` 8/8 (combined 69/69).
- Frontend full suite: 539/539 (38 files); `tsc --noEmit` clean; eslint
  clean on all touched files; production build passes.
- `git diff --check` clean. No DB migration. `sessionStorage` key
  `revluma:integration-store-status:v1` has no remaining readers or writers
  in `src/`.

## Live verification (post-deploy, read-only only)

- Render `/ready` SHA probe for both services (Python + Node) — the new
  endpoints ride the existing Node service; the Python service carries the
  keystone + evidence wiring.
- Vercel production liveness for the dashboard build.
- The authenticated integration-state API and the merchant UI require a
  merchant session: sign-in, open Integrations + Command Center, confirm
  the badge matches the store's real state, and ask Rev about a
  capability-limited store — the human runbook step. The retired store is
  never touched.
