# C2 migration package (PREPARED — NOT applied, NOT executed)

## Why this directory exists

`prisma/migrations/` is auto-applied: production `_prisma_migrations` is current
through `20261123000000_self_managing_operations`, so anything merged under
`migrations/` is picked up by the next `migrate deploy`. The C2 unique index
would FAIL on today's 109 tied `(conversation_id, sequence_number)` pairs, and
its application is explicitly approval-gated. This package therefore lives in
`migrations-pending/` — no pipeline discovers it — until the repair is approved
and executed and the migration itself is approved.

Promotion (after both approvals) is a move, not a rewrite: copy this directory
to `prisma/migrations/20261126000000_c2_conversation_message_sequence/` (keeping
`migration.sql` byte-identical so its checksum matches what was reviewed here)
and run `migrate deploy`.

## Contents

- `migration.sql` — idempotent `CREATE UNIQUE INDEX uq_conversation_message_sequence
  (conversation_id, sequence_number)`. Matches `@@unique(..., map:
  "uq_conversation_message_sequence")` in `schema.prisma`.
- `rollback.sql` — idempotent drop of the backstop in either shape (unique
  constraint or plain unique index). Code keeps working without the
  index (the advisory lock still serializes cooperating writers); the repair is
  forward-only and is never rolled back.
- `repair.sql` — idempotent tie-only UPDATE plus a verification SELECT. Moves
  only excess rows (109 org-wide at last census); untied rows are never touched.

## Runbook (all steps require explicit approval first)

1. **Snapshot.** Record the before-state census (see
   `docs/rev-intelligence/C2-PREPARATION-REVIEW.md`) and take a
   `conversation_messages` backup (`pg_dump -t conversation_messages`).
2. **Blast radius.** Re-run the excess-rows census; the count must equal the
   number of rows `repair.sql` will move.
3. **Repair.** Run the `repair.sql` UPDATE. Re-run it: the second run must
   update 0 rows (idempotency proof).
4. **Verify.** The verification SELECT must report `tied_groups_remaining = 0`.
5. **Promote + migrate.** Move `migration.sql` into `prisma/migrations/` as above
   and `migrate deploy`. Verify the index in `pg_indexes` and the new row in
   `_prisma_migrations`.
6. **Post-check.** Confirm the merge-quarterback queries: zero tied groups, the
   RC concurrency integration green, and no `23505` in backend logs.

## Rollback conditions

Run `rollback.sql` only if `migration.sql` itself fails partway (leaving a
`INVALID` index) or is implicated in a deploy incident. A data-level revert of
the repair is intentionally not provided: renumbered rows keep valid,
conflict-free numbers with or without the index.
