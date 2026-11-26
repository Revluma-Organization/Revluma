# C2 preparation review — conversation sequence races (PREPARED, not merged, not deployed)

Branch: `arena/5d10a13b-revluma`. Stage: C2 implementation + migration/rollback/repair
preparation. STOP status (unchanged): historical repair NOT executed, production
migration NOT applied, PR NOT merged, NOT deployed. H2 annotations and sandbox-org
creation remain separately gated and were NOT performed.

## 1. Insertion-path audit (all writers, with disposition)

| # | Path | Before | After |
|---|------|--------|-------|
| 1 | `acceptSubmission` user row (`revSubmission.js`) | `MAX+1` inside tx, **no lock** — concurrent same-conversation accepts tied | Advisory xact lock after ownership check, same `INSERT…SELECT MAX+1`, whole tx retried (bounded) on unique violation |
| 2 | Chat failure rev row (`revController.js`, was `:342`) | Precomputed `revSequence` (`MAX+1` before the Python call, outside any tx) | Lock + `INSERT…SELECT MAX+1` in tx at write time, bounded retry |
| 3 | Chat success rev row (was `:456`) | Same precomputed value | Same locked allocation |
| 4 | `_insertRevMessage` × 5 call sites (chat catch, stream success/cancelled/error/catch) | `sequenceNumber` parameter, precomputed before SSE/model work | Parameter removed; lock + `INSERT…SELECT MAX+1` in tx, bounded retry |
| 5 | Python `orchestrator._persist_messages` | **Dormant**: replaced by a no-op whenever `_node_owns_chat_persistence` is set, and all Node call sites (chat, stream, image path) set it | Untouched; documented as the non-cooperating writer the UNIQUE backstop + retry defend against. Uses `FOR UPDATE` + `message_count`-based numbering if ever re-enabled — a divergent base, flagged here, not changed |

No Prisma-model writers exist (all raw SQL); no `UPDATE` of `sequence_number`
exists anywhere. `retryConversation` only deletes failed rev rows and reuses the
user row (`reuse_user_message: true`) — covered by paths 2–4, untouched.

## 2. Before-state reconciliation evidence (read-only, 2026-11-26, org-wide)

- 772 message rows, 144 conversations, **0 NULL** `sequence_number`.
- **109 tied groups, all exactly pairs** (`max_group = 2`, zero triples+),
  57 conversations, 218 tied rows, **109 excess rows**.
- Target org `1dc6aa19-…`: **78 groups / 38 convos / 78 excess — unchanged
  since the 5F audit** (no new ties there). Other orgs: 14+7+6+2+2 = 31 groups.
- Role mix: rev+rev 44, user+user 44, cross-role 21 (sums to 109).
- **0 groups share `created_at`** — the repair's `(created_at, id)` order is total.
- Indexes: `idx_conv_msg_conversation` is NON-unique;
  `uq_conversation_message_sequence` is ABSENT; `uq_conversation_message_submission`
  (task 223) present as designed.
- Observed, out of scope: `conversations.message_count` drift (stored 2× actual
  in the worst rows, e.g. 16 vs 8) — consistent with retry-delete flows. C2 does
  not touch `message_count`.

## 3. Repair procedure (PREPARED, NOT executed)

`Backend/prisma/migrations-pending/20261126000000_c2_conversation_message_sequence/repair.sql`:
tie-only, minimal blast radius. Keeps the earliest `(created_at, id)` row of each
tied group on its number; renumbers only excess rows above the conversation's
current maximum in deterministic `(sequence_number, created_at, id)` order.
Untied rows are never touched. Idempotent (second run updates 0 rows).
Expected blast radius at last census: 109 rows of 772.

Trade-off (reviewer decision): 21 cross-role pairs will show the rev answer after
later messages (the user row keeps the slot, the rev row moves past the maximum).
The alternative — full renumbering 1..N by `(created_at, id)` — restores chronology
but shifts every subsequent number in 57 conversations. Tie-only is proposed as
the minimal, still-deterministic fix.

## 4. Migration (PREPARED, NOT applied) and rollback

- `migration.sql`: idempotent `CREATE UNIQUE INDEX uq_conversation_message_sequence
  (conversation_id, sequence_number)`, matching the new `@@unique` in
  `schema.prisma`. Precondition: repair verified at zero tied groups.
- `rollback.sql`: idempotent drop of the backstop in either shape (plain unique
  index on production, unique constraint on schema-bootstrapped databases).
  Code keeps working without the index; the repair is forward-only.
- **Auto-apply protection:** production `_prisma_migrations` is current through
  `20261123000000`, so anything under `prisma/migrations/` would be picked up by
  the next `migrate deploy` — and would FAIL on today's ties. The package
  therefore lives in `prisma/migrations-pending/` (no pipeline discovers it).
  Promotion after both approvals: move `migration.sql` byte-identical into
  `prisma/migrations/` and `migrate deploy`. Full runbook in the package README.

## 5. Pagination (tuple cursor, legacy compatible)

- `?before=<int>` keeps **exact** legacy semantics (same predicate, plus
  deterministic `id` tie-break ordering — exact once repair + backstop land).
- Optional `before_id` uuid selects `WHERE (sequence_number, id) <
  (before_seq, before_id) ORDER BY sequence_number DESC, id DESC`; malformed id
  with a present `before` is a 400; `before_id` without `before` is ignored.
- Response `pagination` gains `before_id`, `next_before`, `next_before_id`
  (additive only). Frontend untouched — still sends `before` only.
- The tuple cursor stays permanently: cheap, robust to any future tie source.

## 6. Test results

Sandbox-runnable (no database), all green:

- `revSubmission.test.js`: 69/69 (65 pre-existing unbroken + 4 C2: lock-before-insert
  ×2, retry-then-success, bounded-retry-exhaustion).
- `revSequence.test.js` (new): 14/14 — lock shape/namespacing, 8
  unique-violation detection shapes, 4 retry behaviours.
- `revConversationPaging.test.js` (new): 9/9 — cursor parsing, 400 rule,
  next-page cursor.
- `revTupleCursor.test.js` (new): 6/6 — real controller + real SQL against a
  mocked DB: first/legacy/tuple predicates, pagination cursors, 400-before-query,
  before_id-ignored.
- Contract suites: `revPersistence` (writer now asserts lock-then-`INSERT…SELECT`),
  `revConversation`, `revRetryReliability` (cursor guards moved to the tested
  parser + delegation pins) — all pass. No contract was weakened; two were
  extended to pin the new behaviour.

Real-PostgreSQL (release-candidate disposable DB, green in CI — see §7):

- `revSequenceConcurrency.integration.js` (new, 9 scenarios): backstop-present
  check, 8-way parallel accepts all completing without duplicates, accepted
  sequences contiguous 1–8, 8-way parallel real-`_insertRevMessage` → 9–16,
  mixed 4+4 race → 17–24 (all distinct and gapless), tuple-predicate shape
  through Prisma params, `repair.sql` validity + zero-tie proof,
  `migration.sql` idempotent apply, rollback→recreate round-trip. Fixture rows
  cleaned up; the backstop is restored in a `finally`.

Full suites / gates: backend suite, `prisma validate`, dashboard suite + build
(tsc baseline 110 — no frontend changes), and the RC job all run in CI on the PR
(§7). `prisma validate` could not run in this sandbox (engine download blocked);
it runs in CI on every PR.

## 7. CI results

PR #516, `e108a45`: **all 12 checks pass** — `Backend test suite`,
`Dashboard suite and production build`, `Prisma bootstrap, financial and
security regressions`, `Vercel`, `Vercel Preview Comments`, `backend`, and
`task025`–`task030`. Release-candidate run `45881350697`: the Prisma regression
job passes in 2m2s, including both C2 probes, the accepts prefix
(scenarios 0–2), the serial baseline, and the full nine-scenario run
(scenarios 0–8).

The concurrency integration earned its place: the real-PG accept race failed
until two real defects were fixed. First, the advisory-lock SELECT needed the
repo-standard `::text` cast because Prisma cannot deserialize bare `void`.
Second — the final blocker — the shipped Phase 5D `//` comment was embedded
inside the accept `INSERT…SELECT` template. PostgreSQL has no `//` comments, so
every real accept transaction failed (`trailing junk after numeric literal`);
unit mocks captured that SQL without executing it. `e108a45` moves the comment
outside the shipped SQL and pins a regression assertion that accept SQL
contains no `//`.

## 8. Contracts preserved (5B–5E)

SSE framing/heartbeat, retry (eligibility, `reuse_user_message`, failed-row
deletion, staleness guard), idempotency (`request_id` key + replay bodies
unchanged; annotation still stands on replay), conversation restoration
(list/search/counts untouched; single-thread read additive-only), read-only
boundary (`execute: true` still rejected pre-persistence), tenant isolation,
retryability closed set, question-length bound, regenerative payload limits.
No frontend change ⇒ tsc baseline 110 untouched. Zero production mutations in
this stage: no repair, no migration, no annotation, no sandbox org.

## 9. Explicit STOP list (awaiting review)

1. Execute the historical sequence repair. 2. Apply the production migration.
3. Merge the PR. 4. Deploy. 5. H2 annotations. 6. Sandbox-org creation.
