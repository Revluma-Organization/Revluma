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

Throughout this section: full detail lives in `P2-P6-PRODUCTION-REPORT.md` (same directory).

## P2 — Shopify product ingestion  ·  Impl: IMPLEMENTED (reconciliation-tested) · Prod: NOT VERIFIED

Path A (live source via the authorized installation) was executed as far as this environment
reaches: Vercel exposes only frontend env (no backend secrets — nothing decrypted, nothing
transmitted); the authorized installation proves itself in production (`last_synced_at` advanced
today for v1 and both conflict-pair stores; v1 records `read_products` from OAuth) but no
authenticated remote catalogue read was possible from here. "0 rows in DB" remains an inference,
NOT a source-verified reconciliation.

Path B (sync-path verification) is DONE and fixture-verified: new
`shopifyProductSync.reconciliation.test.js` (7/7 — 120-product/3-page persistence with exact
decimals and zero duplicates; idempotent re-sync; `created_at` preserved; status mapping for
ACTIVE/ARCHIVED/DRAFT/UNLISTED; 150-variant nested expansion before persistence; loud failure on
malformed nodes; empty source = zero-write; source-absent rows pinned as the approval-gated gap).
`shopifyProductSync.test.js` 8/8; `shopifyWebhookDrift.test.js` 5/5.

**Production facts:** all Shopify stores hold 0 product rows (3 rows total, WooCommerce, stale
2026-08-13). Inventory module exists but is deliberately unwired (quantities stay null, not
invented). Deletion of source-absent rows: NOT IMPLEMENTED (approval-gated, item 9).

**Classification: IMPLEMENTED, NOT PRODUCTION VERIFIED.** Close with: authorized live reconciliation
of v1 + one create→sync→update→delete round-trip (founder/user action).

## P3 — Webhook registration & delivery  ·  Impl: IMPLEMENTED (+drift tooling) · Prod: NOT VERIFIED

Inventory (read-only prod 2026-11-06): required set = **12 topics** (`shopifyWebhookTopics.js`,
pure module). Registrations (82 rows): v1 + `6340092e…` hold **2 active × 9 topics** (split across
legacy/current backend hosts — exact-URI matching never matched legacy subscriptions); `009e5c86…`
1 active × 9; retired store 8 failed pairs + APP_UNINSTALLED ×2; **PRODUCTS_CREATE/UPDATE/DELETE:
zero rows anywhere** (products subscribe only at install/reinstall; background sync runs
`reconcileWebhooks:false` by design). 27 duplicate groups confirmed. Deliveries (197 rows, all
`processed`): latest 2026-10-30 08:00Z; **0 in 7 days** — idle vs dead subscriptions
indistinguishable from here.

Verified: HMAC-SHA256 raw-body signature (401 pre-processing), claim-before-process with P2002
identity checks, retry-once on failed delivery, never-ack-early, 200 only post-success.
`shopifyWebhookDeliverySafety.test.js` 3/3; privacy workflow 6/6; drift analysis 5/5.

**NEW: `scripts/shopifyWebhookDriftReport.js`** — operator-run, READ-ONLY remote drift report
(live subscriptions via the authorized installation vs REQUIRED_SUBSCRIPTIONS; missing / unexpected /
duplicates-with-counts / legacy URLs; exit 1 on drift). Run it per store before any remediation.
It mutates nothing, anywhere.

**Approval-gated (exact proposals):** register PRODUCTS_* on `3ed79446…`, `6340092e…`, `009e5c86…`
(3×3); delete 8 legacy-host subscriptions on v1 and 8 on `6340092e…` (16 total) identified by the
drift report; retired store rows — leave unless founder orders otherwise. No remote mutation has
been executed or is authorized.

**Classification: IMPLEMENTED, NOT PRODUCTION VERIFIED.**

## P4 — Store identity, tenant isolation, security  ·  Impl: IMPLEMENTED · Prod: PARTIAL (fix deployed + verified)

**Cross-merchant webhook-routing ambiguity — FIXED (#305, merged 2026-11-06 10:25:40Z, merge
`726bedc1b2a8ef93962545ce05c3d04fba006f9d`) and VERIFIED DEPLOYED ~10:56Z** (Render `/ready`
`node_build=726bedc1b2a8`, scheduler tick 10:56:33Z `failed=0, succeeded=1`, `python_ready=true`).
Vercel frontend PROMOTED same commit (`dpl_4oMgo4k6ma1RzK9EoivguHNGS243`, READY). The conflicted
domain (`revluma-test-store.myshopify.com`; `6340092e…`/org `09ff67bf…` vs `009e5c86…`/org
`91d88743…`) now fails closed (`WEBHOOK_STORE_AMBIGUOUS`, provider retry) instead of arbitrary-tenant
writes. Behaviour itself is fixture-verified (`webhookStoreResolution.test.js` 7/7); a live 5xx probe
would require sending a webhook — not authorized, not performed.

**WooCommerce scheme mismatch — FIXED this branch (undeployed):** `stores.shop_domain` stores
`https://revluma.local` while the Woo controller strips the scheme — Woo webhooks 404 today.
Fix: bare/https-prefixed candidate matching both directions; ambiguity check unchanged (still fails
closed). Resolution suite 7/7; privacy workflow 6/6 after stub alignment.

Open by design (approval-gated): store-association transfer/delete/revoke; global
`(platform, shop_domain)` uniqueness migration / OAuth arbitration; CBC→GCM token re-encryption.
Two-merchant production exercise: NOT performed (would write data).

**Classification: PARTIAL — ambiguity class closed end-to-end (deployed + verified); isolation not
certified beyond the webhook path.**

## P5 — Privacy / data governance / Shopify compliance  ·  Impl: IMPLEMENTED (+regression pins) · Prod: NOT VERIFIED

Implementation reviewed (2026-11-06): durable-first `privacy_requests` before work; P2002 race →
`PRIVACY_REQUEST_PENDING` (never ack the loser); completed requests short-circuit
(`alreadyCompleted`); every read/write scoped by `store_id` from the *verified* delivery; HMAC gate
precedes processing; 200 only after success; orders retained with PII links severed; emails
pseudonymised (`redacted-<sha256[:24]>@redacted.invalid`); audit_logs carry counts only;
`privacy_requests` artifact excluded from HTTP responses.

Tests: 6/6 workflow + **4 new regression pins** (`privacyWorkflowRegression.test.js`): deterministic
request keys; artifact v1 schema with external identifiers only (internal IDs pinned absent);
deterministic pseudonymisation + PII nulling; financial orders retained. **10/10 green.**

**Named external blocker:** Shopify approval for **protected customer data** and mandatory
compliance webhooks (Partner Dashboard app configuration + review) — eligibility/review state
**unknown** here. No live end-to-end run (would write/redact live merchant data — not authorized).
DSAR SLA/retention uncertified.

**Classification: IMPLEMENTED, NOT PRODUCTION VERIFIED.**

## P6 — Rev intelligence live-data certification  ·  Impl: PARTIAL · Prod: NOT CERTIFIED

Live accuracy cross-check (2026-11-06 ~10:50Z): v1 orders (5 rows, 2026-10-27..30; USD totals sum
3446.85 — matches); current `business_states` row for org `1dc6aa19…` (`ff83f1e6-b131-40f8-9668-288172ebeab5`,
generated 10:50:35Z, complete) shows `revenue_today=0.00` — CORRECT (no orders today; zero is a
fact, not a failure). Production state telemetry present (`baseline_event_rate_5m_30d`,
`current_event_rate_5m`, `warnings`, `root_causes`, `root_cause_verification`,
`observed_drivers`, `ml_signals.inventory_signals`, `ml_signals.customer`) — no invented fields.
`rev-metrics-v1` fails closed for non-computable metrics; seven-day evidence carries
`metric_definitions` alongside values.

Standing certification: `docs/rev-intelligence/REV-CONVERSATION-EXPERIENCE-CERTIFICATION.md`
(2026-11-04 PARTIAL — deterministic layer certified; golden set 507 cases green).

**NOT CERTIFIED:** 11-scenario conversational acceptance with actual tool-invocation counts —
requires an authenticated Rev session (user-only); counts will not be estimated. Runbook appended in
`P2-P6-PRODUCTION-REPORT.md`.

**Classification: PARTIAL — NOT CERTIFIED (live).**

---

## Cross-cutting release gate — current standing

| Gate item | Status |
|---|---|
| Node build on intended commit | `/ready` `node_build=726bedc1b2a8` (PR #305; **PR #306 merged at `e8adae9232a026eb2dd00d9e8b6fd593a86fcfe4` on 2026-11-06 ~11:15Z — Render has NOT flipped to it as of ~11:35Z probe; manual Render deploy REQUIRED; Vercel PROMOTED `dpl_6DQDRz5BXuks78wmCVH4NTSytHXy`**) |
| Python on intended build | Render serving 726bedc (first healthy tick 10:56:33Z, failed=0) |
| Persistence succeeds | **YES** (post-deploy builds incl. previously failing org) |
| Recurring scheduler executions succeed | **YES** (ticks 10:56–10:57Z, failed=0/succeeded=1; age_seconds=9 at probe) |
| Snapshots + alerts persisted | **YES** (post-deploy snapshots + 1 alert `status=delivered`) |
| Product sync source-reconciled | **NO** (P2) — implemented; 7-test reconciliation suite green (fixture-verified); live reconciliation needs authorized Shopify/API or log access; all Shopify stores hold 0 products |
| Webhooks reliable & deduplicated | **NO** (P3) — HMAC/ack/idempotency verified; drift-report tooling added (read-only, never mutates); products topics never registered; 27 duplicate groups; 0 deliveries in 7 days; remediation approval-gated |
| Store identity + tenant isolation | **PARTIAL** (P4) — ambiguity fix DEPLOYED + verified (node 726bedc, 10:56Z). Woo scheme-mismatch fixed this branch (pending deploy). Global uniqueness / transfer/revoke / CBC→GCM approval-gated |
| Privacy workflows pass | **NO (NOT VERIFIED)** (P5) — implemented + **10/10 workflow tests green** (6 existing + 4 regression pins); live run approval-gated; Shopify protected-customer-data eligibility unknown |
| Rev on live-accurate evidence | **NO (NOT CERTIFIED)** (P6) — deterministic layer certified 2026-11-04; live cross-check 2026-11-06 consistent (revenue_today=0 correct; orders sum 3446.85); 11-scenario session user-only |
| Regression/security tests pass | Python suite on main `336bc8a` (1567 passed / 1 skipped); Backend: 46 offline-runnable suites / 9 prisma-generate-blocked in sandbox (CI runs them); new P2 reconciliation 7/7, P3 drift 5/5, P5 pins 4/4; `webhookStoreResolution` 7/7; zero regressions vs baseline |
| Deployments verified | Node: #303 (`eaced144b33c8`) and #305 (`726bedc1b2a8`) promoted + serving `/ready`; Python: healthy ticks; Vercel frontend PROMOTED for both |
| Limitations documented | See `KNOWN-LIMITATIONS.md` and `P2-P6-PRODUCTION-REPORT.md` |

## Approval-gated items (never block unrelated work)

1. R-10 stale business_states cleanup (~1005 rows).
2. Duplicate webhook-registration cleanup (27 groups; pre-flight = `shopifyWebhookDriftReport.js` output per store; plan + approval required).
3. Any remote Shopify subscription mutation — including registering PRODUCTS_CREATE/UPDATE/DELETE (zero rows for every store) and the retired store's 18 failed rows.
4. Transfer/delete/revoke of either production store-domain association (P4 conflict, `6340092e…` vs `009e5c86…`).
5. Global (platform, shop_domain) uniqueness migration or OAuth-arbitration behaviour change (P4).
6. AES-256-CBC → GCM migration of stored `access_token` ciphertexts.
7. Live end-to-end privacy compliance test on production (writes/redacts merchant data) (P5).
8. Live 11-scenario Rev conversational acceptance with tool-invocation counts (P6) — user-only session.
9. Full product-sync reconciliation implementing source-absent-row deletion semantics (P2).
10. Any production data write not covered by an authorized workflow.
11. Manual/operator Render deploy of PR #306 (`e8adae9`, P4 Woo fix) — merged 2026-11-06 ~11:15Z; Render has not auto-deployed it as of ~11:35Z probe; operator must trigger a deploy; not a data-approval item but environment-gated.

## Change log

- 2026-11-06 — Register created. P1 fix implemented (5699c55); PR #303 merged 09:16:49Z;
  P1 **PRODUCTION VERIFIED** at ~09:48Z (see P1 section).
- 2026-11-06 ~10:30Z — P2–P6 inspection batch (all read-only): products inventory (all Shopify
  stores 0 products; inference ≠ reconciliation); webhook registration/delivery map (products never
  registered; 27 duplicate groups; 0 deliveries in 7 days); P4 ambiguity fixed (PR #305); P5 review
  with named Shopify approval blocker; P6 cross-check (v1: 5 orders/21 customers).
- 2026-11-06 ~11:15Z — **PR #306 MERGED (`e8adae9232a026eb2dd00d9e8b6fd593a86fcfe4`, all checks green); Vercel production PROMOTED (`dpl_6DQDRz5BXuks78wmCVH4NTSytHXy`, READY); Render backend still serving `726bedc…` — manual deploy pending (probed twice, ~11:25Z/~11:35Z).**
- 2026-11-06 ~10:56–11:10Z — **PR #305 MERGED (`726bedc1b2a8`) and DEPLOYED VERIFIED** (Render
  node_build=726bedc… at 10:56:33Z probe, scheduler keyword healthy, Vercel PROMOTED). New branch
  work (PR #306): P4 WooCommerce scheme-mismatch fix (bare/https candidate matching, fail-closed
  ambiguity retained; resolution suite 7/7); P3 `shopifyWebhookDriftReport.js` (read-only operator
  drift report; exit 1 on drift; mutates nothing) + `shopifyWebhookDrift.test.js` 5/5;
  `shopifyWebhookTopics.js` pure module extraction; P2 7-test source-to-DB reconciliation suite
  (7/7); P5 `privacyWorkflowRegression.test.js` 4 pins (10/10 total); consolidated report
  `P2-P6-PRODUCTION-REPORT.md` created; backend offline suites 46 pass / 9 prisma-blocked
  (unchanged pre-existing set); docs updated. No production data modified; no remote webhook state changed.

## Change log

- 2026-11-06 — Register created. P1 fix implemented (5699c55) + validated locally
  (1567/1 skipped); PR #303 merged 09:16:49Z (all checks green); P1 **PRODUCTION VERIFIED**
  at ~09:48Z with direct production evidence (see P1 section).
- 2026-11-06 ~10:30Z — P2–P6 inspection batch (all read-only): P2 products inventory executed
  (all Shopify stores 0 products; v1 `read_products` recorded; inference ≠ reconciliation);
  P3 registrations/deliveries mapped (12 required topics, products never registered, 27 duplicate
  groups, 0 deliveries since 2026-10-30); P4 cross-merchant webhook-routing ambiguity **fixed on
  this branch** (`WEBHOOK_STORE_AMBIGUOUS`, fixture 4/4, NOT deployed); P5 privacy workflow reviewed
  (durable, idempotent, never-ack-before-success) with Shopify approval as named blocker; P6 recon
  (v1 live: 5 orders/21 customers; live acceptance session user-only). New Backend fix PR pending;
  no production data modified.
