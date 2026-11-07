# TASK 209 — Validation record

## Local evidence

- Task 209 acceptance matrix — **51 passed** in `python/tests/test_task_209_question_orchestration.py`. The numbered scenarios cover single-domain routing, unsupported writes, clarification, seven mixed-domain combinations, actual parallel/dependent execution, shared evidence, reconciliation, eight follow-up/topic-change cases, bounded failures/retries/deadlines, idempotency, recursion and tenant/read-only/secret safety.
- Canonical investigation, Task 208 and Task 209 post-audit run — **119 passed**, including typed streaming cancellation and early-exit dispatch checks.
- Full Python suite — **2,012 passed, 11 skipped** after compatibility and dependency fixes.
- Full Backend suite — **88 test files passed**, including five independent orchestration boundary tests and existing investigation, streaming and tenant-isolation contracts.
- Dashboard production build — **passed**, 2,881 modules. Existing large-chunk and npm audit warnings remain; no forced dependency upgrade was applied.
- `git diff --check` — passed.

## Findings resolved during validation

- Added explicit current/previous calculation inputs so retention comparisons retain provenance instead of triggering claim guardrails.
- Restored checkout-only comparisons, finding-priority retrieval and legacy product-inventory failure/authorization behavior after excessive tool minimization regressions.
- Checkout/integration execution records now derive from canonical tool outcomes; domain failures contribute to truthful partial rollups.
- Hardened primary-intent selection, per-attempt timing, non-retryable permission errors and malformed Node confidence/input validation.
- Early clarification/unsupported/conversational exits no longer retain unused specialist/tool plans; cancelled streams expose terminal cancellation state.

The Backend environment could not download Prisma engines from the network-restricted host. The complete mocked Node suite used the existing ignored local test-client convention; real Prisma generation and PostgreSQL integration remain required in CI and are not represented by that stub.

## Merge, deployment and production acceptance

Not yet performed. No Task 209 commit, pull request, CI result, deployed revision or authenticated production conversation is claimed by this record.

Local fixtures do not prove merchant authentication, live Shopify authorization or production JSON/SSE behavior. Production acceptance must use active store `revluma-test-store-v1.myshopify.com`, verify deployed Node/Python revision identity, and run real authenticated single-domain, mixed-domain, contextual-follow-up and partial-failure conversations. Readiness endpoints and direct database aggregates are insufficient. The retired store was not used.

**Task 209 remains incomplete until merge, CI, deployment and authenticated active-store acceptance are established.**
