# Task 234 — knowledge-source boundaries, ingestion contract, telemetry and latency budgets

**Status:** implementation and local verification in progress; production corpus coverage, deployment configuration and live latency remain unverified. This document does not claim a production rollout or a live provider/search trace.

## 1. Source boundaries and current runtime status

Knowledge is classified into separate source classes. A route is not evidence that a corpus was queried: `KnowledgeRoute` reports `configured_sources` and `unavailable_sources` separately.

| Domain | Route / source ID | Current reachable source | Required boundary |
|---|---|---|---|
| Public Shopify documentation | `shopify_public_docs` | No local corpus adapter or indexed corpus is configured. Explicit current-web research can use the existing Google-grounded provider; it is a separate `live_web` route, not Shopify documentation retrieval. | Public material only; retain canonical URL, version/revision, section and fetch provenance. Never search or augment with tenant memory by default. |
| General ecommerce knowledge | `ecommerce_knowledge` | No curated document corpus is configured. General/model knowledge is the declared fallback, not a claimed retrieval hit. | Keep source attribution distinct from Shopify and Rev material; identify model-knowledge fallback in route metadata. |
| Revluma product documentation | `revluma_product_docs` | No indexed product-document adapter is configured. | First-party, release-versioned content only. Do not infer product behavior from Shopify or generic ecommerce sources. |
| Private merchant context | `tenant_memory` | Existing `merchant_memories` plus optional pgvector embeddings; retrieval is tenant/user/active/expiry filtered and hybrid-ranked by the existing helper. | Only opt in for an explicitly merchant-specific request. Keep organization/user filters in every DB/vector operation; never mix this corpus into public collections. |
| Current public web evidence | `live_web` | Existing Google grounding path, kept separate from all private context. | Send only the current public-research question. A result without verifiable source URLs is not presented as researched. |
| Authenticated store evidence | `merchant_evidence` | Existing authorized, read-only investigation tools. | Must remain store-scoped and verified as evidence; it is not general knowledge and is not an embedding corpus. |

The authoritative investigation runtime now avoids loading private memories for every turn. New standalone public/general knowledge questions do not send prior merchant conversation history to the understanding model; history is retained only for an explicit tenant-context request or a same-topic follow-up. Public/general knowledge and current-web requests clear memories/history before answer composition. For merchant-specific knowledge questions, the resolver may select `tenant_memory`; retrieval passes the authenticated organization and user IDs, current question only, active/expiry constraints, then the existing lexical/vector ranker. Current-web routes are exclusive and cannot include private memories or history. The legacy orchestrator now delays tenant-memory retrieval until after understanding and applies the same opt-in rule.

The public-document collections are **declared, distinct routing namespaces, not completed indexes**. Until their adapters and approved inventories are implemented, the response route explicitly marks them unavailable and may use the general model fallback only where that is allowed. It must not claim that Shopify or Revluma docs were searched. Merchant evidence requests use the existing investigation tools instead of treating a knowledge route as an evidence lookup.

## 2. Ingestion, versioning, chunking, embeddings, retrieval and provenance contract

This is the required design for a future corpus adapter. Only the private-memory embedding path currently exists; the three document-corpus ingestion pipelines below are not deployed by this change.

### 2.1 Registry and source inventory

For every source, maintain a server-owned registry entry containing: stable `source_id`, domain/collection ID, owner/public-vs-private classification, canonical host/path rules, licence/terms and allowed-use decision, fetch method, content type/language, update signal (API revision, ETag/Last-Modified, release tag or scheduled review), freshness policy, and responsible maintainer. Reject unknown hosts and private-network destinations; canonicalize URLs and strip credentials/query secrets before persistence. Do not crawl Shopify or other sites until the source inventory and permitted use are approved.

### 2.2 Immutable versions and ingestion state

Represent each fetched document as an immutable version with a stable source key, canonical URL or internal doc key, title, domain, source revision when supplied, `content_hash` (SHA-256 of normalized content), `fetched_at`, source `published_at`/`updated_at` when known, `last_checked_at`, `valid_from`, optional `valid_to`, language, licence, and a source-status/tombstone. Identical hashes are idempotent no-ops. Changed content creates a new version; do not overwrite the previous version. Deletions, access-policy changes and revoked documents tombstone the active version and remove its chunks from retrieval. Keep the last-known version for audit only where retention rules permit.

A job records its corpus, source version, attempt count, state, retry schedule and sanitized failure category. Processing is idempotent by `(source_version_id, chunker_version, embedding_model_version)`. Never mark a version searchable until all of its chunks and embeddings have been committed and validated; publish the new active version atomically to avoid partial indexes.

### 2.3 Canonicalization and chunking

Convert HTML/Markdown/PDF through an allowlisted parser; retain heading hierarchy, tables/code boundaries, page/section anchors and canonical source offsets. Remove navigation/boilerplate and active markup without rewriting claims. Normalize Unicode and whitespace while preserving meaningful punctuation and tables. Split first at headings/paragraph boundaries, then at a versioned tokenizer limit (initial experiment: 500–800 tokens, 80-token overlap; tune with retrieval evaluation, not latency alone). Each chunk stores `chunk_id`, source/version IDs, ordinal, parent/heading path, token count, text hash, offsets/page, and chunker version. Do not split citations, code examples, tables or versioned API signatures across chunks where avoidable.

### 2.4 Embedding and access separation

Use a pinned embedding model/version and dimension, batch bounded jobs, retry transient errors, record per-version embedding completion, and re-embed only when content or embedding model version changes. Keep public corpora in separate collection IDs (and preferably separate DB schemas/indexes or vector namespaces); do not place tenant IDs in a shared public index. Tenant vectors retain the current organization/user scope and join back to active, non-expired memories. A mandatory authorization predicate must execute before candidate ranking, not as a post-filter. If a vector/extension query fails, lexical fallback is allowed only inside the same authorized source boundary; do not silently widen to another corpus.

### 2.5 Hybrid retrieval, ranking and answer provenance

For a request, first resolve allowed domain(s), authorization scope, current/stale policy and whether web search is permitted. Retrieve bounded lexical (BM25/full-text) and vector candidate sets from only those collections, merge by stable chunk ID using a documented rank fusion (initial candidate: reciprocal-rank fusion), apply a domain-aware relevance/diversity reranker, remove duplicates only within the same source version, and cap context by tokens. Keep cross-domain results as separate evidence groups; do not merge conflicting claims into one unattributed chunk. The private-memory adapter currently uses pgvector similarity plus lexical relevance and authority/importance rules; it does not implement this planned public-doc BM25/RRF pipeline.

Each retrieved citation must preserve: `source_id`, source domain, canonical URL/internal doc reference, title, source revision/version, section/page, chunk ID and hash, fetch/updated timestamps, freshness state, retrieval method and rank/score. The response must cite only sources actually retrieved or verified by web grounding. If no source is available, stale, or sufficiently relevant, say so and do not fabricate a citation. Merchant-evidence claims continue to use the existing evidence IDs, period, store scope and freshness/verification contracts, not document chunk citations.

### 2.6 Freshness policy and stale handling

Freshness is source-specific, not inferred from a successful embedding job. At retrieval, calculate age from the source's authoritative update time when trustworthy; otherwise use `last_checked_at` and mark that limitation. Proposed initial policy (must be approved and then measured): Shopify public docs checked daily and on API release notices, re-crawl changed pages within 24 hours; Rev product docs published/indexed with each product release, with a 24-hour maximum for a missed event; curated general ecommerce material reviewed at least every 90 days with explicit editorial date; tenant memories use current active/expiry metadata and are never given a public-doc TTL. These are target policies, not current observed freshness SLAs. If a source exceeds its domain threshold, either refresh before use or label it stale and refuse to state time-sensitive claims as current. Preserve “unknown freshness” rather than replacing it with current time.

## 3. Execution telemetry now instrumented

The existing internal endpoint `GET /internal/rev/metrics` is protected by `verify_internal_caller`. Aggregation is in-process, bounded (2,048 recent latency samples per metric, capped metric series), low-cardinality and reset on process restart. It is an operational metrics snapshot, **not** a durable trace store or production-wide aggregation service. No request IDs, user content, URLs, organization IDs or credentials are metric labels.

| Requested stage/field | Current signal | Caveat |
|---|---|---|
| Routing | `stage_routing` latency, route-class counter | Covers authoritative `route_message`; model understanding is also represented by provider calls. |
| Provider/model and model duration | Provider request counters and `stage_model_inference` labelled with safe provider/model | Attempt duration is measured; a fallback is a separate attempt. Missing-key/configuration failures are recorded as zero-duration unavailable attempts. |
| Token usage | `model_input_tokens_total` / `model_output_tokens_total` from provider-reported Anthropic/Gemini usage | Missing provider usage metadata is not estimated. Counts are in-process totals and not cost estimates. |
| Tool selection and duration | `rev_tool_selections_total`; `stage_tool_execution` by bounded tool name and outcome | Tool duration wraps the tool call and its local retry. |
| Knowledge retrieval | `stage_knowledge_retrieval`, source/outcome and selected/result counts | Currently applies to explicit tenant-memory retrieval; public document adapters are unconfigured. |
| Web research | `stage_web_research` around grounded research and `stage_model_inference` | Google Search is bundled into the provider call; there is no separate search-vendor subspan or live search trace. |
| Database duration | `stage_database_query` in `safe_query` and `read_row` | Direct `db.execute` calls outside these helpers are not yet covered; metrics must not be interpreted as all SQL. |
| Total duration | `stage_execution_total` and existing `rev_execution` samples; response includes `execution_metadata.latency_ms` | Cancellation/error outcomes are distinct in stage labels/counters. |
| Retries/fallbacks | Retry/fallback counters, provider fallback transitions, existing reliability failure metadata | Retry counters describe attempts observed by these instrumented paths; not every subsystem is covered. |
| Failure category | Bounded provider and execution failure-category counters; tool failures keep existing safe categories | Raw exceptions and merchant text are not recorded. |
| Cancellation state | `rev_execution_cancellations_total` on stream cancellation and execution-level cancellation | Aggregate counters only; no per-execution span persistence. |

Metrics are exported only through the existing internal authenticated snapshot; local implementation does not prove the production Python revision is deployed or that an external collector scrapes it. Do not expose the endpoint publicly or put high-cardinality identifiers into metrics.

## 4. Reproducible measured local baseline

Command: `cd python && .venv/bin/python scripts/benchmark_knowledge_path.py`.

Environment in this run: Python 3.11.2, NumPy 1.26.4; deterministic synthetic 256-row memory corpus, 384-dimensional existing `sklearn-hashing-word-bigram-v1` vectors, warm-up before timing. There were 1,000 routing samples and 200 samples for each ranking case. **No DB, pgvector, network, model provider, real corpus or production traces were used.** These are local microbenchmark observations, not production p50/p95s and not an accuracy/recall result.

| Workload | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|
| Source route resolution | 0.0042 ms | 0.0058 ms | 0.0114 ms | 0.0286 ms |
| Synthetic embedding + top-16 vector dot product | 0.3629 ms | 0.4980 ms | 0.6870 ms | 1.3422 ms |
| Existing hybrid relevance rank over 256 synthetic memories | 1.1756 ms | 1.3473 ms | 1.9844 ms | 2.1988 ms |
| Explicit private route + local embedding + rank | 1.5707 ms | 1.9185 ms | 2.7429 ms | 2.9042 ms |

The script preserves the benchmark data-generation recipe and emits a fresh JSON report. It deliberately does not claim end-to-end service latency. Required next baseline before production acceptance: run a representative, tenant-authorized and privacy-scrubbed workload against the deployed Python revision, live database and configured provider; collect at least 1,000 requests per route/load tier (warm/cold, representative corpus sizes, concurrent load), report p50/p90/p95/p99, error/cancel/fallback rates and token totals, and record deployment/config revision without logging secrets. Current production provider, corpus sizes and deployment revision are unverified, so a live baseline is **not available**.

## 5. Performance budgets and accuracy guardrails

### Existing source defaults / hard ceilings (not observed latency)

| Operation | Current source default / bound | Provenance |
|---|---:|---|
| Context retrieval | 5,000 ms | `python/src/intelligence/reliability.py::TIMEOUT_POLICY_MS` |
| One database statement | 10,000 ms default (`REV_DB_STATEMENT_TIMEOUT_MS`); `safe_query` clamps the configured timeout to 100–10,000 ms | `reliability.py`, `query.py`; production environment value not observed |
| Model understanding | 12,000 ms | reliability timeout policy |
| Specialist operation | 5,000 ms | reliability timeout policy |
| Deep response composition | Up to 25,000 ms | `investigation.py`/`responder.py` provider calls and reliability policy |
| Investigation deadline | 100,000 ms by default (`REV_INVESTIGATION_DEADLINE_MS`), clamped 1,000–110,000 ms | reliability source; production env not observed |
| Node→Python non-stream response | 45,000 ms default (`ML_TIMEOUT_MS`) | `Backend/src/services/mlService.js`; deployment override not observed |
| Browser stream | 130,000 ms source policy | Python reliability and Node failure contract; deployed override not observed |

These ceilings are not composable guarantees: a 100-second Python deadline cannot make a 45-second Node non-stream request succeed. Use the actual streaming route for long investigations, and verify deployed overrides before claiming a production budget.

### Provisional acceptance SLOs (require live validation)

- Local source-route p95 ≤ 5 ms and explicit private route + local embedding/rank p95 ≤ 5 ms on the benchmark workload. Current local observations are below those thresholds; re-run on the target runtime before using them as release gates.
- Production tenant-memory retrieval (authorization + DB/vector + lexical rank) p95 ≤ 2 seconds, p99 ≤ 5 seconds under the agreed corpus/concurrency tier; each SQL statement retains its 10-second source ceiling. Measure actual SQL and pgvector separately before accepting this budget.
- Non-stream Node→Python request p95 ≤ 40 seconds and p99 ≤ 44 seconds against its 45-second default transport ceiling. The 12-second understanding and ≤25-second response stages are component ceilings; retries/fallbacks share the provider request's overall budget.
- Browser-stream completion p95 ≤ 90 seconds and p99 ≤ 100 seconds against the Python 100-second overall deadline and Node 105-second stream timeout; report cancellations separately rather than counting them as successes or latency wins. The browser's 130-second limit is a last-resort outer bound, not the target.
- Web-research provider execution p95 ≤ 25 seconds if the configured provider uses its current 25-second timeout. Never substitute ungrounded model output to satisfy this latency budget.

These targets are deliberately provisional because there is no production baseline in this workspace. They are not a performance pass. Review/ratify after the required load run and use measured distributions, not averages alone.

**Accuracy and verification are release gates, not budget trade-offs.** Do not reduce evidence coverage, source quality, model role, mandatory validations, authorization filters, or required citations to meet a latency target. If a budget is exceeded, preserve partial results with their status, report an explicit timeout/unknown or cancel, and optimize query plans, batching, caching of versioned public material, provider placement, or concurrency only after regression/accuracy tests. No verification step may be skipped to make a latency chart green.

## 6. Verification completed here and remaining gaps

Local checks added for four-domain route separation, unavailable-corpus transparency, no-private-history public understanding, exclusive public-web routing, tenant opt-in, bounded stage metrics/token counters, SQLAlchemy query-event privacy/timing, and existing database/web paths. The full Python suite passed **2,427 tests, 11 skipped, 16 upstream deprecation warnings** using a local dummy PostgreSQL DSN pointed at `127.0.0.1:1` (no DB connection). Python compileall and `git diff --check` passed. The synthetic benchmark above was run and its local-only results are reported verbatim here.

Still open: implementing and populating the three public-document adapters; approval of source inventory/licensing and freshness policies; rank/recall and citation-fidelity evaluation on labeled corpora; full direct-SQL instrumentation; durable cross-process metrics collection; live provider/web/DB baseline and production configuration/revision evidence; and separate production confirmation that private/public source boundaries are deployed. No live provider calls or production traces were obtained for this work.
