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

## P2 — Shopify product ingestion  ·  Impl: IMPLEMENTED · Prod: NOT VERIFIED

Requirement source: Recovery assignment P2.

**Implemented (code, reviewed + fixture-tested 2026-11-06):** `Backend/src/services/productSync.js` —
50-node pages, `MAX_SYNC_PAGES=100` cap (pagination fail-closed, never a partial import reported
as complete), variant connection fully expanded before persistence (`MAX_VARIANT_PAGES=20`,
stale/changed `updatedAt` between pages fails the product), exact-decimal prices (no floats, no
silent USD), idempotent upsert on `products @@unique([store_id, external_id])`, `created_at` never
nulled on update, `ARCHIVED` maps to a kept `archived` row, deletion path wired end-to-end
(products/delete webhook → `deleteProduct`, store-scoped), prices/status feed the catalogue as read-only.
Scope posture: `read_products` is verified at OAuth time and recorded on `stores.granted_scopes`; only an
explicit Shopify `ACCESS_DENIED` on the products field downgrades (warn + continue); malformed data and
DB failures are fatal. Inventory is deliberately out of the catalogue snapshot (`read_inventory` granted
to v1; `shopifyInventoryObservation.js` is a fail-closed observation module, tested, NOT wired to
persistence or scheduler — quantities stay null rather than invented).

**Production facts (read-only, 2026-11-06 ~10:20Z):** all Shopify stores hold **0 product rows**
(products total = 3, all stale WooCommerce `revluma.local` rows last updated 2026-08-13). v1
(`revluma-test-store-v1`, org `1dc6aa19…`, store `3ed79446…`) recorded `read_products` at OAuth and its
full sync completed today (`last_synced_at` 2026-11-06 09:33:50Z and 10:03Z); with the products stage
non-fatal-but-downgradable only on explicit ACCESS_DENIED, 0 rows is consistent with an **empty source
catalog** — but this is an inference, NOT a source-verified reconciliation. No authorized path from this
environment reaches the live Shopify API (tokens AES-encrypted at rest; `SHOPIFY_TOKEN_ENCRYPTION_KEY`
not available; Render logs/deploy API unavailable). An advanced scheduler timestamp is not proof and is
not claimed as one.

**Defects / gaps found:**
- (a) Full sync never reconciles rows hard-deleted in Shopify without a products/delete webhook — and
  products webhooks were never registered remotely (see P3). Reconciling now = bulk deletion on prod;
  NOT implemented (approval-gated).
- (b) Product sync has no dedicated scope-verification/fail-fast like `verifyOrderReadScope` (orders);
  it relies on the downgrade-on-ACCESS_DENIED path. Acceptable as deployed; hardening noted.

**Offline verification:** `shopifyProductSync.test.js` 8/8; `shopifyWebhookDeliverySafety.test.js` 3/3;
`shopifyPrivacyWebhookWorkflow.test.js` 6/6; `webhookStoreResolution.test.js` 4/4 (new, see P4);
`shopifyWebhookService.test.js` all assertions passed; `shopifySyncRecovery.test.js` 4/4.
`intelligenceShopifyPagination.test.js`, `shopifyNestedLineCompleteness.test.js`,
`shopifyInventoryObservation.test.js` (and 6 other suites) cannot run in this sandbox — `prisma generate`
requires `binaries.prisma.sh`, which this environment's egress policy blocks; these run in CI
(`npm ci` + `prisma generate` there). Baseline comparison: 42→43 pass, 10→9 fail, all 9 failures
identical `MODULE_NOT_FOUND '.prisma/client/default'` on both sides.

**Classification: IMPLEMENTED, NOT PRODUCTION VERIFIED.** To close: live source-to-DB reconciliation
of v1 (merchant confirmation the test store has no products, OR authorized Shopify API read, OR Render
log access), then a created product round-trip (create → sync → row present → webhook update →
delete → row gone).

## P3 — Webhook registration & delivery  ·  Impl: IMPLEMENTED · Prod: NOT VERIFIED

Requirement source: Recovery assignment P3.

**Inventory (read-only prod, 2026-11-06 ~10:20Z) — `webhook_registrations` (82 rows):**
- Required set is **12 topics** (`REQUIRED_SUBSCRIPTIONS`: APP_UNINSTALLED, ORDERS_CREATE/UPDATED/
  CANCELLED/DELETE, CUSTOMERS_CREATE/UPDATE, CHECKOUTS_CREATE/UPDATE, PRODUCTS_CREATE/UPDATE/DELETE).
  *Earlier "13 topics" recon note was inaccurate; the code requires 12.*
- `revluma-test-store-v1` (`3ed79446…`): **2 active rows per each of 9 topics** + 1 succeeded setup-state
  row per topic (setup 2026-10-27) — duplicates split across two delivery URLs (`revluma-backend.onrender.com`
  → `revluma-backend-vrsd.onrender.com`); `revluma-test-store` org `09ff67bf…` (`6340092e…`): same pattern,
  2 active × 9 topics; `revluma-test-store` org `91d88743…` (`009e5c86…`): **1 active × 9 topics**, no
  succeeded setup-state row (registered later, single URL); retired store (`aa269846…`, never touched):
  8 topics × 2 **failed** rows from 2026-10-27 + APP_UNINSTALLED 2 active; **PRODUCTS_* topics have ZERO
  rows for every store — never attempted**; products subscribe only at install/reinstall (background hourly
  sync deliberately runs `reconcileWebhooks: false`), and v1 has had no OAuth exchange since the products
  requirement shipped.
- 27 duplicate (store, topic) groups confirmed: 9 + 9 + 8 (failed pairs, retired) + 1 (retired APP_UNINSTALLED).
- Delivery URLs confirm the URL-migration duplicate source: current `-vrsd` host (6 rows/topic) vs old
  host (3–4 rows/topic). Old-URL subscriptions remain registered at Shopify and, if they still fire,
  deliver to the legacy backend domain.

**`webhook_deliveries` (197 rows, all `status=processed`):** orders/create 5, orders/updated 12,
orders/cancelled 2, orders/delete 1, checkouts/create 19, checkouts/update 142, customers/create 9,
customers/update 7 — latest 2026-10-30 08:00:39Z. **Zero deliveries in 7 days**; indistinguishable
between idle test stores and silently-failing remote subscriptions from inside this environment.

**Code path (verified):** `commerceWebhookController.receive` → HMAC-SHA256 signature over the raw body
(401 before any processing) → `findStore` (see P4) → `claimDelivery` (P2002-identity-checked; failed
deliveries retry once; in-flight deliveries never acked) → process → `markDelivery(processed)` →
only then HTTP 200. Failures mark the delivery failed and yield 5xx so Shopify retries. Delivery safety
covered by `shopifyWebhookDeliverySafety.test.js` (3/3).

**NEW defect fixed on this branch (cross-merchant, see P4):** `findStore` previously resolved the tenant
via `findFirst` with no uniqueness check; the same domain on two orgs routed webhook writes to an
arbitrary organization. Now fails closed with `WEBHOOK_STORE_AMBIGUOUS`.

**Not done (approval-gated):** creating remote PRODUCTS_* subscriptions; duplicate cleanup (27 groups);
any change to the retired store's 18 failed registrations; retired `APP_UNINSTALLED` rows. Any remote
subscription mutation requires explicit authorization + verified evidence.

**Classification: IMPLEMENTED, NOT PRODUCTION VERIFIED.** Acceptance (every registration row mapped,
remote subscriptions reconciled, delivery reliability evidenced in prod) unmet — remote reconciliation
is blocked on authorization; delivery volume is currently zero.

## P4 — Store identity, tenant isolation, security  ·  Impl: IMPLEMENTED (fix) · Prod: NOT VERIFIED

Requirement source: Recovery assignment P4.

**Identity conflict (recon, read-only):** `6340092e…` (org `09ff67bf…`) and `009e5c86…` (org `91d88743…`)
both claim `revluma-test-store.myshopify.com`; both are `status=active`; both synced 2026-11-06 (09:48:09Z
and 09:48:20Z) with 4 customers each, 0 orders, 0 products. `granted_scopes` is NULL for both rows
(scope recording post-dates their install). The OAuth path (`shopifyController.js`) validates the domain
against `^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$` and lowercases it; `stores` enforces
`@@unique([organization_id, shop_domain])` — **no global (platform, shop_domain) uniqueness**, which is
why two orgs may claim the same domain. WooCommerce row stores its domain WITH scheme
(`https://revluma.local`) — mixed normalization conventions.

**Defect 1 — cross-merchant webhook routing (FIXED on this branch, fixture-verified, NOT deployed):**
`commerceWebhookService.findStore` used `stores.findFirst({ platform, shop_domain, status != deleted })`
with no ORDER BY; for the conflicted domain Postgres could return either org's row on any delivery —
i.e., merchant A's order webhook could persist into org B's store record, blending two merchants'
governed data. Fix: `findMany`; if >1 row matches → log + throw `WEBHOOK_STORE_AMBIGUOUS` (global error
handler → 500, provider retries); deleted rows still excluded; single-match resolution unchanged.
New `webhookStoreResolution.test.js` pins: single match resolves; empty resolves null; two-org collision
fails closed; deleted duplicate excluded. Privacy-webhook workflow test updated to stub `findMany`.

**Defect 2 — no global domain uniqueness (NOT fixed; approval-gated):** needs a product/founder decision:
either `@@unique([platform, shop_domain])` after the conflict is resolved (transfer/merge of one
association), or explicit per-domain claim arbitration in OAuth install. Transfer/delete/revoke of either
association remains approval-gated; none granted.

**Token storage:** `stores.access_token` is AES-256-**CBC** (`utils/encryption.js`, key from
`SHOPIFY_TOKEN_ENCRYPTION_KEY`) — no AEAD/integrity tag. Works as deployed; migration to GCM requires
re-encrypting stored ciphertexts and is approval-gated. Tokens are never logged (capability booleans only).

**Tenant boundary:** products has **no `organization_id`** (tenancy via `store_id` join). RLS is enabled
on all audited tables (25 with policies; others deny-by-default — no policies). `FORCE ROW LEVEL SECURITY`
covers abandoned_carts, customers, orders, stores only; policies via `app.current_org_id()` exist for
customers/orders/stores/business_states (SELECT). The app accesses Postgres via a privileged role (RLS not
forced elsewhere), so **application-level scoping is the actual isolation boundary** — one defect (P4-1)
was found and fixed; a full adversarial audit of every org-scoped path has not been performed.

**Two-merchant isolation:** fixtures prove the ambiguity class is closed for the webhook path; no evidence
of cross-tenant rows found in read-only inspection; end-to-end two-merchant exercise on production is NOT
performed (would write data; not authorized).

**Classification: IMPLEMENTED (ambiguity fix), NOT PRODUCTION VERIFIED.** Transfer/revoke of either
association, global uniqueness migration, CBC→GCM re-encryption, and any OAuth behaviour change: all
approval-gated; exposure of the conflict to OAuth re-installs remains open.

## P5 — Privacy / data governance / Shopify compliance  ·  Impl: IMPLEMENTED · Prod: NOT VERIFIED

Requirement source: Recovery assignment P5.

**Implemented (code, reviewed 2026-11-06):** `Backend/src/services/privacyWebhookService.js` —
- Topics: `customers/data_request`, `customers/redact`, `shop/redact` (mandatory compliance webhooks).
- **Durable first:** `privacy_requests` row created BEFORE work; concurrent duplicates hit P2002 →
  `PRIVACY_REQUEST_PENDING`, the racing delivery is NOT acknowledged (Shopify retries); completed requests
  short-circuit to `alreadyCompleted`.
- **Tenant isolation:** every read/write scoped by `store_id` from the *verified* delivery; payload cannot
  redirect the operation.
- **Signature:** same HMAC-SHA256-raw-body path as all Shopify webhooks (401 on failure) — verification
  precedes parsing and persistence; `shopifyPrivacyWebhookWorkflow.test.js` 6/6 including a forced-DB-failure
  leg that proves no ack on failure.
- **Retry/idempotency:** failed deliveries are retried by Shopify; `beginRequest` resumes safely; redact
  of already-redacted customers is a no-op.
- **Erasure:** customer redact deletes events/ml_session_features/churn+sensitivity observations, scrubs
  cart tokens, unlinks sequence_sends, pseudonymises email (`redacted-<sha256[:24]>@redacted.invalid`),
  nulls PII/consents; **orders kept for financial necessity, PII links severed**. shop/redact wipes the
  store's commerce graph in one transaction, nulls `access_token`/`granted_scopes`/`public_tracking_key`,
  sets `status='redacted'`.
- **Audit:** `audit_logs` rows carry action + counts only; payload artifacts stay in `privacy_requests`
  (RLS-enabled, no API-role policies). Never ack before success: HTTP 200 only after the workflow completes.

**Not verified / blockers (explicit):**
1. No live end-to-end compliance delivery exercised — this would WRITE and DELETE production merchant data;
   not authorized. Verification is fixture/workflow-level only.
2. **Shopify App Store approval — protected customer data + mandatory compliance webhooks — eligibility
   and review state unknown in this environment; if Shopify requires approval before the app can process
   these webhooks on production stores, that is the named external blocker.**
3. `privacy_requests`/`audit_logs` retention policy and DSAR response-time SLA are not certified.

**Classification: IMPLEMENTED, NOT PRODUCTION VERIFIED.**

## P6 — Rev intelligence live-data certification  ·  Impl: PARTIAL · Prod: NOT CERTIFIED

Requirement source: Recovery assignment P6.

**Standing certification** (`docs/rev-intelligence/REV-CONVERSATION-EXPERIENCE-CERTIFICATION.md`, 2026-11-04):
**PARTIAL CERTIFICATION** of the deterministic layer (golden set 507 cases / 107 prompts × 6 evidence
states; all gates green; directness ≥95%, rest 100%). Not certified then: live acceptance transcripts A–E,
production `response_mode` assignment, visual regression, manual screen-reader pass.

**Production data available to Rev today (read-only, 2026-11-06 ~10:20Z):** v1 store — 5 orders
(USD 3,446.85 recorded, totals verified via canonical sync), 21 customers; WooCommerce `revluma.local` —
1 order (2026-08-13); both conflict-pair stores — 4 customers each, 0 orders/0 products; retired store —
0 rows; products table — 0 Shopify rows anywhere. `rev-metrics-v1` registry
(`python/src/intelligence/metric_registry.py`) fails closed for non-computable metrics; seven-day evidence
carries `metric_definitions` alongside values.

**Live-data certification NOT possible from this environment:** the 11-scenario conversational acceptance
with actual tool-invocation counts requires an authenticated Rev session against production (browser) or
an authorized harness with real tool calls. Neither is available read-only, and invocation counts must never
be estimated. The merchant acceptance session remains **user-only**; until it is executed and recorded,
Rev's live behaviour is uncertified regardless of internal eval scores.

**Classification: IMPLEMENTED (registry + deterministic layer), NOT CERTIFIED (live-data certification).**
Close by: (1) user-run transcripts A–E + 11-scenario set against v1, recording raw tool-invocation counts;
(2) confirming `/ready python_version` post-Render-redeploy; (3) noting products=0 as the honest catalogue baseline.

---

## Cross-cutting release gate — current standing

| Gate item | Status |
|---|---|
| Node build on intended commit | `/ready` `node_build=eaced144b33c` (PR #303 merge) |
| Python on intended build | Render serving #303 code (first healthy tick 09:31:21) |
| Persistence succeeds | **YES** (post-deploy builds 09:31–09:48Z, incl. previously failing org, twice) |
| Recurring scheduler executions succeed | **YES** (passes 09:31–09:48Z, succeeded>0, failed=0) |
| Snapshots + alerts persisted | **YES** (6 new snapshots post-deploy; 1 new alert `status=delivered`; FK intact) |
| Product sync source-reconciled | **NO** (P2) — implemented, fixture-tested; live reconciliation needs authorized Shopify/API or log access; all Shopify stores hold 0 products (inference, not proof) |
| Webhooks reliable & deduplicated | **NO** (P3) — HMAC/ack/idempotency verified in code+tests; remote reconciliation (products topics never registered; 27 duplicate groups) approval-gated; 0 deliveries in 7 days |
| Store identity + tenant isolation | **PARTIAL** (P4) — cross-merchant webhook-routing ambiguity FIXED on this branch (fixture-verified, NOT deployed); domain global uniqueness + transfer/revoke approval-gated |
| Privacy workflows pass | **NO (NOT VERIFIED)** (P5) — implemented + 6/6 workflow tests; live run would write/delete merchant data; Shopify protected-customer-data approval state unknown |
| Rev on live-accurate evidence | **NO (NOT CERTIFIED)** (P6) — deterministic layer certified 2026-11-04; 11-scenario live acceptance requires user session; counts not fabricated |
| Regression/security tests pass | Python suite on main `336bc8a` (1567 passed / 1 skipped, 2026-11-06); Backend: 43 offline-runnable suites / 9 prisma-generate-blocked in sandbox (CI runs them); new `webhookStoreResolution.test.js` 4/4; zero regressions vs baseline (42/10) |
| Deployments verified | Node: #303 promoted (`eaced144b33c8`) and serving `/ready`; Python: healthy ticks 09:31+ (Render has no API in this environment — verified behaviorally). P4 ambiguity fix is NOT deployed (PR pending) |
| Limitations documented | See `KNOWN-LIMITATIONS.md` |

## Approval-gated items (never block unrelated work)

1. R-10 stale business_states cleanup (earlier ~33k estimate; live table now 1005 rows — needs
   recount + explicit approval before any delete).
2. Duplicate webhook-registration cleanup (27 groups identified; plan + approval required).
3. Any remote Shopify subscription mutation — explicitly including registering PRODUCTS_CREATE/UPDATE/DELETE
   (currently ZERO registration rows for every store) and any change to the retired store's 18 failed rows.
4. Transfer/delete/revoke of either production store-domain association (P4 conflict, `6340092e…` vs `009e5c86…`).
5. Global (platform, shop_domain) uniqueness migration or OAuth-arbitration behaviour change (P4).
6. AES-256-CBC → GCM migration of stored `access_token` ciphertexts (requires re-encryption + cutover) (P4).
7. Live end-to-end privacy compliance test on production (writes/redacts merchant data) (P5).
8. Live 11-scenario Rev conversational acceptance with tool-invocation counts (P6) — user-only session.
9. Full product-sync reconciliation pass implementing hard-delete of source-absent rows (P2).
10. Any production data write not covered by an authorized workflow.

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
