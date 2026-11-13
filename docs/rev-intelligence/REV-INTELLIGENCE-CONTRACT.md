# Rev Intelligence — architecture and contract

Updated: 2026-11-02 · Branch `arena/c85e524b-revluma` · Head `e295f2c`

This document is the normative description of how Rev Intelligence works and the
invariants that must hold. It exists so a reviewer can check the implementation
against stated rules rather than infer them from code.

---

## 1. Product boundary

Rev Intelligence is Revluma's conversational operational intelligence for
Shopify merchants. The promise is: **know what matters, understand why, take
action** — where "take action" in this release means *the merchant* decides and
acts.

**The MVP is strictly read-only.** Rev never:

- creates, edits or deletes products, variants, inventory, orders, customers,
  discounts, checkout configuration, themes or settings;
- sends email, SMS, WhatsApp or any customer communication;
- launches, pauses or schedules a campaign or automation;
- changes a price or applies a discount;
- claims an action was executed.

The boundary is enforced in code, not copy. `detect_prohibited_actions()` in
`python/src/agents/investigation.py` matches write intents (including a generic
execution request such as "Can you fix it for me?") and short-circuits routing to
`read_only_boundary` before any tool runs. `_validate_narrative()` rejects any
model-written answer containing an execution phrase, falling back to the
deterministic composition and recording `meta.narrative_model = False`.

---

## 2. Tier responsibilities

```
Browser (React)  ──HTTPS──►  Node (Render)  ──HTTPS + x-internal-key──►  Python (Render)  ──►  Postgres (Supabase)
Frontend/Dashboard            Backend/                                   python/
```

| Tier | Owns | Must not |
| --- | --- | --- |
| **Browser** | Chat surface, streaming render, cancellation, evidence drawer, conversation history UI | Call Python directly; persist investigations; hold credentials |
| **Node** | Authentication, organization membership, conversation and message persistence, rate limiting, ownership checks, SSE fan-out to the browser | Decide investigation content; query merchant analytics tables directly for Rev answers |
| **Python** | Intent routing, tool execution, evidence assembly, validation, narrative composition, Business State computation | Trust the caller's claimed identity; accept a tenant scope from the model or the merchant's message |

Node authenticates the merchant and passes an `organization_id` to Python.
Python is reachable only with `x-internal-key` (`verify_internal_caller`,
constant-time compare, fail-closed with HTTP 500 if `ML_INTERNAL_KEY` is unset)
and only from the internal network (`verify_internal_network`).

---

## 3. Investigation contract

`run_investigation(organization_id, user_id, message, ...)` is the single entry
point. Its stages are fixed:

1. **Validate** — message bounded by `MAX_MESSAGE_CHARS = 2000`.
2. **Normalise** — `ensure_utc` on the request timestamp.
3. **Identify** — `investigation_id = uuid4()`.
4. **Load context** — `load_conversation_context` returns the prior summary,
   `last_investigation` (intent, period, status), recent turns and unresolved
   items. Transcripts belong to Node; Python stores only the derived window and
   one invalidatable memory record.
5. **Resolve store** — `resolve_store_context`.
6. **Classify** — `classify_investigation` (deterministic; see §4).
7. **Resolve period** — `resolve_reporting_period`, including a `compared_to`
   window when the merchant asks for a comparison.

Early exits, in order: greeting / identity / capability / general →
conversational result; prohibited write request → `read_only_boundary`;
correction pattern → `invalidate_investigation_memory` + clarification.

Then: select tools from `INTENT_TOOLS[intent]`; gate on `store_health` (no
connected store → clarification `no_store`); emit `plan`; run each tool emitting
`step` running → completed/failed; dedupe items; fall back to
`retrieve_revenue_evidence` for comparisons; `validate_collection` +
`validate_attribution`; assemble facts, comparison facts, hypotheses, unknowns,
recommendations and specialist summaries; compose text, then optionally
narrative; persist context only when `persist and conversation_id`; emit
`evidence` then `final`.

**The model may add narrative. It may never add routing facts, metrics, causes,
benchmarks or forecasts.** If the provider is unavailable, misconfigured, times
out or returns text that fails validation, the deterministic composition is
returned unchanged and the degradation is recorded — never silently substituted
with invented content.

Confidence is derived, not asserted: complete `0.82`, partial `0.6`,
insufficient data `0.0`/`0.25`, otherwise `0.4`.

Specialists (`_run_specialists`) run only when `INTENT_DOMAINS[intent]` exists
and `load_current_business_state` returns a non-failed state. Their output
contributes **status and diagnostics only** — never monetary evidence.

---

## 4. Intent routing

Routing decides whether Rev investigates at all: an intent outside
`STORE_INTENTS` runs zero tools.

`INTENT_PATTERNS` is an **ordered, plural-tolerant** table, most specific subject
first: refunds → checkout → customers → products → traffic → data coverage →
revenue → overview. Specificity ordering matters because merchant questions
combine subjects; "Which products contributed the most to revenue?" must reach
`product_investigation` (whose tools include `product_observations`) rather than
`revenue_investigation` (whose list does not), otherwise no line item ever
reaches the evidence.

Follow-up resolution:

- A short elliptical follow-up (≤ `SHORT_FOLLOWUP_WORDS = 6`) refines the
  previous investigation, applying a new segment, filter or period.
- A follow-up that names no subject at all inherits the previous intent.
- A longer follow-up that names its own subject routes on its own keywords, so
  inheritance cannot swallow a genuinely new question.
- A follow-up with no recoverable subject and no history falls back to
  `store_overview`, so it still runs tools instead of returning a zero-evidence
  reply.

`INTENT_GENERAL` remains correct for a question with no commerce subject.

Pinned by `python/tests/test_rev_intent_routing.py` (46 tests) against the live
acceptance question set.

---

## 5. Untrusted data

Store content — product titles and descriptions, order notes, discount names,
customer fields — is **written by other people** and must be summarised, never
obeyed. Three layers hold:

1. **Framing.** Retrieved evidence is serialised and wrapped between
   `UNTRUSTED_OPEN` and `UNTRUSTED_CLOSE`, preceded by `UNTRUSTED_DATA_PREAMBLE`
   stating that in-block text is untrusted, must never be treated as an
   instruction, and cannot widen permissions.
2. **Delimiter escape.** The delimiters are literal strings, so store content
   containing the closing marker would otherwise end the quarantine early and
   place the rest of the text where the model reads it as instructions.
   `_neutralise_untrusted_markers()` rewrites every marker fragment inside the
   payload to an inert form before wrapping.
3. **Output gate.** `_validate_narrative()` rejects a narrative containing
   `NARRATIVE_LEAK_PHRASES` (`system prompt`, `api key`, `x-internal-key`,
   `database_url`, `access token`, `another merchant`, …) as
   `disclosure_attempt`, and execution phrases as `claimed_execution`. Rejection
   falls back to the deterministic composition.

**Authorization is not a prompt property.** Organization scoping lives in the
tool layer: `run_tool` raises `ToolAuthorizationError` on an empty or `None`
organization, and every SQL statement is parameterised with `organization_id`.
A merchant who writes `organization_id=<another uuid>` into their message cannot
widen scope, because scope is never taken from the message or from the model.

Pinned by `python/tests/test_rev_prompt_injection.py` (13 tests).

---

## 6. Database reliability invariants

These are the rules that were violated in production and are now enforced.

1. **No transaction is held open during LLM generation or stream delivery.**
   Reads go through `safe_query()` / `read_row()`, which release the read
   transaction when no outer transaction is in flight. `read_row()` exists
   because SQLAlchemy `RowMapping` rejects integer indexing and the Business
   State snapshot read is positional and wide. A guard logs
   `rev_read_transaction_open_before_model_call` if this is ever violated again.
2. **Pool geometry is a budget, not a guess.** `pool_size = 8`,
   `max_overflow = 4` → capacity 12; `pool_timeout = 30`, `pool_recycle = 300`,
   `pool_pre_ping = True`, `pool_use_lifo = True`,
   `pool_reset_on_return = "rollback"`, plus TCP keepalive in `connect_args`.
   `QueuePool` is forced explicitly. Every limit is read through `_int_setting()`
   with a floor, so a malformed environment variable degrades to a safe default
   instead of crashing at import time.
3. **Request concurrency is bounded below pool capacity.**
   `_REQUEST_CONCURRENCY_LIMIT` plus `_RESERVED_BACKGROUND_DB_CONNECTIONS` must
   fit inside pool capacity, and the threadpool token count must be at least the
   concurrency limit. `_capacity_budget_violation()` reports a breach instead of
   letting the service deadlock under load.
4. **The concurrency permit covers the true stream lifetime.** The pure-ASGI
   `RequestConcurrencyGate` holds its semaphore until the final
   `http.response.body` with `more_body = False`, not until the handler returns.
5. **Cancellation is a distinct outcome from failure.** `InvestigationCancelled`
   → nothing persisted, no error surfaced, work abandoned deliberately, HTTP 499
   on the non-streaming path and a `cancelled` SSE event on the streaming path.
   The whole generator body, including the first `yield`, is inside the `try`
   block: closing the generator before `thread.start()` must not escape
   `GeneratorExit`.
6. **Business State snapshots are retained, not accumulated.**
   `prune_superseded_snapshots()` keeps the newest `SNAPSHOT_HISTORY_RETENTION`
   (default 200, floor 48 — the history reader's `LIMIT`) superseded snapshots
   per organization, deletes at most `SNAPSHOT_PRUNE_BATCH` (500) per call, runs
   **post-commit and outside** the build transaction, can never select the
   current snapshot, and logs-and-swallows its own failure so a pruning problem
   cannot fail a successful rebuild.
7. **Persistence failure is loud.** `BusinessStatePersistenceError` → HTTP 503
   with `Retry-After: 30`. No exception is swallowed into a success.

---

## 7. Observability

`GET /internal/db/diagnostics` (internal-key authenticated; 401 without it)
reports live pool state, Postgres activity, request-gate counters and any
capacity-budget violation:

```json
{
  "pool": {"pool_size": 8, "checked_out": 0, "checked_in": 0, "overflow": -8, "capacity": 12},
  "database_activity": {"unavailable": true, "reason": "query_failed"},
  "request_gate": {
    "limit": 4, "active_requests": 1, "active_streams": 0,
    "total_requests": 1, "queued_requests": 0,
    "mean_wait_ms": 0.0, "max_wait_ms": 0.0, "saturated_events": 0
  },
  "capacity_budget_violation": null,
  "saturated": false
}
```

The gate distinguishes `active_requests` from `active_streams`, and tracks
`total_wait_ms` / `max_wait_ms` / `saturated_at`, so saturation is visible
**while the service runs** rather than only after a timeout storm.

---

## 8. SSE event contract

All three tiers implement the same event vocabulary:

| Event | Meaning |
| --- | --- |
| `accepted` | Turn acknowledged, `investigation_id` issued |
| `meta` | Intent, period, store context, narrative mode |
| `plan` | Tools that will run |
| `step` | One tool running → completed / failed |
| `evidence` | Assembled, validated evidence payload |
| `final` | Terminal success |
| `error` | Terminal failure with a stable `code` |
| `cancelled` | Terminal: the merchant stopped the turn |

`cancelled` is handled end to end: Python emits it on `InvestigationCancelled`;
`Backend/src/services/mlService.js` maps it to `code: 'CANCELLED'` (previously it
fell through to `INVALID_RESPONSE`, so a legitimate Stop surfaced to the merchant
as a malformed-answer error, and logs `rev_stream_cancelled_upstream`);
`revController.chatStream` persists `response_type: 'cancelled'` and forwards the
event; `revStream.ts` resolves `{ completed: false }`.

Stable error codes surfaced to the browser: `RATE_LIMITED`,
`STREAM_START_FAILED`, `STREAM_UNSUPPORTED`, `UNAUTHORIZED`, `CANCELLED`.

---

## 9. Frontend contract

- **Grounding.** Suggested questions are built from the merchant's *actual*
  store by `buildStarters(ctx)` in `src/lib/revStoreContext.ts`, using
  `GET /api/v1/store` (connection status, sync status, webhook coverage,
  monitoring mode, last sync). No store connected → no revenue question is
  offered. Sync incomplete → a sync question comes first. Webhook gap or stale
  sync → a freshness question is unshifted to the front.
- **Honesty banners.** Four explicit states: no store connected, initial sync in
  progress, incomplete webhook coverage (N of M), stale data with a locale
  timestamp. Copy states the read-only boundary rather than implying Rev can act.
- **Answer labelling.** `deriveAnswerState()` in `src/lib/revAnswerState.ts`
  decides the pill from `response_type` first — boundary, clarification,
  conversational — and grades only a genuine investigation on its evidence. The
  evidence drawer is offered only when evidence or hypotheses were actually
  gathered.
- **Read-only vocabulary.** No starter may contain a write verb; the test suite
  asserts against `/\b(draft|create|send|launch|apply|schedule|set up|update|change|discount|refund)\b/i`
  and labels `/win-back|sequence|campaign/i`.

---

## 10. HTTP surface

Node (`Backend/src/route/revRoute.js`), all behind `authenticateToken`:

`POST /chat`, `POST /stream`, `POST /conversation/:id/retry` (each behind
`chatLimiter`, 30/min/IP) · `GET /tools` · `GET /conversations` ·
`GET /conversation/:id` · `DELETE /conversation/:id` ·
`PATCH /conversation/:id/title` · `GET /findings` · `POST /findings/refresh` ·
`GET /findings/:id` · `PATCH /findings/:id` · `GET /briefing` ·
`POST /alerts/check` · `GET /health` · `POST /api/v1/memory` (behind
`memoryLimiter`, 20/5min). Limiters are skipped when `NODE_ENV=test`.

Python (`python/src/serving/api.py`): `POST /orchestrate` (contract `1.0`; 400 on
mismatch, 503 when `result.success = false`, 404 on `PermissionError`) ·
`POST /rev/investigate` · `POST /rev/stream` · `GET /rev/tools` ·
`POST /rev/memory/invalidate` · `GET /health` · `GET /internal/db/diagnostics` ·
`/internal/business-state/rebuild` (409 in-progress, 503 + `Retry-After` on
persistence failure, 503 on lock) · `/internal/morning-briefings` ·
`/internal/recommendation-outcomes/evaluate` · `/internal/features/compute` ·
`/internal/automation/run` · `/internal/sync/trigger` · `/internal/rfm-sync` ·
five `/predict/*` model endpoints. `OrchestrateRequest` bounds the message to
2000 characters, requires 36-character UUIDs, caps `context_payload` at 16 KiB
and allows only allowlisted base64 image media types up to 8 MiB.

---

## 11. Privacy rules

- No credentials, tokens, database URLs, secrets, PII or raw customer exports in
  code, logs, prompts, tests, commits or bundles.
- `storeController.getStores` selects `access_token` for internal use and
  **deletes it from the response** (`safeStore`) before it reaches the browser.
- Grounded public research never carries private conversation history or
  merchant memories into a search query.
- Gemini grounding sources are filtered to `https://` only and capped at five;
  when none survive, the answer says so explicitly rather than implying
  grounding.

---

## 12. Shared Rev operating prompt

The compact, shared merchant-facing language contract lives in
`python/src/agents/rev_system_prompt.py` and is documented in
[`REV-MASTER-SYSTEM-PROMPT.md`](REV-MASTER-SYSTEM-PROMPT.md). It informs
conversational and knowledge responses, structured analysis, and
evidence-grounded narratives. It does **not** grant permissions or replace
deterministic routing, authorization, evidence checks, mutation guards, or
output validation; those remain code-enforced.
