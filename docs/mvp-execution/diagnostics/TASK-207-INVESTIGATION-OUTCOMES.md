# TASK 207 — Diagnosis: integration, history and unsupported questions

**Date:** 2026-11-07
**Consolidates:** original Tasks 224–226
**Initial revision:** `1f463d7a6d3544e6a2485b994ed221acc9a8903f`

## Revalidation

- Local `main`/`origin/main` and the working branch began at `1f463d7`.
- Production `/ready` reported Node `1f463d7a6d35`, full Python `1f463d7a6d3544e6a2485b994ed221acc9a8903f`, with database, Python and Redis ready. Vercel production for Task 205 was previously READY/PROMOTED.
- Inspected the actual Task 197–205 evidence, quality, epistemic, action and financial guardrails. No Task 206 implementation/report exists in this checkout; no dependency on an undocumented Task 206 was assumed.
- Inspected Shopify OAuth/scope and sync ledgers, webhooks, resource/capability registries, evidence coverage, Node↔Python gateways, routing, JSON/SSE, retry and conversation persistence.

## Existing authorities retained

- `integration_evidence.py` / `revIntegrationEvidenceService.js`: connection, effective authorization, per-resource sync, webhook and freshness evidence.
- `evidence_quality.py`: availability, coverage, freshness, value state and zero-vs-missing semantics.
- Certified `intelligence_order_coverage` and resolved merchant-calendar comparison windows.
- Task 204 claims and Task 205 response/action/citation validation.
- Existing sync scheduling, throttling/backoff and deduplication. Conversation retry never starts a sync.

## Defects addressed

1. Tool failures degraded prose but there was no typed, tenant-scoped investigation outcome shared by Python and Node.
2. Connection, sync, retrieval and coverage problems were not consistently distinguishable at the response boundary.
3. Coverage lacked explicit certified earliest/latest observation metadata; integration age could not safely stand in for history.
4. Unsupported external data, prediction, guarantee, general-knowledge and ambiguous-period requests depended too heavily on model routing.
5. Several natural write requests (`fix pricing`, recovery emails, inventory changes) bypassed deterministic read-only detection.
6. SSE/JSON transport errors always advertised retry, including permanent failures. JSON used the legacy orchestrator rather than the investigation runtime for ordinary turns.
7. Failure/capability context and privacy-safe diagnostics were not preserved as one bounded contract.

No schema migration is required: the change composes persisted integration/coverage evidence and existing conversation JSON context.
