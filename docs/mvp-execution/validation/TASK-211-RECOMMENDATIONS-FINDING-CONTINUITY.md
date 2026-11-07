# TASK 211 — Validation record

**Date:** 2026-11-07  
**Branch:** `arena/76d83fed-revluma`  
**Baseline:** `9749b7164737921558c95859f7b314921939ed54`

## Local acceptance evidence

| Gate | Result |
| --- | --- |
| Task 211 synthetic acceptance matrix | **60 passed** |
| Complete Python suite, including Tasks 197–210 regressions | **2,072 passed, 11 skipped** |
| Complete Backend suite | **90 test files passed** |
| Complete Dashboard suite | **36 files / 506 tests passed** |
| Dashboard production build | **passed** (Vite; existing large-chunk warning only) |
| Python compile, Node syntax and `git diff --check` | **passed** |

The complete Python/Backend counts above include the final prompt-injection and legacy-contract fixture repairs. The dedicated 60-scenario run was repeated after expanding the six incomplete/stale evidence cases and adding bounded retrieval, stable identity, dismissed lifecycle and explicit topic-change cases.

## Security and behavior reviewed

- Finding selection is an identifier-only capability; Node and Python both authorize organization/store scope.
- A raw `organization_id=<uuid>` message is not reinterpreted as a finding reference or copied into tool parameters.
- Unknown evidence IDs, cross-tenant contracts, duplicate/generic recommendations and execution claims fail closed.
- Invalid, stale, superseded, dismissed and resolved states remain distinct; selection/acknowledgement is not execution.
- Node's successful JSON/SSE response persistence and Python's persistence both retain bounded selected-finding state. A direct Node persistence test verifies atomic JSONB update, organization scoping, three-item bound, redaction and topic-change clearing.
- The complete UI suite verifies history restoration, retained follow-up context and topic-change clearing without aborting the new stream.

## Release and external gates

- PR **#356** passed all GitHub checks, including real Prisma/PostgreSQL bootstrap, financial and security regressions, and was merged as `028cc99d7910825dd57fcfbeea19fafbf8d62524`. Main-branch Python and Backend CI also passed.
- Vercel production deployment `dpl_HAsXzrtmkaz7Ejs3mZPSAvKTPWJ9` is **READY / PROMOTED** at that merge SHA and aliases `revluma.vercel.app`. The production sign-in route responds at `/auth/login.html`.
- Render `/ready` initially continued to report Node/Python `9749b716…`; final Task 211 Render revision verification remains pending until the new deployment is observed.
- A direct read-only production aggregate confirmed `revluma-test-store-v1.myshopify.com` is active and recently synced, but has **zero persisted findings**. No authenticated merchant session is available. Real selected-finding, multi-turn, navigation and refresh acceptance therefore remains blocked; synthetic fixtures, direct aggregates, readiness and a visible card cannot substitute for it.
