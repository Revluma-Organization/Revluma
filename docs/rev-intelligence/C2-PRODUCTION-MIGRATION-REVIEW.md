# C2 post-merge production migration review — conversation sequences

Review date: 2026-11-26 UTC.  
Merge under review: PR #516, `4706cc0c1b6a163e629839b3a4327c8692df3e02`.  
Review branch: `arena/66b6a728-revluma`, branched from the merge commit.  
Production database inspected read-only: Supabase project `jblpgqmbgdlzitprudgt`
(`Revluma-Database`, `eu-west-1`, `ACTIVE_HEALTHY`, PostgreSQL 17.6.1.127).

Status: **audit and preparation only**. This task executed no production repair,
no production migration, no production writes, no deployment, no merge, no H2
annotation, and no sandbox-org creation.

One deployment fact needs to be stated precisely: merging `main` automatically
promoted a Vercel frontend production deployment for the merge commit. That
deployment builds frontend assets only; it does not run the backend, Prisma
migrations, repair SQL, or backend startup hooks. Backend production status
remains separately verified below.

## 0. Reading guide

- **Verified fact:** observed in merged code, connector output, CI/GitHub output,
  focused tests, or disposable-database validation.
- **Proposed operation:** exact SQL/command prepared for later approval. None was
  executed against production.
- **Unverified assumption:** required for rollout but not established by the
  available evidence.
- **Approval-required action:** must not proceed without explicit approval.

Follow-up addendum (same date, §§11–16): full Node+Python writer audit with
serialization proof (§11, supersedes the "dormant writer" framing in §2.3); the
final transaction-wrapped repair procedure with disposable-DB results (§12,
supersedes the §4.5 draft); migration-ordering resolution (§13); Render/PITR/
freeze/restoration safeguards (§14); exact pre/post verification gates (§15);
and contract preservation (§16). The §1/§10 verdicts are unchanged: this
addendum is evidence, not execution permission.

## 1. Executive verdict

### Split recommendation

| Operation | Recommendation |
|---|---|
| Deploy merged backend application code, with C2 migration package untouched in `migrations-pending/` | **CONDITIONAL GO**, after confirming the Render backend target/process and post-deploy checks in §7 |
| Execute historical sequence repair | **NO-GO**. Procedure is prepared, but writer freeze, backup/PITR proof, and explicit approval are missing |
| Apply unique-constraint migration | **NO-GO**. Production still has 109 tied groups; migration must follow verified zero-tie repair and explicit approval |

### Why the application change is conditionally acceptable

Verified facts:

- The merged backend fixes the invalid Stage 1 accept SQL: the Phase 5D `//`
  comment is outside the shipped SQL template, with a regression assertion that
  shipped accept SQL contains no `//`.
- All Node conversation-message allocation paths allocate `MAX+1` inside the
  inserting transaction under the same per-conversation advisory lock, with
  bounded retry on unique violations.
- There are no production Prisma-model writers for `conversation_messages` and
  no production `UPDATE` of `sequence_number`.
- The C2 database package remains outside Prisma migration discovery:
  only `Backend/src/tests/revSequenceConcurrency.integration.js` references
  `migrations-pending/`; no backend startup path, workflow, or migration runner
  does.
- Current production measurements are unchanged from the pre-merge census: 772
  messages, 144 conversations with messages, 109 tied groups, 218 tied rows,
  109 excess rows, 57 affected conversations, all pairs, zero NULL/non-positive
  sequences, no tied row newer than 2026-11-02.
- Focused merged-code tests pass 101/101 locally.
- Disposable-database validation passes for repair semantics, idempotence,
  migration failure on tied data, transactional rollback, locked per-conversation
  mechanics, and tuple pagination.

### Why repair and migration remain NO-GO

Blocking or unresolved items:

1. The prepared `repair.sql` does **not** acquire the C2 advisory lock and has
   no transaction wrapper. It cannot satisfy the repair requirements as written;
   §3 proposes a locked per-conversation wrapper.
2. The “dormant Python writer” description in the C2 preparation review is
   inaccurate. Python `_persist_messages` remains reachable without the C2 lock
   through scheduler-triggered morning-briefing orchestration, scheduler-alert
   orchestration, and authenticated internal `/orchestrate` calls.
3. No repository-defined writer-freeze switch was found. Render/Python service
   controls are outside the repository and were not inspected.
4. Supabase backup retention/PITR status was not established. A logical
   `conversation_messages` backup plus verified platform recovery capability are
   required before repair.
5. The pending C2 directory shares the `20261126000000` timestamp prefix with
   the now-applied Apple/billing migration. Promotion needs a fresh,
   collision-free migration directory name.
6. Production backend deployment state is not directly verified. Evidence shows
   a post-merge Prisma migration completed, but not that production traffic is
   served by the C2 backend revision.

### Approval-required actions

Explicit approval is required before each of:

1. Backend production deployment.
2. Any production writer freeze, restart, or scheduler/Python behavioral change.
3. Platform snapshot/PITR verification and logical production backup handling.
4. Historical sequence repair.
5. Unique-constraint migration or rollback.
6. Production verification messages, retries, pagination probes that create
   history, or cross-tenant negative tests using production identities.
7. Historical H2 annotations and sandbox-org creation, unchanged from prior gates.

## 2. Merged-code verification

### 2.1 Merge identity

Verified from GitHub:

- PR: `https://github.com/Revluma-Organization/Revluma/pull/516`
- State: `MERGED`
- Merge commit: `4706cc0c1b6a163e629839b3a4327c8692df3e02`
- Merged at: `2026-11-26T19:20:58Z`
- PR head at merge: `29e5e1b119a54de91a583a36d722ea2d90f5b301`
- Base branch: `main`

The local checkout on the review branch is shallow/grafted, so the pre-merge
parent object is unavailable locally. File-level merge scope was therefore taken
from the GitHub PR file list, and behavior was verified against the merged tree.

Merged PR files:

| Change | Additions/deletions | Path |
|---|---:|---|
| modified | +58/-0 | `.github/workflows/release-candidate-verification.yml` |
| added | +51/-0 | `Backend/prisma/migrations-pending/20261126000000_c2_conversation_message_sequence/README.md` |
| added | +11/-0 | `Backend/prisma/migrations-pending/20261126000000_c2_conversation_message_sequence/migration.sql` |
| added | +55/-0 | `Backend/prisma/migrations-pending/20261126000000_c2_conversation_message_sequence/repair.sql` |
| added | +16/-0 | `Backend/prisma/migrations-pending/20261126000000_c2_conversation_message_sequence/rollback.sql` |
| modified | +1/-0 | `Backend/prisma/schema.prisma` |
| modified | +17/-9 | `Backend/src/controller/__tests__/revPersistence.contract.test.js` |
| modified | +9/-2 | `Backend/src/controller/__tests__/revRetryReliability.contract.test.js` |
| modified | +113/-73 | `Backend/src/controller/revController.js` |
| added | +65/-0 | `Backend/src/services/__tests__/revConversationPaging.test.js` |
| added | +91/-0 | `Backend/src/services/__tests__/revSequence.test.js` |
| modified | +69/-0 | `Backend/src/services/__tests__/revSubmission.test.js` |
| added | +51/-0 | `Backend/src/services/revConversationPaging.js` |
| added | +56/-0 | `Backend/src/services/revSequence.js` |
| modified | +15/-4 | `Backend/src/services/revSubmission.js` |
| added | +280/-0 | `Backend/src/tests/revSequenceConcurrency.integration.js` |
| added | +196/-0 | `Backend/src/tests/revTupleCursor.test.js` |
| added | +146/-0 | `docs/rev-intelligence/C2-PREPARATION-REVIEW.md` |

### 2.2 Sequence-allocation paths

Verified: every Node conversation-message insert allocates under the same
transaction-scoped advisory lock in the inserting transaction.

Shared primitive:

- `Backend/src/services/revSequence.js:21`
  - `LOCK_NAMESPACE = 'rev_conversation_sequence'`
- `Backend/src/services/revSequence.js:22`
  - `MAX_ALLOCATION_ATTEMPTS = 3`
- `Backend/src/services/revSequence.js:24-28`
  - `SELECT pg_advisory_xact_lock(hashtext(namespace), hashtext(String(conversationId)))::text AS lock_acquired`
- `Backend/src/services/revSequence.js:38-46`
  - retries only unique violations, bounded at three attempts.

Allocation matrix:

| Path | Code | Transaction and lock | Insert |
|---|---|---|---|
| Accept user row | `Backend/src/services/revSubmission.js:125-166` | `withSequenceAllocationRetry(... prisma.$transaction ...)`; lock at `:147` | `INSERT...SELECT MAX+1` at `:156-164`, with submission-key `ON CONFLICT DO NOTHING` |
| Chat failed rev row | `Backend/src/controller/revController.js:339-356` | Retry + transaction + lock at `:340` | Locked `MAX+1` rev insert |
| Chat successful rev row | `Backend/src/controller/revController.js:458-480` | Retry + transaction + lock at `:459` | Locked `MAX+1` rev insert |
| Shared rev writer | `Backend/src/controller/revController.js:1583-1604` | Retry + transaction + lock at `:1584` | Locked `MAX+1` rev insert |
| Chat-catch rev row | call at `revController.js:566` | Delegates to shared writer | Covered |
| Stream success rev row | call at `revController.js:1905` | Delegates to shared writer | Covered |
| Stream cancelled rev row | call at `revController.js:1945` | Delegates to shared writer | Covered |
| Stream error rev row | call at `revController.js:1971` | Delegates to shared writer | Covered |
| Stream-catch rev row | call at `revController.js:2014` | Delegates to shared writer | Covered |
| Conversation retry | `revController.js:2098-2174` | Deletes failed rev rows, then delegates to `chat` with `reuse_user_message: true`; no direct sequence allocation | Allocation covered downstream |

Also verified:

- The invalid `//` SQL comment is outside the shipped accept template at
  `revSubmission.js:152-154`.
- The regression assertion at
  `Backend/src/services/__tests__/revSubmission.test.js:102-103` rejects `//`
  in shipped accept SQL.
- Production source search finds no `prisma.conversation_messages.create`,
  `update`, `upsert`, or `delete` calls and no production `UPDATE` of
  `sequence_number`.
- The only Prisma-model `conversation_messages.deleteMany` is disposable-RC
  fixture cleanup in `revSequenceConcurrency.integration.js:259`.
- `retryConversation` deletes failed rev rows without allocating replacement
  numbers directly; its replacement rev row is allocated by the locked chat
  path.

Residual ordering caveat, verified but not a sequence-allocation bypass:

- Thread reads are deterministic.
- Retry’s internal latest-user/latest-failed-rev selection uses
  `ORDER BY sequence_number DESC` without an `id` tie-break at
  `revController.js:2105-2127`.
- Python history reads use sequence-only descending order at
  `python/src/agents/orchestrator.py:1562` and
  `python/src/agents/investigation.py:1635`.
- After verified repair plus the unique backstop, those selections become
  deterministic. Before repair, tied rows can make “latest” selection
  nondeterministic.

### 2.3 Non-cooperating Python writer

Verified: the C2 preparation review’s blanket “dormant” label is not accurate.

Code facts:

- Node chat and stream set `_node_owns_chat_persistence: true` at
  `revController.js:319` and `revController.js:1882`.
- Python replaces persistence with a no-op only when that flag is present, at
  `python/src/agents/orchestrator.py:683-684`.
- Otherwise `_persist_messages` writes both user and rev rows using:
  - `SELECT ... FOR UPDATE` on `conversations.message_count`;
  - `base_seq + 1` and `base_seq + 2`;
  - no C2 advisory lock.
- Scheduler-triggered morning briefings call `orchestrate(...,
  trigger_type="scheduler", context_payload={"schedule": "morning_briefing"})`
  at `python/src/intelligence/morning_briefing.py:235-252`.
- Node starts that daily path at 05:00 UTC through
  `Backend/src/services/schedulerService.js:499-588` and `:1204-1345`.
- Scheduler-alert orchestration at `schedulerService.js:680-697` does not set
  `_node_owns_chat_persistence`.
- Internal `/orchestrate` accepts an optional existing `conversation_id` at
  `python/src/serving/api.py:833-930`, subject to internal authentication.

Practical scope:

- Morning-briefing and scheduler-alert calls observed in code pass
  `conversation_id=None`, create a new conversation, and therefore do not
  explain collisions in existing conversations.
- An authenticated internal caller can nevertheless target an existing
  conversation. That path bypasses the C2 lock and uses the divergent
  `message_count` base.
- Python persistence failures are logged and rolled back, not fatal, at
  `orchestrator.py:1480-1498`; after the unique index lands, a Python
  collision becomes a logged persistence failure rather than silent duplication.

This is why §3 requires an explicit non-cooperating-writer freeze during
repair, not merely reliance on the advisory lock.

### 2.4 Unique object: present in schema, absent in production

Verified:

- Merged schema declares:
  - `Backend/prisma/schema.prisma:981`
  - `@@unique([conversation_id, sequence_number], map: "uq_conversation_message_sequence")`
- Pending SQL proposes:
  - `CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_message_sequence ON conversation_messages (conversation_id, sequence_number);`
- Production `pg_indexes` has seven indexes and no
  `uq_conversation_message_sequence`; see §3.
- Production has no corresponding unique table constraint; see §3.
- Production `_prisma_migrations` has zero rows for the C2 migration name.

The pending migration follows the repository’s existing convention for Prisma
uniqueness, matching task 223’s plain unique index for
`uq_conversation_message_submission`.

### 2.5 Deterministic reads and pagination

Verified in `Backend/src/controller/revController.js:710-758`:

- First page: newest rows by
  `ORDER BY cm.sequence_number DESC, cm.id DESC`,
  returned ascending by `sequence_number ASC, id ASC`.
- Legacy `before`: same deterministic ordering plus
  `AND cm.sequence_number < ${before}`.
- Tuple cursor: same deterministic ordering plus
  `AND (cm.sequence_number, cm.id) < (${before}, ${beforeId}::uuid)`.

Verified in `Backend/src/services/revConversationPaging.js:24-45`:

- `before` must parse as an integer `>= 0`; otherwise no cursor is applied.
- `before_id` without `before` is ignored, even when malformed.
- A present `before` with malformed `before_id` raises a 400.
- A full page’s oldest ascending row supplies `next_before` and
  `next_before_id`; a short page returns null cursors.

Legacy-compatibility finding:

- For untied conversations, legacy `?before=<int>` behavior is preserved.
- For historically tied conversations, deterministic `id` tie-breaking can
  change the relative order of equal-sequence rows versus the database’s former
  unspecified tie order. Calling that “exact” without qualification is
  therefore imprecise, although the change is intentional and deterministic.
- Frontend code contains no `before_id` sender; backend additions are additive.

### 2.6 SSE, retry, idempotency, restoration, finding context, tenant isolation

Verified:

- Routes remain authenticated at `Backend/src/route/revRoute.js:72-111`:
  - `POST /api/v1/rev/chat`
  - `POST /api/v1/rev/stream`
  - `POST /api/v1/rev/conversation/:id/retry`
  - `GET /api/v1/rev/conversations`
  - `GET /api/v1/rev/conversation/:id`
- Chat and stream persist acceptance before model work and replay duplicate
  `request_id` submissions instead of inserting another user row or starting
  another investigation.
- Retry preserves eligibility checks, failed-row deletion, and
  `reuse_user_message` delegation.
- SSE success/cancelled/error/catch branches all persist through the locked
  shared writer and preserve `meta`/`final`/`cancelled`/`error` framing.
- Conversation reads verify organization membership and conversation ownership
  before returning messages.
- Finding-context resolution remains server-side under the authenticated
  organization.
- `conversations.message_count` updates remain outside the sequence-allocation
  transaction. This does not affect Node allocation because Node uses
  `MAX(sequence_number)`; it remains relevant only to Python’s divergent
  `message_count` base and to pre-existing count drift.

### 2.7 Discrepancies between merged code and the C2 preparation review

1. **Python writer status:** “dormant” is too broad. The flag disables Python
   persistence for Node chat/stream calls, but scheduler-triggered and internal
   Python paths remain capable of writing without the C2 lock.
2. **Repair readiness:** the preparation review describes `repair.sql` as safe
   to rerun “any time before the UNIQUE migration,” but the file has no lock or
   transaction wrapper. It needs the §3 wrapper and writer freeze.
3. **Legacy pagination wording:** “exact legacy semantics, plus deterministic
   tie-break ordering” is contradictory for tied pages. Untied behavior is
   preserved; tied-row order is intentionally made deterministic.
4. **Migration-history baseline:** the package README says production is current
   through `20261123000000`. Production now also has
   `20261126000000_apple_sign_in_usd_billing`, applied after the C2 merge.
5. **Promotion directory:** the pending C2 directory shares the
   `20261126000000` timestamp prefix with the applied Apple/billing migration.
   Reusing that timestamp at promotion would be confusing even though the full
   directory names differ.
6. **CI citation:** the preparation review cites `e108a45`/RC run
   `45881350697`, while the merged head is `29e5e1b`; the final all-green PR
   checks below supersede that citation.

### 2.8 Test evidence

Verified GitHub PR checks for merged PR #516:

- `Backend test suite`: pass, 27s
- `Dashboard suite and production build`: pass, 2m1s
- `Prisma bootstrap, financial and security regressions`: pass, 2m11s
- `Vercel`: pass
- `Vercel Preview Comments`: pass
- `backend`: pass, 38s
- `task025`: pass, 52s
- `task026`: pass, 33s
- `task027`: pass, 37s
- `task028`: pass, 36s
- `task029`: pass, 30s
- `task030`: pass, 38s

Local focused suites on the merged tree, after dependency install with scripts
ignored because Prisma engine download remains blocked in the sandbox:

```text
101 tests, 101 pass, 0 fail
```

Suites:

- `revSubmission.test.js`
- `revSequence.test.js`
- `revConversationPaging.test.js`
- `revTupleCursor.test.js`
- `revPersistence.contract.test.js`
- `revRetryReliability.contract.test.js`

Disposable PostgreSQL-compatible validation, all passed:

```text
repair first run affected=2
non-sequence columns preserved=7/7
repair verification tied_groups_remaining=0
repair second run affected=0 (idempotent)
migration creates uq_conversation_message_sequence
migration rerun is a no-op
rollback drops the backstop
migration on tied data fails safely: code=23505
failed unique-index transaction leaves no partial backstop (rolled back)
locked per-conversation repair mechanics: lock + update + verify + commit OK
proposed DO-block per-conversation repair: syntax + lock + update + verify + commit OK
aborted per-conversation repair leaves rows unchanged after ROLLBACK OK
tuple pagination: pages [6..10] then [1..5], exact-once, no skip/dup OK
```

Caveat: disposable validation used PGlite, not production PostgreSQL 17 or
Prisma `migrate deploy`. It validates SQL semantics and procedure mechanics,
not Prisma migration-runner behavior.

## 3. Current production database measurements

All production queries below were read-only `SELECT` statements. No repair,
migration, insert, update, delete, DDL, test message, annotation, or sandbox
operation was performed.

### 3.1 Overall state

Executed SQL:

```sql
WITH tied AS (SELECT conversation_id, sequence_number, COUNT(*) AS group_size FROM public.conversation_messages GROUP BY conversation_id, sequence_number HAVING COUNT(*) > 1) SELECT now() AS measured_at, (SELECT COUNT(*) FROM public.conversation_messages) AS total_messages, (SELECT COUNT(*) FROM public.conversations) AS conversation_rows, (SELECT COUNT(DISTINCT conversation_id) FROM public.conversation_messages) AS conversations_with_messages, (SELECT COUNT(*) FROM tied) AS duplicate_groups, (SELECT COALESCE(SUM(group_size), 0) FROM tied) AS tied_rows, (SELECT COALESCE(SUM(group_size), 0) - COUNT(*) FROM tied) AS excess_rows, (SELECT COUNT(DISTINCT conversation_id) FROM tied) AS affected_conversations, (SELECT COALESCE(MAX(group_size), 0) FROM tied) AS max_group_size, (SELECT COUNT(*) FROM public.conversation_messages WHERE sequence_number IS NULL) AS null_sequences, (SELECT COUNT(*) FROM public.conversation_messages WHERE sequence_number <= 0) AS non_positive_sequences, (SELECT MIN(sequence_number) FROM public.conversation_messages) AS min_sequence, (SELECT MAX(sequence_number) FROM public.conversation_messages) AS max_sequence;
```

Result:

| Measurement | Value |
|---|---:|
| `measured_at` | `2026-11-26 19:34:28.64512+00` |
| `total_messages` | 772 |
| `conversation_rows` | 241 |
| `conversations_with_messages` | 144 |
| `duplicate_groups` | 109 |
| `tied_rows` | 218 |
| `excess_rows` | 109 |
| `affected_conversations` | 57 |
| `max_group_size` | 2 |
| `null_sequences` | 0 |
| `non_positive_sequences` | 0 |
| `min_sequence` | 1 |
| `max_sequence` | 32 |

Verified conclusion: the duplicate population is unchanged from the pre-merge
census. Every tied group remains exactly a pair.

### 3.2 Collision-type distribution

Executed SQL:

```sql
WITH tied_keys AS (SELECT conversation_id, sequence_number FROM public.conversation_messages GROUP BY conversation_id, sequence_number HAVING COUNT(*) > 1), grouped AS (SELECT m.conversation_id, m.sequence_number, array_agg(m.role ORDER BY m.created_at, m.id) AS roles, COUNT(*) AS group_size, MIN(m.created_at) AS first_created_at, MAX(m.created_at) AS last_created_at FROM public.conversation_messages m JOIN tied_keys t USING (conversation_id, sequence_number) GROUP BY m.conversation_id, m.sequence_number) SELECT CASE WHEN roles = ARRAY['user', 'user'] THEN 'user/user' WHEN roles = ARRAY['rev', 'rev'] THEN 'rev/rev' WHEN roles = ARRAY['user', 'rev'] OR roles = ARRAY['rev', 'user'] THEN 'cross-role' ELSE 'other:' || array_to_string(roles, '+') END AS collision_type, COUNT(*) AS duplicate_groups, SUM(group_size) AS tied_rows, MIN(first_created_at) AS earliest_tied_row, MAX(last_created_at) AS latest_tied_row FROM grouped GROUP BY 1 ORDER BY 1;
```

Result:

| `collision_type` | `duplicate_groups` | `tied_rows` | `earliest_tied_row` | `latest_tied_row` |
|---|---:|---:|---|---|
| `cross-role` | 21 | 42 | `2026-08-20 23:59:18.131922+00` | `2026-11-02 12:14:24.13285+00` |
| `rev/rev` | 44 | 88 | `2026-09-15 16:18:37.315872+00` | `2026-10-28 20:56:17.745357+00` |
| `user/user` | 44 | 88 | `2026-09-15 16:18:36.644341+00` | `2026-10-28 20:56:16.888352+00` |

No `other:` collision type was returned.

### 3.3 New-collision check

Executed SQL:

```sql
WITH tied_keys AS (SELECT conversation_id, sequence_number FROM public.conversation_messages GROUP BY conversation_id, sequence_number HAVING COUNT(*) > 1) SELECT COUNT(*) AS tied_rows, COUNT(*) FILTER (WHERE m.created_at >= TIMESTAMPTZ '2026-11-26T00:00:00Z') AS tied_rows_on_or_after_audit_date, COUNT(*) FILTER (WHERE m.created_at >= TIMESTAMPTZ '2026-11-26T19:20:58Z') AS tied_rows_on_or_after_merge, MAX(m.created_at) AS latest_tied_row, COUNT(DISTINCT m.conversation_id) AS affected_conversations FROM public.conversation_messages m JOIN tied_keys t USING (conversation_id, sequence_number);
```

Result:

| Measurement | Value |
|---|---:|
| `tied_rows` | 218 |
| `tied_rows_on_or_after_audit_date` | 0 |
| `tied_rows_on_or_after_merge` | 0 |
| `latest_tied_row` | `2026-11-02 12:14:24.13285+00` |
| `affected_conversations` | 57 |

Verified conclusion: no tied row was created on/after the audit date or
on/after the merge. There is no evidence of a new production collision.

### 3.4 Organization distribution

Executed SQL:

```sql
WITH tied_keys AS (SELECT conversation_id, sequence_number FROM public.conversation_messages GROUP BY conversation_id, sequence_number HAVING COUNT(*) > 1), grouped AS (SELECT m.organization_id, m.conversation_id, m.sequence_number FROM public.conversation_messages m JOIN tied_keys t USING (conversation_id, sequence_number) GROUP BY m.organization_id, m.conversation_id, m.sequence_number) SELECT LEFT(organization_id::TEXT, 8) AS organization_prefix, COUNT(*) AS duplicate_groups, COUNT(DISTINCT conversation_id) AS affected_conversations FROM grouped GROUP BY organization_id ORDER BY duplicate_groups DESC, affected_conversations DESC;
```

Result:

| `organization_prefix` | `duplicate_groups` | `affected_conversations` |
|---|---:|---:|
| `1dc6aa19` | 78 | 38 |
| `91d88743` | 14 | 7 |
| `5dc3aea0` | 7 | 7 |
| `b186cce3` | 6 | 3 |
| `09ff67bf` | 2 | 1 |
| `4c2b716e` | 2 | 1 |

Only eight-character organization prefixes were retrieved; full organization
IDs were not needed for this reconciliation.

### 3.5 `created_at` determinism check

Executed SQL:

```sql
WITH tied_keys AS (SELECT conversation_id, sequence_number FROM public.conversation_messages GROUP BY conversation_id, sequence_number HAVING COUNT(*) > 1), grouped AS (SELECT m.conversation_id, m.sequence_number, COUNT(*) AS group_size, COUNT(DISTINCT m.created_at) AS distinct_created_at FROM public.conversation_messages m JOIN tied_keys t USING (conversation_id, sequence_number) GROUP BY m.conversation_id, m.sequence_number) SELECT COUNT(*) AS duplicate_groups, COUNT(*) FILTER (WHERE distinct_created_at < group_size) AS groups_sharing_created_at, MAX(group_size) AS max_group_size FROM grouped;
```

Result:

| Measurement | Value |
|---|---:|
| `duplicate_groups` | 109 |
| `groups_sharing_created_at` | 0 |
| `max_group_size` | 2 |

Verified conclusion: `(created_at, id)` remains a total keeper order for every
current tied group.

### 3.6 Index state

Executed SQL:

```sql
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'conversation_messages' ORDER BY indexname;
```

Result:

| `indexname` | `indexdef` |
|---|---|
| `conversation_messages_business_state_id_idx` | `CREATE INDEX conversation_messages_business_state_id_idx ON public.conversation_messages USING btree (business_state_id)` |
| `conversation_messages_pkey` | `CREATE UNIQUE INDEX conversation_messages_pkey ON public.conversation_messages USING btree (id)` |
| `conversation_messages_user_id_idx` | `CREATE INDEX conversation_messages_user_id_idx ON public.conversation_messages USING btree (user_id)` |
| `idx_conv_msg_conversation` | `CREATE INDEX idx_conv_msg_conversation ON public.conversation_messages USING btree (conversation_id, sequence_number)` |
| `idx_conv_msg_correlation` | `CREATE INDEX idx_conv_msg_correlation ON public.conversation_messages USING btree (correlation_id)` |
| `idx_conv_msg_org_created` | `CREATE INDEX idx_conv_msg_org_created ON public.conversation_messages USING btree (organization_id, created_at DESC)` |
| `uq_conversation_message_submission` | `CREATE UNIQUE INDEX uq_conversation_message_submission ON public.conversation_messages USING btree (organization_id, conversation_id, role, correlation_id)` |

Verified conclusion: `idx_conv_msg_conversation` is non-unique, and
`uq_conversation_message_sequence` is absent.

### 3.7 Constraint state

Executed SQL:

```sql
SELECT conname AS constraint_name, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'public.conversation_messages'::regclass ORDER BY conname;
```

Result:

| `constraint_name` | `definition` |
|---|---|
| `conversation_messages_confidence_score_check` | `CHECK (((confidence_score >= (0)::double precision) AND (confidence_score <= (1)::double precision)))` |
| `conversation_messages_conversation_id_fkey` | `FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE` |
| `conversation_messages_organization_id_fkey` | `FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE` |
| `conversation_messages_pkey` | `PRIMARY KEY (id)` |
| `conversation_messages_role_check` | `CHECK ((role = ANY (ARRAY['user'::text, 'rev'::text, 'system'::text, 'tool'::text])))` |
| `conversation_messages_user_id_fkey` | `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE` |
| `fk_conv_msg_bstate` | `FOREIGN KEY (business_state_id) REFERENCES business_states(id) ON DELETE SET NULL` |

Verified conclusion: there is no unique constraint on
`(conversation_id, sequence_number)`. The role check permits more roles than
appear in the current tied population, but all current tied rows are `user`
and/or `rev`.

### 3.8 Migration-history state

Executed SQL:

```sql
SELECT migration_name, finished_at, applied_steps_count FROM public._prisma_migrations ORDER BY migration_name DESC LIMIT 10;
```

Result:

| `migration_name` | `finished_at` | `applied_steps_count` |
|---|---|---:|
| `20261126000000_apple_sign_in_usd_billing` | `2026-11-26 19:27:48.366019+00` | 1 |
| `20261123000000_self_managing_operations` | `2026-11-23 01:24:34.901107+00` | 1 |
| `20261118170000_expand_store_sync_status` | `2026-11-18 16:32:28.770263+00` | 1 |
| `20261110000000_task229_sync_state_contract` | `2026-11-09 14:59:42.810042+00` | 1 |
| `20261108170000_task223_submission_idempotency` | `2026-11-09 14:59:42.810042+00` | 1 |
| `20261108000000_task215_sync_progress_retry` | `2026-11-08 08:51:47.371716+00` | 1 |
| `20261107230000_task214_integration_recovery` | `2026-11-07 23:27:28.482931+00` | 1 |
| `20261107040000_task200_checkout_evidence` | `2026-11-07 10:15:55.228567+00` | 1 |
| `20261107023000_task199_order_evidence` | `2026-11-07 10:15:54.379539+00` | 1 |
| `20261106233000_streaming_authorized_snapshots` | `2026-11-06 23:16:56.895034+00` | 1 |

Executed SQL:

```sql
SELECT migration_name, checksum, started_at, finished_at, applied_steps_count FROM public._prisma_migrations WHERE migration_name IN ('20261126000000_apple_sign_in_usd_billing', '20261123000000_self_managing_operations') ORDER BY migration_name;
```

Result:

| `migration_name` | `checksum` | `started_at` | `finished_at` | `applied_steps_count` |
|---|---|---|---:|---:|
| `20261123000000_self_managing_operations` | `76d0de698bbb081e738aeebf72f2860cf5ecd8b1964e8b3218fb4247a6e3287d` | `2026-11-23 01:24:34.329942+00` | `2026-11-23 01:24:34.901107+00` | 1 |
| `20261126000000_apple_sign_in_usd_billing` | `86997889fbe963a5b0eac0b19f379bc5f571f5cd449eae047ca3bb8a89a134c3` | `2026-11-26 19:27:47.8627+00` | `2026-11-26 19:27:48.366019+00` | 1 |

Executed SQL:

```sql
SELECT COUNT(*) AS c2_migration_rows FROM public._prisma_migrations WHERE migration_name LIKE '%c2_conversation_message_sequence%';
```

Result:

| Measurement | Value |
|---|---:|
| `c2_migration_rows` | 0 |

Verified conclusion: production has applied the Apple/billing migration after
the C2 merge, but has not applied or recorded any C2 sequence migration.

The post-merge Apple migration timestamp proves that a process with production
migration access ran after the merge. It does not by itself prove that live
backend traffic is served by the C2 backend revision.

### 3.9 Would the proposed unique constraint succeed now?

No.

Verified basis:

- 109 duplicate `(conversation_id, sequence_number)` groups remain.
- Disposable validation of the exact migration statement against tied data
  fails with PostgreSQL error code `23505` and a duplicated-key detail naming
  `(conversation_id, sequence_number)`.
- The failed unique-index statement was verified to leave no partial backstop
  after transaction rollback.

## 4. Historical repair procedure

This section is a **proposed, approval-gated procedure**. It was not executed
against production.

### 4.1 Why the prepared `repair.sql` alone is insufficient

Verified code facts:

- `repair.sql` contains a tie-only `UPDATE` plus a separate verification
  `SELECT`.
- It does not acquire `pg_advisory_xact_lock`.
- It has no `BEGIN`/`COMMIT` wrapper.
- Its verification query is a separate statement, so an operator could observe
  a different database state than the statement just updated.
- Its update logic is otherwise correct for the measured population:
  - keeper: earliest `(created_at, id)` in each tied group;
  - excess ordering: `(sequence_number, created_at, id)`;
  - destination: above the conversation maximum;
  - second-run updates zero rows.

Therefore the repair update logic is retained, but each affected conversation
must be repaired in its own locked transaction with in-transaction verification.

### 4.2 Concurrency control

Proposed controls:

1. Deploy the merged Node application first, under separate approval, so all
   cooperating writers use the C2 lock.
2. Before repair, freeze every writer that does not take the C2 lock:
   - Python scheduler-triggered morning-briefing orchestration;
   - Python scheduler-alert orchestration;
   - direct authenticated internal `/orchestrate` traffic capable of targeting
     an existing conversation;
   - manual SQL writes.
3. Repair one affected conversation per transaction.
4. In each transaction, acquire the same advisory lock before reading or
   updating that conversation.
5. Process affected conversations in ascending UUID order from a freshly
   generated list.
6. Verify message count and zero remaining ties inside the same transaction.
7. Commit only on successful verification; otherwise roll back that
   conversation and stop for triage.

The advisory lock serializes cooperating Node writers. It cannot serialize
Python/manual writers because those paths never acquire it. The writer freeze
is therefore load-bearing, not optional.

### 4.3 Before-state snapshot

Proposed approval-gated backup commands:

```bash
pg_dump "$PROD_DATABASE_URL" \
  --table=public.conversation_messages \
  --file=/secure/approved-path/c2-conversation-messages-before.dump
```

```bash
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -c "COPY (SELECT id, conversation_id, organization_id, user_id, role, sequence_number, correlation_id, created_at FROM public.conversation_messages WHERE (conversation_id, sequence_number) IN (SELECT conversation_id, sequence_number FROM public.conversation_messages GROUP BY conversation_id, sequence_number HAVING COUNT(*) > 1) ORDER BY conversation_id, sequence_number, created_at, id) TO STDOUT WITH (FORMAT csv, HEADER true)" > /secure/approved-path/c2-tied-rows-before.csv
```

Proposed before-state census, read-only:

```sql
WITH tied AS (SELECT conversation_id, sequence_number, COUNT(*) AS group_size FROM public.conversation_messages GROUP BY conversation_id, sequence_number HAVING COUNT(*) > 1) SELECT (SELECT COUNT(*) FROM public.conversation_messages) AS total_messages, (SELECT COUNT(*) FROM tied) AS duplicate_groups, (SELECT COALESCE(SUM(group_size), 0) FROM tied) AS tied_rows, (SELECT COALESCE(SUM(group_size), 0) - COUNT(*) FROM tied) AS excess_rows, (SELECT COUNT(DISTINCT conversation_id) FROM tied) AS affected_conversations;
```

Expected values at the current census:

```text
total_messages=772
duplicate_groups=109
tied_rows=218
excess_rows=109
affected_conversations=57
```

The operator must regenerate these values immediately before repair and abort
if they differ from the approved snapshot without a documented cause.

### 4.4 Affected-conversation list

Proposed read-only generator:

```sql
SELECT conversation_id
FROM public.conversation_messages
GROUP BY conversation_id, sequence_number
HAVING COUNT(*) > 1
ORDER BY conversation_id;
```

This query returns one row per tied group. The repair script must collapse it
to distinct conversation IDs in ascending order. At the current census, that is
57 distinct conversations.

### 4.5 Exact per-conversation repair transaction

Proposed template. Replace every `<CONVERSATION_UUID>` with one affected
conversation ID from §4.4. Run one transaction per conversation, in ascending
UUID order. Do not combine multiple conversations into one transaction.

```sql
BEGIN;
SELECT pg_advisory_xact_lock(
  hashtext('rev_conversation_sequence'),
  hashtext('<CONVERSATION_UUID>'::text)
)::text AS lock_acquired;
DO $$
DECLARE
  target_conversation uuid := '<CONVERSATION_UUID>'::uuid;
  before_messages integer;
  after_messages integer;
  moved_rows integer;
  remaining_tied_groups integer;
BEGIN
  SELECT COUNT(*) INTO before_messages
  FROM public.conversation_messages
  WHERE conversation_id = target_conversation;

  WITH excess AS (
    SELECT
      id,
      conversation_id,
      sequence_number,
      created_at,
      ROW_NUMBER() OVER (
        PARTITION BY conversation_id, sequence_number
        ORDER BY created_at, id
      ) AS keeper_rank
    FROM public.conversation_messages
    WHERE conversation_id = target_conversation
  ),
  conversation_max AS (
    SELECT conversation_id, MAX(sequence_number) AS max_seq
    FROM public.conversation_messages
    WHERE conversation_id = target_conversation
    GROUP BY conversation_id
  ),
  renumbered AS (
    SELECT
      e.id,
      m.max_seq + ROW_NUMBER() OVER (
        PARTITION BY e.conversation_id
        ORDER BY e.sequence_number, e.created_at, e.id
      ) AS new_seq
    FROM excess e
    JOIN conversation_max m ON m.conversation_id = e.conversation_id
    WHERE e.keeper_rank > 1
  )
  UPDATE public.conversation_messages cm
  SET sequence_number = r.new_seq
  FROM renumbered r
  WHERE r.id = cm.id;
  GET DIAGNOSTICS moved_rows = ROW_COUNT;

  SELECT COUNT(*) INTO after_messages
  FROM public.conversation_messages
  WHERE conversation_id = target_conversation;

  SELECT COUNT(*) INTO remaining_tied_groups
  FROM (
    SELECT sequence_number
    FROM public.conversation_messages
    WHERE conversation_id = target_conversation
    GROUP BY sequence_number
    HAVING COUNT(*) > 1
  ) ties;

  IF after_messages <> before_messages THEN
    RAISE EXCEPTION 'C2 repair changed message count for %: before=%, after=%',
      target_conversation, before_messages, after_messages;
  END IF;
  IF remaining_tied_groups <> 0 THEN
    RAISE EXCEPTION 'C2 repair left % tied groups in %',
      remaining_tied_groups, target_conversation;
  END IF;
  RAISE NOTICE 'C2 repair %: before_messages=%, moved_rows=%, after_messages=%, remaining_tied_groups=%',
    target_conversation, before_messages, moved_rows, after_messages, remaining_tied_groups;
END
$$;
COMMIT;
```

On any error:

```sql
ROLLBACK;
```

Then stop and triage before continuing to another conversation.

Validated mechanics on a disposable database:

- lock acquisition plus scoped update plus verification plus commit succeeds;
- the aborted-transaction test leaves the conversation unchanged after
  `ROLLBACK`;
- the underlying update preserves every non-sequence column tested and updates
  only excess tied rows.

### 4.6 Preservation guarantees

The proposed update changes only `sequence_number`.

It preserves:

- message `id`;
- `conversation_id`;
- `organization_id`;
- `user_id`;
- `role`;
- `content`;
- `correlation_id`;
- `metadata`;
- `created_at`;
- all other columns.

It performs no insert and no delete. Untied rows are excluded by
`keeper_rank > 1`.

Reconciliation must nevertheless verify preservation rather than assume it:

1. Total message count before and after must match.
2. Every pre-repair message ID must remain present after repair.
3. No new message ID may appear.
4. Every non-sequence field in the approved before-image must match after
   repair.
5. Remaining tied groups must be zero.
6. The sum of per-conversation `moved_rows` must equal the pre-repair excess
   count, currently 109.

`conversations.message_count` is intentionally not used as a reconciliation
control: C2 does not repair its known drift, and retry-delete flows can leave
stored counts inconsistent with actual message rows.

### 4.7 After-state reconciliation queries

Proposed read-only checks:

```sql
WITH tied AS (SELECT conversation_id, sequence_number, COUNT(*) AS group_size FROM public.conversation_messages GROUP BY conversation_id, sequence_number HAVING COUNT(*) > 1) SELECT (SELECT COUNT(*) FROM public.conversation_messages) AS total_messages, (SELECT COUNT(*) FROM tied) AS duplicate_groups, (SELECT COALESCE(SUM(group_size), 0) - COUNT(*) FROM tied) AS excess_rows, (SELECT COUNT(*) FROM public.conversation_messages WHERE sequence_number IS NULL) AS null_sequences, (SELECT COUNT(*) FROM public.conversation_messages WHERE sequence_number <= 0) AS non_positive_sequences;
```

Expected after successful repair at the current census:

```text
total_messages=772
duplicate_groups=0
excess_rows=0
null_sequences=0
non_positive_sequences=0
```

Proposed ID-preservation check against the approved before-image:

```sql
SELECT COUNT(*) AS missing_before_ids
FROM c2_repair_before_image before_image
WHERE NOT EXISTS (
  SELECT 1
  FROM public.conversation_messages live
  WHERE live.id = before_image.id
);
```

The before-image may be a restored logical-backup table in a disposable
comparison database, not necessarily a new production table. If a production
comparison table is proposed instead, its creation, access controls, retention,
and drop must be separately approved.

### 4.8 Cross-role ordering trade-off

The tie-only repair preserves minimal blast radius but does not restore strict
chronology for all moved rows:

- Current cross-role tied groups: 21.
- In each such group, the earliest `(created_at, id)` row keeps its sequence;
  the later row moves above the conversation maximum.
- Affected rev answers may therefore appear after later messages in sequence
  order.

The alternative, full `1..N` renumbering by `(created_at, id)`, would restore
chronology but change many untied rows across 57 conversations. The proposed
minimal repair remains preferable for data preservation, but the cross-role
display consequence needs explicit reviewer acceptance.

## 5. Unique constraint migration

This section is a **proposed, approval-gated migration**. It was not executed.

### 5.1 Exact proposed migration SQL

From the reviewed pending package, byte-identical SQL is proposed:

```sql
-- C2: exactly one message per (conversation_id, sequence_number).
--
-- PRECONDITION (reviewed and approved separately): run repair.sql from this
-- directory until its verification query reports zero tied groups. Applying
-- this index while ties remain fails.
--
-- This statement is idempotent (IF NOT EXISTS): safe to re-run, and a no-op
-- where the release-candidate bootstrap already created the matching unique
-- constraint from the Prisma schema.
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_message_sequence
  ON conversation_messages (conversation_id, sequence_number);
```

Verified properties:

- It constrains exactly `(conversation_id, sequence_number)`.
- It does not delete rows.
- It does not rewrite message content.
- It is idempotent on rerun.
- On tied data it fails with `23505`.
- A failed creation inside an explicit transaction leaves no partial index
  after rollback.

### 5.2 Preconditions

The migration must not be promoted or applied unless all are true:

1. Writer freeze is active and verified.
2. Repair has completed for every affected conversation.
3. The after-state queries report zero tied groups.
4. Total message count equals the approved before-image.
5. ID preservation and non-sequence-field preservation checks pass.
6. The migration directory name is fresh and does not reuse the
   `20261126000000_apple_sign_in_usd_billing` timestamp prefix.
7. The migration SQL remains byte-identical to the reviewed statement.
8. Explicit migration approval has been recorded.

### 5.3 Transactionality and midway failure

The proposed statement is an ordinary non-concurrent `CREATE UNIQUE INDEX`,
without `CONCURRENTLY`.

Expected behavior:

- PostgreSQL can run ordinary DDL transactionally.
- A duplicate-key failure aborts the migration statement/transaction.
- Prisma records only successful migrations in `_prisma_migrations`.
- The verified disposable-database behavior is: `23505`, no partial backstop
  after rollback.

Unverified assumption: the exact Prisma `migrate deploy` transaction boundary
and log wording in the production Render/Prisma/database configuration were not
observed during this read-only task. The operator must retain the production
migration log and verify both `pg_indexes` and `_prisma_migrations`.

Because the statement is not concurrent, it takes the locks needed for index
creation. On the current 772-row table, expected contention is small, but the
repair-window writer freeze should remain in force through migration
verification.

### 5.4 Exact rollback SQL

From the reviewed pending package:

```sql
-- C2 rollback: drop the sequence backstop.
--
-- The shipped code keeps working without this index: the per-conversation
-- advisory lock still serializes all cooperating writers. Only the
-- non-cooperating-writer backstop (dormant legacy Python path, manual SQL)
-- is lost until the index is re-created with migration.sql.
--
-- The repair is forward-only and is NOT rolled back: renumbered rows keep
-- their repaired numbers, which remain valid with or without this index.
--
-- Both shapes are dropped: production carries a plain unique index (from
-- migration.sql), while schema-bootstrapped databases carry a unique
-- constraint of the same name. Each statement is a no-op where its shape is
-- absent.
ALTER TABLE conversation_messages DROP CONSTRAINT IF EXISTS uq_conversation_message_sequence;
DROP INDEX IF EXISTS uq_conversation_message_sequence;
```

Validated on a disposable database:

- rollback drops the created backstop;
- rerunning rollback statements is a no-op where the object is absent.

Limitations:

- Rollback removes only the uniqueness backstop. It does not reverse repair.
- This is intentional: repaired numbers remain valid with or without the index.
- A rollback comment still calls the Python path “dormant”; §2.3 supersedes
  that wording for rollout purposes.
- Rollback has not been executed against production and must itself be
  approval-gated.
- Prisma migration-history handling for a rolled-back migration must be
  explicitly decided: dropping the index outside Prisma does not automatically
  reconcile `_prisma_migrations`.

## 6. Rollback and recovery plan

### 6.1 Application rollback

Proposed behavior, based on code inspection:

- Rolling the backend back to the prior Stage 1 revision is independent of
  dropping the database index.
- Code continues to run with or without
  `uq_conversation_message_sequence`.
- A prior-revision backend loses:
  - the Stage 1 accept-SQL fix;
  - C2 advisory-lock allocation;
  - tuple pagination.
- The unique index, if already applied, continues to reject duplicate
  sequences even under old application code.

Therefore application rollback and database rollback are technically separable,
but operationally they must be coordinated. Rolling back code while leaving
historical repair in place is safe for repaired rows; rolling back code before
repair re-exposes the old race.

### 6.2 Deploy succeeds, migration not applied

This is the intended intermediate state after the conditional application
deployment:

- Node writers allocate safely under the C2 lock.
- Historical ties remain readable and pageable.
- Python/manual writers can still bypass allocation because no unique backstop
  exists.
- New collisions remain possible only through a non-cooperating writer or a
  defect outside the verified Node paths.
- Required monitoring: tied-group census, backend `23505`/persistence-failure
  logs, Python persistence-error logs, and scheduler/internal orchestration
  activity.

### 6.3 Migration succeeds, deployment fails

Proposed recovery:

1. Keep the writer freeze until the system state is known.
2. Verify whether the migration row and index exist:
   - expected index: `uq_conversation_message_sequence`;
   - expected migration-history row for the approved migration name.
3. If the backend failed before serving traffic, fix forward with the same
   approved backend revision or roll the backend back under approval.
4. Do not drop the unique index merely because deployment failed, unless the
   index itself is implicated.
5. If old backend code must temporarily serve traffic, retain heightened
   collision monitoring because old code can race, even though the index will
   reject duplicates rather than persist them.

### 6.4 Interrupted repair

Because the proposal uses one transaction per conversation:

- Interruption inside a conversation transaction: issue `ROLLBACK`; that
  conversation remains unchanged.
- Interruption between conversations: already-committed conversations remain
  repaired; unprocessed conversations remain tied.
- Recovery is deterministic:
  1. Re-run the affected-conversation generator.
  2. Repair only conversations that still contain tied groups.
  3. Never rerun repair blindly against already-clean conversations as a
     substitute for verification, although the update itself is idempotent.
- If the operator is uncertain which conversation was active, regenerate the
  before-state census and compare it with the approved snapshot plus committed
  repair notices.

The abort path was validated on a disposable database: a failed repair block
followed by `ROLLBACK` left the test conversation unchanged.

### 6.5 Backup and snapshot requirements

Minimum approval-gated requirements:

1. Verified platform backup or point-in-time recovery capability for
   `Revluma-Database`.
2. Logical `conversation_messages` backup taken immediately before repair.
3. CSV/image export of all tied rows before repair.
4. Recorded before-state census values.
5. Recorded per-conversation repair notices.
6. Recorded after-state census and preservation checks.
7. Secure retention and deletion policy for production-data exports.

Unresolved: Supabase backup retention and PITR availability for this project
were not established from the available connector metadata. This must be
resolved before repair approval.

### 6.6 Lock contention and downtime

Expected impact on the measured population:

- 57 affected conversations.
- 109 rows moved.
- 772 total rows scanned by census queries.
- Small ordinary unique-index build.

No production repair/migration timing was measured because execution was
prohibited. The dominant operational cost is likely the writer freeze and
verification work, not the size of the SQL operations.

A full backend outage is not structurally required by the SQL: per-conversation
locks are narrow, and the unique index is small. However, a full outage or
targeted writer freeze may still be the simplest safe control because:

- Python writers bypass the advisory lock;
- no repository-defined freeze switch exists;
- Render/Python operational controls were not verified.

The rollout plan must therefore choose one explicitly:

- brief maintenance/writer-freeze window; or
- verified suspension of all non-cooperating writers while Node traffic
  continues under C2 locks.

“Hope no autonomous write occurs” is not an acceptable control.

### 6.7 Preventing new duplicates during rollout

Required controls:

1. Deploy locked Node allocation before repair.
2. Freeze Python/manual writes during repair and migration verification.
3. Avoid the 05:00 UTC morning-briefing window unless the scheduler/Python path
   is verifiably suspended.
4. Monitor for new tied groups immediately after every rollout phase.
5. Keep the writer freeze until the unique migration is verified.
6. After migration verification, restore writers in a controlled order and
   continue monitoring for `23505`.

## 7. Deployment dependency analysis

### 7.1 Backend startup and migration hook

Verified in `Backend/package.json:6-13`:

```json
{
  "postinstall": "npm run prisma -- generate",
  "prestart": "npm run migrate:deploy",
  "start": "node server.js",
  "migrate:deploy": "node scripts/run-prisma.js migrate deploy"
}
```

Verified in `Backend/scripts/run-prisma.js:1-30`:

- loads `.env.production` without overriding existing environment values;
- defaults `DIRECT_URL` to `DATABASE_URL`;
- spawns `npx prisma` with the supplied arguments.

Verified in `Backend/docs/BACKEND_SETUP.md:110-119`:

- committed migrations are applied with `npm run migrate:deploy`;
- `npm start` runs that command through `prestart`;
- Prisma records successful migrations in `_prisma_migrations`;
- a migration failure stops the backend before it accepts traffic.

### 7.2 What Prisma will and will not discover

Verified:

- Prisma migration discovery uses `Backend/prisma/migrations/*/migration.sql`.
- The C2 package is at:
  - `Backend/prisma/migrations-pending/20261126000000_c2_conversation_message_sequence/`
- Only the disposable-RC integration test references `migrations-pending/`.
- No backend startup file, migration script, or workflow references it.

Therefore, deploying merged `main` as-is does **not** cause Prisma to apply
the C2 unique migration. Promotion requires a deliberate later change moving
approved SQL into `prisma/migrations/`.

### 7.3 Vercel behavior

Verified from repository and Vercel connector output:

- Root `vercel.json` installs/builds frontend assets only:
  - install: `cd Frontend/Dashboard && npm install --include=dev`
  - build: Dashboard build plus Landing embed build
  - output: `Frontend`
- Vercel project `revluma` is linked to GitHub `Revluma-Organization/Revluma`
  with production branch `main`.
- The C2 merge automatically produced production deployment
  `dpl_FF26v73vL368Wk4VVreycAznRKPz`:
  - commit `4706cc0c1b6a163e629839b3a4327c8692df3e02`;
  - `READY`/`PROMOTED`;
  - aliases include `revluma.vercel.app`.
- Vercel build/install commands are null at project level, so repository
  `vercel.json` controls the frontend build.

Verified conclusion: Vercel frontend auto-deployment cannot apply Prisma
migrations or execute repair SQL. It is irrelevant to database gating except as
proof that `main` merges have at least one automatic production consumer.

### 7.4 Render backend behavior

Partially verified; operationally incomplete.

Verified from repository/history evidence:

- Backend code and docs target Render-style deployment:
  - `RENDER_GIT_COMMIT_SHA` fallback in `Backend/src/app.js:40-50`;
  - Render proxy trust configuration;
  - historical `onrender.com` backend URLs and Render service references.
- No `render.yaml`, Dockerfile, or Render service definition exists in the
  repository.
- Backend production migration behavior depends on dashboard-configured build,
  start, environment, scaling, and deploy-trigger settings.
- A prior task baseline states that Render services are configured outside the
  repository and cannot be verified from the sandbox alone.
- Production `_prisma_migrations` shows a post-C2-merge migration completion,
  indicating post-merge migration access, but not proving live C2 backend
  traffic.

Unverified assumptions:

- which Render service is authoritative for production backend traffic;
- whether production backend deploys automatically from `main` or manually;
- exact production build/start commands;
- production `DATABASE_URL`/`DIRECT_URL` wiring;
- operator controls for restart, scaling, maintenance mode, scheduler behavior,
  and writer freeze.

These must be confirmed in Render before backend deployment approval.

### 7.5 CI behavior

Verified:

- Release-candidate verification runs only on relevant pull requests and manual
  dispatch.
- It uses disposable localhost PostgreSQL and explicitly does not touch
  Supabase/production.
- Backend tests run on pull requests, `main` pushes affecting backend paths,
  and manual dispatch.
- No reviewed workflow deploys production, runs production Prisma migrations,
  executes repair SQL, creates production messages, or mutates production data.

### 7.6 Safest rollout sequence

Proposed approval-gated sequence:

1. **Confirm backend deployment target and controls.**
   - Identify the authoritative Render backend service.
   - Confirm manual versus automatic deployment.
   - Confirm build/start behavior and migration credentials.
   - Confirm writer-freeze/maintenance controls.
2. **Deploy backend application code only.**
   - Deploy merged `main`.
   - Leave `migrations-pending/` untouched.
   - Verify `/ready`, backend build identity, migration history, absence of a
     C2 migration row, and no new tied groups.
3. **Observe the locked allocator.**
   - Confirm new accepts/streams allocate without `23505`.
   - Confirm idempotent replays still work.
   - Confirm tuple and legacy pagination behavior.
4. **Freeze non-cooperating writers.**
   - Suspend scheduler-triggered Python persistence paths and internal
     orchestration writes.
   - Prohibit manual production writes.
5. **Snapshot and repair.**
   - Take platform plus logical backups.
   - Run locked per-conversation repair.
   - Verify all §4 checks.
6. **Promote and apply the unique migration.**
   - Use a fresh migration directory name.
   - Keep migration SQL byte-identical.
   - Apply under approval.
   - Verify index plus migration-history row.
7. **Restore writers and verify production.**
   - Restore writers in controlled order.
   - Run §8 checks.
   - Continue monitoring for collisions and `23505`.

This sequence delivers the urgent Stage 1 SQL fix without coupling it to
irreversible historical repair or uniqueness enforcement.

## 8. Production verification checklist

All production verification involving writes, retries, restoration probes that
create history, or production identities requires explicit approval. This
checklist was prepared but not executed.

### 8.1 Deployment identity and database gating

| Check | Method | Expected |
|---|---|---|
| Backend liveness | `GET /health` | `200`, `status: ok` |
| Backend readiness/build | `GET /ready` | `200`, `database_ready: true`, Python healthy, `node_build` identifies C2 `main` |
| No premature C2 migration | Read-only `_prisma_migrations` query | Zero C2 sequence-migration rows before migration approval |
| No premature backstop | Read-only `pg_indexes` query | No `uq_conversation_message_sequence` before migration approval |
| No new collisions after app deploy | Read-only tied-group census | Still 109/218/109/57, latest tied row unchanged |

### 8.2 Concurrent submissions

| Check | Method | Expected |
|---|---|---|
| Concurrent user accepts | Approved parallel `POST /api/v1/rev/chat` calls with distinct `request_id` values against one approved conversation | All accepted; distinct gapless sequences; no `23505` |
| Duplicate transport retry | Repeat one approved `request_id` with the same message/conversation | `duplicate` replay; no second user row; no second investigation |
| Concurrent chat and stream turns | Approved parallel chat/stream submissions | Distinct sequences; terminal persisted outcomes; no skipped numbers from allocation races |
| Failed-turn retry | Approved `POST /api/v1/rev/conversation/:id/retry` for an eligible failed turn | Failed rev rows removed once; replacement allocated under lock; no duplicate user row |

### 8.3 Restoration and pagination

| Check | Method | Expected |
|---|---|---|
| Thread restoration | Approved `GET /api/v1/rev/conversation/:id` | Tenant-owned conversation; ascending deterministic thread |
| First page | No cursor or explicit limit | Newest page; deterministic order; null next cursors on short page |
| Multi-page tuple walk | Follow `next_before` + `next_before_id` | Exact-once retrieval; no skip; no duplicate |
| Legacy cursor walk | `?before=<int>` only | Same legacy page boundaries for untied data; deterministic tied-row order |
| Cursor validation | Malformed `before_id` with present `before` | `400`, before any message query |
| Cursor compatibility | `before_id` without `before` | Ignored; first page returned |
| Cross-role ordering | Repaired cross-role conversations | Deterministic thread order; reviewer-accepted placement of moved rows |

### 8.4 Contracts and isolation

| Check | Method | Expected |
|---|---|---|
| SSE behavior | Approved `POST /api/v1/rev/stream` | `meta`, progress/final or terminal error/cancelled; heartbeat; no partial payload presented as success |
| Read-only boundary | `execute: true` submission | Rejected before persistence |
| Tenant isolation | Cross-organization conversation read/retry | `403`, no cross-tenant disclosure |
| Finding context | Approved finding-associated turn | Server-resolved finding context preserved |
| Feedback path | Approved thumbs up/down | Organization/user/message-scoped rating behavior unchanged |

### 8.5 Post-repair and post-migration database checks

| Check | Method | Expected |
|---|---|---|
| Zero tied groups | Read-only duplicate-group census | `0` |
| Message preservation | Before/after count and ID checks | Same total; same IDs; no missing or extra rows |
| Field preservation | Before/after non-sequence comparison | Identity/content/role/correlation/metadata/timestamps unchanged |
| Sequence validity | NULL/non-positive scan | `0`; minimum remains `1` |
| Backstop presence | `pg_indexes` | `uq_conversation_message_sequence` present after migration |
| Migration record | `_prisma_migrations` | Exactly one approved C2 migration row |
| Operational logs | Backend/Python logs | No unexpected `23505`, persistence-stage failure, or Python persistence-error spike |

## 9. Risks and unresolved questions

### Risks

1. **Autonomous writer bypass:** Python persistence does not use the C2 lock.
   Without a freeze, repair and migration verification can be invalidated.
2. **Repair-file gap:** unmodified `repair.sql` does not lock or wrap work in a
   transaction. Running it as-is would not meet the stated safety requirements.
3. **Cross-role display change:** 21 moved cross-role rows may appear after
   later messages in sequence order.
4. **Pre-repair nondeterminism:** retry/latest-row and Python history queries
   lack `id` tie-breaks. This disappears after verified repair plus the unique
   backstop, but remains observable until then.
5. **Render control gap:** backend deploy, freeze, and recovery controls are not
   versioned or verified.
6. **Backup gap:** platform recovery capability is unverified.
7. **Promotion-name hazard:** reusing the `20261126000000` timestamp creates
   operational confusion with the applied Apple/billing migration.
8. **Migration-history coordination:** out-of-band rollback SQL does not
   automatically reconcile `_prisma_migrations`.
9. **Message-count drift:** stored `conversations.message_count` values remain
   unreliable and must not be used as repair reconciliation controls.

### Unresolved questions

1. Which Render service serves production backend traffic, and is its deploy
   trigger manual or automatic?
2. What are the exact production backend build/start commands and migration
   credentials?
3. How will operators suspend Python morning-briefing, alert, automation, and
   internal orchestration writes?
4. What is the Supabase backup retention/PITR capability for production?
5. Which existing production merchant conversation(s), if any, may be used for
   approved post-deploy verification?
6. What is the approved fresh Prisma migration directory name for C2?
7. Who owns rollback decisions if application deployment and database migration
   diverge?
8. Is a brief maintenance window preferred over attempting live repair under
   continued Node traffic?

## 10. Explicit go/no-go recommendation

- **Backend application deployment:** **CONDITIONAL GO**.
  - Ship merged code with the C2 database package still pending.
  - Obtain Render target/process confirmation first.
  - Verify build identity, migration history, absence of premature C2 database
    objects, and unchanged duplicate census after deployment.
- **Historical sequence repair:** **NO-GO at this time**.
  - Use the locked per-conversation procedure in §4.
  - Resolve writer freeze, backup/PITR proof, affected-conversation approval,
    and cross-role ordering acceptance first.
- **Unique-constraint migration:** **NO-GO at this time**.
  - Apply only after verified zero-tie repair.
  - Use a fresh migration directory and byte-identical SQL.
  - Verify both the index and migration-history row.

No production migration, historical sequence repair, deployment, H2 annotation,
or sandbox-org action was performed in preparing this review.

## 11. Follow-up item 1 — complete writer audit and serialization proof

This section supersedes the "dormant legacy Python path" framing in §2.3. The
Python persist path is reachable code, not dead code — but every currently
reachable invocation persists into a freshly created conversation, which is
what keeps it from colliding with Node today. The two runtimes do **not** share
a lock domain, so no DB-level mutual serialization exists between them. That
negative result is proved statically below.

### 11.1 Method (verified fact)

Every `conversation_messages` and `conversations` write in first-party code was
enumerated by exhaustive search at the merge commit, then each site was traced
up its call graph to an HTTP route, a scheduler job, or an internal endpoint:

- `INSERT INTO conversation_messages`: exactly 4 Node sites
  (`Backend/src/controller/revController.js:342`, `:461`, `:1586`;
  `Backend/src/services/revSubmission.js:156`) and exactly 1 Python site
  (`python/src/agents/orchestrator.py:1440`).
- `INSERT INTO conversations`: exactly 2 sites (`revSubmission.js:138`,
  `orchestrator.py:1512`).
- Prisma-model writers (`conversation_messages.create/upsert/update`): none —
  the grep is empty; all message writes are raw SQL.
- Python-wide `conversation_messages` references: exactly 3 lines —
  `orchestrator.py:1440` (the INSERT), `orchestrator.py:1560` (history SELECT),
  `investigation.py:1632` (history SELECT).

### 11.2 Node writers — all four serialize in one lock domain (verified fact)

| ID | Site | What it writes | Reached from |
|---|---|---|---|
| W-N1 | `revSubmission.js:156` (`acceptSubmission`) | user row, `MAX+1` | `revController.chat:266`, `chatStream:1792` (new request_id); NOT retry (retry reuses the user row) |
| W-N2 | `revController.js:342` | failed-rev row, `MAX+1` | `chat`, when `mlResult.success` is false |
| W-N3 | `revController.js:461` | rev row, `MAX+1` | `chat`, success path |
| W-N4 | `revController.js:1586` (`_insertRevMessage`) | rev row, `MAX+1` | `chat` catch-all `:566`; `chatStream` success `:1905`, cancelled `:1945`, error `:1971`, catch-all `:2014` |

All four share one shape — `withSequenceAllocationRetry(() =>
prisma.$transaction(... acquireConversationWriteLock(tx, conversationId) ...
INSERT ... SELECT ... COALESCE(MAX(sequence_number),0)+1 ...))` — with the lock
defined once in `Backend/src/services/revSequence.js`:

```sql
SELECT pg_advisory_xact_lock(hashtext('rev_conversation_sequence'), hashtext(conversationId))::text AS lock_acquired
```

Retry policy is bounded (3 attempts) on `P2002`/`23505` only, re-running the
whole allocating transaction. Route wiring (`revRoute.js:85,88,91`):
`POST /chat` → `chat`, `POST /stream` → `chatStream`,
`POST /conversation/:id/retry` → `retryConversation`, which deletes failed rev
rows after the last user message and re-enters `exports.chat` with
`reuse_user_message: true` (`revController.js:2152-2167`), so a retry allocates
exactly one new number (the replacement rev row) via W-N3/W-N4.

**Node↔Node serialization: proved.** Every allocation takes the same
transaction-scoped advisory lock keyed by conversation id before computing
`MAX+1`, so two Node transactions allocating for one conversation are fully
ordered. The RC concurrency integration (12 checks green at merge) exercises
this dynamically.

### 11.3 Python writer — one funnel, different lock, flag-gated (verified fact)

The only Python message writer is `_persist_messages`
(`orchestrator.py:1406-1553`), reached exclusively through the `persist_turns`
alias (`:684`):

```python
node_owns_persistence = bool((context_payload or {}).get("_node_owns_chat_persistence"))
persist_turns = (lambda *args, **kwargs: None) if node_owns_persistence else _persist_messages
```

Eight `persist_turns(...)` call sites (`:695`, `:715`, `:754`, `:776`, `:807`,
`:842`, `:913`, `:1150`) cover the scheduler-briefing, deterministic-answer,
and final-analysis returns. `_persist_messages` itself (`:1427-1500`): `SELECT
message_count ... FOR UPDATE` on the `conversations` row → `base_seq`; one
multi-row INSERT of the user turn (`base+1`) plus the rev turn (`base+2`); one
`UPDATE conversations SET message_count = base+2`; commit; any exception logs
and rolls back without failing the response (non-fatal by design).

Callers of the funnel:

| Caller | `conversation_id` | Flag | Effect |
|---|---|---|---|
| `POST /orchestrate` from Node chat with image (`revController.js:310`, `mlService.js:751`) | existing (`activeConvId`) | **set** (`_node_owns_chat_persistence: true`) | persist is a no-op; Node owns both rows |
| `POST /orchestrate` from scheduler alert queue (`schedulerService.js:680`) | none | absent | `_get_or_create_conversation` creates a **new** conversation (`orchestrator.py:1512`), then persists seq 1+2 — self-safe |
| In-process `orchestrate()` from morning briefing (`morning_briefing.py:240`) | `None` | absent (`{"schedule": ...}`) | same: new conversation, seq 1+2 — self-safe |
| Direct `POST /orchestrate` with a body `conversation_id` and no flag | existing | absent | **persists into the existing conversation** — no shipped caller does this; reachable only with the internal-caller secret |

The flag survives the HTTP hop: `_rev_trace_payload` (`api.py:1447-1454`) copies
the whole `context_payload` dict, so Node's `_node_owns_chat_persistence: true`
reaches `_run` intact.

**Python↔Python serialization: proved for one conversation.** Two concurrent
`_persist_messages` calls for the same conversation order on the `conversations`
row lock (`FOR UPDATE`), so both read the same committed `message_count` only
in sequence.

### 11.4 Proven non-writers (verified fact)

- `POST /rev/investigate` and `POST /rev/stream` never write messages: the
  exhaustive Python grep finds no `INSERT INTO conversation_messages` in
  `investigation.py`; its only `conversations` writes update
  `context_window`/`summary` (`:3432`, `:3576`) — never `message_count`, never
  sequences.
- The scheduler-alert → orchestrate → persist chain is currently
  **unreachable**: `runAlertQueue` requires `alert.payload.requires_ai === true`
  (`schedulerService.js:677`), and no producer in either runtime sets that key
  (the only `alert_queue` writer, `business_state.py:1543`, stores anomaly
  dicts without it, `:1376-1406`). One payload change away from live — not live.
- `POST /alerts/check` writes `notifications` rows, not `alert_queue` rows, so
  it cannot feed the alert-queue chain.
- `_persist_briefing` upserts `morning_briefings`, not messages
  (`morning_briefing.py:659-720`).

### 11.5 Node↔Python: NO mutual serialization (proved negative)

The two runtimes lock in disjoint domains:

- Node never takes a row lock on `conversations`: the only `FOR UPDATE` in
  `Backend/src` is `featureWorkerService.js:42`, on its own queue table.
  `_touchConversation` is a lock-free `UPDATE ... message_count +
  increment`, issued outside the allocating transaction.
- Python never takes the advisory lock on the conversation path: the only
  `pg_advisory` reference in `python/src` is an unrelated
  `pg_advisory_unlock` in `training/lifecycle.py:578`.

PostgreSQL advisory locks never conflict with row locks by design, so a Node
allocator and a Python persister for the same conversation run fully
concurrently: Node's `MAX+1` INSERT never touches the `conversations` row
Python holds locked, and Python's `base+1/base+2` computation never takes the
advisory key Node holds. Concrete interleaving that duplicates: Python reads
`message_count = M` under its row lock; Node concurrently computes `MAX(seq)+1
= M+1`, inserts and commits; Python then inserts `M+1` (duplicate) and `M+2` —
both commit, because no unique backstop exists today. Node's bounded 23505
retry only helps after the backstop exists.

Dynamic multi-session proof was not executable here: the disposable harness is
PGlite (single session), so the race cannot be staged; the proof above is
static (exhaustive lock-site enumeration) plus the documented non-interference
of the two lock domains. It is conclusive as a negative: with no shared lock
and no unique index, mutual exclusion is impossible.

### 11.6 Reachability verdict and hardening (verified fact + proposal)

**Verified fact:** the dangerous combination (existing `conversation_id` +
absent flag) is unreachable from every shipped caller. Both live Python-persist
paths pass `conversation_id=None`/`null`, so `_get_or_create_conversation`
mints a fresh UUID nobody else can be writing to. The census corroborates: 0
new ties since the audit window (§3.3).

**Residual risk:** the `/orchestrate` contract permits the dangerous
combination to anyone holding the internal-caller secret, and the
`requires_ai` chain can go live with a one-key payload change. Neither has
happened, but neither is structurally prevented.

**Proposed hardening (not implemented, needs approval):** make Python join
Node's lock domain with one statement at the top of `_persist_messages`,
before the `FOR UPDATE` select —

```sql
SELECT pg_advisory_xact_lock(hashtext('rev_conversation_sequence'), hashtext(CAST(:c AS text)));
```

— using byte-identical key expressions to `revSequence.js` (the
`conversation_id::text` cast renders the same canonical hyphenated UUID string
Node's `String(conversationId)` hashes). Cost: one round trip per autonomous
persist; benefit: true Node↔Python mutual serialization, after which the
bounded retry + unique backstop cover only truly manual SQL. Alternative
defense-in-depth: return 400 from `/orchestrate` when a body `conversation_id`
arrives without `_node_owns_chat_persistence`, forcing the dangerous
combination to fail loudly instead of double-writing.

## 12. Follow-up item 2 — final repair procedure and disposable tests

This section supersedes the §4.5 draft. The procedure below is
**transaction-wrapped, lock-protected, deterministically ordered, audited
before/after, explicit about ambiguous order, and abort-safe** — and it was
validated statement-by-statement on a disposable database (21/21 checks,
§12.3). It has **not** been executed against production.

### 12.1 Final repair SQL (v2) — proposed operation, NOT executed

```sql
-- C2 Final repair procedure (v2) — REVIEWED, NOT EXECUTED.
-- RUN ONLY under an approved writer freeze. Single transaction: COMMIT iff every
-- gate passes, else ROLLBACK (which restores all rows byte-identical).
--
-- Conventions: every STEP below is one statement except where marked; gate
-- SELECTs print one row each. The operator records all gate outputs in the
-- approval log before COMMIT.

BEGIN;

-- STEP 0 — serialize against every cooperating writer.
-- Same lock domain as Backend/src/services/revSequence.js acquireConversationWriteLock:
--   pg_advisory_xact_lock(hashtext('rev_conversation_sequence'), hashtext(conversationId))
-- Acquired in conversation_id order. Deadlock-free: Node writers hold at most
-- one advisory lock at a time, so no wait cycle can form.
SELECT COUNT(*) AS locked_conversations
FROM (
  SELECT (pg_advisory_xact_lock(
      hashtext('rev_conversation_sequence'),
      hashtext(ties.conversation_id::text)
  ))::text AS lock_acquired
  FROM (
    SELECT cm.conversation_id
    FROM conversation_messages cm
    GROUP BY cm.conversation_id, cm.sequence_number
    HAVING COUNT(*) > 1
  ) ties
  GROUP BY ties.conversation_id
  ORDER BY ties.conversation_id
) locks;

-- STEP 1 preamble — allow re-running this script in the same session (e.g.
-- the idempotency second run): previous temp audit tables are dropped so the
-- snapshot below is always fresh. Never use IF NOT EXISTS here: a stale
-- snapshot would silently validate against old rows.
DROP TABLE IF EXISTS c2_before_snapshot;
DROP TABLE IF EXISTS c2_before_plan;

-- STEP 1a — BEFORE audit: full snapshot of every affected conversation.
CREATE TEMPORARY TABLE c2_before_snapshot AS
SELECT cm.id, cm.conversation_id, cm.sequence_number, cm.role,
       cm.created_at, cm.organization_id, cm.user_id, cm.content,
       cm.correlation_id, cm.agent_name, cm.metadata, cm.has_error
FROM conversation_messages cm
WHERE cm.conversation_id IN (
  SELECT conversation_id
  FROM conversation_messages
  GROUP BY conversation_id, sequence_number
  HAVING COUNT(*) > 1
);

-- STEP 1b — BEFORE audit: per-group plan (keeper + excess + ambiguity flag).
-- keeper_rank 1 keeps its number; rank > 1 moves. ambiguous = the keeper
-- choice inside the group is decided by the id tiebreak because two or more
-- tied rows share created_at (semantically arbitrary, still deterministic).
CREATE TEMPORARY TABLE c2_before_plan AS
SELECT conversation_id, sequence_number, id, created_at, keeper_rank,
       COUNT(*) OVER (PARTITION BY conversation_id, sequence_number) AS group_size,
       (MIN(created_at) OVER (PARTITION BY conversation_id, sequence_number)
        = MAX(created_at) OVER (PARTITION BY conversation_id, sequence_number)) AS group_shares_created_at
FROM (
  SELECT id, conversation_id, sequence_number, created_at,
         ROW_NUMBER() OVER (
           PARTITION BY conversation_id, sequence_number
           ORDER BY created_at, id
         ) AS keeper_rank
  FROM conversation_messages
) ranked
WHERE (conversation_id, sequence_number) IN (
  SELECT conversation_id, sequence_number
  FROM conversation_messages
  GROUP BY conversation_id, sequence_number
  HAVING COUNT(*) > 1
);

-- STEP 1c — BEFORE gate outputs (record all three rows).
SELECT COUNT(*) AS before_tied_groups,
       COUNT(*) FILTER (WHERE group_shares_created_at) AS before_ambiguous_groups,
       COALESCE(SUM(group_size - 1), 0) AS before_excess_rows_to_move
FROM (SELECT DISTINCT conversation_id, sequence_number, group_size, group_shares_created_at
      FROM c2_before_plan) g;
SELECT conversation_id, sequence_number, group_size,
       (array_agg(id ORDER BY keeper_rank) FILTER (WHERE keeper_rank = 1))[1] AS keeper_id,
       array_agg(id ORDER BY keeper_rank) FILTER (WHERE keeper_rank > 1) AS excess_ids
FROM c2_before_plan
GROUP BY conversation_id, sequence_number, group_size
ORDER BY conversation_id, sequence_number;
SELECT md5(COALESCE(string_agg(
         id::text || '|' || conversation_id::text || '|' || sequence_number::text || '|' ||
         role || '|' || created_at::text || '|' || COALESCE(content::text, ''),
         '||' ORDER BY id), '')) AS before_snapshot_md5,
       COUNT(*) AS before_snapshot_rows
FROM c2_before_snapshot;

-- STEP 2 — repair UPDATE (tie-only). Semantics identical to the reviewed
-- repair.sql: keepers stay; each excess row moves above its conversation's
-- pre-repair maximum in deterministic (sequence_number, created_at, id) order.
-- Untied rows are never touched.
WITH conversation_max AS (
  SELECT conversation_id, MAX(sequence_number) AS max_seq
  FROM conversation_messages
  GROUP BY conversation_id
),
renumbered AS (
  SELECT
    p.id,
    m.max_seq + ROW_NUMBER() OVER (
      PARTITION BY p.conversation_id
      ORDER BY p.sequence_number, p.created_at, p.id
    ) AS new_seq
  FROM c2_before_plan p
  JOIN conversation_max m ON m.conversation_id = p.conversation_id
  WHERE p.keeper_rank > 1
)
UPDATE conversation_messages cm
SET sequence_number = r.new_seq
FROM renumbered r
WHERE r.id = cm.id;

-- STEP 3a — AFTER gate G1 (HARD): zero tied groups remain.
SELECT COUNT(*) AS g1_tied_groups_remaining
FROM (
  SELECT conversation_id, sequence_number
  FROM conversation_messages
  GROUP BY conversation_id, sequence_number
  HAVING COUNT(*) > 1
) ties;

-- STEP 3b — AFTER gate G2 (HARD): row counts unchanged per affected conversation.
SELECT COUNT(*) AS g2_convos_with_changed_rowcount
FROM (
  SELECT b.conversation_id
  FROM (SELECT conversation_id, COUNT(*) AS c FROM c2_before_snapshot GROUP BY 1) b
  FULL JOIN (SELECT conversation_id, COUNT(*) AS c FROM conversation_messages
             WHERE conversation_id IN (SELECT conversation_id FROM c2_before_snapshot)
             GROUP BY 1) a USING (conversation_id)
  WHERE b.c IS DISTINCT FROM a.c
) diff;

-- STEP 3c — AFTER gate G3 (HARD): every keeper still on its original number.
SELECT COUNT(*) AS g3_moved_keepers
FROM c2_before_plan p
JOIN conversation_messages cm ON cm.id = p.id
WHERE p.keeper_rank = 1 AND cm.sequence_number IS DISTINCT FROM p.sequence_number;

-- STEP 3d — AFTER gate G4 (HARD): every excess row above its conversation's
-- pre-repair max, and all post-repair numbers distinct per conversation.
SELECT COUNT(*) AS g4_excess_not_above_old_max
FROM c2_before_plan p
JOIN conversation_messages cm ON cm.id = p.id
JOIN (SELECT conversation_id, MAX(sequence_number) AS old_max
      FROM c2_before_snapshot GROUP BY 1) m ON m.conversation_id = p.conversation_id
WHERE p.keeper_rank > 1 AND cm.sequence_number <= m.old_max;
SELECT COUNT(*) AS g4_post_repair_ties_in_affected_convos
FROM (
  SELECT conversation_id, sequence_number
  FROM conversation_messages
  WHERE conversation_id IN (SELECT conversation_id FROM c2_before_snapshot)
  GROUP BY conversation_id, sequence_number
  HAVING COUNT(*) > 1
) ties;

-- STEP 3e — AFTER gate G5 (HARD): every non-sequence column byte-identical.
SELECT COUNT(*) AS g5_rows_with_changed_noseq_columns
FROM c2_before_snapshot b
JOIN conversation_messages cm ON cm.id = b.id
WHERE cm.conversation_id IS DISTINCT FROM b.conversation_id
   OR cm.role IS DISTINCT FROM b.role
   OR cm.created_at IS DISTINCT FROM b.created_at
   OR cm.organization_id IS DISTINCT FROM b.organization_id
   OR cm.user_id IS DISTINCT FROM b.user_id
   OR cm.content IS DISTINCT FROM b.content
   OR cm.correlation_id IS DISTINCT FROM b.correlation_id
   OR cm.agent_name IS DISTINCT FROM b.agent_name
   OR cm.metadata IS DISTINCT FROM b.metadata
   OR cm.has_error IS DISTINCT FROM b.has_error;

-- STEP 3f — AFTER gate G6 (HUMAN): ambiguous groups need explicit sign-off.
-- Expected 0 (prod census: 0 groups share created_at). If > 0, STOP: ROLLBACK
-- unless the approval names each (conversation_id, sequence_number) below.
SELECT COUNT(DISTINCT (conversation_id, sequence_number)) AS g6_ambiguous_groups
FROM c2_before_plan
WHERE group_shares_created_at AND keeper_rank > 1;
SELECT conversation_id, sequence_number,
       array_agg(id ORDER BY created_at, id) AS tied_ids_in_keeper_order
FROM c2_before_plan
WHERE group_shares_created_at
GROUP BY conversation_id, sequence_number
ORDER BY conversation_id, sequence_number;

-- STEP 4 — DECISION (operator runs exactly one of the two):
--   All of G1=0, G2=0, G3=0, G4a=0, G4b=0, G5=0, G6=0 (or G6 explicitly
--   approved row-by-row)  =>  COMMIT;
--   Anything else                          =>  ROLLBACK;
-- COMMIT;
```

### 12.2 Design notes (verified fact about the procedure text)

- **Transaction wrap:** everything from `BEGIN` to the operator's `COMMIT`
  runs in one transaction. Any gate failure → `ROLLBACK`, which restores all
  rows byte-identical (proved in §12.3, scenario S1).
- **Lock protection:** STEP 0 takes Node's exact advisory lock
  (`rev_conversation_sequence` namespace, `hashtext(conversation_id::text)` —
  the cast renders the same canonical UUID string Node hashes) for every
  affected conversation, in `conversation_id` order. Deadlock-freedom holds
  because Node writers hold at most one advisory lock at a time, so no wait
  cycle can form. The lock is belt-and-braces under the freeze (§14); it also
  serializes against any cooperating writer that escapes the freeze.
- **Deterministic ordering:** keeper choice is `(created_at, id)` per tied
  group; excess placement is `(sequence_number, created_at, id)` per
  conversation above the pre-repair max. Both chains are total orders over
  distinct rows (`id` is unique), so the outcome is a pure function of the
  input — verified by identical md5 across two fresh disposable runs (§12.3).
- **Before/after audit records:** `c2_before_snapshot` (every row of every
  affected conversation) and `c2_before_plan` (per-group keeper/excess/
  ambiguity) are temp tables live until COMMIT; the operator records the STEP
  1c outputs (group list with keeper/excess ids, snapshot md5) plus G1–G6 in
  the approval log. The `DROP ... IF EXISTS` preamble makes same-session
  re-runs safe while guaranteeing a fresh snapshot (`IF NOT EXISTS` would
  risk validating against stale rows).
- **Ambiguous-order handling:** a group is ambiguous when its tied rows share
  `created_at`, so the keeper is picked by the `id` tiebreak — deterministic
  but semantically arbitrary. Ambiguous groups are listed with keeper order in
  STEP 3f; the procedure mandates ROLLBACK unless the approval names each
  ambiguous `(conversation_id, sequence_number)` explicitly. Expected count
  for production is 0 (§3.5 census: 0 of 109 groups share `created_at`).
- **Rollback:** pre-commit, `ROLLBACK` (total). Post-commit, the repair is
  forward-only by design (renumbered rows keep valid conflict-free numbers);
  the only post-commit revert is the pre-freeze `pg_dump` restore (§14.3).
- **Supersedes §4.5:** the §4.5 per-conversation DO-block draft is withdrawn
  in favor of this audited single-transaction form (same tie-only semantics,
  stronger gates, tested abort path).

### 12.3 Disposable-database results (verified fact — 21/21)

Harness: PGlite (PostgreSQL 17-compatible, single session), schema mirroring
the 12 audited columns, fixture of 5 conversations — A: two prod-like pairs
(distinct `created_at`); B: a triple tie (beyond prod's all-pairs census); C:
clean; D: ambiguous pair (identical `created_at`); E: clean with a gap
(seq 1,2,5).

| # | Check | Result |
|---|---|---|
| S1-1 | Seed 20 rows | PASS |
| S1-2 | STEP 0 locks 3 affected conversations | PASS (`locked_conversations: 3`) |
| S1-3 | Before summary: 4 groups / 1 ambiguous / 5 excess | PASS |
| S1-4 | UPDATE moves exactly 5 rows | PASS (`affectedRows: 5`) |
| S1-5…S1-9 | G1=0, G2=0, G3=0, G4a=0, G4b=0, G5=0 | PASS (all six) |
| S1-10 | G6=1 flags D/seq-2 with keeper-ordered ids | PASS |
| S1-11 | ROLLBACK leaves table byte-identical (md5 `855a1e1d…35efc` both sides) | PASS |
| S2-1 | Prod-like fixture (no D): all gates zero incl. G6=0 | PASS |
| S2-2 | Excess count 4 (A×2 + B×2) | PASS |
| S2-3 | A keepers stay on 1,2,3,4,5; excess → 6,7 in `(seq, created)` order | PASS |
| S2-4 | B triple → keeper 2 + excess 3,4 in `created_at` order | PASS |
| S2-5 | Clean conversations C and E byte-untouched (gap preserved) | PASS |
| S2-6 | Second full run moves 0 rows; before-plan empty (0/0/0) | PASS |
| S2-7 | `CREATE UNIQUE INDEX (conversation_id, sequence_number)` builds on repaired data | PASS |
| DET | Two fresh identical fixtures → identical placement md5 (`839fac90…e3c79e3b40`) | PASS — deterministic |

Validation also caught and fixed two real defects in the draft procedure
before it is ever near production: PostgreSQL has no `min(uuid)` aggregate
(replaced with `array_agg(...)[1]`), and temp audit tables break same-session
re-runs without the `DROP IF EXISTS` preamble. Both fixes are in the §12.1
text and covered by S2-6.

Residual limitation: PGlite is single-session, so lock contention against a
live second writer was not staged; the lock statement itself executed (S1-2).
The production run additionally requires the §14 freeze and the §15 gates.

## 13. Follow-up item 3 — migration-ordering resolution

### 13.1 The collision (verified fact)

The prepared package directory is named
`20261126000000_c2_conversation_message_sequence`, whose 14-digit stamp
`20261126000000` is identical to the already-applied
`20261126000000_apple_sign_in_usd_billing` (production `_prisma_migrations`
row: applied `2026-11-26T19:27:48Z`, checksum starting `86997889`). The package
README predates that migration (it names `..._self_managing_operations` as the
latest applied). Prisma orders migrations lexicographically by full directory
name, so the as-is name would still sort after apple (`apple...` <
`c2...`) — the stamp sharing is confusing but not, by itself, an ordering
fault. It is worth resolving anyway: same-stamp siblings invite misreads of
"which came first", and any tooling that keys off the numeric prefix would see
a duplicate.

### 13.2 History-parity evidence (verified fact, this follow-up)

| Check | Result |
|---|---|
| Production `_prisma_migrations` row count | 36 |
| Local `Backend/prisma/migrations/` directory count | 36 |
| md5 over pipe-joined ordered names, production | `3271ec40e2e2b06763d86a9471acfd43` |
| md5 over pipe-joined ordered names, local | `3271ec40e2e2b06763d86a9471acfd43` — **match** |
| Latest on both sides | `20261126000000_apple_sign_in_usd_billing` |

Local migration history is therefore byte-identical (as an ordered name set)
to production history. The C2 package exists only under `migrations-pending/`
(verified present) and has no row in production (0 rows match either the old
or the proposed name).

### 13.3 Resolution: rename to `20261127000000_...` (proposed operation)

Promote the package under the fresh stamp `20261127000000`, keeping
`migration.sql` byte-identical so its reviewed checksum is preserved:

```text
Backend/prisma/migrations/20261127000000_c2_conversation_message_sequence/migration.sql
```

Verified against production this follow-up (`BOOL_AND(migration_name <
'20261127000000_c2_conversation_message_sequence')` over all 36 rows):
**true** — the proposed name sorts strictly after every applied migration, and
no local `migrations/` directory uses it (verified absent). Promotion remains
a move, not a rewrite, executed only after the §15 post-repair gates pass:

1. Copy the pending directory to the new `migrations/` path (SQL
   byte-identical).
2. `prisma migrate deploy` (Render backend `prestart`, or the approved manual
   equivalent).
3. Verify the new `_prisma_migrations` row (name + checksum + `finished_at`)
   and the index in `pg_indexes` (§15.3).

## 14. Follow-up item 4 — Render, backup/PITR, freeze, restoration

### 14.1 Render targets and process (verified fact + unverified assumption)

Verified from `docs/engineering/PRODUCTION_REMEDIATION_MASTER.md` (which also
records the standing access limitation — no Render access from this
environment, no Render IaC in the repo):

- Node backend service: `srv-db9m6pom7kps73dtk1tg`
  (`revluma-backend-vrsd.onrender.com`).
- Python intelligence service: `srv-db9m923ncjis739s8co0`.
- Workspace: `tea-dat7lbqd0e5s73afif20`.
- Deploys-from-`main` is proved only by observed database side effects; the
  auto-deploy setting and the currently deployed SHA were never reported.

**Unverified assumption (operator must confirm in the dashboard):** the exact
suspend/resume controls for both services and whether auto-deploy is on. There
is no code path for the freeze: the scheduler has no environment kill-switch
(no `ENABLED`/`DISABLED`/`SKIP_*` gate in `schedulerService.js`), and
`stopScheduler()` runs only via `SIGTERM` → `gracefulShutdown`
(`Backend/server.js`). The freeze is therefore process-level — the operator
suspends both Render services — not flag-level.

### 14.2 Restoration behavior the plan must account for (verified fact)

`startScheduler()` (`schedulerService.js:1204-1345`) fires an immediate
staggered startup pass for 12 jobs — including `runAlertQueue` — on every boot.
Restoration therefore re-arms autonomous writers within seconds of resume; the
post-repair verification window (§15.2) must complete while services are still
suspended, and resume order is Python-first (health) then Node, followed by
`/ready`, `scheduler_started`, and `automation_job_state` checks.

### 14.3 Backup and PITR (operator-verified prerequisite)

- The Supabase connector exposes no backup/PITR API (full tool listing
  checked this follow-up), so the recovery point cannot be captured from here.
- Operator records, from the Supabase dashboard for `jblpgqmbgdlzitprudgt`
  **before** the freeze: plan (PITR requires Pro or above — confirm), latest
  backup timestamp, and the PITR recovery-point timestamp. No repair without
  all three written in the approval log.
- Additionally: `pg_dump -t conversation_messages` (custom format) taken
  after the freeze is verified, before STEP 0. This dump is the only
  post-commit revert path (§12.2).

### 14.4 Writer-freeze procedure (proposed operation)

1. Schedule outside 05:00 UTC ± 30 min (the morning-briefing window;
   `runMorningBriefings` only fires inside it, `schedulerService.js:1333`).
2. Suspend the Node Render service (`srv-db9m6pom7kps73dtk1tg`) — stops HTTP
   writers (chat/stream/retry) and the in-process scheduler (alert queue,
   briefing trigger).
3. Suspend the Python Render service (`srv-db9m923ncjis739s8co0`) — stops
   `/orchestrate`, `/internal/morning-briefings`, and the business-state
   alert writer.
4. Verify the freeze with read-only queries (§14.5) — two samples ≥60 s apart
   where stated. Proceed to §12 only on frozen readings.

### 14.5 Freeze-verification queries (read-only; proposed operation)

```sql
-- F1. No application backends remain (service role; expect only this session
-- and the pooler; application_name values vary — record what you see).
SELECT pid, usename, application_name, state, query_start
FROM pg_stat_activity
WHERE datname = current_database();

-- F2. Message table frozen: run twice, >=60 s apart; both rows identical.
SELECT COUNT(*) AS n, MAX(created_at) AS latest
FROM conversation_messages;

-- F3. Alert queue frozen: run twice; both rows identical.
SELECT status, COUNT(*) FROM alert_queue GROUP BY status ORDER BY status;

-- F4. No job completed during the window (compare last_completed_at across samples).
SELECT job_name, status, last_completed_at
FROM automation_job_state
ORDER BY last_completed_at DESC NULLS LAST;
```

### 14.6 Restoration procedure (proposed operation)

1. Resume Python, confirm `/health` 200.
2. Resume Node, confirm `/ready` 200 and `scheduler_started` in logs.
3. Confirm `automation_job_state` shows fresh completions (proves the
   startup passes in §14.2 ran and writers are back).
4. Run the §8.2–§8.4 application checks (concurrent submissions, restoration,
   pagination, contracts).

## 15. Follow-up item 5 — exact verification gates

Expected values below are pinned to the §3 census (772 messages / 241
conversations / 109 tied groups / 57 affected conversations / 109 excess rows
/ 0 NULL / 0 ambiguous). Any drift between this review and the run must be
reconciled in the approval log before STEP 0.

### 15.1 Pre-repair gates (read-only; run after the §14.5 freeze proof)

```sql
-- P1. Census still matches §3 (expect 772 / 241 / 144-with-messages).
SELECT COUNT(*) AS messages FROM conversation_messages;
SELECT COUNT(*) AS convos FROM conversations;
SELECT COUNT(DISTINCT conversation_id) AS convos_with_messages FROM conversation_messages;

-- P2. Tied groups still exactly 109, all pairs, 57 conversations, 109 excess.
SELECT COUNT(*) AS tied_groups,
       SUM(cnt) AS tied_rows,
       SUM(cnt - 1) AS excess_rows,
       COUNT(DISTINCT conversation_id) AS affected_convos,
       BOOL_AND(cnt = 2) AS all_pairs
FROM (SELECT conversation_id, sequence_number, COUNT(*) AS cnt
      FROM conversation_messages GROUP BY 1, 2 HAVING COUNT(*) > 1) t;

-- P3. Zero NULL sequences (expect 0).
SELECT COUNT(*) AS null_sequences FROM conversation_messages
WHERE sequence_number IS NULL;

-- P4. Zero ambiguous groups (expect 0 — precondition for the G6=0 path).
SELECT COUNT(*) AS ambiguous_groups FROM (
  SELECT conversation_id, sequence_number
  FROM conversation_messages
  GROUP BY conversation_id, sequence_number
  HAVING COUNT(*) > 1 AND MIN(created_at) = MAX(created_at)
) t;

-- P5. Zero ties on/after the audit window still holds (expect 0; re-pin the
-- cutoff to the freeze time at run time).
SELECT COUNT(*) AS new_ties FROM (
  SELECT conversation_id, sequence_number
  FROM conversation_messages
  WHERE created_at >= TIMESTAMPTZ '2026-11-26T19:34:28Z'
  GROUP BY 1, 2 HAVING COUNT(*) > 1
) t;
```

**Zero-tie precondition for the migration (restated):** `migration.sql` runs
only after P2-equivalent reads 0 tied groups post-repair (G1, §12.1) with the
reading recorded. There is no other path to the constraint.

### 15.2 Post-repair gates

G1–G6 inside the §12.1 transaction (all 0, or G6 row-by-row approved), then
after COMMIT, still under freeze:

```sql
-- R1. Global zero-tie confirmation (expect 0).
SELECT COUNT(*) AS tied_groups_remaining FROM (
  SELECT conversation_id, sequence_number FROM conversation_messages
  GROUP BY 1, 2 HAVING COUNT(*) > 1
) t;

-- R2. Totals preserved (expect 772 / 241).
SELECT COUNT(*) AS messages FROM conversation_messages;
SELECT COUNT(*) AS convos FROM conversations;

-- R3. Idempotency re-run: re-execute §12.1 STEPS 0–3 in a fresh transaction;
-- expect locked_conversations = 0, before-plan 0/0/0, UPDATE 0 rows; ROLLBACK.
```

### 15.3 Post-constraint gates

```sql
-- C1. Backstop present as a plain unique index (expect 1 row).
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'conversation_messages'
  AND indexname = 'uq_conversation_message_sequence';

-- C2. Migration-history row present (expect 1 row, finished_at NOT NULL).
SELECT migration_name, finished_at, checksum
FROM public._prisma_migrations
WHERE migration_name = '20261127000000_c2_conversation_message_sequence';

-- C3. Optional, needs explicit approval: prove the backstop bites, with zero
-- net change (duplicate INSERT inside a rolled-back transaction; expect
-- error 23505, then the count below still 772).
BEGIN;
INSERT INTO conversation_messages (id, conversation_id, organization_id, user_id,
  role, content, sequence_number)
SELECT gen_random_uuid(), conversation_id, organization_id, user_id,
  'rev', '{"text":"backstop probe"}'::jsonb, sequence_number
FROM conversation_messages LIMIT 1;
-- expect: ERROR: duplicate key value violates unique constraint
--   "uq_conversation_message_sequence" (SQLSTATE 23505)
ROLLBACK;
SELECT COUNT(*) AS messages FROM conversation_messages; -- still 772
```

## 16. Follow-up item 6 — contract preservation

The repair writes exactly one column (`sequence_number`) on exactly the excess
rows (109 at census); G5 (§12.1) asserts the other ten audited columns
byte-identical, and the `conversations` table is never written. Contract by
contract:

| Contract | Why it holds | Caveat |
|---|---|---|
| **Restoration** (`replayBody`, idempotent replay) | Keyed on `(organization_id, request_id)` + `rev_content`/`rev_id`; none change. History reads order by `(sequence_number, id)` (`getConversation`), which remains a total order after repair. | Moved rows display later than their `created_at` suggests (inherent to tie-breaking; keepers — the earliest row per slot — never move). |
| **Retry** (5D matrix + `retryConversation`) | Eligibility reads `has_error`/`error_code` and `content` (G5-covered); the DELETE-then-`chat(reuse)` flow allocates via the same locked W-N3/W-N4 path. | None. Pre-repair retry-created gaps stay gaps; gaps never violated any contract. |
| **Cursor pagination** (tuple `(before, before_id)` over `(sequence_number, id)`) | The total order is preserved as a total order; post-repair paging is exact-once as validated. | **Outstanding pre-repair cursors must be discarded**: renumbering can shift page boundaries. The freeze (§14) drains in-flight pagination; clients re-fetch from head after restoration. |
| **Idempotency** (acceptance UQ `(organization_id, conversation_id, role, correlation_id)`, `request_id`-derived conversation ids) | Neither the constraint columns nor the derivation change; replay returns the same owned rows (same ids). | None. |
| **Tenant isolation** | The procedure is scoped per conversation; `organization_id` is immutable in it (G5 asserts) and locks are per-conversation. No statement joins or writes across organizations. | None. |
| **Phase 5B finding continuity** | `selected_finding` lives in `conversations.context_window` (`_persistFindingContext`), a table the repair never touches. | None. |
| **Phase 5C/5E evidence payloads** | Evidence, claims, investigation outcomes live in message `content` (G5-covered, asserted identical). | None. |
| **Phase 5D retry semantics** | Covered under Retry above. | None. |

One honest restatement for the approval: the repair changes user-visible
message order for the 109 moved rows (they sort by their new, higher numbers —
see §4.8). That is unavoidable — two rows cannot keep one slot — and is why
the earliest-keeps rule, the G6 ambiguity gate, and the approval log exist.
Nothing else the merchant can see (text, evidence, errors, findings, titles,
counts) changes.

**STOP (repeated):** no production repair, migration, deployment, freeze,
backup/restore, or verification write was performed. §§11–16 are evidence and
proposed operations only — wait for explicit approval before any of them.

**STOP:** wait for explicit approval before any production migration,
historical sequence repair, deployment, or production verification write.
