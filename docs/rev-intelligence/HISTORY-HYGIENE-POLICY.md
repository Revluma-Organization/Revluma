# Conversation History Hygiene Policy (Stage 1 — H2)

**Effective:** 2026-11-26. **Owner:** Rev platform.
**Authority:** Phase 5F audit §4 (contamination), addendum A6 (H2).

## 1. Rules

1. **No scripted traffic in merchant organizations.** Load tests, eval harnesses,
   smoke sweeps, and any non-human client send Rev traffic only to dedicated
   sandbox organizations. There is no exception for "just one run".
2. **Every scripted run is configured, never ad-hoc.** Runs go through
   `python/src/lab/eval_config.py`: explicit `REVLUMA_EVAL_API_BASE` +
   `REVLUMA_EVAL_ORG_ID`, a production blocklist (`REVLUMA_EVAL_PROD_ORG_IDS`),
   and a stable run identity. The config refuses to build against blocklisted orgs.
3. **Every scripted request is tagged.** HTTP: `User-Agent: revluma-<source>/<harness>/<run_id>`
   plus `X-Eval-Run`. Body: `client_context: {source: eval|load, run_id, harness}`,
   which the gateway validates (allowlist) and persists into the user message's
   existing `metadata` column. Tags are annotative: they never alter routing,
   evidence scope, or idempotency.
4. **Never delete history to clean it.** Contamination is handled by annotation
   (`metadata.eval_burst` on the affected user messages, approval-gated,
   SELECT-first, rollback by restoring prior JSON), never by DELETE. Message
   counts, sequence numbers, and evidence payloads are preserved as observed.
5. **Bursts are reported, not hidden.** Any run that produces error bursts,
   duplicate submissions, or unexpected volumes files the run id, target org,
   request count, and error codes in the eval log before any annotation PR.

## 2. Sandbox organizations

- Sandbox orgs are ordinary organizations reserved by policy: company name prefix
  `Revluma Eval Sandbox`, slug prefix `revluma-eval-sandbox-`. Creation SQL is
  proposed per need and executed only after approval (requires owner user +
  membership rows; harness credentials issued as secrets, never in repo).
- CI sets `REVLUMA_EVAL_PROD_ORG_IDS` to all production org ids; any harness run
  without an explicit non-production target fails closed at config load.
- Sandbox orgs are excluded from merchant analytics, briefings, and finding
  rollups by organization id, not by content sniffing.

## 3. Tagging contract (server side)

- Accepted on `POST /api/v1/rev/chat` and `POST /api/v1/rev/stream` as optional
  `client_context`. Rejected with 400 `INVALID_CLIENT_CONTEXT` unless
  `source ∈ {eval, load}` and `run_id`/`harness` match `[A-Za-z0-9_.:-]{1,64}`.
- Persisted verbatim at `conversation_messages.metadata.client_context` on the
  accepted user row only. Ordinary merchant turns store `metadata = NULL`.
- Returned on restore as `client_context` in `GET /rev/conversation/:id`
  (extracted projection; no other metadata is exposed).
- Replay semantics: the idempotency key is unchanged
  (`organization_id, conversation_id, role, correlation_id`); a replayed
  request_id returns the owned turn and keeps the first accepted annotation.

## 4. Historical bursts

The 5F audit identified scripted-looking traffic in Splendor's Store
(`1dc6aa19`): 9/15 bursts, the 8/20 smoke sweep, and 10/27–28 clusters.
The SELECT-first candidate list and proposed (not yet applied) annotations are in
`H2-EVAL-BURST-CANDIDATES.md`. Annotation requires explicit per-burst approval.

## 5. Runbook — a new burst is suspected

1. Freeze: identify run/conversations with the candidate-list queries; do not delete.
2. Attribute: match `client_context`/headers, timing, and error codes to a run id.
3. File: record run id, org, counts, codes (rule 5).
4. Propose: extend the candidate list with message ids + annotation payload.
5. Annotate only after approval; verify counts before/after; keep the evidence.
