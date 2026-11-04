# REV Capacity and Performance — Production Hardening Phase 6

Date: 2026-11-04 · Branch: `arena/4f3ee579-revluma` · Supabase project: `jblpgqmbgdlzitprudgt`

Everything below was measured against the live production stack on the date
above (direct database queries, persisted application rows, deployed-service
responses). No figure is a guess; where a number is a projection it is labelled
as one and its arithmetic is shown. Per the hardening directive, **no paid
infrastructure upgrade was performed** — this document is the reviewed capacity
plan the directive requires before any upgrade is considered.

---

## 1. Current topology (as deployed)

| Layer    | Host / plan                        | Instances | Notes |
|----------|------------------------------------|-----------|-------|
| Frontend | Vercel (Dashboard)                 | edge      | Deploy `dpl_Ewu7dt5S1vg9r6SzhvHoPVmeFLLw` promoted |
| Node API | Render **free** (0.1 CPU, 512 MB)  | 1         | `revluma-backend-vrsd`, spins down after idle → cold starts |
| Python ML| Render **free** (0.1 CPU, 512 MB)  | 1         | `revluma-python` (FastAPI + gunicorn) |
| Database | Supabase **free** (shared compute) | 1         | 60-connection ceiling, 500 MB disk |
| Redis    | Render-managed (`REDIS_URL` set)   | 1         | locks/cache; Postgres job locks are the system of record |

Scheduler load today (from `automation_job_state`, verified live):

- `business-state` rebuild: every minute, staggered per organization — 6
  organizations observed, ≈11 s each (started 16:09:25 → completed 16:09:36 UTC).
- `daily-churn`: hourly pass, 31 customers (11 active), now Postgres-locked and
  persisted in `automation_job_state` (Phase 5 change in this branch).
- store-sync: 15-minute eligibility interval, 20-minute stuck-sync recovery
  (`shopifySyncRecovery.js`).
- intelligence-findings: hourly; alert-queue, feature-queue, recovery-queue,
  automation, training-observations: interval-driven with local/Redis locks.

## 2. Foreign-key covering indexes (advisor finding — RESOLVED)

The Supabase performance advisor reported **25 foreign keys without covering
indexes**. Verified directly against `pg_index` (none of the 25 column lists is
the prefix of an existing index, so none was redundant), then created by
migration `20261104180000_fk_covering_indexes` and applied to production.

Post-state, measured: **0 uncovered foreign keys remain** in the public schema.

Planner usability proven with `enable_seqscan = off` (at current row counts the
planner still prefers seq scans — correct behaviour; the indexes bind as tables
grow):

```
EXPLAIN SELECT * FROM notifications WHERE user_id = $1;
 → Index Scan using notifications_user_id_idx
EXPLAIN SELECT * FROM conversation_messages WHERE business_state_id = $1;
 → Index Scan using conversation_messages_business_state_id_idx
```

Hot access patterns these serve: notification lists per user (1,896 rows and
growing), alert-queue sweeps per business state, conversation history loads,
churn/sensitivity observation writes per organization (hourly workers),
recovery-worker joins from abandoned carts to orders, cascade deletes on every
referenced parent row.

## 3. Rev conversational latency (measured from production rows)

`conversation_messages.latency_ms` (persisted per assistant turn):

| turns | min | p50 | p95 | max |
|-------|-----|-----|-----|-----|
| 15    | 5.9 s | 18.8 s | 44.3 s | 45.9 s |

Interpretation, honestly:

- The median includes full investigation turns (LLM understanding + multiple
  Python tool calls + composer) on a 0.1-CPU instance. Social/conversational
  turns sit at the low end (~6 s).
- **p95 (44.3 s) and max (45.9 s) are at the ML timeout ceiling**
  (`ML_TIMEOUT_MS` default 45 000 ms): the slowest investigation turn did not
  just run long, it brushed the timeout boundary. On any slower day that turn
  degrades safely (composer fallback), but it is a real ceiling, not headroom.
- SSE streaming means the merchant sees progressive output; `latency_ms`
  measures completion, not first token.

## 4. Connection-pool budget (verified, not assumed)

Node logs its budget at startup (`database_connection_budget`): Prisma
`connection_limit=10` (operator DSN), Python pool budget 12, against the
Supabase 60-connection maximum. Python's SQLAlchemy engine is built with
`pool_size`/`max_overflow` from the same variables it advertises, plus
`pool_pre_ping`, `pool_recycle=300`, LIFO reuse, and a saturation listener that
records the first saturation instead of discovering it at timeout.

Worst case: 10 (Node) + 12 (Python) + Supabase internals ≈ 25–30 of 60. The
startup stagger (`SCHEDULER_STARTUP_STAGGER_MS`) exists precisely so a restart
does not open a burst of concurrent Python sessions against this pool.

**Headroom exists for the current load; it does not survive 500 merchants** —
see §6.

## 5. What is already engineered for reliability (verified in code, this audit)

- Per-customer failure isolation in churn scoring (one customer cannot
  interrupt the pass) — regression-tested (`churnWorkerLogging.test.js`).
- Postgres job locks with heartbeats for `business-state`,
  `intelligence-findings`, and now `daily-churn`; outcomes (including
  `failed`/`partial` with counters) persisted in `automation_job_state` —
  regression-tested (`churnQueueJobState.test.js`).
- Sync-freshness monitoring: a connected store unsynced for >120 minutes raises
  a HIGH `INTEGRATION_FAILURE` finding (`intelligenceFindingsEngine.js`);
  syncs stuck in `syncing` for >20 minutes are recovered
  (`shopifySyncRecovery.js`).
- Readiness (`/ready`) reports actual dependency health (database, Python,
  Redis, scheduler state); liveness (`/health`) is static and cannot fail on an
  optional downstream outage.

## 6. Projection: 500 merchants on the current stack (arithmetic shown)

Assumptions (conservative, from today's measured per-unit costs): 500
organizations; ~11 s per business-state rebuild; ~200 active customers per
store; churn scoring dominated by one Node→Python HTTP round-trip per customer
(~0.5–1 s each on free tier today: 31 customers complete within the hourly
pass).

- **Business-state**: 500 × 11 s ≈ **92 minutes sequential** — does not fit the
  hourly (let alone per-minute) cadence. The scheduler would permanently lag.
- **Churn**: 500 × 200 = 100,000 customers per pass at ~0.5 s ≈ **14 hours**
  per "hourly" pass — structurally impossible per-customer over HTTP.
- **Connections**: one Python worker pool (12) serving 500 merchants'
  concurrent conversations saturates; queueing latency compounds the 45 s
  timeout ceiling already being brushed at p95.
- **Render free spin-down**: every idle period costs a cold start for *both*
  services; at 500 merchants traffic is continuous, so spin-down stops being
  the bottleneck and 0.1 CPU becomes it.

**Conclusion: the free tier is correct for the current pilot (≤ ~10 merchants)
and cannot carry 500. This is a documented limit, not a defect to hide.**

## 7. Minimum viable configuration for 500 merchants (reviewed plan; NO upgrade performed)

Ordered by leverage; each item is independently adoptable:

1. **Batch the churn contract** (code, no infra): a `/predict/churn-risk/batch`
   endpoint scoring N customers per call removes the per-customer HTTP
   round-trip — the single largest structural blocker (14 h → minutes).
2. **Supabase Pro** (~$25/mo): 8 GB compute, disk-based connection pooler
   (pgbouncer transaction mode) — required before any compute scaling, because
   the 60-connection ceiling and shared CPU cap everything else.
3. **Render Starter ×2** (Node + Python, ~$7/mo each): 0.5 CPU / 2 GB, no
   spin-down. Removes cold starts and gives the Python pool real throughput.
4. **Business-state cadence change** (code): per-organization adaptive
   interval (e.g. 5–15 min by activity) with bounded concurrency (4–6 parallel
   rebuilds) instead of a fixed per-minute staggered sweep; 500 orgs then fit
   comfortably inside each window.
5. **Second Node instance + Redis locks** (infra): only after 1–4; the Postgres
   job locks already make multi-instance scheduling safe (they were built for
   it), and `acquireLock` falls back to Redis when present.
6. **Re-measure p95 against `ML_TIMEOUT_MS`** after each step; raise the
   timeout only with evidence, never to mask a regression.

Estimated floor for 500 merchants: Supabase Pro + 2× Render Starter ≈ **$39/mo**
plus the two code changes (batch churn, adaptive business-state). No component
requires an enterprise tier.

## 8. Rollback

- Index migration: `DROP INDEX CONCURRENTLY IF EXISTS` per index (all 25 are
  additive; nothing depends on them for correctness).
- Churn contract change: backward-compatible on both sides (null was already
  rejected; numbers still validate identically). Rollback = redeploy previous
  Render builds; no data migration involved.
- Job-lock migration for churn: revert to Redis `acquireLock('daily-churn')`;
  the `automation_job_state` row is inert if unused.
