# TASK 207 — Validation record

## Local commands and results

- `PYTHONPATH=/tmp/revdeps:python DATABASE_URL=postgresql://test:test@localhost:5432/test python -m pytest -q python/tests` — **1,870 passed, 11 skipped**. A preceding audit regression run found four follow-up-routing failures; the deterministic general-knowledge refusal was narrowed to context-free questions, the focused 58-test rerun passed, and this full suite confirms the fix.
- `cd Backend && npm test` — **86 test files passed**.
- `cd Frontend/Dashboard && npm run build` — **passed**, 2,881 modules; chunk-size and dependency-audit warnings remain non-blocking and pre-existing.
- `git diff --check`, Python compileall and Node syntax checks — passed.

## Behavioral coverage

The Task 207 suite verifies disconnected/revoked/expired/missing-permission states, running/stale/failed sync, network/throttling/API/database classes, permanent versus transient retry, partial source survival, unsupported resources, no-store versus storage failure, insufficient/predating/incomplete/unknown history, certified zero, narrower periods, unsupported external data/payment providers/causation/guarantees/forecasts/actions/general knowledge, ambiguity, tenant-safe outcomes, JSON/SSE parity, and persisted retry/reconnection/narrower-period continuity.

Mocks establish contract behavior only. They do not prove live Shopify state or production authorization. Real Prisma/PostgreSQL and release verification remain CI requirements; authenticated production JSON/SSE and recovery conversations remain deployment acceptance requirements.
