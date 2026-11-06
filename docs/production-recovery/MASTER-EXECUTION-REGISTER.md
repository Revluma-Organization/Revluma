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

## P1 — Business-state persistence & scheduler recovery  ·  Impl: COMPLETE (5699c55) · Prod: NOT VERIFIED

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

**Fix implemented (branch commit 5699c55, PR pending):**

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

**Acceptance criteria & how each will be evidenced (production, post-merge deploy):**

| Criterion | Evidence to collect |
|---|---|
| A build exits with successful scheduler outcome | `automation_job_state` row, outcome=rebuilt, `last_error` empty |
| New snapshot persisted | `SELECT id, generated_at, is_current FROM business_states ORDER BY generated_at DESC LIMIT 1` |
| Exactly one current row per org | `SELECT organization_id, COUNT(*) FROM business_states WHERE is_current GROUP BY 1` |
| Dependent `alert_queue` rows reference the snapshot | join on `business_states.id` |
| No FK violations / no torn rows | build logs + `alert_queue` count delta; zero FK errors in run |
| Lease completes correctly | `automation_job_state.status` transitions `running → idle` with outcome |
| **Subsequent scheduled runs succeed** (not just one manual run) | ≥ 2 consecutive scheduler ticks with persisted snapshots |
| Simulated failure behavior | covered locally (flip-in failure, alert-insert failure, retry-safe rebuild); prod equivalent = repeated scheduled runs |

**Status: IMPLEMENTED, NOT PRODUCTION VERIFIED.** Deploy + verification pending PR merge.
Pre-fix prod state above stands as the baseline defect record.

**Commits/PRs:** commit `5699c55` on `arena/1ccbea1c-revluma`; PR pending at time of writing.

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
| Node build on intended commit | Vercel `dpl_nCKzaysZRETqoLjK5j751ixZKisA` @ `30c428ae9f9a` (pre-P1) |
| Python on intended build | Render at merged #302 (pre-P1 fix) |
| Persistence succeeds | **FAILING** (09:04Z evidence) — expected to flip with P1 deploy |
| Recurring scheduler executions succeed | **NO** (frozen since 2026-11-05 23:59:53) |
| Snapshots + alerts persisted | **NO** (0 alerts/24h) |
| Product sync source-reconciled | NOT DONE (P2) |
| Webhooks reliable & deduplicated | NOT DONE (P3) |
| Store identity + tenant isolation | NOT VERIFIED (P4) |
| Privacy workflows pass | NOT VERIFIED (P5) |
| Rev on live-accurate evidence | NOT VERIFIED (P6) |
| Regression/security tests pass | **YES** for python suite on this branch (1567 passed / 1 skipped, 2026-11-06) |
| Deployments verified | Node: prior build verified; Python: fix pending |
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
  (1567/1 skipped); prod verification pending merge+deploy. P2–P6 not started; reconnaissance
  facts above recorded as gathered, not as certified.
