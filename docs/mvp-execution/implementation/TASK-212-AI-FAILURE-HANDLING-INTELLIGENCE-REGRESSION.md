# TASK 212 — AI failure handling and intelligence regression

**Consolidated Task:** user-assigned 212 (original Tasks 246–251). This is distinct from the older backlog item 212 already consolidated into Task 204.

**Scope:** existing read-only Rev investigation, Node gateway, persistence and Dashboard. Task 213 was not started.

## Implementation

### Shared failures, deadlines and retries

`python/src/intelligence/reliability.py` and `Backend/src/services/revFailureContract.js` define the `rev-failure-v1` safe diagnostic contract. Categories are `timeout`, `cancelled`, `rate_limited`, `provider_unavailable`, `connection_failed`, `invalid_request`, `malformed_output`, `schema_validation_failed`, `authorization_failed`, `permission_denied`, `unsupported_capability`, `evidence_retrieval_failed`, `specialist_failed`, `partial_success` and `internal_error`. Only timeout/rate-limit/provider/connection categories are retryable. Metadata is allowlisted: stage, bounded retry count, partial/fallback flags, correlation/execution IDs and timestamp; raw exceptions, prompts, SQL, credentials and customer records are not copied.

The common policy bounds context retrieval at 5 seconds, PostgreSQL statements at 10 seconds, intent at 12 seconds, specialists at 5 seconds each, response composition at 25 seconds, and the Python investigation at 100 seconds. Node allows 105 seconds so Python can return its typed partial result first; the browser has a 130-second overall limit and a 45-second inactivity limit. Python uses monotonic remaining-budget propagation. Gemini/Anthropic transport has explicit connect/read/write/pool budgets.

The investigation checks the deadline before each remaining retrieval and before specialist/composition work. A transient tool exception gets at most one 50 ms delayed retry; authorization, validation and other permanent exceptions are not retried. Existing specialist retry/cancellation checkpoints remain authoritative. Failed steps stay visible, independent evidence survives, and no failed check becomes an empty success. Node and browser cancellation are distinct from timeout; browser timeout never appears as merchant cancellation or a completed answer.

### Strict output and partial success

`understanding.py` now accepts only one complete JSON object (optionally one complete JSON fence). It rejects surrounding prose, truncation, missing fields, invalid intent/mode/urgency enums, wrong entity/domain/boolean types and invalid confidence instead of scavenging JSON or coercing values. One bounded schema retry is allowed within the intent budget. `responder.py` applies the same fail-closed rules to analysis sections, confidence and read-only actions. The general-knowledge fallback now uses `model_gateway`; it has no direct Anthropic client.

The gateway rejects empty and max-token-truncated provider output. Safe provider status categories distinguish rate limiting, transient service/network failure, timeout, malformed output and permanent requests. Node independently validates success, evidence, claims, specialists, outcome and read-only boundaries; HTTP 200 alone is not success.

Python and Node quarantine an invalid recommendation while retaining independently valid evidence, calculations and other recommendations. The response includes a warning and `schema_validation_failed` diagnostic. Execution-claiming recommendations are never persisted or forwarded. This does not relax whole-response evidence, tenant, claim, specialist or orchestration validation.

### Repeatable calculations and changed evidence

`rev-consistency-v1` fingerprints authenticated organization/store scope, resolved intent/metric, reporting period, selected finding/version and evidence semantics. Values, currency, status, period, coverage, freshness state, definition and stable external identity participate. Per-investigation generated evidence IDs and retrieval timestamps do not create false changes.

For an unchanged canonical request/evidence snapshot, the current authoritative rows are still retrieved and the current deterministic calculation is recomputed; only optional model prose is skipped. No generated answer cache exists. Changed values, coverage, currency or period produce `evidence_changed`/`context_changed`, recalculation and an explicit update explanation. Unrelated prose and raw wording are not semantic cache keys.

### Bounded conversation context

`rev-conversation-context-v2` is a deterministic projection, never an AI rewrite. It preserves active finding and bounded finding history, investigation/status, period, currencies, graded claims with exact numeric values, hypotheses/unknowns, unresolved questions, cited evidence, recommendation provenance and consistency state. Recent turns are capped at six and the assembled context text at 6,000 characters. Claims/recommendations/history are capped and sensitive keys/token-like values are removed.

Loading validates contract, organization, conversation, summary method, period, claim grades, exact decimal-string/number forms, ISO currencies and evidence membership. Invalid or foreign context is discarded with a visible context warning. Node atomically persists the summary and consistency record alongside selected-finding state in `conversations.context_window`. Conversation deletion now clears derived summary/context while retaining the existing soft-deletion behavior for message history; no broader retention/deletion claim is made.

### JSON/SSE/Dashboard behavior

Node propagates correlation/execution IDs and the overall policy in JSON and streaming calls. JSON investigation uses the overall deadline rather than the shorter general ML timeout; streaming defaults to 105 seconds. Transport/validation failures carry safe diagnostics through JSON and SSE. Raw Python error details are not forwarded as trusted merchant diagnostics.

`revStream.ts` owns an internal abort controller, overall and reset-on-activity inactivity timers. Stop remains `completed:false`; timeout raises `INTELLIGENCE_TIMEOUT`. Existing busy-state and retry logic remains the duplicate-submission guard. `RevAnswerView` names failed stages while continuing to render valid evidence and preserves partial/unavailable presentation.

## Real provider data flow and retention boundary

1. The browser sends the message, conversation/finding identifiers and read-only retry options to Node. It does not send provider credentials or authoritative tenant/evidence payloads.
2. Node authenticates membership, verifies conversation/finding scope, reads bounded tenant-scoped aggregates/context and calls Python with the server-only internal key.
3. Python retrieves authorized evidence and constructs bounded prompts. If model use is enabled and configured, `model_gateway` sends the minimum needed question/history and evidence semantics (which can include metric values, periods, currencies, limitations and capped operational labels) to the configured Gemini or Anthropic endpoint. OAuth tokens, API keys, database URLs and raw customer datasets are not prompt fields. Deterministic specialist calculations do not call a model.
4. Node validates the result and persists chat/context records. Operational logs carry category/stage/retry/fallback/correlation metadata, not raw prompts or secrets.

Provider retention and training behavior are controlled by the deployed provider account/API terms; this task did not independently verify those terms and therefore makes **no zero-retention, no-training or regional-processing claim**. Synthetic fixtures are test-only and were not inserted into production.

## Verification and release boundary

The deterministic suite is `python/tests/test_task212_reliability_matrix.py` (exactly 110 scenarios), with orchestration checks in `test_task212_orchestration.py`, Node contract tests and Dashboard timeout/disclosure tests. Exact results and delivery identity are recorded in the validation report. Local/mocked results do not certify a real provider or authenticated production journey. Production acceptance remains a separate gate on `revluma-test-store-v1.myshopify.com`; the retired store is not used.
