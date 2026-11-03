# P0 Incident — Business State scheduler silently disabled

**Date:** 2026-11-02 → 2026-11-03
**Status:** Root cause established and fixed in `main` (`ab3dc7a`, PR #252). **Deployment to Render is outstanding and is a user-only action.**
**Severity:** P0 — the scheduler job that produces every Business State snapshot was disabled for 17+ hours with no error surfaced anywhere.

---

## 1. Symptom

Business State snapshots stopped being written at **2026-11-02 08:00:20 UTC**. They were still not being written **17.3 hours later**.

Throughout that window the Node service looked healthy and *was* healthy: store syncs continued normally, the most recent at **2026-11-03 01:04:06 UTC**.

Python was initially suspected. **Python was not the cause.** For this job, nothing was calling it.

## 2. Root cause

`runBusinessStateRebuild` was the **only** job among roughly ten in `schedulerService.js` configured with `requireDistributed: true`. That requirement could be satisfied **only** by Redis. When Redis was not ready, `acquireLock()` returned `null` and the job returned having logged at `debug` level:

```js
if (!isRedisReady()) {
    if (requireDistributed) {
        logger.warn('scheduler_distributed_lock_unavailable');
        return null;                    // <- job silently skipped, every 60s tick
    }
    return { local: true, ... };        // <- every other job took this path
}
```

Every other job took the local-lock fallback and kept running. That asymmetry is precisely why the outage presented as a Python failure: syncs, alerts, feature jobs and the Python automation call all continued, while the one job that produced snapshots was dead.

Three independent mechanisms made that state **permanent** rather than transient. All three are now closed.

### 2.1 Redis readiness was unrecoverable

`retryStrategy` returned `null` after five attempts, which instructs ioredis to stop reconnecting for the lifetime of the process. Separately, `connectRedis()` attempted `connect()` once and never retried an initial failure. A transient Redis blip during a deploy therefore disabled Redis until the next process restart.

### 2.2 A failed initial connection could crash the process

Event handlers were attached **after** `await client.connect()` resolved. An initial connection failure emits `'error'`; with no listener attached, Node treats an emitted `'error'` event as fatal.

### 2.3 A malformed environment variable silently disabled the job

Every scheduler setting was read with a bare `parseInt`. A non-numeric value yields `NaN`, which fails in two ways worse than an unset variable:

- `setInterval(fn, NaN)` is treated as `0` and fires **every millisecond**.
- A `NaN` lock TTL serialises to `null` in the Redis `SET key val EX ttl NX` command, so the command errors, `acquireLock` catches it and returns `null`, and the guarded job is skipped forever.

`parseInt` is also lenient — `'60s and then some'` parses to `60` — so a typo could be accepted as a deliberately configured value.

### 2.4 Why the 10-minute lock TTL could not explain 17 hours

`BUSINESS_STATE_LOCK_TTL_SECONDS` was 600, so a *held* lock self-expires in 10 minutes. A stuck lock therefore cannot explain a 17-hour outage. The failure had to be the `isRedisReady() === false` branch or the `NaN` TTL branch — both permanent for the process lifetime.

## 3. Evidence that isolates the cause

Established from the production database, not inferred from logs.

**`automation_job_state` showed `real_data_model_lifecycle` completing at 2026-11-02 21:02:48 UTC.** That job is reachable only through:

```
Node runAutomationQueue()  ->  POST /internal/automation/run  ->  api.py  ->  run_automation_cycle()
```

and `runAutomationQueue` uses `acquireLock('intelligence-automation')` **without** `requireDistributed`, so it took the local fallback and kept running through the Redis outage.

Therefore, at 21:02:48 UTC — 13 hours after snapshots froze:

| Component | State |
|---|---|
| Node scheduler ticking | healthy |
| Node → Python HTTP | healthy |
| Python service | healthy |
| Python DB connection pool | healthy |
| Business State snapshots | **frozen since 08:00:20** |

That isolates the failure to the single job that required a distributed lock.

A second observation at **2026-11-03 01:18:19 UTC** reproduced the same asymmetry: newest store sync `01:04:06`, newest snapshot still `2026-11-02 08:00:20`.

## 4. Fix

### 4.1 The lock moved to Postgres (`941331e`)

Postgres is already a hard dependency and is the system of record for the snapshots being rebuilt, which makes it the correct coordinator. This removes Redis as a single point of failure for the most important job in the system.

The single-writer invariant the original code insisted on is preserved:

- the claim is one **atomic conditional `UPDATE`**;
- a crashed holder expires after its TTL rather than wedging the job forever;
- release is **token-matched**, so a holder whose claim was superseded cannot release a lock another instance has taken over.

**No migration was required.** The `automation_job_state` table already existed (`Backend/prisma/schema.prisma`) and was unused by Node; Python's `automation/runner.py` uses it for four model jobs, all claimed **by explicit name**, so the new `business-state` row is invisible to that code and cannot be picked up and executed by it.

### 4.2 Redis resilience (`941331e`)

Retries are now unbounded with capped backoff, handlers are attached **before** `connect()`, a watchdog re-establishes a dead client, and prolonged unavailability escalates to `logger.error('redis_unavailable_persistent')`.

### 4.3 Configuration hardening (`941331e`)

`Backend/src/utils/intSetting.js` requires the **entire** string to be an integer, enforces a per-setting minimum, and logs at error level before falling back to the documented default. Applied to all 12 scheduler settings.

### 4.4 The failure became visible (`941331e`)

This is the part that allowed a P0 to run unnoticed for 17 hours.

- A skipped job records its reason in `automation_job_state`, readable from the database.
- A completed run records its outcome (organizations processed, succeeded, failed, latency).
- Lock acquisition errors log at `error`, not `debug`.
- `GET /ready` reports the scheduler heartbeat and `redis_configured`.

"Did Business State actually run?" is now answerable with one HTTP call or one SQL query, without Render log access.

### 4.5 Findings producer (`2838b2c`)

`evaluateOrganizationFindings` was reachable **only** from the merchant-facing refresh endpoint, so a qualifying condition had to coincide with someone pressing refresh to ever be recorded. `schedulerService.js` contained no reference to findings at all. A bounded, lock-guarded scheduled pass now supplies the missing caller. Detection rules and evidence gates are unchanged.

### 4.6 Baselines producer (`47e7c7a`)

The sole `INSERT` into `business_state_baselines` sat inside `run_historical_ingestion`, a CLI cold-start script with **no HTTP route and no Node caller** — unreachable from production. `establish_missing_baselines` is now claimed by the automation cycle at a six-hour cadence.

### 4.7 Memory writes no longer destroy each other (`47e7c7a`)

`persist_investigation_context` wrote `conversations.context_window` and the `merchant_memories` row in **one transaction with one commit**, so a failure in the `INSERT` rolled back the context too — losing contextual follow-ups and the memory together, reported only as a `warning` that did not say which write failed. They now commit separately; each failure logs at `error` with the stage named; a deliberate skip logs distinctly so silence is not ambiguous.

## 5. Verified against production, not assumed

| Claim checked | Result |
|---|---|
| `uq_memory_org_key` unique constraint exists (so the memory `ON CONFLICT` is valid) | **Yes** — hypothesis disproved; not the cause |
| Stores with certified order coverage (`shopify_verified_history_v1`) | 2 of 4 Shopify stores |
| Orders on those certified stores | **0 each** |
| The store with real orders (`3ed79446`, 5 orders, 14 days) | **No certified coverage** |
| `conversations.context_window` / `summary` populated | **0 of 122** |
| `automation_job_state` rows | 4, all Python model jobs; **none** named `business-state` |

### 5.1 Consequences stated plainly

**`intelligence_findings = 0` is currently correct behaviour, not a defect.** The gate requires a certified coverage row spanning both comparison periods *and* `evidenceReady(..., 10)` — at least ten orders in **each** period. No production store satisfies both. This change will **not** manufacture revenue, order-volume or returning-customer findings.

One finding **does** legitimately qualify and should appear after deploy: store `aa269846` has **16 failed webhook registrations** and has never synced, which `detectIntegrationFailure` reports independently of order history.

**`business_state_baselines` will be written only for organizations with observable trading history.** The selection requires orders or abandoned carts within the lookback window, so an organization with no history receives no row rather than a row of fabricated zeros that would read like real data. On current data, that means one organization qualifies.

**`merchant_memories` may legitimately remain empty** until an investigation produces verified evidence on a conversation whose id reaches Python. What changed is that the reason is now recorded rather than swallowed.

## 6. Pre-deploy baseline

Captured **2026-11-03 01:18:19 UTC**, before Render deployment:

```
new_job_rows_deploy_detector   0        <- 'business-state' / 'intelligence-findings' absent
newest_snapshot                2026-11-02 08:00:20 UTC
snapshots_last_2h              0
valid_current                  0
findings                       0
baselines                      0
memories                       0
conversations_with_context     0
newest_store_sync              2026-11-03 01:04:06 UTC
```

## 7. Verification runbook

### 7.1 Deploy detector (single query, no log access needed)

The new code writes rows that the old code never could. Their presence **is** proof of deployment:

```sql
select job_name, status, last_started_at, last_completed_at,
       left(coalesce(last_error, ''), 120) as last_error,
       last_result
from automation_job_state
where job_name in ('business-state', 'intelligence-findings', 'business_state_baselines')
order by updated_at desc;
```

- **No rows** → the new commit is not deployed.
- **`business-state` row with `status = 'completed'`** and a populated `last_result` → the scheduler is running and recording outcomes.
- **`status = 'blocked'` with `last_error` naming a reason** → the job is being skipped, and the reason is now visible instead of silent.

### 7.2 Readiness probe

```bash
curl -s https://revluma-backend-vrsd.onrender.com/ready | jq
```

`/health` always returns `200 {status:'ok'}` and proves nothing. `/ready` returns **200 or 503** with `database_ready`, `redis_ready`, `redis_configured`, `python_ready`, `python_model_status`, `beta_automation_*` and the new `scheduler` heartbeat. This single call disambiguates Redis from Python from database.

### 7.3 Snapshot recovery

```sql
select max(generated_at) as newest_snapshot,
       count(*) filter (where generated_at > now() - interval '10 minutes') as last_10_min,
       count(*) filter (where is_current and valid_until > now()) as valid_current
from business_states;
```

`newest_snapshot` must advance past `2026-11-02 08:00:20 UTC` and `valid_current` must become non-zero.

### 7.4 Findings and baselines

```sql
select type, severity, count(*) from intelligence_findings group by 1, 2;
select organization_id, computed_at, revenue_avg_30d, event_rate_5m_30d
from business_state_baselines;
```

Expect **at most one** `integration_failure` finding and **at most one** baseline row on current data. More would indicate the gates were weakened; the tests in `Backend/src/tests/intelligenceFindingsProducer.test.js` and `python/tests/test_baseline_producer.py` pin them.

## 8. Outstanding user-only actions

Render is not reachable from this environment and no Render connector exists. The following require the account owner:

1. **Deploy `ab3dc7a` to the Node service and the Python service.** Confirm whether auto-deploy from `main` is enabled; if not, trigger a manual deploy. This is the gating action for every criterion below.
2. **Report the deployed commit SHA** for both services after deploy.
3. **Run `curl -s https://revluma-backend-vrsd.onrender.com/ready`** and share the JSON.
4. **Confirm the value of `BUSINESS_STATE_LOCK_TTL_SECONDS`** on the Node service if it is set at all. If it holds a non-numeric value, that alone was sufficient to cause this outage via §2.3, and it is now both sanitised and logged at error level.

## 9. Not verified / explicitly open

- **Criteria 2, 3, 4, 8, 9, 10, 11 and 13 are not yet verified in production.** All depend on the Render deploy in §8.1. Nothing here should be read as production-verified.
- **The SQLAlchemy `QueuePool` saturation observed earlier was fixed and tested in PR #245** (`size=8, overflow=4`, `timeout=30`, `recycle=300`, `pre_ping`, `use_lifo`, `reset_on_return="rollback"`, plus `GET /internal/db/diagnostics`). It has **not** been re-observed in production since, and cannot be confirmed until Python is redeployed and exercised.
- **Why `persist_investigation_context` never committed** remains open between two explanations: an older deployed commit predating the feature, or a write that threw and was swallowed at `warning` level. Render access is required to distinguish them. §4.7 makes the second self-reporting on the next deploy.
- **The 33,712 superseded `business_states` rows have not been pruned.** That is destructive and requires explicit approval; it was never requested and never performed.
- **No live acceptance run (LIVE-001…015) has been executed.**

## 10. Test coverage added

71 new tests. Python suite **754 passed, 3 skipped** (up from 715 passed at the previous merge). Backend suite **32 pass / 8 fail** locally against a baseline of **30 / 9**, where all 8 failures are the pre-existing `Cannot find module '.prisma/client/default'` caused by being unable to run `prisma generate` in this sandbox.

| File | Tests | What it pins |
|---|---|---|
| `Backend/src/tests/schedulerLocks.test.js` | 12 | Mutual exclusion, TTL crash recovery, token-matched release, outcome recording, a skip that cannot throw |
| `Backend/src/tests/redisResilience.test.js` | 10 | Retries never give up; a failed boot cannot crash the process. **Fails against the original `redis.js`** |
| `Backend/src/tests/intSetting.test.js` | 13 | The `NaN` and lenient-parse cases |
| `Backend/src/tests/intelligenceFindingsProducer.test.js` | 17 | The real aggregator and repository against fixtures, in both directions |
| `python/tests/test_baseline_producer.py` | 18 | Bounded self-gating selection; the honesty gates asserted against the SQL text |
| `python/tests/test_merchant_memory_persist.py` | 18 | Both writes commit; a memory failure no longer loses the context; error-level stage-named logging |

All 7 CI checks passed on PR #252, including *Prisma bootstrap, financial and security regressions*, which runs the Python suite against a real bootstrapped `pgvector/pgvector:pg16` schema — so the new tests pass under both database realities.
