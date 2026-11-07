# TASK 209 — Implementation: question routing and coherent multi-domain orchestration

**Consolidated Task:** 209 (original Tasks 230–234)
**Status:** merged with green CI and Vercel production verified; Render revision and authenticated production acceptance pending.

## Understanding and deterministic planning

`python/src/intelligence/question_orchestration.py` implements `rev-question-understanding-v1` and `rev-question-orchestration-v1`. Understanding records primary/secondary and candidate intents, required domains, confidence, ambiguity, clarification policy, missing information and contextual-follow-up interpretation. Explicit topic changes replace previous domain scope; scoped follow-ups may inherit subject/period and expand only for newly requested domains.

The existing investigation classifier remains authoritative. Planning validates required domains against the actual read-only tool catalog and implemented Task 208 specialists, selects the smallest sufficient set, deduplicates tools, and creates stable request/task identities. Integration evidence is a dependency of domain analysis. Unsupported writes and genuine ambiguity terminate without dispatch; early exits retain understanding but no fictitious selected tools or specialists.

## Bounded execution and reconciliation

Canonical retrieval remains sequential on its authorized session. Pure specialists then analyze the same validated evidence concurrently when independent, with maximum fan-out three, recursion depth zero, per-specialist timeout, overall deadline and at most one transient retry. Permanent authorization/validation failures are not retried. Each task records attempts, duration, dependency state and outcome. Repeated plans are deterministic; execution does not invoke orchestration recursively.

Checkout and integration receive execution records derived from actual canonical tool results. Unavailable/failed evidence remains unavailable/failed, never a successful zero. Partial domain failure does not erase successful domains or turn missing values into global zeros.

Reconciliation deduplicates evidence by identity and compares observations only when metric, definition, unit, currency and period are compatible. Equal observations are not double counted; incompatible periods/currencies/definitions are not contradictions; incompatible same-key values remain unresolved and disclose freshness. Repeated hypotheses never become facts. Cross-domain concurrency is explicitly non-causal, and local uncertainty remains in the response limitations.

## Lifecycle, continuity and Node boundary

The typed lifecycle covers received, understanding, planning, executing, reconciling, composing, validating and terminal completed, partial-success, clarification, unsupported, failed and cancelled states. Streaming cancellation emits a terminal cancellation contract, including cancellation before worker startup.

`investigation.py` attaches question understanding, orchestration, reconciliation and domain execution records to canonical JSON/SSE results. `Backend/src/services/revQuestionOrchestration.js` independently validates contract versions, confidence, domains, tenant, evidence references, dependencies, capabilities, fan-out, retries, recursion, terminal states, epistemic boundaries and sensitive fields. `mlService.js` validates against authorized current/comparison evidence IDs; `revController.js` preserves the contract and persists a bounded context summary.

Follow-up context retains compact understanding, request fingerprint, state, domain outcomes and evidence references. Fresh turns rerun authorized evidence; old conclusions are not promoted into current facts. Tenant/store scoping, RLS, consent, privacy, numeric integrity and read-only behavior remain unchanged.

## Verification boundary

`python/tests/test_task_209_question_orchestration.py` contains 51 substantive local scenarios covering the requested routing, mixed-domain, execution, reconciliation, continuity, failure, idempotency and security cases. They exercise real planning, concurrency and canonical runtime paths, but are synthetic/local evidence. They do not establish production authentication, active-store behavior or live Shopify coverage.
