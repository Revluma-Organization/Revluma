# Task 223 diagnostics — conversation submission, loading and evidence

## Scope and inspected baseline

User-assigned Task 223 consolidates original Tasks **300–304** only. The inspected baseline was `5479a7f89c94c24fbb151413d32161469e6cded3` on `arena/1a609ce0-revluma`. Task 224 was not started.

The upstream Tasks 204/205/207/209/210/211/212 implementation and validation records and current source were inspected. `RevAnswerView`, `EvidencePanel`, `revPresentation.ts`, response adaptation, claim/evidence guards, adaptive confidence, selected-finding continuity, typed investigation outcomes and bounded AI failures already provide the required answer and evidence behavior. Task 223 reuses those contracts rather than introducing another response pipeline.

## Findings

### F-1 — composer cleared before acceptance

`RevIntell.send()` cleared the text and image before the request. A pre-acceptance authentication, validation, rate-limit or network failure could therefore discard the only editable copy. SSE `meta` is emitted after the user row is persisted and is the acceptance point; a valid final response is also authoritative acceptance evidence.

### F-2 — no stable transport idempotency key

The server generated each correlation UUID and `correlation_id` had only a non-unique index. Disabling Send prevented ordinary double-clicks but could not deduplicate a lost response followed by a network retry. Stable client `request_id`, tenant/conversation-scoped uniqueness and replay behavior were required.

### F-3 — direct API oversize input was silently changed

`sanitiseMessage` truncated input to 2,000 characters. The browser bound from Task 222 did not protect direct API calls. Shared validation now rejects `MESSAGE_TOO_LONG` before persistence while retaining exactly 2,000 characters.

### F-4 — compact loading implied measurable progress

The compact timeline showed `completed/steps.length`. That can be read as percentage progress even though backend stages are not a measured workload. Compact loading now names only the actual running event, or an indeterminate investigation status, without fractions or percentages. Expanded explicit check counts remain factual.

### F-5 — malformed stream endings could be treated as completion

The stream client resolved `completed:false` for missing finals and did not strictly validate final envelopes. Task 223 requires a valid successful final with a conversation ID, string text and response type. Missing/malformed finals now raise `MALFORMED_RESPONSE`; a trailing final cannot reverse a terminal error.

### F-6 — CRLF SSE boundaries were incomplete

The parser searched only for `\n\n`, leaving standard `\r\n\r\n` frames unparsed. Boundary matching now supports both LF and CRLF, including chunk splits.

### F-7 — accepted failures could remain forever in progress

After persisting a user turn, an unhandled JSON/SSE failure could return without a Rev row. A later idempotent retry would see acceptance but no terminal result. Both controllers now persist a safe failed Rev outcome where acceptance and sequence are known; failure-persistence errors are logged without exposing internals.

## Security, tenancy and read-only review

- Organization identity remains resolved from the verified request context. No tenant/store/provider identifiers from the browser are trusted.
- Accepted lookup is scoped by `organization_id`, request UUID and `role='user'`; its Rev join additionally matches the same conversation and correlation.
- Existing conversation access retains 404-unknown and 403-foreign behavior.
- Reusing a UUID for another question or conversation returns `REQUEST_ID_REUSED` (409).
- `execute:true` remains forbidden. No provider/tool capability was added.
- Request IDs are UUID-validated and parameterized; image/media constraints, rate limits, RLS and privacy boundaries are unchanged.
- New conversations use a server-derived UUIDv5 of the request ID. Concurrent acceptance therefore targets the same conversation, with `ON CONFLICT DO NOTHING` and one unique user acceptance marker.

## Evidence presentation and responsive/accessibility audit

Revenue, Retention and Operations evidence continues through the existing validated evidence envelope, claim citations and scoped finding context. Evidence rows expose period, source, definition, timestamp/freshness, status and limitations through progressive disclosure. Missing citations, partial/stale/contradictory/unavailable and unverified states are not converted into support. Recommendations remain read-only and no recoverable-revenue amount is inferred.

Automated scenarios cover the required widths **320, 375, 430, 600, 768, 1024, 1280, 1440 and 1920 px**, full-workspace composer availability/44px send target/bounds and compact lifecycle wrapping/no percentages. Existing page and component suites cover keyboard operation, dialogs/focus, live regions, reduced motion, long answers and evidence tables. jsdom is not pixel-level browser proof; authenticated real-browser checks remain separate acceptance evidence.

## Decision

Implement the narrow transport/persistence and truthful lifecycle corrections, retain the verified response/evidence system, add a migration and at least 120 meaningful scenarios, then require CI/migration evidence and deployment verification. Do not infer authenticated active-store acceptance from fixtures or deployment readiness.
