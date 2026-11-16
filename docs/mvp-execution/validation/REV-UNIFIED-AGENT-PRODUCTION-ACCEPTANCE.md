# Rev Unified Agent — Production Acceptance

**Status: IN PROGRESS — NOT PRODUCTION ACCEPTED**
**Review date:** 2026-11-13 UTC
**Branch:** `arena/542c36f7-revluma` (PR #412 open), based on `b1e2cc4dd882113da105dc4ce0a586c5ea733ded`
**Acceptance rule:** No production-completion claim is valid until every mandatory item below has dated, reproducible evidence.

## Executive result

The first implementation slice adds a provider-backed, model-directed tool-call loop to the existing Python investigation runtime. The loop can select from an intent- and capability-filtered subset of the established read-only merchant tool registry, execute typed calls using server-owned organization/store/date scope, and feed sanitized real results back before the next selection. Deterministic evidence aggregation, calculations, validation, and narrative remain authoritative. The actual merchant `/rev/stream` route reaches this runtime.

This is **not** proof of full production readiness. The implementation is not merged or deployed; provider tool calls have only been mocked in tests; production backend revisions and live merchant/provider acceptance remain unverified. Legacy deterministic tool planning remains an explicit fallback when model-directed selection is unavailable, with `model_directed: false` and a fallback reason in orchestration metadata.

## Requirement status

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Genuine LLM-selected tool calls with result feedback | **PASS — local behavior, provider mocked** | `python/src/agents/model_gateway.py` implements Gemini function calling and Anthropic tool use; `python/src/agents/objective_agent.py` executes one selected call per round and includes the sanitized actual result in the next provider turn. Behavior tests cover adapting from revenue to order evidence. |
| Real provider and multi-step execution | **NOT RUN / BLOCKED** | `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `AI_PROVIDER`, and `AI_FALLBACK_PROVIDERS` are all unset in this workspace. Existing provider and tool-call tests are mocked; no provider/model has been observed and no genuine dynamic selection, web search, citation, or follow-up tool-result cycle has run. Configure an approved non-production credential through secure infrastructure before integration acceptance; do not paste secrets into chat. |
| Active merchant `/rev/stream` integration | **PASS — local integration test** | The objective loop is invoked within `python/src/agents/investigation.py` after authenticated scope and plan resolution; selected `ToolResult`s enter the existing evidence aggregation path. `test_model_selected_evidence_tools_feed_the_existing_stream_result` verifies the wired result/trace path. |
| Typed, authorized, tenant-scoped, read-only tools | **PASS — code and local tests** | Model schemas expose only server-allowlisted filters; arguments are revalidated; no tenant/store/date identifiers, SQL, or Shopify writes are model-controlled. Existing `run_tool` binds authenticated organization context and store scope. Local integration checks organization-scoped DB statements. Production authorization testing remains pending. |
| Iteration, call, time, token, and cost bounds | **PASS — configured local implementation; production config not verified** | Objective loop limits 6 tool calls, 8 model turns, per-turn output, an overall 16,000-token budget, per-turn timeout no larger than 12 seconds, the investigation deadline, and an estimated USD ceiling (`REV_AGENT_MAX_ESTIMATED_COST_USD`, default $2; default input/output rate guards $100 per million tokens). Actual provider usage is recorded where returned. Actual vendor billing prices/configuration must be verified before accepting the cost ceiling in production. |
| Failure handling, cancellation, partial success | **PARTIAL** | Tool failures are returned as bounded unavailable evidence and later tool selection can adapt; provider exhaustion is explicit; legacy fallback is flagged. Cancellation is checked between model turns, but an in-flight synchronous provider request can run until its bounded request timeout (up to 12 seconds); immediate provider-call cancellation and production retry/partial-success acceptance remain outstanding. |
| Provider/model telemetry | **PASS — local code/tests** | The actual provider/model and provider token usage are surfaced in the objective trace and provider metrics. Live production telemetry has not been observed. |
| Evidence/uncertainty boundaries and deterministic calculations | **PASS — existing pipeline preserved; regression suite passes** | Objective selection does not author merchant narrative or numerical conclusions; the established deterministic evidence/calculation/validation path remains in use. This does not certify live data freshness or quality. |
| General conversation / knowledge turns | **NOT COMPLETE** | Code inspection of `_run_investigation_core` confirms greetings, identity, general, clarification, and knowledge intents return from `_conversation_result` before `run_objective_tool_loop`; the loop only runs after the merchant evidence plan. General turns therefore still use separate responder paths. |
| Shopify/ecommerce knowledge retrieval | **NOT COMPLETE** | `knowledge_retrieval.py` classifies public Shopify docs and ecommerce knowledge but marks those collections unavailable; only tenant-memory and live-web adapters are configured. No Shopify/ecommerce retrieval corpus or execution behavior is wired into the objective loop. |
| Public web research and current information | **PARTIAL / NOT ACCEPTED** | Existing Gemini Google Search grounding call remains a separate `compose_web_research` responder, not a capability in the model-directed tool loop. No live current-source URL/freshness verification was performed. |
| Multi-domain investigation and follow-up reasoning | **PARTIAL / NOT ACCEPTED** | The objective tool loop picks one evidence tool per turn from the preplanned merchant candidate list; it does not currently authorize public knowledge/web tools or establish unified multi-domain planning. Conversation context provides some inherited scope, but broader refresh/follow-up/isolation acceptance is missing. |
| Conversation continuity/isolation | **PARTIAL / NOT ACCEPTED** | Store-investigation objective input receives already-loaded server-scoped context; local tests cover inherited investigation/segment and isolation from unrelated knowledge turns. No authenticated refresh/follow-up browser test, adversarial cross-tenant production test, or persistent cross-worker idempotency/deduplication guarantee was added. |
| Prompt injection / private-data leak resistance | **PARTIAL** | Model input is labeled untrusted and model-call schema/arguments are allowlisted; public knowledge/web routes omit private tenant memories by policy and have mocked route-isolation tests. No full adversarial prompt-injection suite or genuine provider execution test has been run. |
| Read-only execution / tenant-user isolation | **PARTIAL — local code/tests** | Candidate tools are existing merchant read-only handlers, query scope is server-owned, and organization-scoped DB parameter tests exist. No authenticated cross-organization/user acceptance or real-provider authorization exercise has run. |
| Caching and context reuse | **NOT ACCEPTED** | No new bounded cross-request agent-response or tool-result cache was introduced or validated. Context reuse follows the existing persistence path only; cache privacy, invalidation, and tenant-key tests remain absent. |
| Parallel independent operations | **NOT IMPLEMENTED** | The current objective loop intentionally selects and executes one capability per model turn to inspect the real result before adapting. There is no dependency-aware parallel execution path or behavior test for independent tool batches. |
| Privacy-safe execution traces | **PARTIAL — code only** | Telemetry records bounded provider/model/tool/status metadata and redacted identifiers; no live trace audit was performed to prove that user text, tool payloads, or merchant identifiers never enter logs across all services. |
| Failures, retries, timeouts, cancellation | **PARTIAL — mocked/local** | Unit tests cover provider errors, a failed tool followed by adaptation, deadline bounds, and cancellation before the first provider call. Provider gateway retry tests are mocked; an in-flight synchronous provider request cannot be interrupted immediately and remains bounded by timeout. No real-provider outage/retry/cancellation test ran. |
| Evidence reconciliation and deterministic calculations | **PASS — existing pipeline/local tests; live evidence unverified** | Existing deterministic merchant evidence aggregation, arithmetic, and narrative guardrails remain authoritative and their local regressions pass. No live provider/merchant acceptance establishes production data freshness, domain reconciliation, or evidence quality. |
| Frontend build | **PASS — local** | `npm run build` in `Frontend/Dashboard` succeeded (Vite 7.3.7; 2,251 modules). Vite reported a >500 kB JS chunk advisory. |
| Frontend lint | **PASS with warnings — local** | `npm run lint`: 0 errors, 21 pre-existing hook/Fast Refresh warnings; no automated fixes applied. |
| Frontend tests | **PASS — local** | Full Dashboard rerun: **1,399 passed, 0 failed** in 58 files. The initial pending-sync expectation was reconciled: explicit `pending` and `in_progress` are active; ambiguous `awaiting_verified_sync` is not. |
| Python test suite | **PASS — local, not production evidence** | Final local `DATABASE_URL='postgresql+psycopg2://test:test@127.0.0.1:1/test' .venv/bin/pytest -q`: **2,438 passed, 11 skipped, 16 warnings in 11.36s**. This dummy unreachable DSN does not validate a live database; CI's PostgreSQL-backed suite remains required. |
| Backend Node tests/build | **FAILURE IDENTIFIED; FIX AWAITING COMPLETE CI** | All three diagnostic reruns at `bb57715` failed in `shopify.callback.test.js`, `verifyPersistedStoreIsReturnedWithoutCredentials:270`: expected `complete`, actual `unknown`. The success fixture had only `last_synced_at`, not a recorded completed sync; this branch intentionally no longer infers completion from that timestamp. Preserve all existing assertions, add explicit completion/domain evidence to the success fixture and add a timestamp-only fail-closed regression. Both affected local files pass; this is **not** a full-suite result. The local Prisma client remains unavailable because engine generation is blocked, including the official `generate --no-engine` attempt; standard Prisma-backed hosted suites remain required. No production migrations ran. |
| CI/security checks, merge, deployment | **BLOCKED / NOT ACCEPTED** | Draft PR [#412](https://github.com/Revluma-Organization/Revluma/pull/412) remains open. Exact Backend assertions and stacks were retrieved through GitHub check annotations from all three full diagnostic reruns at `bb57715` (see triage record below); no root cause was guessed. All three failed at the same callback fixture assertion. Fixes must pass all complete workflows, including downstream real-PostgreSQL checks. Branch-protection API remains HTTP 403; full review and provider/security acceptance are outstanding. No merge or production deployment occurred. |
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
9. Diagnostic full-suite reruns at `bb57715` exposed the exact callback assertion in all three Backend checks. Earlier signed raw logs remain inaccessible, but the current failure output is now accessible through bounded, redacted check annotations; see the exact job links below. A previous CI Dashboard failure is separately reproduced as a delayed-history draft/attachment/submission race; three new regressions fail before the fix and pass after it, and the complete `RevIntell.test.tsx` file passes **195/195**. Complete post-fix CI and Dashboard suite reruns are still required.

## Backend failure triage (actual execution, not inferred)

The original signed logs for runs `43844535556`, `43844535523`, and `43844535469` still redirect outside the sandbox egress allowlist. The authorized alternative is the existing GitHub Checks API: the Backend runner now emits redacted failure tails, handles plain assertions as well as TAP, and continues to execute every discovered test file before returning a failing aggregate exit status. No assertion or test was removed or skipped. Diagnostic output stays below Actions' observed 4,096-character annotation truncation limit.

At implementation-equivalent diagnostic head `bb57715526f422cd3918e82f2eca0b5d3a8e5f61`, **all three complete-suite reruns identify the same failure**:

| Workflow | Exact run/job | Retrieved failure |
|---|---|---|
| Backend tests (Node 22) | [43849148146 / 133236890828](https://github.com/Revluma-Organization/Revluma/actions/runs/43849148146/job/133236890828) | `verifyPersistedStoreIsReturnedWithoutCredentials`, `shopify.callback.test.js:270:10`, actual `unknown`, expected `complete`. |
| Backend refresh regression (Node 20) | [43849148250 / 133236890977](https://github.com/Revluma-Organization/Revluma/actions/runs/43849148250/job/133236890977) | Same named assertion, line, actual and expected values. |
| Release candidate, Prisma-backed (Node 22/PostgreSQL 16) | [43849148155 / 133236891263](https://github.com/Revluma-Organization/Revluma/actions/runs/43849148155/job/133236891263) | Same named assertion, line, actual and expected values. Schema/bootstrap setup had succeeded before tests. |

Exact common assertion/stack excerpt:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ 'unknown'
- 'complete'
    at verifyPersistedStoreIsReturnedWithoutCredentials (.../shopify.callback.test.js:270:10)
    at async .../shopify.callback.test.js:317:3
```

**Classification:** a branch-introduced test-fixture/contract mismatch, not a Prisma-generation or CI-infrastructure failure. Running the unchanged callback test with the base commit's `storeController.js` passed; the branch's controller reproduced the exact assertion locally. The intentional status correction in this branch stopped inferring sync completion from `last_synced_at`. The legacy success fixture supplied only that timestamp, with no `initial_sync_status` or completed domain rows. The fix preserves the original `complete`/credential-removal assertions, supplies explicit completed-sync evidence to the success fixture, strengthens its domain-completion assertions, and adds a timestamp-only regression that must remain `unknown`. The production fail-closed logic is not rolled back to make the test green.

**Separate Dashboard finding:** run `43847892000`, job `133232602594`, reports `normalises a legacy structured attachment response before rendering it` at `RevIntell.test.tsx:187` (answer render spy called zero times). A deferred-history reproduction proves the existing auto-resume effect can navigate to conversation A after composition begins, resetting an image/draft or aborting a submission. Three new deterministic behavior regressions fail before and pass after guarding auto-resume once composition starts. The original attachment-normalization assertion is unchanged. This is a pre-existing continuity race surfaced by CI, not a reason to extend timeouts or weaken the test.

## External deployment observations (baseline only)

- Earlier Vercel metadata showed the current production deployment READY at SHA `ea44aaffa4e9e8294ccb24ed962062a5faf52e6e`, not this task branch. This is metadata only and says nothing about Node/Python deployment.
- Earlier Supabase metadata showed project `jblpgqmbgdlzitprudgt` with only the default DB branch reported as `FUNCTIONS_DEPLOYED`; this is not evidence that the Node or Python application is deployed.
- GitHub CLI authenticated successfully; Draft PR #412 is open from the task branch. A Vercel preview success is not a production deployment. GitHub branch protection is not queryable with the current integration (HTTP 403). Signed Actions log downloads remain blocked; exact Backend assertions and stacks are now available through the Checks API diagnostics described above.

## Mandatory remaining acceptance gates

- Keep the Draft PR open; verify the identified Backend fixture correction and Dashboard continuity fix in all complete CI suites, then inspect downstream release-candidate failures if any. Preserve the exact pre-fix traces above; signed historical logs remain unavailable, not silently substituted with an isolated-test pass.
- Resolve the local Prisma generated-client/network limitation only through approved infrastructure; do not bypass the blocked host or vendor an unverified engine.
- Review dependency/security checks and branch protections before merge; the current GitHub integration returns HTTP 403 for the protection endpoint. Existing work is committed in `ac73cf3` and the acceptance document remains tracked on the branch.
- Prove provider-native Gemini and Anthropic function selection/result feedback against non-production credentials without exposing secrets or merchant PII.
- Exercise model prompt injection, invalid arguments, cross-tenant attempts, unavailable sources, cancellation, retries, partial results, repeated requests, follow-up isolation, and cost/latency caps end-to-end.
- Verify live public research source URLs and freshness; test authenticated Shopify investigations with traceable source, coverage, freshness, uncertainty, and deterministic arithmetic.
- Merge only through approved controls; separately deploy the Dashboard, Node backend, and Python service; verify each deployed revision against the merged SHA.
- Run authenticated production acceptance for general intelligence, current web research, merchant investigation, follow-up/isolation, failure handling, and security. Record timestamps, revision IDs, redacted correlation/execution IDs, observed provider/model, outcomes, and reproducible evidence here.

**Final disposition:** **FAIL / NOT ACCEPTED until all mandatory gates above are verified.**
