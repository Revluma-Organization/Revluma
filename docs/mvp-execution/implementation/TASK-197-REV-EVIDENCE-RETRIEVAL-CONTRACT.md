# Task 197 — Production-Grade Rev Evidence Retrieval Contract

Status: implemented in the Node and Python Rev path; local validation is recorded below. Deployment and independent production verification are separate release gates and are not implied by this document.

## Runtime path

`authenticated JWT + active organization membership -> authorized Shopify store scope -> scoped ledger/snapshot retrieval -> rev-evidence-v2 validation -> coverage/freshness/provenance evaluation -> typed Python context and tools -> validated non-streaming or streaming Rev response`

The authenticated read-only endpoints are:

- `GET /api/v1/rev/evidence?store_id=<uuid>&resource_id=<resource>&limit=<1..100>`
- `GET /api/v1/rev/evidence/:id?store_id=<uuid>`

Organization identity is never accepted from evidence query parameters. Store IDs only narrow the server-resolved organization scope. Cancellation is propagated from the HTTP request. Retrieval remains read-only and uses existing ledgers, reconciliation checkpoints and active snapshots; it does not introduce a second acquisition pipeline.

## Contract and failure semantics

`rev-evidence-v2` requires organization and store ownership, versioned deterministic identity, domain/type/classification, source references, reporting period and IANA timezone, retrieval/computation timestamps, coverage, freshness, confidence, reproducible lineage, store scope and limitations. Monetary evidence additionally requires a typed measurement defining gross/net/opportunity interpretation and tax, shipping, discount, refund and cancellation treatment.

Classifications are `verified_fact`, `deterministic_calculation`, `analytical_finding`, `hypothesis`, and `unknown`. Hypotheses cannot be returned as verified. Unknowns cannot carry affirmative values.

The implementation distinguishes available evidence, certified zero, partial coverage, no synchronization, stale data, pending synchronization, missing scopes, unsupported resources, retrieval/storage failures, invalid evidence, contradictory reconciliation, and unavailable periods. Empty or missing snapshots are not zero. `verified_zero` is permitted only with complete certified coverage. Monetary zero under incomplete coverage is rejected.

Current synchronized snapshots are explicitly not historical activity or revenue measures. Source references and context evidence are bounded. Missing scopes prevent snapshot-record queries. Cross-organization evidence, out-of-scope stores, duplicate/malformed IDs, orphan fact references, invalid financial semantics, and verified hypotheses fail closed. Streaming evidence events and final responses are validated before acceptance, not merely by HTTP status.

## Local verification

Focused Node contract, retrieval, authorization, investigation-response, context, tenant-isolation and acquisition tests: 44 passed.

Python contract, revenue, investigation, context and API tests: 91 passed. The complete Python suite initially reported 1 unrelated instrumentation regression and 1,573 passes with 9 skips; after correcting the zero-frame instrumentation regression, the complete suite passed: **1,574 passed, 9 skipped** (16 pre-existing warnings).

The complete Node runner passed **79 test files**. The full runner requires Prisma generated-client artifacts. A clean dependency installation without lifecycle scripts removed those artifacts; generation attempted to reach `binaries.prisma.sh`, which is outside this environment's outbound allowlist. For local unit execution only, an ignored, fail-closed PrismaClient module shim was placed under `node_modules`; any unmocked Prisma call throws. The shim is not committed and is not a substitute for generated-client, migration, integration, or production validation. Focused Node tests additionally passed without relying on a live database.

No schema migration was added by Task 197. No deployment, production synchronization, merchant token access, or production behavior is claimed by local tests.

## Production limitations retained

Evidence and Rev responses must continue to expose the existing coverage limitations rather than infer revenue or leakage from available record counts. In particular, the main store previously inspected has five orders but no certified 14-day order coverage. Two other inspected stores have certified order coverage but no verified customer lifetime. No financial or leakage finding was established by those inspections. These are historical observations, not refreshed production metrics.
