# Rev agent runtime: baseline inspection (2026-11-18)

Baseline: `main` @ `f828937` (merge of PR #412), inspected on branch `arena/e40fa28b-revluma`.

## What existed

| Area | State at `f828937` | Gap |
|---|---|---|
| Tool loop | `objective_agent.run_objective_tool_loop` ran only after `build_investigation_plan`. Its candidate tools were the plan tools minus `store_health`. Each turn was a single forced tool call, and the history was re-serialised into one user prompt. The legacy deterministic plan ran when this failed. | The model could only reorder or skip plan tools. It could not follow evidence into related domains, make parallel calls, judge sufficiency itself, or write the answer. |
| Anthropic tool calling | `model_gateway.generate_tool_turn` called `anthropic.Anthropic().messages.create(tools=..., tool_choice=...)`. | **The pinned SDK, `anthropic==0.25.8`, has no `tools` or `tool_choice` parameters.** With the default `AI_PROVIDER=anthropic`, the agent path could never run, so production always fell back to the deterministic plan. |
| Web research | Gemini `google_search` grounding only (`responder.compose_web_research`). | With Anthropic as primary, current-information questions could not be researched. Third-party causal sentences could also make the final guardrail raise `VALIDATION_ERROR`. |
| Arithmetic | Deterministic comparisons existed inside tools. | The model had no way to request a calculation, so any figure it did not find in the evidence was either refused or derived by the model itself. |
| Persistence | Both `conversation_messages` insert sites hardcoded `model_name='investigation-pipeline'` and `model_provider='rev-model-gateway'`. `_boundedResultForPersistence` dropped `execution_trace`. | The actual provider, model and tokens were never recorded per answer. Supabase shows 17 recent rows with empty `tool_calls`, null `metadata` and the placeholder provider. |
| Stream UI | The agent emitted `step` events with `status: "skipped"`. | `revStream.ts` coerced unknown statuses to `running`, so skipped sources showed a perpetual spinner and marked answers "partial". |

## Blockers (outside the repository)

1. **No egress from the sandbox to Render, Vercel or production.** `curl` to `*.onrender.com` and `revluma.vercel.app` returns `SSL_ERROR_SYSCALL`.
2. **No model-provider keys in the sandbox**, and `gh secret list` returns HTTP 403. No workflow references secrets, so CI cannot make real provider calls either.
3. **No Render connector or credentials.** The Node (`revluma-backend-vrsd`) and Python (`revluma-python-p7j2`) services are configured outside the repo, with no `render.yaml`. Their deployed revisions and health cannot be verified from here.
4. **No authenticated merchant session for `revluma-test-store-v1.myshopify.com`.** Live production tests A–F cannot be executed by this agent.

Vercel (frontend) and Supabase (read-only SQL) are reachable through connectors and are used for the evidence they can provide.

## Plan executed

Build `agent_gateway` (native multi-turn tool calling over raw HTTP for Anthropic and Gemini) and `rev_agent` (bounded objective loop). Make them the front door of the merchant evidence path in `run_investigation`. Rebuild web research on the capability-aware gateway. Persist the real provider, model and tokens. Fix the stream-status contract. Add tests for every bound and invariant. Then validate, open the PR, merge, and verify what can be verified.
