# C2 Free-plan recovery assessment

Date: 2026-11-26 UTC. Plan confirmed: Supabase Free — no scheduled backups,
no PITR. Method: read-only prod inventory, credential-surface inspection
(values never reproduced), and a disposable backup/restore/recovery drill
(14/14). No prod writes, no freeze, no repair, no migration performed.

## Verdict: CONDITIONALLY SAFE

A complete logical backup is feasible and cheap (32 MB database), the
restore + validation procedure is proven on a prod-shaped fixture (14/14),
and under a verified writer freeze a post-freeze dump covers exactly the
repair's recovery point. It becomes SAFE only when the operator has (a)
taken the actual post-freeze dump, (b) trial-restored it into a disposable
target, and (c) recorded the validation outputs below. Per the task
boundary, no backup is claimed valid until that trial restore exists.

## 1. Production inventory (read-only, verified)

- Database size **32 MB**; **84 tables** in `public`; 776 messages /
  242 conversations. Full-DB `pg_dump` takes seconds.
- `conversation_messages` + `conversations`: PKs; FKs to `organizations`,
  `users`, `conversations`, `business_states` (SET NULL); CHECKs on
  `status`, `role`, `confidence_score`; unique submission index
  `uq_conversation_message_submission`; 11 indexes total across both
  tables; sequence backstop absent (as expected pre-migration).
- Extensions: `plpgsql`, `pgcrypto`, `uuid-ossp`, `pg_stat_statements`,
  `supabase_vault`, `vector 0.8.0` — any Supabase trial target has all of
  these; vanilla PG would need `vector` installed.
- RLS: 1 policy on each of the two tables (`pg_dump` captures policies).
  Sequences in `public`: 0.

## 2. Credentials and connection (inspected, nothing exposed)

- No usable database credentials are accessible from this environment. The
  secrets listing shows one entry whose stored value is not a usable
  connection string (value not reproduced here, per boundary).
- Operator retrieves the database password from the Supabase dashboard
  (project Settings → Database) at window time. It must travel by prompt
  or env var only — never chat, logs, or files.
- Dumps **must use the direct connection** (`db.<project-ref>.supabase.co`,
  port **5432**). The 6543 pooler breaks `pg_dump` (transaction pooling).
  `pg_dump` needs any PostgreSQL ≥ 15 client; PG 17 preferred.

## 3. Backup procedure (operator-run, post-freeze)

```bash
# Full logical backup (all schemas: public + auth/storage/vault state).
pg_dump "host=db.jblpgqmbgdlzitprudgt.supabase.co port=5432 dbname=postgres user=postgres sslmode=require" \
  --format=custom --file=/secure/c2-freeze-YYYYMMDD-HHMM.dump
# Fast targeted second copy (repair blast radius only).
pg_dump "<same-connection>" --format=custom \
  --table=public.conversations --table=public.conversation_messages \
  --file=/secure/c2-freeze-msgs-YYYYMMDD-HHMM.dump
sha256sum /secure/c2-freeze-*.dump   # record both hashes in the approval log
```

Covers: all data, schemas, PK/FK/CHECK/UNIQUE constraints, indexes,
sequences (none exist), RLS policies, functions, extensions markers.
Non-blocking (MVCC snapshot), but run it post-freeze anyway so the dump
moment equals the repair start.

## 4. Trial restore + validation (mandatory before the window)

Restore into a **disposable Supabase project** (free; has all extensions)
or local PG 17 + pgvector — never into production:

```bash
pg_restore --no-owner --role=postgres -d postgres /secure/c2-freeze-YYYYMMDD-HHMM.dump
```

Then record outputs of (expected values = the frozen prod census):

```sql
SELECT COUNT(*) AS messages FROM conversation_messages;      -- expect frozen N
SELECT COUNT(*) AS convos FROM conversations;                 -- expect frozen M
SELECT COUNT(*) AS tied_groups FROM (                          -- expect 109
  SELECT conversation_id, sequence_number FROM conversation_messages
  GROUP BY 1, 2 HAVING COUNT(*) > 1) t;
SELECT md5(COALESCE(string_agg(id::text || sequence_number::text || role, ','
  ORDER BY id), '')) AS msg_checksum FROM conversation_messages; -- match prod
SELECT COUNT(*) AS cross_org FROM conversation_messages cm    -- expect 0
  JOIN conversations c ON c.id = cm.conversation_id
  WHERE cm.organization_id IS DISTINCT FROM c.organization_id;
SELECT COUNT(*) AS orphan_msgs FROM conversation_messages cm  -- expect 0
  LEFT JOIN conversations c ON c.id = cm.conversation_id WHERE c.id IS NULL;
```

Gate: all six match the frozen prod readings or the window does not proceed.

## 5. Drill evidence (disposable PG17, 14/14)

Prod-shaped fixture (stub parents + both tables with prod-equivalent PKs,
FKs, CHECKs, submission UQ, 3 indexes, 1 RLS policy; 6 msgs incl. a tied
pair): dump → restore into a fresh instance → counts + checksums identical,
PK/FK/CHECK/UQ all reject violations with the expected SQLSTATEs
(23505/23503/23514), policy + indexes present. Disaster round-trip: repair
COMMIT on a clone (ties 1→0), restore from the backup, state byte-identical
to pre-repair (md5 match, ties back). This proves the procedure and the
validation queries — not the `pg_dump` binary or the actual prod file, which
is exactly what §4 covers.

## 6. Storage, retention, retrieval

- Transfer over TLS (direct connection, `sslmode=require`); encrypt the
  `.dump` at rest (operator full-disk encryption at minimum; age/gpg if it
  leaves the operator machine). Access: operator only.
- Retain until repair + UQ migration verified **plus 30 days**, then
  secure-delete. Record file hashes + locations in the approval log.
- Retrieval on repair failure (approval-gated, downtime): stop writers
  (already frozen), `pg_restore --clean --no-owner -d postgres` of the full
  dump into production, re-run §4 queries against prod, then decide
  retry/abort. RTO: minutes at 32 MB.

## 7. Limitations vs PITR (honest)

- **Granularity**: one recovery point (dump moment), no per-second WAL
  replay. Under a *verified* freeze this equals PITR-to-repair-start,
  because zero writes occur between dump and repair. If the freeze leaks,
  post-dump writes are unrecoverable — the F1–F4 freeze proof is what closes
  this, and any leak finding aborts the window.
- **Post-commit mistakes**: a bad COMMIT is recovered by full restore
  (minutes), same outcome as a PITR restore but coarser and manual.
- **Coverage**: full dump covers all schemas/objects pg_dump supports;
  not covered are live-server runtime state (irrelevant), and anything
  written after the dump moment (excluded by the freeze).
- **No managed safety net**: no automatic scheduled backup exists to fall
  back on — the operator-held dump is the only copy. Hence the dual-file
  (§3) + trial-restore gate (§4): two files, one proven restorable.

## Conditions for SAFE

1. Operator takes both §3 dumps post-freeze; hashes recorded.
2. Operator trial-restores the full dump to a disposable target; all six
   §4 outputs match frozen prod readings.
3. Dump files secured per §6 until retention expires.
4. Freeze proof F1–F4 green before the dump (closes the data-loss window).

Meet 1–4 and the recovery posture is SAFE for this operation. Until then it
remains CONDITIONALLY SAFE, and the C2 repair stays blocked.
