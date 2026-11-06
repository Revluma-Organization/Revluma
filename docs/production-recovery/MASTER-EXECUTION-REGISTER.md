# REVLUMA — Production Recovery & Certification Master Register

Branch: `arena/1ccbea1c-revluma` · Started: 2026-11-06 · Owner: Revluma recovery operation
Repository: `Revluma-Organization/Revluma` · Database: Supabase project `jblpgqmbgdlzitprudgt` (eu-west-1) · Application: Vercel (Node) + Render (Python serving/scheduler)

**Standing rules.** Read-only production unless an item is explicitly authorized. Approval-gated
destructive actions never block unrelated workstreams. No success may be claimed without direct
production evidence. Where a criterion cannot be met, it is marked **BLOCKED** with the exact
dependency named. Final status vocabulary: **PRODUCTION VERIFIED** / **IMPLEMENTED, NOT PRODUCTION
VERIFIED** / **BLOCKED**.

Legend for status fields:
- Impl = implementation status in this branch
- Prod = production verification status

---

## 0. Environment identity (as observed)

| Item | Value | Evidence (2026-11-06) |
|---|---|---|
| Node build (`/ready.node_build`) | `30c428ae9f9a` (Vercel `dpl_nCKzaysZRETqoLjK5j751ixZKisA`) | direct fetch, ~08:35Z |
| Python service base commit | merged PR #302 @ `30c428a` (= current `main`) | `/ready` commit field; PR history |
| Python scheduler outcome (latest tick) | `BusinessStatePersistenceError … pid_before=1547883 …` | `automation_job_state` `business-state-build:1dc6aa19…`, 09:04:18Z |
| `business_states` table | 1005 rows, `is_current = 5`, latest `generated_at` = **2026-11-05 23:59:53+00** (frozen) | read-only SQL |
| `alert_queue` | 1896 total, **0 created in 24h** | read-only SQL |
| `stores` (active) | 4 | read-only SQL |
| `products` | 3 rows | read-only SQL |
| Retired store | `bys-user-store-923319-1ifggjsw` — **never touched** | standing constraint |

Note: an earlier estimate of "~33,000 stale business_states (R-10)" does **not** match the live
table (1005 rows); the operative defect is narrower and confirmed: the current-snapshot pipeline
has written nothing since 2026-11-05 23:59:53.

---

## P1 — Business-state persistence & scheduler recovery  ·  Impl: COMPLETE (5699c55, PR #303, merged 09:16:49Z 2026-11-06) · Prod: **PRODUCTION VERIFIED 2026-11-06 ~09:48Z**

**Requirement source:** Recovery assignment P1; standing rule "no timeout bumps, no exception
suppression, no FK bypass".

**Production failure history (evidence-backed):**

1. **2026-11-03 10:21Z** — `pg_stat_activity`: four server backends each held one statement of the
   persistence block (`set_config('lock_timeout')` idle-in-transaction · `pg_advisory_xact_lock`
   idle-in-transaction · `UPDATE business_states SET is_current=FALSE` idle-in-transaction ·
   `INSERT INTO business_states` active, `Lock/transactionid`). Lease row reported
   `QueryCanceled … inserting index tuple … idx_bstate_org_current` after 133,851 ms
   (statement_timeout 2min + read phase). Self-deadlock on the unique partial index.
2. **2026-11-06 ~07:57Z** — after the advisory-lock + single-statement-batch remedy merged
   (PR #302, `ce605c5`/`0aefd84` line) the batch FK-violated against `alert_queue`:
   statements landed on arbitrary backends, the alert INSERT could not see the snapshot INSERT,
   block rolled back, no snapshot persisted.
3. **2026-11-06 08:33Z** — post-deploy run of merged code: batched statement *returned without
   error* yet the snapshot was not visible to the very next statement
   (`diag scope_opened=True in_tx_before=True pid_before=1545467 pid_after_insert=1539098`);
   inner cause "snapshot was not verifiable after persistence." Gate fired; **no false success
   reported**; `business_states` frozen; scheduler outcome INTELLIGENCE_UNAVAILABLE.
4. **2026-11-06 09:04Z** — reproduced on the same code path (`pid_before=1547883`), i.e. the
   P1 defect is **not** an intermittent blip; it is structural.

**Root cause (confirmed):** the environment's connection pooler (Supavisor, transaction mode)
does **not** pin one server backend to one client transaction. Every client-side transaction
design — two-phase (original), advisory-lock (PR #302), single-batch (PR #302) — can silently
scatter statements across backends; uncommitted work has no reliable common fate and is dropped
when the abandoning backend is reclaimed. No multi-statement transaction semantic is dependable
here. The only reliable unit is a **single statement** (implicit transaction, atomic per backend).

**Fix implemented (commit 5699c55, merged to main via PR #303 on 2026-11-06T09:16:49Z):**

- Dedicated NullPool engine in **autocommit** mode (`REVLUMA_PERSISTENCE_DATABASE_URL` or
  `settings.DATABASE_URL`) executes every persistence statement and the diagnostic reads.
  Engine creation is lazy; falls back to caller-session+explicit commit when no URL is
  configured (hermetic local tests).
- Decomposed steps, each its own implicit transaction:
  ① INSERT snapshot `is_current = FALSE` → ② conditional baselines UPDATE →
  ③ per-alert INSERTs `ON CONFLICT (organization_id, dedupe_key) DO NOTHING` →
  ④ flip previous current → FALSE → ⑤ flip new snapshot → TRUE →
  ⑥ post-condition gate (`SELECT is_current`) → prune superseded snapshots.
- Deterministic `_rollback_quietly(db)` before persistence so read-phase transaction remnants
  cannot couple into the write path (this coupling demonstrably rolled back the `is_current`
  flip on 2026-11-06 local reproduction).
- New `_compensate_failed_build()`: deletes this attempt's `alert_queue` rows and its non-current
  snapshot after any persistence failure; each statement nested in try + `logger.exception`;
  never raises; wired into every failure branch.
- `23505` (unique partial index `idx_bstate_org_current` race) now maps to
  `BusinessStateBuildInProgress` (HTTP-409 semantics) instead of corruption.
- Dead code removed: `begin_write_scope`/`commit_write_scope` (`query.py`),
  `PERSIST_LOCK_TIMEOUT_SECONDS`, the advisory-lock + `set_config` batch,
  `critical_section_sql`. Remaining stale advisory-era comments reworded.

**Known bounded degradation (accepted, loud & self-healing):** if a build fails between steps ④
and ⑤ the organization has no `is_current` row until the next successful build;
nothing downstream can read a torn or partial snapshot (the gate refuses to succeed).

**Regression coverage (rewritten, not patched):**
`tests/test_business_state_persistence_atomicity.py` (6), `tests/test_write_scope_atomicity.py` (10,
incl. dedicated-transport, NullPool, session-fallback, compensation-never-touches-session, and the
Supavisor counterfactual model), `tests/test_business_state_persistence_lock.py` (16,
lease-TTL claim guards, release commits, cause-capture/diagnostics-first/280-char-bound contract,
finally-release). **Full python suite: 1567 passed, 1 skipped.**

**Acceptance criteria & how each was evidenced (production, post-merge deploy):**

| Criterion | Production evidence (2026-11-06) |
|---|---|
| A build exits with successful scheduler outcome | Lease rows for all 5 orgs report `outcome=rebuilt ... computation_status=complete` (e.g. 1dc6aa19 at 09:31:21, state_id `1606d755…`); Node heartbeat row `business-state` shows `status=completed`, `last_error` empty, e.g. 09:33:37 with `succeeded=1, failed=0` |
| New snapshot persisted | `business_states` rows generated 09:31:21 / 09:32:22 / 09:33:21 / 09:34:21 / 09:35:21 for 1dc6aa19, 91d88743, b186cce3, 8148cda9, 09ff67bf respectively; **all five organizations hold fresh snapshots** (pre-fix: frozen at 2026-11-05 23:59:53) |
| Exactly one current row per org | Per-org check: 1 current row each (e.g. 1dc6aa19: 1/201; verified for all five post-deploy) |
| Dependent `alert_queue` rows reference the snapshot | `revenue/medium` alert referencing `state_id=1606d755…` with `status=delivered`, dedupe_key `<state_id>:revenue`; no FK violation |
| No FK violations / no torn rows | Builds succeeded end-to-end; dependent inserts committed; gate passed on every post-deploy tick |
| Lease completes correctly | Python lease rows return to `status=idle` with `outcome=rebuilt`; Node claim row resolved `completed` (09:33:37 `succeeded=1`) |
| Subsequent scheduled runs succeed | **Two consecutive cycles covered**: 1dc6aa19 rebuilt at 09:31:21 AND again at 09:47:21; 91d88743 again at 09:48:21; 09:33 pass `succeeded=1`; `/ready` shows `failed=0` |
| Simulated failure / process interruption | Local: flip-in failure + alert-insert failure + retry-safe rebuild (suite green). Production: the 09:21:17 pass was killed mid-flight by the Node redeploy; the Postgres claim TTL (600s) expired at 09:31:17 and the scheduler self-healed at the 09:31:19 pass with zero manual intervention |

**Verdict: PRODUCTION VERIFIED** (merge commit `eaced144b33c8d612f07820ff40874122a42f5a8`; Node `node_build=eaced144b33c` at `/ready`; Vercel dashboard deployment `dpl_2vptZNY2SBSWPi1qVV768TiGh13k` READY/PROMOTED; Python service running merged #303 code as of first post-deploy tick; evidence above plus read-only SQL).

**Still open within P1 (non-blocking, documented):**

1. Node→Python rebuild HTTP call relies on axios `timeout` (default 45s); a mid-pass deploy killed the 09:21:17 pass and the heartbeat sat at `status=running` until the DB claim TTL expired (09:31:17). The system recovered unaided, but `/ready` reported a phantom "running" state for ~10 minutes. Recommend (future workstream, needs separate change): verify axios abort actually unwinds a wedged call under all conditions; consider a startup sweep that releases claims whose holder died with this signature. Not a regression from this fix; pre-existing behavior, observed live once at 09:21Z on 2026-11-06.
2. Alert coverage is anomaly-driven: only 1 new alert post-deploy (revenue, 1dc6aa19). Absence of alerts for other orgs is consistent with no anomalies above thresholds, not with a failure.

**Acceptance criteria — historical pre-merge table (kept for audit):**

**Status: PRODUCTION VERIFIED 2026-11-06 ~09:48Z.** Production evidence above.
Pre-fix prod state retained below as the baseline defect record.

### P1 post-merge deploy timeline (2026-11-06)

| Time (UTC) | Event |
|---|---|
| 09:04:55 | Commit 5699c55 (fix) |
| 09:16:49 | PR #303 merged → `eaced14`; CI all green (merge authorized) |
| 09:17:17 | Scheduler pass ran pre-deploy Node/Python (one tick raced the deploy) |
| ~09:18 | Vercel production deployment promoted (`eaced144b33c8…`) |
| 09:21:17 | Deploy-time interruption of an in-flight pass; DB claim left `running` |
| 09:23 | `/ready` shows `node_build=eaced144b33c`; scheduler still wedged by claim |
| 09:31:17 | Node claim TTL (600s) expired |
| 09:31:21 | **First post-deploy Python pass: build REBUILT org 1dc6aa19 (duration 20.3s, complete)** |
| 09:32:22–09:35:21 | All five orgs hold fresh `is_current` snapshots |
| 09:33:19–09:33:37 | Node pass completes, `succeeded=1, failed=0, last_error` empty |
| 09:47:21, 09:48:21 | Second rebuild cycle for 1dc6aa19 and 91d88743 — repeat success |

**Commits/PRs:** commit `5699c55` on `arena/1ccbea1c-revluma` → PR **#303** (MERGED 2026-11-06T09:16:49Z) → merge commit `eaced144b33c8d612f07820ff40874122a42f5a8`.

---

## P2 — Shopify product ingestion  ·  Impl: NOT STARTED · Prod: NOT VERIFIED

Requirement source: Recovery assignment P2.
Environment facts (read-only, 2026-11-06): `products` = **3 rows**; live active store under
recovery is `revluma-test-store-v1.myshopify.com`; retired store not touched.
Known risks to investigate: scope grants via `currentAppInstallation.accessScopes`;
pagination/cursor recovery; archival/deletion semantics; reconciliation vs source.
No success claim possible yet. Acceptance (source-vs-local reconciliation, or a live-API +
authorized fixture proof when the store is empty) unmet.

## P3 — Webhook registration & delivery  ·  Impl: NOT STARTED · Prod: NOT VERIFIED

Requirement source: Recovery assignment P3.
Facts gathered earlier (read-only): **27 duplicate groups**; **13 topics × 3 store records**
discrepancy; at least one domain present on >1 organization.
Constraints: do not delete registrations on suspicion; do not touch the retired store; remote
subscription modification/deletion requires explicit authorization + verified evidence (cleanup
plan to be prepared, work stays non-destructive until approved).
Acceptance unmet.

## P4 — Store identity, tenant isolation, security  ·  Impl: NOT STARTED · Prod: NOT VERIFIED

Requirement source: Recovery assignment P4.
Known identity conflict to trace: store `6340092e…` (org `09ff67bf…`) and `009e5c86…` (org
`91d88743…`) claim the same Shopify domain. OAuth install/callback flow, domain normalization,
ownership resolution, RLS and every org-scoped data path require audit. Cross-tenant tests
(A↛B, B↛A, jobs, webhooks, Rev context) unmet. Any transfer/delete/revoke of either association
requires explicit authorization — none granted; production stays read-only.
No success claim possible yet.

## P5 — Privacy / data governance / Shopify compliance  ·  Impl: NOT STARTED · Prod: NOT VERIFIED

Requirement source: Recovery assignment P5.
To verify: customer-data request/erasure/shop-erasure workflows, signature verification,
request identity + store ownership, durable request records, retry/idempotency, audit trail,
retention, RLS, DB privileges. Never ack-before-done. Protected-customer-data eligibility /
Shopify approval requirements to be named explicitly if blocking. Acceptance unmet.

## P6 — Rev intelligence live-data certification  ·  Impl: NOT STARTED · Prod: NOT VERIFIED

Requirement source: Recovery assignment P6.
To trace: Shopify → canonical → metrics → evidence → business_state → Rev; `rev-metrics-v1`
registry claim grades; live-evidence accuracy; period/currency/timezone handling; conversational
mode discipline (greeting ≠ investigation); context persistence across follow-ups; read-only MVP;
the 11-item acceptance script with actual tool-invocation counts. Acceptance unmet.

---

## Cross-cutting release gate — current standing

| Gate item | Status |
|---|---|
| Node build on intended commit | `/ready` `node_build=eaced144b33c` (PR #303 merge) |
| Python on intended build | Render serving #303 code (first healthy tick 09:31:21) |
| Persistence succeeds | **YES** (post-deploy builds 09:31–09:48Z, incl. previously failing org, twice) |
| Recurring scheduler executions succeed | **YES** (passes 09:31–09:48Z, succeeded>0, failed=0) |
| Snapshots + alerts persisted | **YES** (6 new snapshots post-deploy; 1 new alert `status=delivered`; FK intact) |
| Product sync source-reconciled | NOT DONE (P2) |
| Webhooks reliable & deduplicated | NOT DONE (P3) |
| Store identity + tenant isolation | NOT VERIFIED (P4) |
| Privacy workflows pass | NOT VERIFIED (P5) |
| Rev on live-accurate evidence | NOT VERIFIED (P6) |
| Regression/security tests pass | **YES** for python suite on this branch (1567 passed / 1 skipped, 2026-11-06) |
| Deployments verified | Node: #303 promoted (`eaced144b33c8`) and serving `/ready`; Python: healthy ticks 09:31+ (Render has no API in this environment — verified behaviorally) |
| Limitations documented | See `KNOWN-LIMITATIONS.md` |

## Approval-gated items (never block unrelated work)

1. R-10 stale business_states cleanup (earlier ~33k estimate; live table now 1005 rows — needs
   recount + explicit approval before any delete).
2. Duplicate webhook-registration cleanup (27 groups identified; plan + approval required).
3. Any remote Shopify subscription mutation.
4. Transfer/delete/revoke of either production store-domain association (P4 conflict).
5. Any production data write not covered by an authorized workflow.

## Change log

- 2026-11-06 — Register created. P1 fix implemented (5699c55) + validated locally
  (1567/1 skipped); PR #303 merged 09:16:49Z (all checks green); P1 **PRODUCTION VERIFIED**
  at ~09:48Z with direct production evidence (see P1 section). P2–P6 not started; reconnaissance
  facts above recorded as gathered, not as certified.
