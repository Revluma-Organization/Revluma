# C2 final pre-execution safety gate — approval package

Date: 2026-11-26 UTC. Merge: PR #516 `4706cc0`. Production DB (read-only
inspections only, all prior to this package): Supabase `jblpgqmbgdlzitprudgt`.
Full evidence: `C2-PRODUCTION-MIGRATION-REVIEW.md` §§0–16.

Status: **review only**. This package executed nothing in production: no
freeze, no SQL against production, no data change, no migration, no deploy, no
merge, no verification write. New workspace artifacts are one inert
RC-gated regression test and this document.

## 1. Writer serialization

**Every path capable of writing to an existing conversation** (full audit in
review §11; re-verified this pass):

- Node (all inside `$transaction`, lock statement immediately before INSERT):
  W-N1 `revSubmission.js:156` (tx@125, lock@147), W-N2 `revController.js:342`
  (tx@339, lock@340), W-N3 `:461` (tx@458, lock@459), W-N4 `:1586` (tx@1583,
  lock@1584). Lock: `pg_advisory_xact_lock(hashtext('rev_conversation_sequence'),
  hashtext(conversationId))`, bounded retry ≤3 on P2002/23505.
- Python: `_persist_messages` (`orchestrator.py:1406`), sole INSERT at `:1440`;
  `FOR UPDATE` `:1429` → INSERT `:1440` → `UPDATE conversations` `:1469` →
  single `commit()` `:1484` — one transaction, no intermediate commit.
- No other paths exist: no Prisma-model writers, no writes in
  `Backend/scripts`, `python/scripts`, or any applied migration; `/rev/investigate`
  and `/rev/stream` never write messages; the scheduler `requires_ai` chain is
  unreachable (no producer sets the key).

**Common serialization mechanism — specified, NOT implemented** (exact diff
proposed for `python/src/agents/orchestrator.py`, first statement inside the
`_persist_messages` try block, before the `FOR UPDATE` select):

```python
db.execute(
    text("SELECT pg_advisory_xact_lock(hashtext('rev_conversation_sequence'),"
         " hashtext(CAST(:c AS text)))"),
    {"c": conv_id},
)
```

Key-equality with Node's lock proved on disposable PG (`hashtext` of the same
string through both spellings → identical key; statement executes). After this
lands, every writer to an existing conversation holds the same
transaction-scoped advisory key before allocating — true mutual exclusion in
both directions. Lock ordering (advisory first, row lock second, everywhere)
keeps the scheme deadlock-free against Node's single-lock holders.

**Regression test — added, red-before demonstrated:**
`Backend/src/tests/c2NodePythonSerialization.regression.js` (inert under
`npm test`, which only globs `*.test.js`; RC-gated with the same localhost-only
guard as the existing concurrency proof). Part A asserts the cross-runtime
contract from source (namespace identical to Node's `LOCK_NAMESPACE`, lock
precedes `FOR UPDATE`); Part B (disposable `revluma_rc` PG) proves two-session
blocking in both directions plus 23505 fail-closed on a rogue duplicate.
This pass: `node --check` clean; run shows A1/A2 FAIL with a pointer to this
spec and Part B correctly skipped; test-logic simulation confirms A1+A2 pass
with the specified statement. Proposed (not applied) RC wiring: add a step in
`.github/workflows/release-candidate-verification.yml` running this file after
`revSequenceConcurrency.integration.js` under the same disposable-DB bootstrap.

**Unique-constraint protection for future writes:** after `migration.sql`, any
duplicate allocator gets 23505 — Node retries and re-allocates from live
`MAX+1` (correct); Python's `except` rolls back, logs, and still returns
success **without persisting the turns**. That silent-drop is acceptable only
because the common lock should make it unreachable — flag as approval item
B5 (accept, or require a Python retry-or-propagate follow-up).

## 2. Production repair safeguards

**Processes to freeze (complete list):** (a) Node Render service
`srv-db9m6pom7kps73dtk1tg` — HTTP writers (chat/stream/retry) plus the
in-process scheduler (alert queue, 05:00 UTC briefing trigger); (b) Python
Render service `srv-db9m923ncjis739s8co0` — `/orchestrate`,
`/internal/morning-briefings`, business-state alert writer. Non-writers
needing no action: keep-alive pings (`/health` only, stops on SIGTERM),
Vercel frontend (no direct DB writes; goes quiet once the backend suspends),
CI workflows (none call backend internal endpoints — verified by grep).

**Stop method + stopped-state evidence:** no code kill-switch exists, so the
operator suspends both Render services in the dashboard (process-level;
`SIGTERM → gracefulShutdown → stopScheduler/stopKeepAlive` is the code path).
Stopped state is verified read-only: F1 `pg_stat_activity` shows no app
backends, F2 message count + `MAX(created_at)` identical across two samples
≥60 s apart, F3 `alert_queue` grouped counts frozen, F4 no new
`automation_job_state` completions (exact SQL in review §14.5).

**Backup/PITR + operator:** BLOCKED — the connector exposes no backup API, so
plan tier, latest backup timestamp, and PITR recovery point must be recorded
from the dashboard by a **named operator who is not yet designated** (blockers
B1–B2). Plus a post-freeze `pg_dump -t conversation_messages` before STEP 0.

**Ambiguity halts, never auto-alters:** STEP 3f lists ambiguous groups; STEP 4
permits COMMIT only at G6=0 or with row-by-row named approval — otherwise the
operator runs ROLLBACK. The script contains no uncommented COMMIT, so it
cannot self-commit; disposable test S1 proved ROLLBACK restores rows
byte-identical (md5 match). Census expectation: 0 ambiguous groups.

**Preservation:** G5 asserts 10 non-sequence columns identical per row
(content, ids, role, correlation, timestamps, org/user, agent, metadata,
error flag); G2/G3 assert counts and keepers; `created_at` chronology values
are immutable. User-visible caveat (accepted-design): the 109 excess rows sort
by their new higher numbers.

## 3. Migration and pagination

- **Timestamp:** `20261127000000_c2_conversation_message_sequence` verified
  absent from production history (0 rows) and sorting strictly after all 36
  applied migrations; local history md5-matches production (`3271ec40…`).
- **Zero-dupe gating:** `migration.sql` runs only after recorded G1=0
  (§15.1 P2 → post-repair G1 → §15.2 R1). Defense in depth: the statement
  itself fails closed with 23505 on dirty data (proved on disposable PG).
- **Pre-repair cursors:** NO code-level invalidation exists — cursors are raw
  `(sequence_number, id)` tuples with no epoch. Invalidation is procedural
  only: freeze drains in-flight pagination (no frontend cursor persistence
  found in repo — cursors are ephemeral page tokens), clients re-fetch from
  head after resumption. Approval item B4: accept procedural invalidation, or
  require a cursor-epoch follow-up before repair.
- **Post-repair contract + concurrent writes:** newest-first pages over the
  total order `(sequence_number, id)` with strictly-less-than tuple predicate
  — concurrent appends land above max and can never disturb already-issued
  older pages; exact-once validated on disposable PG (tuple test). Post-UQ,
  concurrent allocators serialize on the advisory lock with the unique index
  as backstop.

## 4. Deployment separation

**PR #516 deploys independently of repair + UQ migration: YES.**
Merged reads tolerate ties explicitly (`(sequence_number, id)` ordering,
client-side dedupe by id); merged writes lock + allocate `MAX+1` with or
without the index; the 23505 retry is inert without the backstop (no other
unique target on those INSERTs). The repair and the constraint are strictly
later, approval-gated steps — the app neither needs nor triggers them
(`migrations-pending/` is undiscoverable; local 36 = prod 36, so `prestart`
`migrate deploy` is a proven no-op).

**Safe deployment order:** (1) deploy backend `4706cc0`; (2) implement + deploy
the §1 Python serialization (new PR; compatible in both directions — an
uncontended advisory lock is a no-op); (3) freeze → repair → UQ migration;
(4) resume writers + smokes. Step 2 before 3 is recommended, not strictly
required (freeze + fresh-convo property already protect the repair window).

**Exact Render target/process/commit/smoke/rollback:**

- Service: Node `srv-db9m6pom7kps73dtk1tg` (`revluma-backend-vrsd.onrender.com`),
  workspace `tea-dat7lbqd0e5s73afif20`; process `node server.js` via
  `prestart` (no-op migrate) → `start`.
- Commit: `4706cc0` (target). Currently-deployed SHA was never reported —
  operator must confirm before/after (blocker B1).
- Read-only smokes (no verification writes): `/ready` 200, Python `/health`
  200, `scheduler_started` in logs, fresh `automation_job_state` completions,
  `GET /rev/conversations` + `GET /rev/conversation/:id` 200.
- Rollback: Render dashboard rollback to the previous deploy (operator,
  code-only — zero DB changes in this deploy, nothing to revert in Postgres).

## 5. Final verdict

| Decision | Verdict |
|---|---|
| Backend application deployment (`4706cc0`) | **CONDITIONAL GO** — conditions: operator confirms Render target + current SHA (B1), prestart applies zero migrations (pre-verified), read-only smokes pass |
| Historical sequence repair | **NO-GO** — blockers B1, B2, B4, B6, B7 |
| Unique-constraint migration | **NO-GO** — requires verified zero-tie repair first |
| Writer resumption | **NO-GO** — only after repair + UQ + smokes; procedure ready (§14.6) |

**Remaining blockers for explicit approval:** B1 named operator + Render
confirmations (current SHA, suspend/resume, auto-deploy); B2 PITR plan,
backup timestamp, recovery point recorded; B3 Python serialization PR merged
+ regression test wired into RC (specified, not implemented); B4 accept
procedural cursor invalidation (or cursor-epoch follow-up); B5 accept Python
23505 silent-drop (or retry-or-propagate follow-up); B6 freeze window outside
05:00 UTC ± 30 min; B7 ambiguous-group policy sign-off (G6=0 expected).

**STOP:** no production action taken. Awaiting explicit approval naming the
operator and resolving B1–B7.
