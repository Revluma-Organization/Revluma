# Rev Unified Agent — Production Acceptance

**Status: IN PROGRESS — NOT PRODUCTION ACCEPTED**
**Review date:** 2026-11-13 UTC
**Branch:** `arena/542c36f7-revluma` (active), based on `b1e2cc4dd882113da105dc4ce0a586c5ea733ded`
**Acceptance rule:** No production-completion claim is valid until every mandatory item below has dated, reproducible evidence.

## Executive result

The first implementation slice adds a provider-backed, model-directed tool-call loop to the existing Python investigation runtime. The loop can select from an intent- and capability-filtered subset of the established read-only merchant tool registry, execute typed calls using server-owned organization/store/date scope, and feed sanitized real results back before the next selection. Deterministic evidence aggregation, calculations, validation, and narrative remain authoritative. The actual merchant `/rev/stream` route reaches this runtime.

This is **not** proof of full production readiness. The implementation is not merged or deployed; provider tool calls have only been mocked in tests; production backend revisions and live merchant/provider acceptance remain unverified. Legacy deterministic tool planning remains an explicit fallback when model-directed selection is unavailable, with `model_directed: false` and a fallback reason in orchestration metadata.

## Requirement status

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Genuine LLM-selected tool calls with result feedback | **PASS — local behavior, provider mocked** | `python/src/agents/model_gateway.py` implements Gemini function calling and Anthropic tool use; `python/src/agents/objective_agent.py` executes one selected call per round and includes the sanitized actual result in the next provider turn. Behavior tests cover adapting from revenue to order evidence. Live provider execution remains unverified. |
| Active merchant `/rev/stream` integration | **PASS — local integration test** | The objective loop is invoked within `python/src/agents/investigation.py` after authenticated scope and plan resolution; selected `ToolResult`s enter the existing evidence aggregation path. `test_model_selected_evidence_tools_feed_the_existing_stream_result` verifies the wired result/trace path. |
| Typed, authorized, tenant-scoped, read-only tools | **PASS — code and local tests** | Model schemas expose only server-allowlisted filters; arguments are revalidated; no tenant/store/date identifiers, SQL, or Shopify writes are model-controlled. Existing `run_tool` binds authenticated organization context and store scope. Local integration checks organization-scoped DB statements. Production authorization testing remains pending. |
| Iteration, call, time, token, and cost bounds | **PASS — configured local implementation; production config not verified** | Objective loop limits 6 tool calls, 8 model turns, per-turn output, an overall 16,000-token budget, per-turn timeout no larger than 12 seconds, the investigation deadline, and an estimated USD ceiling (`REV_AGENT_MAX_ESTIMATED_COST_USD`, default $2; default input/output rate guards $100 per million tokens). Actual provider usage is recorded where returned. Actual vendor billing prices/configuration must be verified before accepting the cost ceiling in production. |
| Failure handling, cancellation, partial success | **PARTIAL** | Tool failures are returned as bounded unavailable evidence and later tool selection can adapt; provider exhaustion is explicit; legacy fallback is flagged. Cancellation is checked between model turns, but an in-flight synchronous provider request can run until its bounded request timeout (up to 12 seconds); immediate provider-call cancellation and production retry/partial-success acceptance remain outstanding. |
| Provider/model telemetry | **PASS — local code/tests** | The actual provider/model and provider token usage are surfaced in the objective trace and provider metrics. Live production telemetry has not been observed. |
| Evidence/uncertainty boundaries and deterministic calculations | **PASS — existing pipeline preserved; regression suite passes** | Objective selection does not author merchant narrative or numerical conclusions; the established deterministic evidence/calculation/validation path remains in use. This does not certify live data freshness or quality. |
| General conversation / knowledge turns | **PARTIAL** | The existing authenticated `/rev/stream` gate still handles greetings, explanations, definitions, advice, and identity turns through the existing responder path. The new dynamic tool loop currently covers store-data investigations only; a single generalized agent cycle for all ordinary turns is not yet implemented or accepted. |
| Public web research and current information | **PARTIAL / NOT ACCEPTED** | Existing Gemini Google Search grounding route is preserved; it is not yet a function-loop capability. No live current-source URL/freshness verification was performed. |
| Conversation continuity/isolation | **PARTIAL** | Store-investigation objective input receives only the already-loaded current tenant/user conversation context, with untrusted text boundaries; existing history-isolation tests pass. No persistent cross-worker idempotency/deduplication guarantee was added for provider-costing read requests. Dedicated authenticated follow-up, cancellation, repeat-request, and cross-tenant acceptance remains required. |
| Frontend build | **PASS — local** | `npm run build` in `Frontend/Dashboard` succeeded (Vite 7.3.7; 2,251 modules). Vite reported a >500 kB JS chunk advisory. |
| Frontend lint | **PASS with warnings — local** | `npm run lint`: 0 errors, 21 pre-existing hook/Fast Refresh warnings; no automated fixes applied. |
| Frontend tests | **PASS — local** | Full Dashboard rerun: **1,399 passed, 0 failed** in 58 files. The initial pending-sync expectation was reconciled: explicit `pending` and `in_progress` are active; ambiguous `awaiting_verified_sync` is not. |
| Python test suite | **PASS — local, not production evidence** | Final local `DATABASE_URL='postgresql+psycopg2://test:test@127.0.0.1:1/test' .venv/bin/pytest -q`: **2,438 passed, 11 skipped, 16 warnings in 11.36s**. This dummy unreachable DSN does not validate a live database; CI's PostgreSQL-backed suite remains required. |
| Backend Node tests/build | **FAIL / BLOCKED FOR TRIAGE** | Local `npm test -- --runInBand` failed because generated Prisma client `Backend/node_modules/.prisma/client/default` is missing, and `npm run prisma -- generate` cannot fetch its schema-engine from the sandbox's blocked `binaries.prisma.sh` host. Hosted GitHub Actions successfully installed/generated Prisma and validated/bootstrap the schema, but all three backend suite jobs failed at the test-suite step. Logs are inaccessible from this sandbox, so the specific assertion is unknown and must be triaged via an authorized Actions-log viewer. The isolated modified `revQuestionOrchestration.test.js` passed (**6/6**). No production migrations were run. |
| CI/security checks, merge, deployment | **BLOCKED / NOT ACCEPTED** | Commit `ac73cf3` is pushed to the current branch and Draft PR [#412](https://github.com/Revluma-Organization/Revluma/pull/412) is open. GitHub checks: `python-regressions` PASS, `dashboard` PASS, `Dashboard suite and production build` PASS, Vercel preview PASS; `Backend test suite`, release-candidate `Prisma bootstrap, financial and security regressions`, and separate `backend` check FAILED at their backend test-suite steps. The exact test assertion is not retrievable from this sandbox because Actions log download redirects to an inaccessible `results-receiver.actions.githubusercontent.com` host; check annotations only report exit code 1. Branch protection query returned HTTP 403 `Resource not accessible by integration`; merge rules cannot be independently inspected. No merge or production deployment occurred. |
| Authenticated production acceptance | **NOT RUN** | No live provider, public-web, merchant-evidence, follow-up/isolation, failure, or security trace has been captured. |

## Local validation evidence

1. Python compile check: `python -m compileall -q python/src python/tests` — passed after final agent tests.
2. Whitespace check: `git diff --check` — passed after final agent tests.
3. Focused Python tests: **114 passed** across objective agent, model gateway, failure routing, orchestration, and investigation tests (before two final edge-case regressions were added).
4. Final full Python suite: **2,438 passed, 11 skipped, 16 warnings in 11.36s** (dummy unreachable PostgreSQL DSN; not a live DB check).
5. Dashboard production build: succeeded; one large-chunk advisory.
6. Dashboard full tests: **1,399 passed, 0 failed** in 58 files.
7. Dashboard lint: 0 errors and 21 warnings.
8. Isolated modified Backend orchestration test: **6/6 passed** locally. Local full Backend suite cannot start because the Prisma client is absent and schema-engine generation cannot reach `binaries.prisma.sh`.
9. Draft PR #412 CI: Python, Dashboard, and Vercel preview checks passed. The full Backend test workflow, separate backend workflow, and release-candidate workflow failed in their backend test-suite step. The release-candidate run passed Prisma install/validation/bootstrap, schema drift checks, migration application, and model-existence checks before backend tests failed; later financial/security/integration acceptance steps were skipped. GitHub check annotations contain only generic exit code 1. Signed Actions log retrieval failed with EOF from `results-receiver.actions.githubusercontent.com`, so the failing assertion is unverified.

## External deployment observations (baseline only)

- Earlier Vercel metadata showed the current production deployment READY at SHA `ea44aaffa4e9e8294ccb24ed962062a5faf52e6e`, not this task branch. This is metadata only and says nothing about Node/Python deployment.
- Earlier Supabase metadata showed project `jblpgqmbgdlzitprudgt` with only the default DB branch reported as `FUNCTIONS_DEPLOYED`; this is not evidence that the Node or Python application is deployed.
- GitHub CLI authenticated successfully; Draft PR #412 is open from the task branch. Its Vercel preview check passed; this is not a production deployment. GitHub branch protection is not queryable with the current integration (HTTP 403). The GitHub Actions test logs cannot be downloaded from the sandbox because the signed log host is not accessible, so the exact backend assertion failure remains unknown.

## Mandatory remaining acceptance gates

- Keep the Draft PR open; obtain the failed Backend Actions logs through an authorized GitHub UI/session (the signed log host is outside this sandbox's egress policy), identify and fix the exact failed assertion(s), then rerun the complete CI checks.
- Resolve the local Prisma generated-client/network limitation only through approved infrastructure; do not bypass the blocked host or vendor an unverified engine.
- Review dependency/security checks and branch protections before merge; the current GitHub integration returns HTTP 403 for the protection endpoint. Existing work is committed in `ac73cf3` and the acceptance document remains tracked on the branch.
- Prove provider-native Gemini and Anthropic function selection/result feedback against non-production credentials without exposing secrets or merchant PII.
- Exercise model prompt injection, invalid arguments, cross-tenant attempts, unavailable sources, cancellation, retries, partial results, repeated requests, follow-up isolation, and cost/latency caps end-to-end.
- Verify live public research source URLs and freshness; test authenticated Shopify investigations with traceable source, coverage, freshness, uncertainty, and deterministic arithmetic.
- Merge only through approved controls; separately deploy the Dashboard, Node backend, and Python service; verify each deployed revision against the merged SHA.
- Run authenticated production acceptance for general intelligence, current web research, merchant investigation, follow-up/isolation, failure handling, and security. Record timestamps, revision IDs, redacted correlation/execution IDs, observed provider/model, outcomes, and reproducible evidence here.

**Final disposition:** **FAIL / NOT ACCEPTED until all mandatory gates above are verified.**
