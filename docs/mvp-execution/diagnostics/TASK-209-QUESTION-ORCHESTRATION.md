# TASK 209 — Diagnosis: question routing and coherent multi-domain orchestration

**Date:** 2026-11-07
**Consolidates:** original Tasks 230–234
**Baseline:** `c7f8f6c7d70dfed8ac054ce7cf6b53eb663f4a48`

## Revalidation

- Inspected the canonical `run_investigation` router, authorized read-only tool catalog, Task 208 specialist runtime, evidence/claim/outcome authorities, conversation persistence, and Node JSON/SSE validation rather than introducing another response pipeline.
- Production `/ready?task209=baseline` reported both Node and Python at `c7f8f6c7d70dfed8ac054ce7cf6b53eb663f4a48`, with dependencies ready. Readiness was treated only as revision/dependency evidence.

## Actual gaps found

1. Deterministic routing selected one investigation intent; mixed-domain questions did not expose structured primary/secondary intent, confidence, required domains, ambiguity or contextual interpretation.
2. Specialist selection was embedded in investigation execution without a capability-validated task graph, explicit dependencies, bounded retry/deadline policy, domain execution records or idempotency identity.
3. Shared evidence existed, but checkout and integration execution were not represented in specialist orchestration records, and there was no independent reconciliation of duplicate observations, incomparable metrics, contradictions, freshness or uncertainty.
4. Follow-up context preserved previous investigation/specialist summaries but not compact question understanding, domain results or execution references.
5. Node preserved validated specialist results but had no independent orchestration tenant, evidence-reference, dependency, fan-out, retry, epistemic or sensitive-field boundary.

## Existing authorities retained

- One canonical investigation runtime, one authorized SQLAlchemy retrieval session, the existing read-only tool catalog and Task 208 pure specialists.
- Existing evidence identity, calculation provenance, coverage/freshness, epistemic, causation/action, investigation outcome and narrative guardrails.
- Existing authenticated organization/store resolution, conversations/messages, RLS and compact context persistence. No router service, context store, merchant write path, migration or privacy exception was added.
