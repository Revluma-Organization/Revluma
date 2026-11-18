# Rev Unified Agent: Production Acceptance

**Status: BUILT AND MERGED. NOT VERIFIED IN PRODUCTION. NOT ACCEPTED.**
**Review date:** 2026-11-18 UTC
**Branch / PR:** `arena/e40fa28b-revluma`, PR [#415](https://github.com/Revluma-Organization/Revluma/pull/415). Based on `main` @ `f828937` (merge of PR #412).
**Rule:** a gate passes only with dated, reproducible evidence. A blocked gate is reported as blocked, never as passed. Evidence from synthetic providers is always labelled as such.

> The completion statement ("REV INTELLIGENCE — UNIFIED AI AGENT BUILT, MERGED, DEPLOYED AND VERIFIED IN PRODUCTION.") is **not** made. Gates 9 to 12 cannot pass from this environment (see section 13).

---

## 1. Executive result

Rev now has one authoritative LLM tool-use runtime behind merchant `/rev/stream` store-evidence questions. The earlier one-call selector has been removed rather than run alongside it.

- `python/src/agents/agent_gateway.py` is a new gateway with these properties:
  - It does native multi-turn tool calling over raw HTTP for Anthropic (`tool_use`/`tool_result`) and Gemini (`functionCall`/`functionResponse`).
  - It routes by declared capability.
  - It retries at most once, and falls back to another provider only when `AI_FALLBACK_PROVIDERS` authorises it.
  - It can cancel while a request is in flight.
  - It records the provider and model that actually answered, plus usage, for every call.
  - It runs provider-native web search: Anthropic `web_search_20250305` or Gemini `google_search`.
- `python/src/agents/rev_agent.py` is the bounded objective loop:
  - The model chooses which of the objective-filtered tools to call, sees each real result, judges sufficiency, and calls `finish_answer` or `request_clarification`.
  - Server code owns permissions, typed arguments, tenant scope and windows, budgets and all arithmetic.

**Root cause fixed along the way.** The previous Anthropic tool path called `messages.create(tools=…, tool_choice=…)` on the pinned `anthropic==0.25.8` SDK, which has no such parameters. With the default `AI_PROVIDER=anthropic`, the model-directed loop could never run in production, so every investigation used the deterministic fallback.

Production data in Supabase is consistent with this. Since 2026-11-09 there are 17 rows with empty `tool_calls`, null `metadata`, and placeholder provider/model values.

## 2. Architecture (as merged)

```
Browser (revStream.ts) ─SSE─> Node revController.chatStream ─SSE─> Python /rev/stream
  └ stream_investigation → run_investigation
      ├ L1 deterministic safeguards (prohibited actions, greetings, capability, coverage)
      ├ L2 model understanding (route_message / understanding.understand)
      ├ conversational / knowledge / web turns → responder (knowledge) | run_adaptive_web_research (web, on agent_gateway)
      └ store-evidence turns:
          store_health gate (server) → build_investigation_plan (domains, authorised capabilities)
          → rev_agent.run_agent  ◄── authoritative front door
              exposure = plan tools ∪ objective-adjacent tools (≤10, never store_health, never full catalogue)
              loop: agent_gateway.chat(tool_choice=required) → validated calls (≤3 parallel)
                    → run_tool(server-owned org/store/window) → compact PII-scrubbed tool_result → model
                    calculate (Decimal, evidence ids only) · web_research (public query guard)
                    finish_answer(answer, cited ids, hypotheses, unknowns, sufficiency) | request_clarification
          → deterministic facts / comparisons / claims / outcome / specialists over the same results
          → _agent_narrative: model prose accepted only if numbers ⊆ evidence ∪ facts ∪ calculations,
            no unsafe causal/financial/action language, cited ids exist; otherwise existing composition
          → guardrails → final (Node validateInvestigationResponse + validateQuestionOrchestration)
  Node persists sanitized execution_trace/agent_answer + actual model_name/model_provider/tokens/metadata.
```

If no provider is configured or the provider fails before any evidence exists, the established deterministic plan runs. It is labelled `model_directed: false` and `fallback_mode: deterministic_legacy_plan`. It is never presented as agent reasoning.

## 3. Requirement status

| Requirement | Status | Evidence |
|---|---|---|
| Model genuinely chooses tools, with typed schemas | **PASS (synthetic provider)** | `run_agent` uses only model-returned calls. `test_model_chooses_tool_sees_real_result…` and `test_rev_stream_store_question_runs_native_agent_end_to_end` cover this. |
| Tool exposure filtered by objective | **PASS** | `select_tool_exposure` returns at most 10 tools and never exposes `store_health`. Covered by `test_exposure_is_objective_filtered…`. |
| Multi-step with real tool-result feedback | **PASS (synthetic provider)** | Native `tool_result` blocks. Tests assert that the second turn carries the actual result. |
| Sufficiency evaluation, conditional calls, clarification | **PASS (synthetic provider)** | `finish_answer` carries `evidence_sufficiency`. `request_clarification` is terminal. A finish sent in the same turn as new evidence calls is deferred. |
| Bounds: calls, iterations, duration, per-tool time, tokens, cost, retries | **PASS** | `AgentBudget` defaults: 8 calls, 6 iterations, 75 s, 35 s per turn, 1,400 output tokens per turn, 90k total tokens, $0.50, 3 parallel calls, 2 malformed outputs, 2 web searches. Gateway retries at most once. Each bound has a test. A synchronous DB tool cannot be pre-empted; it is bounded by the DB statement timeout and slow calls are logged. |
| Cancellation | **PASS (local)** | Checked before every turn and tool. The in-flight provider call returns in under 2 s (`test_gateway_cancellation_returns_promptly`). |
| Retry / fallback, no silent substitution | **PASS (HTTP mocked)** | A 529 is treated as transient. A 401 does not fall back. A fallback records the actual provider and `fallback_used`. |
| Idempotency / duplicate protection | **PASS** | Identical calls are not re-executed. Request idempotency is unchanged: Node `acceptSubmission` plus the unique key `(org, conversation, role, correlation_id)`. |
| Partial-failure recovery | **PASS (local)** | A failed tool is fed back as "unknown, not zero" and the model adapts. A provider failure after evidence exists keeps the results (`partial_provider_failure`). |
| Malformed-output handling | **PASS** | Bounded at 2. Unknown citation ids are returned to the model once. Invalid arguments are rejected server-side. |
| Structured, privacy-safe traces | **PASS (local)** | `execution_trace.agent` includes `tool_calls`, `model_turns`, `stop_reason`, budget and validation. Node sanitises it to allowlisted tokens; a contract test proves that prompts, argument values and raw errors are dropped. |
| Evidence integrity: facts / calculations / interpretations / hypotheses / unknowns | **PASS (local)** | Deterministic facts and claims are unchanged. Model hypotheses are stored as `hypotheses_unverified` and never become facts. Unsupported numbers are rejected (`test_agent_answer_with_unsupported_number_falls_back…`). |
| Deterministic arithmetic; missing ≠ zero; no mixed currencies | **PASS** | `EvidenceLedger.calculate` uses Decimal and ROUND_HALF_UP. It refuses unavailable values, zero denominators and mixed currencies. |
| Abandoned checkout ≠ lost revenue | **PASS (existing guardrails + prompt)** | `_FINANCIAL_WORDS` guardrail plus the system policy. |
| Capability-aware gateway; actual provider/model recorded per call and answer | **PASS (local)**. Production **BLOCKED** | Gateway results and the Node columns `model_name`, `model_provider`, `input_tokens`, `output_tokens` and `metadata`. No hardcoded placeholders remain (contract test). |
| Knowledge boundaries: no fabricated corpus coverage | **PASS (honest unavailability)** | Shopify docs, ecommerce and Revluma corpora are still reported unavailable. Only tenant memory and the live web are configured. |
| Real web research with citations and honest failures | **PASS (synthetic provider)**. Live **BLOCKED** | Only verified HTTPS sources are listed, unverifiable URLs and bracket markers are stripped, and third-party causal claims are omitted with a note. With no search provider the answer says so explicitly. |
| Conversation memory and isolation | **PARTIAL** | Existing context-loader tests pass. The agent objective uses scoped history. Public web research receives no private context (route test). No live refresh test. |
| Security: tenant isolation, tool auth, injection, read-only, no SQL | **PASS (code and tests)**. Live **BLOCKED** | Server-owned scope. Allowlisted arguments: `organization_id` is rejected. Untrusted-data framing. Private web queries are rejected. No mutation tools exist. |
| General conversation / knowledge turns on the agent runtime | **NOT DONE (scoped out)** | Greetings, identity and knowledge still use the responder (unchanged). Web research now runs on the same gateway. |
| Parallel independent tools | **PASS (bounded)** | Up to 3 calls per turn, executed sequentially on the request's DB session because SQLAlchemy sessions are not thread-safe. |
| Caching | **PARTIAL** | Public web results are cached for 10 minutes by normalised query, with at most 64 entries and no tenant data. Tenant tool results are not cached; correctness is preferred. |

## 4. Changes in this PR

- **Python**
  - New: `agents/agent_gateway.py`, `agents/rev_agent.py`.
  - Rewritten: `agents/objective_agent.py`. It keeps the typed registry and validation, and web research now runs on the gateway.
  - Removed: `model_gateway.generate_tool_turn`.
  - `agents/investigation.py`:
    - the agent is the front door;
    - `_agent_narrative` validation;
    - the DB transaction is released before every model turn;
    - trace fields.
- **Node:** `revController.js` gains `_sanitizeExecutionTrace`, `_sanitizeAgentAnswer` and `_executionPersistenceFields`, applied at both insert sites.
- **Dashboard:** `skipped` step status. Previously it was coerced to `running`, and the answer was mislabelled "partial".
- **CI:** agent and web tests were added to the focused step of `rev-python-tests.yml`.
- **Config:** `REV_AGENT_*` variables are documented in `python/.env.example`.

## 5. Local validation

| Suite | Before (`f828937`) | After |
|---|---|---|
| Python, full (dummy `DATABASE_URL`) | 2,441 passed / 11 skipped | **2,469 passed / 11 skipped** |
| New agent/gateway/web tests | none | 30 + 6 (part of the above) |
| Backend `revPersistence.contract` | pass | **pass** (new assertions) |
| Backend full, local (no Prisma client) | 105/115 files | 105/115 files. The same 10 Prisma-dependent files fail before and after; hosted CI is authoritative. |
| Dashboard vitest | 1,402 | **1,404 passed** |
| Dashboard build | ok | **ok** |
| ESLint on changed files | — | 0 errors (1 pre-existing warning) |
| `tsc -p tsconfig.app.json` | 105 errors | 105 errors (pre-existing, unchanged) |
| `compileall`, pyflakes on new files | — | clean |

## 6. Hosted CI

All 8 contexts are **SUCCESS** on PR #415 at code head `2f77316`:

- Backend test suite
- backend
- Prisma bootstrap, financial and security regressions (PostgreSQL)
- python-regressions (PostgreSQL 16; includes the new focused agent step)
- Dashboard suite and production build
- dashboard
- Vercel
- Vercel Preview Comments

Branch-protection API: HTTP 403, so required-review configuration cannot be inspected.

## 7. Provider evidence

**No real provider call was made by this agent.** No `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` is present in the sandbox. `gh secret list` returns HTTP 403, and no workflow references secrets.

Every provider interaction in the tests is synthetic:

- either a scripted `agent_gateway.chat`;
- or a fake `httpx.Client` that returns the documented wire formats.

## 8. Acceptance scenarios (mocked vs real clearly separated)

| # | Scenario | Mocked / local | Real provider and production |
|---|---|---|---|
| 1 | Revenue decline: the model selects revenue evidence, adapts, and finishes grounded | PASS | BLOCKED |
| 2 | Multi-domain follow-through to adjacent tools | PASS (exposure + parallel tests) | BLOCKED |
| 3 | Failed tool → adaptation, unknown ≠ zero | PASS | BLOCKED |
| 4 | Provider unavailable → labelled deterministic fallback | PASS | BLOCKED |
| 5 | Provider fails after evidence → partial preserved | PASS | BLOCKED |
| 6 | Fallback records the actual provider/model, with no silent substitution | PASS | BLOCKED |
| 7 | Cancellation before start and in flight | PASS | BLOCKED |
| 8 | Iteration / tool / token / cost / deadline bounds | PASS | BLOCKED |
| 9 | Malformed output and unknown citations | PASS | BLOCKED |
| 10 | Deterministic calculation over evidence ids; refusals | PASS | BLOCKED |
| 11 | Unsupported number in model prose → rejected | PASS | BLOCKED |
| 12 | Clarification request | PASS | BLOCKED |
| 13 | Tenant/argument injection rejected server-side | PASS | BLOCKED |
| 14 | Private data never reaches the public web query | PASS | BLOCKED |
| 15 | Web research: verified citations, unverifiable URLs stripped | PASS | BLOCKED |
| 16 | Web search without sources → honest failure | PASS | BLOCKED |
| 17 | `/rev/stream` SSE end to end with valid step/final contract | PASS | BLOCKED |
| 18 | Persistence of the actual provider/model/tokens with a sanitized trace | PASS (contract) | BLOCKED (needs a live answer row) |
| 19 | Follow-up retains context; unrelated question isolated | PASS (existing suites) | BLOCKED |
| 20 | Before/after latency and cost | NOT MEASURED (synthetic timings are not production performance) | BLOCKED |

## 9. Merge

PR #415 is merged into `main` only after the hosted checks pass, using `gh pr merge --merge`. The merge SHA is recorded in section 14.

## 10. Deployment

- **Frontend (Vercel):** the deployment is verified through the Vercel connector (section 14).
- **Node and Python (Render):** **BLOCKED.** There is no Render connector or credentials and no egress. Merging to `main` may trigger Render auto-deploy, but that cannot be confirmed. Deployment success is **not** claimed.

## 11. Live production tests A–F (`revluma-test-store-v1.myshopify.com`)

**NOT RUN (BLOCKED).** Running them needs:

- an authenticated merchant session;
- egress to production;
- confirmation that the Render Python service runs the merged revision with a provider key.

## 12. Sanitized production traces

None captured, for the reasons in section 11.

After deployment, a read-only Supabase query should show non-null `model_provider`, `model_name` and `input_tokens` on new `conversation_messages` rows. This can be used to confirm that Render picked up the change. As of this report, no rows newer than 2026-11-14 exist.

## 13. Blockers and what is needed to close them

1. **Provider key on Render Python.** Set `AI_PROVIDER` and `ANTHROPIC_API_KEY` (or `GEMINI_API_KEY`) on `revluma-python-p7j2`. Optionally set `AI_FALLBACK_PROVIDERS`. Without a key the agent reports `provider_unavailable` and the labelled deterministic fallback runs.
2. **Render deploy verification.** Confirm the deployed commit and health for `revluma-python-p7j2` and `revluma-backend-vrsd`. That needs Render dashboard access, a Render connector, or a deploy hook.
3. **Authenticated live tests A–F.** A human or an authorised test harness needs to run them against the test store and share redacted correlation ids. Those ids can then be checked read-only in Supabase.
4. **Optional: CI provider secret.** A non-production key exposed to a dedicated, manually triggered workflow would enable recorded real-provider integration tests.

## 14. Final CI, merge and deployment record

- **CI:** 8/8 SUCCESS at `2f77316` (section 6). This report commit is re-checked before merge.
- **Merge:** via `gh pr merge 415 --merge`. The merge SHA and the Vercel production deployment id are posted as a comment on PR #415 after verification, because this branch cannot push to `main`.
- **Render (Node/Python):** not verifiable (section 10).
- **Live A–F:** not run (section 11).

**Disposition: BUILT, CI-GREEN, MERGED. NOT VERIFIED IN PRODUCTION. NOT ACCEPTED** until gates 10 to 12 have evidence.
