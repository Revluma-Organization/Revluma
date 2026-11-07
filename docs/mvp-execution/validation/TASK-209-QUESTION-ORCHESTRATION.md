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

## Merge, CI and deployment evidence

- PR #354 merged as `e37a24f5851c905472fe416968fdfc3eb513c1f5`. All five PR workflows passed on `324ab163ee56e2e5bf4ebd950a379cff8729c9bf`, including real Prisma/PostgreSQL financial and security regressions. Both main-branch test workflows passed on the merge commit.
- Vercel `dpl_H9coPivjMtVttYS2BeJsEu1edzfu` is READY/PROMOTED on `e37a24f`, aliases assigned without error; the production sign-in page is reachable.
- The active store remains `3ed79446-cb6d-4a1c-b174-9ec1ab91fe15`, `revluma-test-store-v1.myshopify.com`, status `active`. This is scope evidence, not authenticated Rev behavior.
- Render `/ready` remained healthy but reported Node/Python `c7f8f6c` after the merge. Task 209 backend deployment identity is not yet established.

## Production acceptance not established

Local fixtures do not prove merchant authentication, live Shopify authorization or production JSON/SSE behavior. Production acceptance must verify deployed Node/Python revision identity and run real authenticated single-domain, mixed-domain, contextual-follow-up and partial-failure conversations on the active store. Readiness endpoints and direct database aggregates are insufficient. No merchant session is available, and no production conversation is claimed. The retired store was not used.

**Task 209 remains incomplete until backend deployment and authenticated active-store acceptance are established.**
