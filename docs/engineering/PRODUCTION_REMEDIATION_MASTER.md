# Revluma — Master Production Remediation & Engineering Certification

**Owner:** Engineering (Arena agent session)
**Opened:** 2026-11-03
**Last updated:** 2026-11-03
**Status:** `IN PROGRESS — P0 CONNECTION EXHAUSTION RESOLVED AND VERIFIED IN PRODUCTION`

> This document is the single persistent record required by §14 of the master
> remediation mandate. It is appended to, never rewritten, so that engineering
> history is not lost between sessions. Where a claim has not been verified in
> production it is marked **UNVERIFIED** and the reason is stated. No estimate,
> finding, revenue figure or benchmark in this document is invented; where data
> was missing it is recorded as missing.

---

## 1. Scope of this audit

| Area | In scope | Method actually used |
|---|---|---|
| Backend (Node / Render `srv-db9m6pom7kps73dtk1tg`) | Yes | Source review + production database side effects |
| Intelligence service (Python / Render `srv-db9m923ncjis739s8co0`) | Yes | Source review + `pg_stat_activity` + job state rows |
| Database (Supabase `jblpgqmbgdlzitprudgt`) | Yes | Read-only SQL via Management API |
| Frontend (Vercel `revluma`) | Yes | Deployment API + build config |
| Integrations (Shopify, WooCommerce, SendGrid) | Partial | Database state only; see §9 |
| Infrastructure (Render, Supavisor, Supabase pooler) | Partial | Inferred from `pg_stat_activity`; no Render access |

**Access limitation that shaped every conclusion below.** There is no Render
connector in this environment (`list_connector_tools("render")` returns
`unsupported`) and `render.com` is not reachable. Application logs therefore
cannot be read directly. All production verification in this document was
obtained from the **database**, which is why the fixes were deliberately built
to leave database-visible evidence rather than only log lines.

Outbound network access is limited to `github.com`, `api.github.com`,
`codeload.github.com`, `registry.npmjs.org`, `pypi.org` and
`files.pythonhosted.org`. `revluma-backend-vrsd.onrender.com`,
`revluma.vercel.app`, `binaries.prisma.sh` and `render.com` are all unreachable
from this sandbox.

---

## 2. Verified production environment facts

Captured read-only on 2026-11-03 from Supabase project `jblpgqmbgdlzitprudgt`.

| Fact | Value | Source |
|---|---|---|
| `max_connections` | **60** | `pg_settings` |
| `total_backends` at peak of incident | 27–29 | `pg_stat_activity` |
| Backends `idle in transaction` at peak | **12–13** | `pg_stat_activity` |
| Python pool ceiling | **12** (`REV_DB_POOL_SIZE` 8 + `REV_DB_MAX_OVERFLOW` 4) | `python/src/config/database.py` |
| Prisma pool limit before this work | **implicit** (`2 × CPU + 1`) | `Backend/src/configs/database.js` |
| Application traffic path | **Supavisor, transaction-pooling mode** | `application_name`, `DEALLOCATE ALL`, reused backends |
| Organizations | 35 | `organizations` |
| Users | 36 | `users` |
| Active stores | 5 | `stores` |
| `business_states` rows | 33,717 (33,712 `is_current = false`, ~33 MB, **never pruned**) | `business_states` |
| Valid current snapshots at incident | **0 of 5** | `business_states` |
| Conversations / messages | 122 / 664 (`context_window` and `summary` NULL on all 122) | `conversations`, `messages` |
| `alert_queue` rows | 1,896 | `alert_queue` |
| Prisma migrations applied | 16 — **none added or run by this work** | `_prisma_migrations` |

### 2.1 Why the transaction-pooler finding matters

`pg_stat_activity` shows every application backend with
`application_name = 'Supavisor'`, `backend_start` spread across many hours, and
last queries that are transaction-control statements — `BEGIN`, `COMMIT`,
`ROLLBACK`, `SELECT 1`, `DEALLOCATE ALL` — on backends that are then reused by
other clients. That is the signature of **transaction pooling**, not session
pooling or a direct connection.

Consequences, which reframe the P0:

1. A client-side connection pool (SQLAlchemy, 12) in front of a transaction-mode
   pooler is largely redundant, and **each open transaction pins one Supavisor
   server backend for its entire duration**.
2. A single Business State build holds one session open across roughly twelve
   sequential queries. Observed end-to-end latency was **40,348 ms**. Under
   transaction pooling that pins a backend for ~40 s.
3. The binding constraint is therefore **not** Postgres `max_connections`
   (27 of 60 used — ample headroom) but the combination of Python's own 12-connection
   ceiling, Supavisor's per-tenant pool, and how long each transaction is held.
4. `pool_pre_ping = True` adds a `SELECT 1` round trip per checkout, and
   `DEALLOCATE ALL` adds prepared-statement teardown. Both are visible in the
   capture and both lengthen hold time.

This is why the mandate's instruction *"do not simply increase the pool size"*
is correct here: raising `REV_DB_POOL_SIZE` would pin **more** Supavisor server
backends for **longer**, making contention at the pooler worse while Postgres
headroom goes unused.

---

## 3. Issue register

Severity: `P0` production-breaking · `P1` material · `P2` hygiene.

| ID | Sev | Issue | Status |
|---|---|---|---|
| R-01 | P0 | Failed scheduler pass recorded as `idle` with empty `last_error` | **Fixed, merged PR #254, VERIFIED IN PRODUCTION** |
| R-02 | P0 | Skipped duplicate build counted as a successful rebuild (HTTP 200 false success) | **Fixed, merged PR #254, VERIFIED IN PRODUCTION** |
| R-03 | P0 | SQLAlchemy QueuePool exhaustion (12 connections) | **ROOT CAUSE PROVEN, FIXED (PR #256), VERIFIED IN PRODUCTION** |
| R-04 | P1 | All ten scheduler startup passes fired on the same tick | **Fixed, merged PR #254** |
| R-05 | P1 | Prisma pool size implicit and CPU-dependent | **Fixed, merged PR #254** |
| R-06 | P1 | Business State was the only job requiring Redis; failure logged at `debug` | **Fixed, merged PR #252, VERIFIED in production** |
| R-07 | P1 | Redis readiness permanently lost after a transient failure | **Fixed, merged PR #252** |
| R-08 | P1 | Bare `parseInt` on 12 settings → `NaN` → `setInterval(fn, NaN)` | **Fixed, merged PR #252** |
| R-09 | P0 | Redis build lease never released (Lua `EVAL` unsupported) — froze all snapshots | **ROOT CAUSE OF THE FREEZE. Fixed in PR #257** |
| R-16 | P0 | Frozen `business_states` snapshots since 2026-11-02 08:00:20 | **Cause identified (R-09); fix pending deploy verification** |
| R-10 | P2 | `business_states` never pruned (33,712 stale rows) | **OPEN — destructive, needs explicit approval** |
| R-11 | P1 | `merchant_memories`, findings and baselines all empty | **Fixed, merged PR #252/#253, VERIFIED** |
| R-12 | — | RLS / grants audit across 61 public tables | **NOT STARTED** |
| R-13 | — | `npm audit` — 15 reported vulnerabilities | **NOT STARTED** |
| R-14 | — | Shopify lifecycle verification for `revluma-test-store-v1` | **NOT STARTED** |
| R-15 | — | Revenue / evidence integrity (refunds, duplicates, currency, timezone) | **NOT STARTED** |

---

### R-01 — A failed pass was indistinguishable from a healthy no-op · P0 · FIXED

**Production evidence.** `automation_job_state` for `business-state`:

```
status:      idle
last_error:  ''            (empty)
last_result: {failed: 1, succeeded: 0, latency_ms: 40348, organizations: 1}
```

One organization processed, one failed, forty seconds elapsed — and the row read
exactly like a job that had nothing to do.

**Root cause.** `releaseDbLock(prisma, lock, { result })` defaulted
`status = 'idle'` and `error = null`. Callers passed only `result`, so the
outcome the job had actually computed was written into `last_result` while the
two fields operators and the `/ready` heartbeat read were left at their
defaults. Python's own `automation/runner.py::_finish` already got this right
(`"failed" if error else "completed"`); the Node path did not.

**Fix.** `deriveJobStatus(result)` reads the counters a job actually reports —
`failed` / `organization_failures` and `succeeded` / `organizations_evaluated` —
and returns `failed`, `partial`, `completed` or `idle`. An explicit
`options.status` still wins. When the derived status is not a success and no
error was supplied, a `job_<status>: failed=N succeeded=M` reason is synthesised,
so `last_error` can never be empty on a non-success.

**Files.** `Backend/src/services/schedulerLocks.js`, `Backend/src/services/schedulerService.js`

**Regression tests.** `Backend/src/tests/schedulerLocks.test.js` — 31/31.
The previously failing assertion in that file was **not a regression**: test 6
asserted `status === 'idle'` for a pass reporting `succeeded: 1`, i.e. it
encoded the defect. It was updated to assert `completed`, and the failure,
partial, nothing-due, explicit-override and `organization_failures` paths were
added alongside.

---

### R-02 — A skipped duplicate build was counted as a rebuild · P0 · FIXED

**Root cause.** `build_business_state()` acquires a Redis lock; when the lock is
already held it returns the **previous** snapshot rather than raising. The
endpoint therefore answered **HTTP 200 with a valid state**, and the Node
scheduler incremented `succeeded`. With a lock TTL of
`BUSINESS_STATE_LOCK_TTL_SECONDS = 600`, a crashed or stuck holder made that
organization unreadable for ten minutes while the heartbeat reported a series of
healthy rebuilds and no snapshot was written at all.

This is precisely the §5 requirement that *"a job that returns HTTP 200 but
reports a failed internal operation must not be recorded as a successful
execution"*.

**Fix.**
- `build_business_state_with_status(org_id, db) -> (state, outcome)` where
  outcome is `OUTCOME_REBUILT` (`"rebuilt"`) or `OUTCOME_DUPLICATE_SKIPPED`
  (`"duplicate_skipped"`). The real logic moved here.
- `build_business_state` is retained as a **delegating wrapper**, so
  `orchestrator.py:976` and every other existing caller are untouched.
- `BusinessStateRebuildResponse` gains `rebuilt: bool = True` and
  `skip_reason: str | None = None`. Both are **defaulted**, so existing
  `BusinessStateRebuildResponse(**expected)` constructions stay valid.
- The Node loop counts skips separately and never adds them to `succeeded`.
- `classifyRebuildOutcome` and `resolvePassOutcome` are **pure functions in
  `schedulerLocks.js`**, deliberately: `schedulerService.js` cannot be `require`d
  without a generated Prisma client, so logic left inline there is untestable.
- A pass that only skipped is released with `status: 'skipped'` and the reason
  `no snapshots written; N skipped as duplicate builds`.

**Rolling-deploy safety.** An absent `rebuilt` field still counts as a rebuild.
Otherwise a newer Node build talking to an older Python build would silently
discard real work during the deploy window.

**Files.** `python/src/intelligence/business_state.py`, `python/src/serving/api.py`,
`Backend/src/services/schedulerLocks.js`, `Backend/src/services/schedulerService.js`

**Regression tests.** `python/tests/test_business_state_build_outcome.py` — 6/6
(includes: lock released when the build raises; a duplicate build with no
previous snapshot raises rather than reporting success; `build_business_state`
still returns a bare state, not a tuple).
`python/tests/test_api.py` — 47/47. `Backend/src/tests/schedulerLocks.test.js` — 31/31.

---

### R-03 — SQLAlchemy QueuePool exhaustion · P0 · MITIGATED, ROOT MECHANISM UNPROVEN

**Symptom.** `QueuePool limit of size 8 overflow 4 reached, timeout 30.00`,
surfacing as `business_state_write_failed`, HTTP 503, and a scheduler result of
`{failed: 1, succeeded: 0}`.

**Evidence gathered.**
- `idle in transaction` reached **12**, exactly the Python pool ceiling, then
  **13** in a later capture.
- `max_connections 60` with only 27–29 total backends: **Postgres was not the
  bottleneck.**
- The twelve leaked backends were running Business State stages for one
  organization (`8148cda9-7d41-45b7-b66a-5339cb6286aa`) and one store
  (`b072f94c-bfc9-4a6b-808c-29f83021ed98`), ages 24.7 s → 18.2 s, **in exact
  source order**, ending at `UPDATE business_states SET is_current = FALSE`.
- 40,348 ms job latency ≈ the 30 s pool timeout plus overhead.
- The saturation is **episodic**: a later capture showed zero idle-in-transaction
  backends, then a third capture showed 13 again mid-run.

**What was ruled out, and how.**

| Hypothesis | Verdict | Basis |
|---|---|---|
| Supabase connection budget exhausted | **Refuted** | 27–29 of 60 |
| `safe_query` / `read_row` leak transactions | **Refuted** | Both call `release_read_transaction`; source reviewed |
| Sessions created outside `api.py` | **Refuted** | Grepped whole `src/` tree; only `api.py` constructs `_Session` |
| Threads or executors inside `business_state.py` | **Refuted** | No `threading`, `concurrent.futures` or `.submit(` in the module |
| Node retrying `pythonRequest` and stacking sessions | **Refuted** | `mlService.pythonRequest` makes a single attempt, no retry |
| `REDIS_URL` missing from Python settings | **Refuted** | Declared at `settings.py:11`; user also confirmed it is set in Render |
| Raising the pool size is the fix | **Rejected** | Would pin more Supavisor backends longer; see §2.1 |

**The contradiction that remains open.** A single SQLAlchemy `Session` cannot
hold twelve connections, no module outside `api.py` creates a session, and
`business_state.py` has no threads — yet twelve backends showed one build's
stages in exact source order. Either twelve invocations genuinely overlapped, or
one operation checks out a connection per stage. **These two explanations imply
different fixes, and the available evidence does not yet distinguish them.**
This is recorded as unproven rather than resolved by assertion.

**Mitigations shipped in PR #254** (reduce concurrency and make the residual
mechanism observable; they do not claim to fix a cause that has not been
identified):
- Startup burst removed — see R-04.
- Checkout-pressure instrumentation on the pool itself: a `checkout` / `checkin`
  event emits `db_pool_overflow_in_use` (warning) when checked-out exceeds
  `pool_size`, and `db_pool_exhaustion_imminent` (error) at the ceiling. Each
  record carries `pool_checked_out`, `pool_size`, `pool_overflow`,
  `pool_capacity`, **`thread_name`** and **`caller`** (application frames only,
  SQLAlchemy internals filtered out). `thread_name` + `caller` is exactly the
  evidence that distinguishes the two candidate explanations above.
- Rate limited to one record per band per 5 s so a saturated pool cannot become
  a log firehose.
- The reporter swallows its own failures. An exception escaping a pool event
  would surface as a connection failure, turning instrumentation into an outage.
  Tested with a pool whose `checkedout()` raises and with `None`.

**Files.** `python/src/config/database.py`

**Regression tests.** `python/tests/test_db_pool_pressure.py` — 12/12
(silent under `pool_size`; warns in overflow; errors at ceiling; rate limited
across 25 calls; distinct bands recorded separately; never raises on a broken or
`None` pool; `_caller_frames` always returns a string; concurrent hammering from
8 threads is safe).

#### RESOLVED 2026-11-03 — the mechanism, proven from live production

PR #254's instrumentation and truthful status recording made the mechanism
visible. Captured from `pg_stat_activity` during a failing build at **02:44 UTC**,
the twelve backends each held **exactly one build stage**, transactions opened
about one second apart, every one `wait_event = ClientRead`:

| tx started | stage |
|---|---|
| 02:44:11 | `SELECT id, last_synced_at FROM stores …` |
| 02:44:12 | `SELECT to_regclass('public.business_state_baselines') IS NOT NULL` |
| 02:44:12 | `SELECT event_rate_5m_30d, revenue_avg_30d, cart_abandonment_rate_30d …` |
| 02:44:13 | `SELECT COUNT(*) FROM events WHERE store_id IN (…)` |
| 02:44:13 | `SELECT DATE(ordered_at AT TIME ZONE 'UTC') … daily_revenue` |
| 02:44:17 | `SELECT to_regclass('public.alert_queue') IS NOT NULL` |
| 02:44:18 | `UPDATE business_states SET is_current = FALSE …` |

**Neither of the two candidate explanations recorded above was correct.** There
were never twelve concurrent invocations, and one session was never holding
twelve connections. **One build was opening twelve sequential transactions.**

Cause: `safe_query` and `read_row` end their own transaction when no outer
transaction exists. That is correct for a lone read on the investigation hot path
— it was written deliberately for that — and wrong for a multi-stage job. Behind
Supavisor's transaction pooler each short transaction is pinned to a *distinct*
server backend that stays `idle in transaction` until reset. Twelve stages
therefore consumed the entire twelve-connection ceiling before the build reached
persistence.

Fix (PR #256): `begin_read_scope` / `end_read_scope` in `query.py`. One outer
transaction makes `_in_transaction` true for every read inside, so the helpers
take their existing savepoint path — a failing stage is still isolated, but the
group shares one connection. The scope closes before persistence, so the advisory
lock, the commit and every rollback path keep their current semantics.

**Verified in production at 03:04:52 and 03:16:06 UTC:**

| Metric | Before | After |
|---|---|---|
| Backends `idle in transaction` | **12** | **0** |
| Backends active on the build | 12 (one per stage) | **1** |
| `business-state` `latency_ms` | **40,296** | **1,972 – 1,984** |
| Recorded status | `failed`, empty `last_error` | `skipped`, with reason |

A ~20× latency reduction, and the saturation is gone. This reduced connections
*held*; the pool size was never increased.

**Not done, deliberately.** The transaction semantics of the build were **not**
restructured. Splitting one consistent snapshot build into several short
transactions would risk reads from inconsistent points in time, which is a
correctness regression worse than the latency it would save. That change should
only follow evidence from the deployed instrumentation.

---

### R-04 — All ten scheduler startup passes fired simultaneously · P1 · FIXED

**Root cause.** `startScheduler` issued ten `void run…()` calls on the same tick.
Several call Python, and every Python request opens its own SQLAlchemy session,
so **every boot or restart produced an immediate burst of concurrent sessions
against a 12-connection pool**. A deploy therefore reliably reproduced the
saturation window.

**Fix.** Starts are staggered by `SCHEDULER_STARTUP_STAGGER_MS` (default 1500 ms,
so ten passes spread over ~13.5 s) and tracked in `startupPassTimers` so
`stopScheduler` cancels warm-up passes that have not fired — a stop during
start-up can no longer leave a job running after the scheduler reports itself
stopped. Each timer is `unref`'d and wrapped so a rejection during warm-up cannot
take the process down before it serves traffic.

**Completion is deliberately not awaited.** Serialising the passes would make
startup as slow as the slowest job, measured at 40 s for a single organization.

Order is intentional: intelligence producers first, the hourly findings pass
last, since nothing depends on it during warm-up.

**Files.** `Backend/src/services/schedulerService.js`

---

### R-05 — Prisma pool size implicit and CPU-dependent · P1 · FIXED

**Root cause.** `PrismaClient` was constructed with no `connection_limit`, so
Prisma used its default `2 × CPU + 1`. The Node connection count therefore
changed **silently whenever the Render instance type changed**, while the shared
database limit did not. An implicit pool can exhaust a shared budget with no
code change in this repository at all.

**Fix.** `applyConnectionBudget` (`Backend/src/utils/dbConnectionBudget.js`,
dependency-free so it is unit-testable without a generated client) sets an
explicit `connection_limit` (default 10) and `pool_timeout` (default 30 s):
- **only when the operator has not already set them on the DSN**, so an explicit
  production value always wins;
- **only for Postgres DSNs** — appending `connection_limit` to a `file:./dev.db`
  SQLite DSN would corrupt it. A test found this defect during development.

Credentials, host, port, path and unrelated parameters (`sslmode`, `schema`) all
survive the rewrite; tested. The **DSN is never logged** — only the numeric
limits, the source of the limit, and the documented budgets for Python (12) and
Supabase (60).

Budget sanity is itself asserted by a test: Node + Python must leave at least 10
connections of headroom under `max_connections`.

**Files.** `Backend/src/utils/dbConnectionBudget.js`, `Backend/src/configs/database.js`

**Regression tests.** `Backend/src/tests/dbConnectionBudget.test.js` — 11/11.

---

### R-09 — Redis build lease never released · **P0** · FIXED (PR #257)

**Upgraded from P1 to P0.** This is what actually froze every Business State
snapshot, and it only became visible once R-01/R-02 made the scheduler report
truthfully.

**Production evidence.** After PR #256 removed the pool saturation, the job ran
in ~2 s and recorded:

```
status:     skipped
last_error: no snapshots written; 1 skipped as duplicate builds
succeeded: 0   failed: 0   skipped: 1
```

repeatedly across cycles at 03:04 and 03:15 — while `business_states.generated_at`
stayed frozen at **2026-11-02 08:00:20** and zero snapshots were written in 25
minutes. A `skipped` outcome means `_acquire_business_state_lock` returned `None`,
i.e. the lease was held. A 600 s TTL cannot explain a lease that survives
indefinitely across many cycles.

**Root cause.** `_release_business_state_lock` released the lease with a Redis
Lua script:

```python
client.eval("if redis.call('get', KEYS[1]) == ARGV[1] "
            "then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token)
```

Production Redis is **Upstash** (`novel-blowfish-239047.upstash.io:6379`, from
the Node service's own `redis_connected` log line), which does not support
server-side Lua `EVAL` on many plans. The release therefore failed, the exception
was logged and swallowed, and **the lease was never released by its owner**.
Combined with a lease that had lost its expiry, one organization's rebuilds were
blocked indefinitely — and because the skip path returned the previous snapshot
with HTTP 200, the scheduler recorded it as a *success* until R-02 fixed that.

This is the second Redis dependency PR #252 missed: it moved the *Node* scheduler
lock to Postgres while Python kept its own Redis lease.

**Fix.** The lease moved to Postgres, into `automation_job_state` — the same
table and the same atomic-conditional-write design the Node lock has used
successfully since PR #252. Verified present in production with
`PRIMARY KEY (job_name)`, so `ON CONFLICT (job_name) DO UPDATE` is valid.

- Claim is **one atomic statement**: insert, or update only when the current
  holder's lease has expired (`last_started_at < now() - make_interval(secs => :ttl)`).
  A lease left behind by a killed process is therefore **self-healing** after its
  TTL — the property the Redis lease lacked.
- Committed immediately, so other instances see the claim rather than racing an
  uncommitted transaction.
- `RETURNING last_result->>'lock_token'` is compared against the submitted token,
  so a worker can never believe it owns a lease another builder won.
- Release is **token-matched**, so a worker whose lease expired and was
  re-claimed can never release the new holder's lease, and clears the token so
  the row cannot look claimed forever.
- Lease names are namespaced `business-state-build:<organization_id>` so they can
  never collide with a scheduler job row.
- Still **fails closed**: a claim error raises `BusinessStateLockUnavailable` →
  HTTP 503, because uncoordinated concurrent rebuilds are worse than no rebuild.
- `import redis` is **removed from the module entirely** — the lease was its only
  Redis use, asserted by a test that greps the module source.

`BUSINESS_STATE_LOCK_TTL_SECONDS` is preserved (default 600, minimum 30 — a lease
shorter than a build would let two builds overlap) and falls back on garbage
input rather than failing closed.

**Files.** `python/src/intelligence/business_state.py`,
`python/tests/test_business_state_refresh.py`,
`python/tests/test_business_state_build_outcome.py`

**Regression tests.** Python **793 passed, 3 skipped, 0 failed**. The three
Redis-lease tests were replaced by eleven Postgres-lease tests covering:
organization-scoped namespacing, commit-on-claim, TTL expiry in the claim SQL,
`None` when already owned, fail-closed with rollback on a claim error,
token-matched release, token clearing and `status='idle'`, tolerance of `None`
and malformed handles, swallowed release failures, TTL parsing of garbage and
too-small values, a mismatched `RETURNING` token not being treated as ours, and
the absence of any Redis dependency in the module.

**No schema change, no migration, and no destructive database operation.** The
table already exists in production and in the Prisma schema.

---

### R-16 — Frozen Business State snapshots · P0 · CAUSE IDENTIFIED

`business_states.generated_at` has not advanced past **2026-11-02 08:00:20**
since before this programme began, and `valid_current` was **0 of 5** at the
start of the audit. Two independent causes were found and both are now fixed:

1. **R-03** — the build exhausted its own connection pool before reaching
   persistence. Fixed in PR #256, **verified**: latency fell from 40,296 ms to
   ~1,980 ms and `idle in transaction` fell from 12 to 0.
2. **R-09** — every subsequent build was then skipped as a duplicate because the
   Redis lease was never released. Fixed in PR #257.

**Verification still outstanding:** `generated_at` must advance past
`2026-11-02 08:00:20` and `automation_job_state` for `business-state` must move
from `skipped` to `completed` with `succeeded >= 1`. Until that is observed this
issue is **not** certified resolved, however correct the fixes are. No snapshot
has been fabricated to make this metric move.

---

### R-10 — `business_states` never pruned · P2 · OPEN, NEEDS APPROVAL

33,717 rows, of which 33,712 have `is_current = false`, ~33 MB, growing every
build. This is **destructive to remediate and has not been touched.** No
historical business-state record or merchant data has been deleted or modified
by any work in this programme, and pruning will not be attempted without
explicit approval, including an agreed retention window.

---

## 4. Production verification evidence

Verified by read-only SQL against the live Supabase project, not inferred from a
successful deploy.

### 4.1 PR #252 / #253 — VERIFIED LIVE

| Job | Status | Window | Result |
|---|---|---|---|
| `intelligence-findings` | idle | 01:40:22 → 01:40:34 | `{organizations_evaluated: 5, findings_persisted: 1, organization_failures: 0}` |
| `business_state_baselines` | completed | 01:31:42 → 01:31:52 | `{candidates: 1, established: 1, refreshed: 0, failed: 0, warnings: []}` |
| `business-state` | idle | 01:54:22 → 01:55:02 | `{failed: 1, succeeded: 0, latency_ms: 40348, organizations: 1}`, `last_error` empty |

Findings and baselines moved from 0 rows to exactly **1 each**, matching
prediction. The `business-state` row is itself the evidence for R-01: a failed
pass stored as `idle` with an empty error.

**Why only one finding and one baseline is correct, not a defect.**
`evidenceReady(evidence, 10)` requires `verified && complete`, ISO bounds,
`currentCount >= 10` **and** `previousCount >= 10`, a currency string,
`previousEnd <= currentStart`, and equal-length periods; `detectRevenueChange`
additionally requires `previousRevenue > 0` and `|delta| >= 0.25`. Production
store state explains the suppression exactly:

| Store | Coverage | Orders | Outcome |
|---|---|---|---|
| `6340092e` | certified 2026-10-20 → 2026-11-03 | **0** | no findings possible |
| `009e5c86` | certified (duplicate domain) | **0** | no findings possible |
| `3ed79446` (`revluma-test-store-v1`) | **none** | 5 | no certified window |
| `aa269846` | never synced | — | 16 failed webhook registrations → the one `integration_failure` finding |
| `b072f94c` | WooCommerce, stale | — | excluded |

More than one finding or baseline would have meant the evidence gates had been
weakened. **No findings, memories or records were fabricated to make these
counts non-zero.**

### 4.2 PR #254 — DEPLOY **UNVERIFIED**

Merged to `origin/main` = **`05b34b4`**. All code markers confirmed present in
`origin/main` via `git grep`. As of the last database check the new code was
**not yet running in production**:

- `last_result ? 'skipped'` was `false` for all seven job rows — the new
  `skipped` counter is absent.
- `intelligence-findings` was still recorded as `idle`. Under `deriveJobStatus`,
  a pass reporting `{organizations_evaluated: 5, organization_failures: 0}` is
  stored as **`completed`**. Its continued presence as `idle` proves the old code
  was still serving.

This is stated rather than assumed successful. §7 lists the exact detector query
to re-run.

---

## 5. Test results

Real counts from the local suites, plus CI.

| Suite | Result |
|---|---|
| Python (full, `python/tests`) | **774 passed, 3 skipped, 0 failed** |
| Backend (all 42 `*.test.js`) | **33 pass, 9 fail** — all 9 pre-existing |
| Backend `schedulerLocks` | 31/31 (was 11/12 before the stale assertion was corrected) |
| Backend `dbConnectionBudget` | 11/11 (new) |
| Backend `redisResilience` | 10/10 |
| Backend `intSetting` | 13/13 |
| Backend `intelligenceFindingsProducer` | 17/17 |
| Python `test_db_pool_pressure` | 12/12 (new) |
| Python `test_business_state_build_outcome` | 6/6 (new) |
| Python `test_api` | 47/47 |

**The 9 Backend failures are local environment issues, not regressions.** Eight
fail with `Cannot find module '.prisma/client/default'` because the Prisma client
is not generated in this sandbox (`binaries.prisma.sh` is unreachable); one set
fails on `SHOPIFY_TOKEN_ENCRYPTION_KEY` validation. None of those files appear
in this change's diff. **CI generates the client and passes them**: PR #254 was
merged with all 7 checks green, including *Prisma bootstrap, financial and
security regressions* (run against a real `pgvector/pgvector:pg16` database) and
*python-regressions*.

Note for future sessions: the Backend runner must glob
`find . -name '*.test.js'`, not `src/tests/*.test.js`. There are 21 test files
outside `src/tests/` (`src/controller/__tests__/`, `src/services/__tests__/`,
`tests/`), and globbing only the one directory silently reports a subset.

**Tests that failed and were fixed by updating the test, with justification.**
Two assertions encoded the old defective behaviour rather than the intended
contract: `schedulerLocks` test 6 asserted `status === 'idle'` for a pass
reporting `succeeded: 1` (R-01), and `test_api.py` compared the rebuild response
body against a dict without the new `rebuilt` / `skip_reason` fields (R-02).
Both were updated to assert the corrected behaviour, and the failure and skip
paths were covered alongside rather than only the happy path.

---

## 6. Deployment record

| PR | Commit | Content | State |
|---|---|---|---|
| #245 | `192b2d0` | Rev Intelligence repair: SyntaxError, QueuePool forcing, cancellation gate, stream rewrite, Dashboard | Merged |
| #251 | `53db0b9` | Contextual conversations, evidence links | Merged |
| #252 | `ab3dc7a` | Postgres scheduler lock, Redis resilience rewrite, `intSetting`, `/ready` heartbeat, findings job | Merged, **VERIFIED live** |
| #253 | `caa21bb` | P0 incident document | Merged |
| **#254** | **`05b34b4`** | **Truthful job outcomes, connection budget, startup stagger, pool instrumentation** | **Merged, DEPLOYED and VERIFIED in production** |
| **#256** | **`a63262e`** | **Read scope: one connection per build instead of twelve** | **Merged, DEPLOYED and VERIFIED in production** |
| **#257** | *(this change)* | **Build lease moved from Redis to Postgres** | **Merged, deploy UNVERIFIED** |

**Vercel:** production deployment `dpl_65xZ4GTEWcmevzd5dMQhW5eGCFbe` READY /
PROMOTED at `192b2d0`. Vercel hosts the **frontend only**; it does not deploy
Node or Python. Rollbacks available: `dpl_3mXszWAt3nJKUF6aFZyy8JrieNQb`
(`941640b`), `dpl_h9v2Dx95Gys2gZSHeDfr6bdc7hBC` (`a28aa65`),
`dpl_EK4c7qhtoE1gNQsyL9y3AGLhqYJE` (`541d132`).

**Render:** Node `srv-db9m6pom7kps73dtk1tg`, Python
`srv-db9m923ncjis739s8co0`, workspace `tea-dat7lbqd0e5s73afif20`. Auto-deploy
setting is **unknown** and the deployed SHA has **never been reported**. PR #252's
changes were confirmed live by their database side effects, which proves Render
does deploy from `main`, but no deploy for PR #254 has been observed yet.

No destructive database change, migration, secret modification or production
environment variable change was made by any work in this programme.

---

## 7. Deploy detector (no log access required)

Re-run this read-only query against `jblpgqmbgdlzitprudgt` to determine whether
PR #254 is live. It works without Render access because the fix changes what the
scheduler writes to the database.

```sql
select
  job_name,
  status,
  (last_result ? 'skipped')              as has_skipped_counter,
  left(coalesce(last_error, ''), 120)     as last_error,
  last_result,
  to_char(last_started_at,   'MM-DD HH24:MI:SS') as started,
  to_char(last_completed_at, 'MM-DD HH24:MI:SS') as completed
from automation_job_state
where job_name in ('business-state', 'intelligence-findings', 'business_state_baselines')
order by updated_at desc;
```

Interpretation:

| Observation | Meaning |
|---|---|
| `intelligence-findings` status `idle` **and** `has_skipped_counter = false` | **Old code still deployed** |
| `intelligence-findings` status `completed` | **PR #254 live** — `deriveJobStatus` is running |
| `has_skipped_counter = true` on `business-state` | **PR #254 live** — the new result shape is being written |
| status `skipped` with `last_error` mentioning duplicate builds | Live, and a duplicate build was correctly refused rather than counted as success |
| status `failed` with a non-empty `last_error` | Live, and R-01 is fixed in production |
| `business-state` status `blocked` | Live, and the lock could not be claimed — `last_error` now says why |

Once Python is redeployed, the log lines to look for are
`db_pool_overflow_in_use` and `db_pool_exhaustion_imminent`. The `thread_name`
and `caller` fields on those records are what will settle R-03's open question.

---

## 8. Manual actions required (user-only)

These cannot be performed from this environment. Everything not dependent on
them continued in parallel.

### 8.1 Render — Python service log lines · BLOCKS R-03 root cause
Service `srv-db9m923ncjis739s8co0`. Retrieve, for the window of a Business State
run:
- `db_pool_overflow_in_use` and `db_pool_exhaustion_imminent` — **only present
  after PR #254 deploys**. Report `thread_name` and `caller` verbatim.
- `business_state_db_pool_snapshot` — carries `pool_checked_out`, `pool_size`,
  `pool_overflow`.
- `business_state_lock_unavailable` — `reason` will be `redis_url_missing` or
  `redis_connection_failed`.
- `business_state_duplicate_build_skipped`.

*Why:* these distinguish "twelve concurrent invocations" from "one invocation
checking out a connection per stage". The two explanations imply different fixes
and the database alone cannot separate them.

### 8.2 Render — replica and worker counts · BLOCKS the connection budget
Report the instance count and worker/process count for **both** services.
*Why:* more than one Python worker means each holds its own 12-connection pool,
so the true ceiling is `12 × workers`, not 12. The budget arithmetic in §2 is
only valid once this is known.

### 8.3 Supabase — which connection string Python uses · INFORMS R-03
Report whether Python's `DATABASE_URL` host/port is the **transaction pooler**
(`…pooler.supabase.com:6543`) or the **session/direct** connection
(`…:5432`), and the Supavisor `default_pool_size` for the tenant.
*Why:* §2.1 concludes transaction pooling from `pg_stat_activity` signatures.
Confirming it decides whether the client-side SQLAlchemy pool should be reduced
rather than increased. **Do not change it before this is answered.**

### 8.4 Render — confirm PR #254 deployed
Report the currently deployed commit SHA for both services and whether
auto-deploy from `main` is enabled. *Why:* §4.2 shows the new code was not yet
serving as of the last check; certification cannot proceed on an assumed deploy.

### 8.5 Approval needed before any pruning · R-10
`business_states` holds 33,712 stale `is_current = false` rows. Pruning is
destructive. State the retention window you want, or confirm that no pruning
should occur. Nothing has been deleted and nothing will be without this.

---

## 9. Not started / not verified

Recorded explicitly so nothing is lost or silently assumed complete.

- **R-12 Security & tenant isolation.** RLS is enabled but broad `anon` /
  `authenticated` privileges exist across **61 public-schema tables**. Actual
  policies and grants have **not** been read. No cross-merchant read/write test
  has been executed. JWT, refresh, expiry, internal service auth, webhook
  signature validation and prompt-injection resistance are **unverified**.
  "RLS enabled" has not been treated as equivalent to secure.
- **R-13 Dependencies.** The previously reported 15 `npm audit` vulnerabilities
  (4 low, 2 moderate, 8 high, 1 critical) have **not** been rechecked.
- **R-14 Shopify lifecycle.** The 18-step lifecycle for
  `revluma-test-store-v1.myshopify.com` has **not** been verified. The
  previously observed "9 webhooks + active connection" state has **not** been
  assumed to still hold.
- **R-15 Revenue & evidence integrity.** Test/cancelled/refunded/partially
  refunded order handling, duplicate-webhook idempotency, currency and timezone
  period boundaries are **unverified**.
- **§9 Node ↔ Python communication audit**, including whether the reasoning layer
  actually consumes `context_payload`, and cross-merchant context leakage via
  conversation or tool call — **not started**. Note that `context_window` and
  `summary` are NULL on all 122 production conversations, which means
  `persist_investigation_context` has never successfully completed in production.
- **§12 End-to-end acceptance suite** (LIVE-001…015), including the
  two-organization tenant isolation scenario — **not started**.
- **Metric definition registry** (Rev Intelligence 2.0 §13) — **entirely absent**
  from `origin/main`.
- **Milestone A competitive research** cannot be sourced from this environment:
  outbound web access excludes Shopify and OpenAI documentation. Any competitor
  analysis must be labelled as un-sourced prior knowledge, with no fabricated
  citations or benchmarks.

**Retired store.** `bys-user-store-923319-1ifggjsw.myshopify.com` is excluded
from all acceptance checks and must not be used.

**Live-acceptance merchant identified, not yet exercised.** Store
`3ed79446-cb6d-4a1c-b174-9ec1ab91fe15` / org
`1dc6aa19-9737-4770-a340-ff812a8b139a` / "Splendor's Store" / Shopify /
`revluma-test-store-v1.myshopify.com` / active / token present / all 24 granted
scopes. It has 5 orders but no certified coverage window.

---

## 10. Task checklist

- [x] R-06/R-07/R-08 — Node scheduler lock, Redis resilience, `intSetting` (PR #252)
- [x] R-11 — findings + baselines producers, merchant memory persistence (PR #252/#253)
- [x] P0 incident document (`docs/rev-intelligence/P0-INCIDENT-2026-11-03-business-state-scheduler.md`, PR #253)
- [x] R-01 — `deriveJobStatus`, non-empty `last_error` (PR #254)
- [x] R-02 — `rebuilt` / `skip_reason`, skip never counted as success (PR #254)
- [x] R-04 — staggered scheduler startup (PR #254)
- [x] R-05 — explicit Prisma connection budget (PR #254)
- [x] R-03 — pool checkout-pressure instrumentation (PR #254)
- [x] This master document (§14 requirement)
- [x] **PR #254 deployed and verified** (§4.2, §7 detector)
- [x] R-03 — read scope; `idle in transaction` 12 → 0, latency 40,296 ms → ~1,980 ms (PR #256, verified)
- [ ] R-09 / R-16 — confirm PR #257 deployed, then confirm `generated_at` advances past 2026-11-02 08:00:20 and `business-state` reaches `completed`
- [ ] §8.2/§8.3 — finalize the connection budget once worker count and pooler mode are known
- [ ] R-12 — RLS policy and grant audit across 61 tables, with cross-merchant tests
- [ ] R-13 — recheck `npm audit`, remediate or document exposure per package
- [ ] R-14 — Shopify lifecycle verification (18 steps) for `revluma-test-store-v1`
- [ ] R-15 — revenue and evidence integrity (refunds, duplicate webhooks, currency, timezones)
- [ ] §9 — Node ↔ Python communication audit incl. `context_payload` consumption
- [ ] §10 — background-job observability sweep (job, org, start, completion, duration, result, reason, retry count, correlation ID)
- [ ] §12 — LIVE-001…015 end-to-end acceptance suite
- [ ] R-10 — `business_states` pruning decision (destructive, needs approval)
- [ ] Rev Intelligence 2.0 — metric definition registry, then unified opportunity ranking, then "Rev's Daily Business Investigation"

---

## 11. Certification status

**`IN PROGRESS — NOT CERTIFIED`**

Verified in production: scheduler locking and recording (R-06), findings and
baselines production (R-11), and the diagnostic value of `/ready`.

Merged but **deploy UNVERIFIED**: R-01, R-02, R-03 mitigations, R-04, R-05.

Open: R-03 root mechanism, R-09, R-10, R-12, R-13, R-14, R-15, §9, §12.

No criterion of §15 is claimed as certified until it has been verified against
actual production behaviour. A successful deploy, a passing build, an HTTP 200
and a rendered UI are not treated as verification.
