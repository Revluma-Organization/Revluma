# Rev: Knowledge boundaries, efficiency, execution telemetry and authoritative-runtime acceptance tests

Follow-up to PR #415 (merged as `4b0c546`). Scope is the four requirements as stated:

1. knowledge retrieval with separated sources and honest coverage,
2. efficiency,
3. structured execution telemetry,
4. automated acceptance tests of the authoritative runtime.

Scope was not widened or narrowed.

> **Evidence class.** Every result in this document comes from local or hosted CI tests. Model behaviour is **scripted** at the provider's HTTP boundary. No real AI provider was called, no production system was exercised, and nothing here is a production latency or quality measurement. Production verification is still **BLOCKED** (see the main report, §13).

## 1. Knowledge retrieval: source boundaries

| Source | What exists | How Rev uses it | Visibility |
|---|---|---|---|
| Shopify public docs (`shopify_public_docs`) | **No ingested corpus.** Live search restricted to `shopify.dev`, `help.shopify.com` and `changelog.shopify.com`, and only when a search-capable provider is configured and `REV_SHOPIFY_DOCS_LIVE` is on. | `search_shopify_docs` tool. Results from any other host are dropped. A provider summary that may rest on a dropped source is withheld. | Public. The query passes through `PublicQueryGuard`. |
| General ecommerce knowledge (`ecommerce_knowledge`) | **No ingested corpus.** | No tool. Answers carry the label "no ecommerce reference library was searched". | Public |
| Revluma docs (`revluma_product_docs`) | 41 documents generated at runtime from the capability catalogue, metric definitions and the read-only and evidence policies. Help centre, pricing, marketing and roadmap are excluded and reported as such. | `search_revluma_docs` tool. The "Revluma documentation" block lists only documents the model cited. | Public, never sent to search |
| Tenant context (`tenant_memory`) | Organisation- and user-scoped memories, retrieved once per request. | `recall_merchant_context` tool. Only offered for explicit tenant questions. Documents seed the public-query guard. | Private |

- `source_manifest()` reports real coverage, and `available_retrieval_adapters()` follows it dynamically. A source is never claimed as searched unless it actually was.
- For `INTENT_KNOWLEDGE`, the knowledge agent (`_knowledge_agent_answer`, `run_agent(mode="knowledge")`) is authoritative. The model chooses among the tools exposed for the resolved route.
  - Sources are attached only from retrieval ids the model actually cited.
  - Missing coverage is disclosed deterministically.
  - An answer that fails the shared claim guardrails is never delivered. The established composer answers instead, and `guardrail_rejections` is recorded.
- **Routing fix found by the acceptance tests.** A conceptual Shopify platform question such as "How do Shopify webhooks work?" used to hit the integration-health fast path and open store tools.
  - It is now treated as public documentation, unless it uses status wording ("working", "failing", "connected", …) or refers to the merchant's own store.
  - "Are webhooks working?" still checks the merchant's own integration.

## 2. Efficiency

- **No unnecessary model calls**
  - Context-free definitions skip the understanding model. A test asserts exactly one model call.
  - The store path skips `_compose_narrative` when the agent's answer has been validated.
  - The knowledge agent replaces the composer.
- **Request-scoped reuse only.** `RequestToolMemo` reuses an identical, already-validated tool result within one request.
  - Failed or unavailable results are not memoised.
  - Nothing is shared across requests.
  - The cross-request merchant evidence cache was **removed**. Webhooks change data without moving any reliable watermark, so it could have served stale evidence as current.
- **Bounded public cache.** Public web and Shopify-docs search results are cached for 600 s, 64 entries at most, and the answer discloses their age. Merchant data is never cached.
- **Safe parallelism.** Independent `thread_safe` knowledge and web tools in one model turn run concurrently (scenario A5: `concurrent_batches == 1`, two searches). Database tools stay sequential.
- **Tenant context** is retrieved once per request and served from that prefetch. There is no second query.

## 3. Structured execution telemetry

`intelligence/execution_telemetry.py` provides one `ExecutionRecorder` per `run_investigation`. It is attached as `execution_trace.telemetry` and emitted **once** as a `rev_execution_record` log line, on success, failure and cancellation alike.

The record contains:
- identifiers;
- objective and routing (intent, request class, response mode, gate, sources, follow-up, private-context allowed, web requested);
- each model call (purpose, provider, model, duration, provider-reported tokens, attempt, fallback, outcome, failure category);
- stage timings;
- tools (status, duration, reuse);
- knowledge-source use;
- cache outcomes;
- retries, fallback, failure category, cancellation, and final status and outcome.

Token totals are labelled with their scope (`all_model_calls`, `partial_provider_reported` or `no_model_calls`).

**Privacy.** Only tokens matching `[A-Za-z0-9._:-]{1,80}`, numbers and identifiers are accepted. Messages, prompts, evidence values, URLs with queries and PII are dropped by construction. Node persists a further-sanitised projection, covered by `TELEMETRY-PERSIST-001` in the contract test.

Two telemetry fixes were found by the tests:
- `web_requested` was true for a Revluma-docs question.
- `followup` missed follow-ups recorded under `investigation.context_used`.

## 4. Automated acceptance tests (scripted provider)

`tests/rev_provider_fakes.py` (`FakeGemini`) replaces only the Gemini HTTP endpoint. The FastAPI `/rev/stream` route, investigation pipeline, gateways, agent loop, tools against the database double, validation, guardrails, telemetry and persistence all run for real. Scripted model turns read the tool results they actually received and cite them, so the answers depend on what the tools returned.

**`tests/test_rev_authoritative_acceptance.py`** (14 tests, all through `/rev/stream`)

| Scenario | Proves |
|---|---|
| A1 | General knowledge: one agent turn, no source tools, honest "no library searched" label |
| A1b | Off-domain trivia keeps the existing scope; no agent turn |
| A2 | Ecommerce knowledge: one model call total, no store SQL, no web |
| A3 | Revluma docs: real registry formula reaches the model; cited block |
| A4 | Shopify docs: only official hosts, other host dropped, summary withheld, cache telemetry |
| A5 | Current Shopify research: concurrent search, citations, private conversation never sent |
| A6 | Revenue: `revenue_observations` evidence (30.31 USD) grounds an accepted answer |
| A7 | Refunds: 5.00 USD from refund evidence; unsynchronised ledger is unknown, not 0 |
| A8 | Products: line-item evidence, accepted |
| A9 | Missing order data: never reported as zero |
| A10 | Insufficient evidence: model clarification is terminal |
| A11 | Follow-up keeps the previous period |
| A12 | Unrelated question inherits no store scope or private history |
| A13 | Context restored from the database after refresh (no client context) |

**`tests/test_rev_knowledge_agent.py`** (23 tests)
- Source manifest coverage.
- Shopify tool offered only with a provider.
- Tenant recall only for tenant questions; prefetched tenant context.
- `PublicQueryGuard` reasons (8 cases).
- Private context never reaches a public search.
- Private recall is marked private and kept out of telemetry.
- No tenant retrieval for public questions.
- Uncited sources are never attached.
- Guardrail-failing answers are never delivered.
- With no provider, Rev fails honestly and the agent never starts.
- Routing of Shopify doc questions vs integration checks (5 cases).

**`tests/test_rev_execution_telemetry.py`** (10 tests)
- The recorder privacy contract, no-ops outside an execution, and bounds.
- `RequestToolMemo`: reuse, no reuse of failed results, no sharing between requests, telemetry.
- Exactly one content-free record on success, failure and cancellation.

All new files were added to the focused step in `.github/workflows/rev-python-tests.yml`.

## 5. Local validation

| Suite | Result |
|---|---|
| Python full suite | **2516 passed, 11 skipped**, up from 2469 (+47 new tests, no assertion removed) |
| pyflakes (changed Python files) | clean |
| Node persistence contract test | pass |
| Backend `npm test` (local) | 105/115. The same 10 Prisma-client failures as the baseline. CI is authoritative. |

Hosted CI results are recorded in the PR.

## 6. Not verified / blocked

- Real-provider answer quality, latency and token use.
- Render Node and Python deployments.
- Live tests A–F on `revluma-test-store-v1.myshopify.com`.

These stay **BLOCKED** for the reasons in the main report §13 (provider key on Render, Render access, authenticated live session). The legacy orchestrator greeting path (`orchestrator.py`, outside `run_investigation`) has no active recorder, so its model call is not part of an execution record.
