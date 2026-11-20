# Rev Intelligence — AI/LLM engineering audit and handoff (20 Nov 2026)

**Inspected reference:** `main@6bcf737a66515266b9eeac5b37e21386039d3560` (read through the connected `srdataml-droid` GitHub account).
**Scope:** Rev Intelligence, Shopify-only, read-only operational advisor. No store modifications, messaging execution, speculative financial forecasts, model training, new orchestration framework, or changes to merchant authorization.
**Verification status:** **SOURCE/REPORT AUDIT ONLY**. The audit author did not run current-revision tests, authenticate as a merchant, inspect deployed provider environment, or run a production conversation in this session. Historical results below are not current-release passes.

## Short conclusion

**Repair, validate, and certify; do not rebuild.** The essential Node → Python → evidence → answer architecture already exists. The biggest remaining work is **cross-component, current-SHA, authorized real-store acceptance; merchant-centered adversarial evaluation; model and operating-cost measurement; and precise documentation of any actual failing cases**. Do not mark a feature missing merely because an older backlog checkbox was never updated.

## Existing code map (verified present on the inspected main)

| Boundary | Module(s) | Observed responsibility |
| --- | --- | --- |
| User interface | `Frontend/Dashboard/src/pages/RevIntell.tsx` | Conversation and response surface; JSON and streaming requests |
| Authenticated Node entry | `Backend/src/route/revRoute.js`, `Backend/src/controller/revController.js` | Chat/stream/history/evidence routes; auth and tenant/ownership gate |
| Node-Python contract | `Backend/src/services/mlService.js` | Bounded internal calls, correlation IDs, validation and typed failure handling |
| Python API | `python/src/serving/api.py` | Internal-key-guarded FastAPI investigation/stream/tools endpoints |
| Conversation orchestrator | `python/src/agents/investigation.py` | Intent/routing, read-only tool plans, evidence processing, response assembly |
| Read-only operational tools | `python/src/agents/tools.py` | Whitelisted, organization-scoped commerce retrieval; no model-authored SQL |
| Evidence and quality | `python/src/intelligence/evidence.py`, `evidence_quality.py`, `revenue_evidence.py` | Provenance, coverage, currency, period, freshness, numeric validation |
| Claim integrity | `python/src/intelligence/epistemics.py` and Node `revEpistemics.js` | Verified facts vs calculations vs hypotheses vs unknowns |
| Model transport and prompts | `python/src/agents/model_gateway.py`, `rev_system_prompt.py`, `responder.py` | Provider/model roles, bounded fallback, safe narrative instructions |
| Bounded conversation | `python/src/intelligence/conversation_reliability.py` | Tenant/conversation-validated compact context; evidence references |
| Evaluation | `python/tests/test_golden_set.py`, `test_rev_investigation_scenarios.py`, `test_task212_reliability_matrix.py`, `tests/benchmarks/test_benchmark_llm_judge.py` | Deterministic golden, investigation, reliability, optional paid judge tests |

The Python service also has older predictive-model inference endpoints (e.g. churn/send-time/offer logic). They are **not evidence that the read-only Rev chat MVP needs training or new models**. Do not expand their remit under this assignment.

## Findings and verification priorities

| ID | Assessment | Evidence/qualification | Next verification |
| --- | --- | --- | --- |
| REV-AI-01 | Existing evidence discipline is substantial | `evidence.py` requires source, period and currency; `epistemics.py` enforces claim grades and calculation references; historical Task 204/206 reports include simulated regression results | Run those suites on current main; add a merchant-facing false-claim test only for a demonstrated gap |
| REV-AI-02 | Node/Python boundary exists, but authorization must be tested end-to-end | Node authenticates requests and owns conversation access. Python still has organization-scoped read-only database tools; this is **not** an assertion that Python reads only pre-fetched Node-provided records | Coordinate scope contract with backend owner. Prove A cannot request B's store through JSON, SSE, tool selection, history/retry and persisted output. Do not alter auth rules independently |
| REV-AI-03 | Live product acceptance remains a documented gap | Historical Task 208 and Task 234 reports explicitly distinguish mock/SQL/CI success from authenticated, deployed conversations | Record actual deployed Node/Python SHAs and exercise two authorized test merchants or tenant-isolated fixtures; capture sanitized correlation IDs and outcomes |
| REV-AI-04 | Provider reliability is implemented in source, not certified for current production | `model_gateway.py` has fast/deep model roles, configured fallback, categorized errors and at-most-two attempts; exact active model/API availability is an environment fact | Verify deployed `AI_PROVIDER` and nonsecret model identifiers, no prompt logging, live successful and failed turns, p50/p95 by route |
| REV-AI-05 | Conversation controls are implemented but live follow-ups require proof | `conversation_reliability.py` validates ownership and reference continuity; dated Task 212 validation reported 110 synthetic reliability scenarios | Test same-store periods, switched conversation, switched tenant, long thread, cancellation/retry, stale data after follow-up |
| REV-AI-06 | Evaluation exists; merchant-centered model-output quality is not proved by a generic knowledge judge | `test_golden_set.py` covers deterministic paths; optional live `test_benchmark_llm_judge.py` targets the non-store knowledge path and requires configured paid judge | Run the merchant evidence/adversarial matrix in `AI-EVALUATION-MATRIX-2026-11-20.md`; report deterministic vs live-generated scores separately |
| REV-AI-07 | Cost and latency require current measurements | Provider usage metadata and timeout handling are present in source; historical benchmarks are not live current-SHA results | Capture successful/failed turns, tokens in/out, real provider model and rate, wall-clock latency, tool calls; publish cost assumptions (never credentials) |
| REV-AI-08 | Older docs contain future-only work outside this MVP | `MASTER-PLAN.md` includes future proactive actions and long-lived memory phases | Keep those as a roadmap, **not current permission**. This MVP only observes, explains, investigates and advises |
| REV-AI-09 | Backlog is historical and includes duplicate consolidated task numbers | `docs/mvp-execution/backlog.md` lists 406 original tasks and several later consolidated/reused Task 204/206/210/212 numbers | Use exact report filenames and inspected SHAs, not a naked task number, when reporting completion |

## Authoritative references to keep, not replace

- [MVP execution history](../mvp-execution/README.md), [backlog](../mvp-execution/backlog.md), [audit register](../mvp-execution/audit-register.md)
- [Rev master plan](MASTER-PLAN.md), [conversation experience specification](REV-CONVERSATION-EXPERIENCE-SPEC.md)
- [Task 204 epistemics](../mvp-execution/validation/TASK-204-REASONING-EPISTEMICS.md), [Task 206 investigations](../mvp-execution/validation/TASK-206-REVENUE-CHECKOUT-PRIORITY-INVESTIGATION.md), [Task 212 reliability](../mvp-execution/validation/TASK-212-AI-FAILURE-HANDLING-INTELLIGENCE-REGRESSION.md)
- [Task 234 architecture/reliability](../mvp-execution/validation/TASK-234-COMPLETION-REPORT.md) — a dated checkpoint; do not assume every local fix is on `main`

## Scope and ownership

- **AI/LLM engineer:** evidence-bound reasoning, retrieval-contract validation with the backend engineer, malicious-input quarantine, prompt/model quality, context quality, deterministic and live evaluation, latency/cost analysis and reports.
- **Node/backend owner:** authentication, actual tenant authorization, Shopify ingestion/webhooks, live merchant-context shape, tenant-scoped persistence, infrastructure credentials.
- **Frontend owner:** Command Center and Rev chat/stream UI, error and evidence presentation.
- **Project integration owner:** coordinate contract changes, staging setup, release checklist and deployment.
- **All:** refuse fabricated metrics; no autonomous merchant action or secret exposure.

## Release blockers

A critical cross-tenant disclosure, fabricated merchant financial claim, fictitious evidence/citation, unsupported claim of executing store changes, unauthorized data retrieval, or regression in Node/Python contract is a **release blocker**. An unexecuted test is not a pass. A CI-green commit or deployment READY state is not proof of a real merchant answer.

## Handoff deliverables

1. Architecture audit with exact inspected SHA (this document).
2. [Module execution / lifecycle](AI-ENGINEERING-MODULES-2026-11-20.md).
3. [Merchant evaluation and acceptance matrix](AI-EVALUATION-MATRIX-2026-11-20.md).
4. For every implementation change: changed paths, test commands/results, CI run ID, deployment SHA, authenticated test evidence, release decision and remaining risks.

**Change policy for this assignment:** user requests writes **only to existing `main`**, no new feature branches or PRs. This handoff is a documentation-only change and does not override repo owners' protection rules or authorize untested production code deployment. Prefer minimal verified changes; stop on a protected-branch rejection instead of bypassing it.
