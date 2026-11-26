# C2 maintenance readiness record

Date: 2026-11-26 UTC. Merges: #516 `4706cc0`, #519 `9a133438` (HEAD).
Operator: the user (self-nominated this session).
Window: **06:30–07:30 UTC** (07:30–08:30 WAT), accepted this session.
Boundary: no freeze, repair, migration, or prod writes without explicit authorization.

## 1. Production deployment verification

**In the merged commit (verified at HEAD):** Python advisory lock
(`orchestrator.py:1437`, namespace `rev_conversation_sequence`), 23505
retry-once-then-raise (`:27`, `:1504-1516`), regression test + RC workflow
wiring (workflow `:198`). CI green on #519 incl. the live two-session proof.

**In production (read-only evidence, ~20:47Z, post-merge):**

| Signal | Reading | Meaning |
|---|---|---|
| Scheduler jobs completing 20:43–20:47Z | all 12 jobs fresh | Services alive after deploy |
| Messages 774 (+2), convos 241, ties 109 | ties unchanged, 0 since #519 | Writers healthy; no new dupes |
| Ambiguous groups 0 | — | G6=0 path expected |
| `_prisma_migrations` 36 rows, latest apple, 0 C2 | — | Boundary held: no migration applied |
| Rev errors 0/24h vs 0/prior 24h | — | No new error signal |
| Latest message 20:16Z (pre-merge) | **zero post-deploy message traffic** | Lock/fix activity not yet observable |

**Not verifiable from here (operator must confirm):** exact deployed SHAs —
both services expose build markers, no dashboard needed:

```bash
curl -s "$BACKEND_URL/ready" | python3 -c \
  "import json,sys; r=json.load(sys.stdin); print(r['status'], r['node_build'], r['python_build'])"
# expect: ready 9a133438... 9a133438...
curl -s "$PYTHON_URL/health"  # expect build: 9a133438...
```

Lock/fix "active" follows from SHA match (code is in that commit); first
post-deploy turn with 0 new ties closes the loop. Restoration smoke (read-only,
allowed anytime): `GET /rev/conversation/:id` 200 with ascending `(seq,id)`
pages. A synthetic chat turn would be a prod write — banned without approval.

## 2. Writer serialization verification

Same key, both runtimes: `pg_advisory_xact_lock(hashtext(
'rev_conversation_sequence'), hashtext(conv_uuid_string))` — Node
(`revSequence.js`) and Python (`orchestrator.py:1437`) use identical
expressions (key-equality proved on disposable PG). Same boundary: Node
lock-inside-`$transaction` at all 4 sites (verified line pairs); Python lock
as first statement of the persist transaction, single commit, no intermediate
commit. Ordering advisory-before-row-lock on both sides: deadlock-free.
23505: Node retries ≤3; Python retries once then raises (no silent success).

## 3. Recovery readiness

Supabase `jblpgqmbgdlzitprudgt`: db + pooler `ACTIVE_HEALTHY` (API-verified).
No backup/PITR API exists in the connector — before the window the operator
records from the dashboard: plan tier (PITR-capable?), latest backup
timestamp, PITR recovery-point timestamp. Plus post-freeze
`pg_dump -t conversation_messages` before STEP 0 (only post-commit revert).

## 4. B4/B6/B7 rulings (binding)

- **B4 — cursors:** procedural invalidation accepted. No persisted cursors
  exist (verified: no cursor storage anywhere in repo; tokens are ephemeral).
  Freeze drains in-flight pagination; clients re-fetch from head on resume.
  Residual: a stale mid-freeze cursor returns a shifted page, self-healing by
  id client-side.
- **B6 — window:** 06:30–07:30 UTC. Evidence: 10 messages/7 days (all at
  09/13/20 UTC); only hard exclusion is the 05:00 UTC briefing job (±30 min),
  which ran clean today at 05:09. Window sits in zero-traffic hours, after
  briefings, in operator morning hours.
- **B7 — ambiguity:** G6>0 mandates ROLLBACK + quarantine: STEP 3f emits the
  per-group keeper-ordered id lists, the operator attaches them to the
  approval log, and nothing commits until each group is approved row-by-row.
  Ambiguous rows are never automatically rewritten. Current census: 0.

## 5. Remaining blockers

1. Operator SHA confirmation (the two curls above) + read-only smokes.
2. Operator PITR artifacts (plan, backup ts, recovery point).
3. Explicit authorization for the window (this record grants none).

## 6. Exact maintenance sequence (all steps approval-gated)

1. 06:30Z: operator suspends Node `srv-db9m6pom7kps73dtk1tg`, then Python
   `srv-db9m923ncjis739s8co0` (Render dashboard).
2. Freeze proof F1–F4 (review §14.5), two samples ≥60 s apart.
3. `pg_dump -t conversation_messages`; record PITR recovery point.
4. Pre-repair gates P1–P5 (review §15.1); reconcile any drift vs §1 census.
5. Repair §12.1 STEPS 0–4 in one transaction; record every gate output.
   G1–G5 must read 0; G6 must read 0 or trigger B7 quarantine → ROLLBACK.
6. COMMIT only on all-green; then R1–R3 (review §15.2), still frozen.
7. Promote `migration.sql` byte-identical to
   `migrations/20261127000000_c2_conversation_message_sequence/`; migrate
   deploy; gates C1–C3 (review §15.3).
8. Resume Python → `/health`; resume Node → `/ready` + `scheduler_started` +
   fresh job completions; restoration/pagination read smokes.
9. First post-resume turns: confirm 0 new ties; close the window.

**STOP:** no freeze, repair, migration, or prod write performed. Awaiting
explicit authorization for step 1.
