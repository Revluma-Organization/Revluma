# REVLUMA — Production Recovery & Certification Master Register

Branch: `arena/f9c10395-revluma` · Started: 2026-11-06 · Owner: Revluma recovery operation
Repository: `Revluma-Organization/Revluma` · Database: Supabase project `jblpgqmbgdlzitprudgt` (eu-west-1) · Application: Vercel (Node) + Render (Python serving/scheduler)

**Standing rules.** Read-only production unless an item is explicitly authorized. Approval-gated
destructive actions never block unrelated workstreams. No success may be claimed without direct
production evidence. Where a criterion cannot be met, it is marked **BLOCKED** with the exact
dependency named. Final status vocabulary: **PRODUCTION VERIFIED** / **IMPLEMENTED, NOT PRODUCTION
VERIFIED** / **BLOCKED** / **APPROVAL REQUIRED**. Record any deployment status separately from
merge status; merge ≠ deploy ≠ verified.

Legend: Impl = implementation status in this branch · Prod = production verification status

---

## 0. Environment identity (2026-11-06, probes through ~12:15Z)

| Item | Value | Evidence (2026-11-06) |
|---|---|---|
| Repo state | `main` = `55639425b3f5` (merge of PR #308); this record delivered from branch `arena/097a7439-revluma` | `git rev-parse HEAD`, `gh pr view 308` |
| Node build on Render (`/ready.node_build`) at last probe ~12:05–12:09Z | **`55639425b3f5`** (PR #306 `e8adae9…` and PR #308 merged 11:15Z / 11:30Z; backend DEPLOYED VERIFIED ~12:05–12:09Z — deploy-interrupted pass self-completed 12:09:12Z `failed=0`) | direct fetch (cache-busted) + direct SQL |
| Python service | serving (post-#308 deploy); `python_ready=true`, `python_model_status=beta_ready` (0.6.0); behavioral evidence only | `/ready`; `automation_job_state` |
| `stores` (active) | 4 | read-only SQL |
| `products` | 3 rows (stale WooCommerce, 2026-08-13) | read-only SQL |
| Retired store | `bys-user-store-923319-1ifggjsw` — **never touched** | standing constraint |
| Conflicting domain pair | `6340092e…` vs `009e5c86…` (`revluma-test-store.myshopify.com`) — **never touched** | standing constraint |
| `webhook_deliveries` | 197 rows, all `processed`, latest 2026-10-30 08:00Z; 0 in 7 days | read-only SQL |
| `webhook_registrations` | 82 rows; PRODUCTS_* topics zero rows anywhere; 27 duplicate (store, topic) groups | read-only SQL |

Note: the earlier estimate of "~33,000 stale business_states (R-10)" does not match the live table
(1005 rows; `is_current = 5`); R-10 remains an approval-gated recount, not a closed item.

---

## P1 — Business-state persistence & scheduler recovery · Impl: COMPLETE (5699c55, PR #303, merged 09:16:49Z) · Prod: **PRODUCTION VERIFIED 2026-11-06 ~09:48Z**

**Unchanged from the 2026-11-06 verification record** — see `PRODUCTION-VERIFICATION-REPORT.md` → P1
for the full failure chain and acceptance evidence. Summary of the standing facts:

- 2026-11-03 10:21Z: advisory-lock batch self-deadlocked on `idx_bstate_org_current`
  (Lock/transactionid; lease row `QueryCanceled … idx_bstate_org_current` after 133,851 ms).
- 2026-11-06 ~07:57Z and 08:33Z/09:04Z: PR #302-era batches FK-violated and
  returned without error while the snapshot was invisible to the next statement
  (`pid_before=1545467 → pid_after_insert=1539098`).
- **Root cause (confirmed):** Supavisor (transaction mode) does not pin one server backend to one
  client transaction; statements scatter; uncommitted work has no common fate. The only dependable
  unit here is a **single statement**.
- **Fix (merged #303, `eaced144b33c8…`):** dedicated NullPool autocommit engine; decomposed
  single-statement steps (insert non-current snapshot → conditional baselines → per-alert upsert
  `ON CONFLICT DO NOTHING` → flip previous current → flip new → post-condition gate → prune);
  deterministic `_rollback_quietly(db)` before the write path; `_compensate_failed_build()`;
  `23505` → `BusinessStateBuildInProgress` (HTTP-409 semantics).
- **Regression:** atomicity 6; write-scope 10; persistence-lock 16. Python suite 1567 passed /
  1 skipped at merge. Post-deploy: all five orgs rebuilt (09:31–09:35Z, repeat 09:47–09:48Z);
  `node_build=eaced144b33c`; heartbeat tick 09:33:37Z `succeeded=1, failed=0`; deploy-time
  interruption absorbed via 600s claim TTL with zero manual action.
- **Still open (non-blocking, documented):** deploy-killed passes self-heal at TTL, leaving a
  phantom "running" heartbeat (observed 09:21Z); alert coverage is anomaly-driven (absence ≠
  failure); full Python deploy evidence is behavioral, not deploy metadata.

**Commits:** `5699c55` (fix) → PR **#303** → `eaced144b33c8d612f07820ff40874122a42f5a8`.

---

## P2 — Shopify product ingestion · Impl: IMPLEMENTED + TESTED (PR #308 extended) · Prod: NOT VERIFIED (permission-blocked)

**Path A (live source) — as far as this environment reaches:** Vercel exposes only frontend env;
Render env unreachable; no token read, decrypted, printed or transmitted anywhere. Production
`last_synced_at` advanced today for v1 and both conflict-pair stores; v1 recorded `read_products`
at OAuth; syncs complete (any non-permission failure aborts the sync). "0 product rows" is an
**inference, not a reconciliation** — recorded as such everywhere.

**Path B (this branch, all fixture-verified):**
- `shopifyProductSync.reconciliation.test.js` (7/7): 120-product/3-page idempotent persistence,
  exact decimals, status mapping (archived ≠ purchasable), 150-variant nested expansion, loud
  malformed-node failure, empty source = zero writes, source-absent deletion gap pinned.
- `productSync.js` (PR #308): pagination failures now throw with `sync_stage`/`pages_completed`/
  `products_upserted`; `shopifySync.js` logs the same counters (+`http_status`) on
  `shopify_sync_failed`. Earlier pages persist; the run fails loudly; retries converge
  (upserts idempotent); `last_synced_at` must not advance on failure.
- P2 access diagnostic (PR #308): `GET /api/v1/admin/shopify/stores/:storeId/access` (admin key,
  no-store) — allow-list only; live vs recorded scopes; per-collection probes ok | empty |
  access_denied | error:<code>; `scope_query_ok=false` + null live flags on scope-query failure;
  no ids/tokens/PII. 4/4 tests.
- Reconciliation tooling (PR #308): `productReconciliation.js` + `scripts/productSyncReconcile.js` —
  dry-run default; `--apply` gated on `REVLUMA_RECONCILE_CONFIRM_DELETIONS=DELETE-SOURCE-ABSENT-PRODUCTS`;
  empty source hard-refused (override `REVLUMA_RECONCILE_ALLOW_EMPTY_SOURCE=ALLOW-EMPTY-SOURCE-DELETE`);
  7/7 tests.
- Production facts (unchanged): all Shopify stores hold 0 product rows; inventory module exists,
  deliberately unwired (quantities null, never invented).

**Classification: IMPLEMENTED, NOT PRODUCTION VERIFIED.** Close with: authorized live
reconciliation of v1 + one create→sync→update→delete round-trip (founder/user action; mutates
Shopify and this DB). Approval-gated — see list below.

## P3 — Webhook registration & delivery · Impl: IMPLEMENTED + TESTED (PR #308 extended) · Prod: NOT VERIFIED (visibility/remediation gated)

**Inventory (read-only prod 2026-11-06):** required set = **12 topics**
(`shopifyWebhookTopics.js`, pure module). 82 registration rows: v1 + `6340092e…` hold 2 active × 9
topics (split across legacy/current backend hosts); `009e5c86…` 1 active × 9; retired store 8 failed
pairs + APP_UNINSTALLED ×2; **PRODUCTS_CREATE/UPDATE/DELETE zero rows anywhere**. 27 duplicate
(store, topic) groups. Deliveries: 197 rows, all `processed`, latest 2026-10-30 08:00Z;
**0 in 7 days** — idle vs dead subscriptions indistinguishable from here.

**Verified in code + tests:** HMAC-SHA256 raw-body signature (401 pre-processing); claim-before-
process with P2002 identity checks; retry-once on failed deliveries; never-ack-before-success;
200 only post-success. `shopifyWebhookDeliverySafety.test.js` 3/3; privacy workflow 6/6;
drift analysis 5/5.

**This PR adds:**
- **Adopt-by-topic** (`shopifyWebhookService.js`): on exact-URI miss, an existing same-topic
  subscription at a remote URI is adopted in place — no duplicate creation, no silent remote URI
  migration; warn `shopify_webhook_legacy_subscription_adopted`; local registration row records the
  remote URI and `last_error=legacy_callback_url_adopted:…`. Zero duplicate creation verified.
- **In-flight delivery recovery** (`webhookDeliveryRecovery.js` + `schedulerService.js`): deliveries
  claimed (`received`) but never completed are wall-clock-detected (≥ 900s default) and flipped to
  `failed` with an explicit reason; the provider's redelivery then re-claims them. Nothing is
  re-sent, re-processed or deleted by this module. Scheduler every 5 min (startup pass wired;
  interval `WEBHOOK_DELIVERY_RECOVERY_INTERVAL_MS`, threshold `WEBHOOK_DELIVERY_STALE_SECONDS`);
  3/3 tests; errors logged, never fatal to the tick.
- `shopifyWebhookDriftReport.js` path repair; drift report remains operator-run, READ-ONLY
  (exit 1 on drift, 2 on access failure, mutates nothing).

**Approval-gated (exact proposals; nothing executed):** register PRODUCTS_* on the three stores;
delete 8 legacy-host subscriptions on v1 and 8 on `6340092e…` (16 total, IDs via drift report);
retired store failed rows — leave unless founder orders otherwise.

**Classification: IMPLEMENTED, NOT PRODUCTION VERIFIED.**

## P4 — Store identity, tenant isolation, security · Impl: IMPLEMENTED + HARDENED (PR #308) · Prod: PARTIAL (ambiguity fix verified live 10:56Z; hardening DEPLOYED ~12:05Z, unexercised live)

- **Cross-merchant webhook-routing ambiguity — FIXED (#305, `726bedc1b2a8…`) and VERIFIED DEPLOYED
  ~10:56Z** (`/ready` flip; tick 10:56:33Z `failed=0, succeeded=1`; `python_ready=true`); Vercel
  frontend PROMOTED (`dpl_4oMgo4k6…`). Fixture-verified ambiguity-fails-closed (7/7); live behavioural
  5xx probe not performed (would require sending a webhook — not authorized).
- **WooCommerce scheme-mismatch — FIXED (#306, `e8adae9232a026eb2dd00d9e8b6fd593a86fcfe4`)**:
  bare/https-prefixed candidate matching both directions; ambiguity still fails closed. MERGED
  ~11:15Z (CI green); Vercel PROMOTED (`dpl_6DQDRz5BXuks78wmCVH4NTSytHXy`); **live in production
  since ~12:05Z** (backend serving `55639425b3f5`, which includes #306).
- **This PR (crypto + audits):** AES-256-GCM token encryption v2 (`v2:<iv 12B>:<tag>:<ct>`); v1 CBC
  decrypt-only compat (shape-gated `ENCRYPTION_FORMAT_UNKNOWN`); key format enforced at load;
  `scripts/reencryptStoreTokens.js` dry-run default, `--apply` gated on
  `REVLUMA_REKEY_CONFIRM=REENCRYPT-ALL-SHOPIFY-TOKENS` (3/3 tests; 5/5 encryption tests).
- **Tenant-isolation audit 2026-11-06 (this operation):** no unscoped cross-tenant read found.
  Rev/settings/shopify/dashboard/intelligence/operational paths are org- or store-scoped; pixel
  ingest is HMAC-SHA256 `public_tracking_key` (timing-safe; unsigned → 404); internal/admin
  diagnostics are key-authed and store-id-keyed; ambiguity fails closed everywhere inspected.
  The conflicting-domain pair remains untouched.
- **RLS inventory (read-only, PR #308):** 17/17 audited tables `relrowsecurity=true`; 7 also
  `FORCE`. Enabled-not-forced tables (products, order_items, webhook_*, audit_logs,
  automation_job_state, business_states, sequence_sends, ml_session_features, privacy_requests)
  rely on app-role least privilege via store/org scoping — recorded, not changed.
- **Index audit (read-only, PR #308):** hot paths covered (`webhook_deliveries(status,received_at)`
  and per-store received_at; products store/external unique; events pixel idempotency key; orders
  store/external unique; stores org_domain unique). **No migration applied.** Watch item:
  `stores.shop_domain` lookup is a seq scan — fine at 4 stores; index before ~100 (documented).

Open by design (approval-gated): the conflicting store-domain association
(transfer/delete/revoke); global `(platform, shop_domain)` uniqueness migration / OAuth
arbitration; CBC→GCM re-encryption apply; two-merchant production exercise. Never executed.

**Classification: PARTIAL — ambiguity class closed end-to-end (deployed + verified); isolation not
certified beyond the webhook path and the audited read paths; crypto hardened, migration gated.**

## P5 — Privacy / data governance / Shopify compliance · Impl: IMPLEMENTED + HARDENED (PR #308) · Prod: NOT VERIFIED

**Durable-first, idempotent, never-ack-before-success — implementation reviewed** (2026-11-06):
`privacy_requests` rows precede any work; P2002 race → `PRIVACY_REQUEST_PENDING` (never ack the
loser); completed requests short-circuit (`alreadyCompleted`); every read/write scoped by
`store_id` from the *verified* delivery; HMAC gate precedes processing; 200 only after success;
orders retained (financial) with PII links severed; emails pseudonymised
(`redacted-<sha256[:24]>@redacted.invalid`); audit_logs carry counts only; artifact v1 schema
excludes internal IDs (pinned by test).

**This PR (P5 critical fix):** `handleShopRedact` no longer wraps an interactive multi-statement
`prisma.$transaction`. The Supavisor pooler does not commit interactive transactions atomically
(2026-11-06 root cause — statements scatter across backends; work silently vanishes). Redact is
now a loop of ordered, individually-committed, **idempotent** single statements (children →
parents: sequence_events → … → customers), each tagged; on failure it throws
`SHOP_REDACT_STEP_FAILED` carrying `failed_step` and `cause`; the delivery/privacy-request rows
are marked `failed` with `SHOP_REDACT_STEP_FAILED:<step>`; the final `stores.update`
(status=redacted, tokens NULL) runs last, after every step is durable. Retry converges.
Workflow 6/6 + regression 4/4 green after the rewrite.

**Named external blocker (unchanged):** Shopify approval for **protected customer data** and the
mandatory compliance webhooks — Partner Dashboard configuration + Shopify review; eligibility/review
state **unknown** from this environment. No live end-to-end run (writes/redacts live merchant data —
not authorized). DSAR SLA/retention uncertified.

**Classification: IMPLEMENTED, NOT PRODUCTION VERIFIED.**

## P6 — Rev intelligence live-data certification · Impl: PARTIAL · Prod: NOT CERTIFIED (live session user-only)

Live accuracy cross-check (2026-11-06 ~10:50Z): v1 orders 5 rows (USD 3446.85 sum — matches);
`business_states` org `1dc6aa19…` `revenue_today=0.00` — CORRECT (latest order 2026-10-30); telemetry
keys present; no invented fields; `rev-metrics-v1` fails closed for non-computable metrics.

**This PR adds:** `python/tests/test_rev_eleven_scenarios.py` — the eleven mandated launch scenarios
(greeting · casual · general question · sales concern · explicit investigation · period follow-up ·
acknowledgement · clarification · return-to-investigation · topic change · prohibited action) as
**fixture-level** acceptance against real `route_message` with a patched model gateway: **11/11
pass**. Pins: greeting/casual/ack route with zero understanding-model calls; scenario 3 knowledge
gate (no tools); scenario 4 `gate=tools` (revenue intent); scenario 5 analysis response_mode;
scenario 6 follow-up carry (`followup=true`); scenario 8 `gate=clarify`; scenario 10 topic-change
isolation; scenario 11 `gate=refuse` with zero tool-capable routing for both
"Delete all my products…" and "Please refund order 1004."
Full python suites green locally: 57 (conversational) + 667 (routing/investigation/golden/registry/
metrics/failure/mode) + 11 = **735**.

**P6-D frontend review (PR #308):** quiet turns (conversational/clarify/refuse) never render report
scaffolding, evidence pills stay honest (verified/partial/unverified/unavailable), `pending` steps
render "did not run" (never "completed"). No defect found; no change made.

**NOT CERTIFIED:** live 11-scenario conversational acceptance with real tool-invocation counts —
requires an authenticated Rev session (user-only). Procedure: `REV-LIVE-ACCEPTANCE-RUNBOOK.md`
(created PR #308; referenced from the test module docstring). Counts never estimated.

**Classification: PARTIAL — deterministic layer certified (2026-11-04); fixture-level acceptance
green (11/11); live acceptance pending user session.**

---

## Cross-cutting release gate — standing at `55639425b3f5` (PR #308 live ~12:05Z)

| Gate item | Status |
|---|---|
| Node build on intended commit | **YES — `55639425b3f5`** (`/ready` flip probe ~12:05Z, cache-busted; deploy-interrupted pass self-completed 12:09:12Z `failed=0, succeeded=1`; confirmed by direct DB read, not HTTP cache) |
| Python on intended build | Healthy ticks on #303-era code; behavioral evidence only |
| Persistence succeeds | YES (post-#303 deploys incl. previously failing org; tick 10:56Z failed=0) |
| Recurring scheduler executions succeed | YES — post-#308 deploy: deploy-interrupted pass self-completed 12:09:12Z (`failed=0, succeeded=1`, latency 22.1s); fresh ticks observed 12:02Z and 12:07:53Z pre-restart, none wedged |
| Snapshots + alerts persisted | **YES — all five orgs hold one current snapshot each (12:08:51Z freshest for `1dc6aa19…`; others fresh 11:54–11:57Z); direct SQL; no torn rows** |
| Product sync source-reconciled | NO (P2) — fixture-verified only; live read permission-blocked; see P2 section |
| Webhooks reliable & deduplicated | NO (P3) — HMAC/ack/idempotency verified; adopt-by-topic + in-flight recovery added PR #308 (tested); products topics unregistered; duplicates unremediated (approval-gated); 0 deliveries/7d |
| Store identity + tenant isolation | PARTIAL (P4) — ambiguity fix DEPLOYED + verified (726bedc, 10:56Z); Woo scheme fix MERGED (#306) and DEPLOYED (~12:05Z, `5563942…`); token crypto v2 IMPLEMENTED + DEPLOYED (unexercised); audits RLS/index/tenancy clean |
| Privacy workflows pass | NO (NOT VERIFIED) (P5) — implemented + hardened PR #308 (de-transacted); 10/10 tests; live run approval-gated |
| Rev on live-accurate evidence | NO (NOT CERTIFIED) (P6) — fixture acceptance 11/11; live session pending user |
| Regression/security tests pass | Python 735 green; backend offline suites green incl. all new: reconciliation 7/7, webhook recovery 3/3, encryption 5/5, reencrypt 3/3, diagnostic 4/4, drift 5/5, webhook service 7 scenarios, privacy 6/6 + 4/4 pins; 9 suites CI-only (sandbox `prisma generate` blocked — `binaries.prisma.sh` unreachable); CI is truth |
| Deployments verified | #303 (deployed+verified), #305 (deployed+verified), #306 (merged + DEPLOYED ~12:05Z), #307 (docs, merged), **#308 (MERGED 11:30:16Z + DEPLOYED VERIFIED ~12:05–12:09Z: `node_build=55639425b3f5`, tick 12:09:12Z `failed=0`, 5×1 current snapshots)**; Python serving (`beta_ready` 0.6.0) |
| Known limitations documented | See `KNOWN-LIMITATIONS.md` (audit findings appended this revision) |

## Approval-gated items (never block unrelated work)

1. R-10 stale `business_states` cleanup (~1005 rows) — recount first.
2. Duplicate webhook-registration cleanup (27 groups; drift report per store as pre-flight;
   delete legacy-host subscriptions 16 total on v1 + `6340092e…`).
3. Remote Shopify subscription mutation generally — incl. registering PRODUCTS_CREATE/UPDATE/DELETE.
4. Transfer/delete/revoke of either production store-domain association (P4 conflict;
   `6340092e…` vs `009e5c86…`).
5. Global `(platform, shop_domain)` uniqueness migration or OAuth-arbitration behaviour change (P4).
6. AES-256-CBC → GCM migration of stored `access_token` ciphertexts (tooling merged PR #308;
   `--apply` execution gated on `REVLUMA_REKEY_CONFIRM`).
7. Live end-to-end privacy compliance test on production (P5).
8. Live 11-scenario Rev conversational acceptance (P6) — user-only session (see runbook).
9. Full product-sync reconciliation implementing source-absent-row deletion semantics (P2) —
   tooling merged PR #308 (dry-run default; `--apply` gated on `REVLUMA_RECONCILE_CONFIRM_DELETIONS`).
10. Any production data write not covered by an authorized workflow.
11. ~~Manual/operator Render deploy of PR #306~~ — **DONE ~12:05Z** (#306 and #308 both live).
12. ~~Post-merge deploy of PR #308 + verification record~~ — **DONE ~12:05–12:09Z** (deploy + DB-verified; docs record landed in the follow-up docs PR).

## Change log

- 2026-11-06 — Register created. P1 fix implemented (5699c55); PR #303 merged 09:16:49Z;
  P1 **PRODUCTION VERIFIED** ~09:48Z.
- 2026-11-06 ~10:30Z — P2–P6 inspection batch (read-only): products inventory; webhook
  registration/delivery map (products never registered; 27 duplicate groups; 0/7d); P4 ambiguity
  fixed on `arena/f9c10395-revluma` (later dispatched as #305); P5 review with Shopify named blocker.
- 2026-11-06 ~10:56–11:10Z — **PR #305 MERGED and DEPLOYED VERIFIED** (node_build=726bedc1b2a8 at
  10:56Z; scheduler healthy). PR #306 opened for Woo scheme fix (undeployed at that time).
- 2026-11-06 ~11:15Z — **PR #306 MERGED** (`e8adae9…`, CI green); Vercel PROMOTED; Render not
  deployed at that time (2 probes); PR #307 (docs-only) merged 11:06Z.
- 2026-11-06 ~11:30Z — **PR #308 MERGED** (`e095137` → merge `55639425b3f5`, all CI green;
  Vercel Production deployment success 11:32:35Z). Hardening batch: P5 shop/redact de-transaction
  (single-statement steps, `SHOP_REDACT_STEP_FAILED:<step>`), P4 AES-256-GCM v2 + gated rekey tool,
  P3 in-flight delivery recovery (scheduler-wired, 5 min) + adopt-by-topic, P2 reconciliation
  tooling (dry-run default, gated apply) + admin access diagnostic endpoint, productSync partial-
  failure counters, drift-report path repair, P6 fixture-level 11-scenario acceptance (11/11),
  RLS/index/tenant-isolation audits (read-only), end-state docs + checklist + live-acceptance
  runbook. **No production data written; no remote state changed.**
- 2026-11-06 ~12:15Z — **Deployed + verification record (this revision):** `/ready` reports
  `node_build=55639425b3f5` (both #306 and #308 live); deploy-interrupted business-state pass
  resolved `completed` at 12:09:12Z (`failed=0, succeeded=1`, 22.1s) after the restart — the
  documented phantom-`running` mode, cleared without DB surgery; all five orgs hold exactly one
  current snapshot each (freshest `1dc6aa19…` 12:08:51Z; others 11:54–11:57Z); `/ready` HTTP
  responses during ~12:05–12:12Z were edge-cached copies of the deploy-interrupted claim — direct
  DB read used as authority. Python serving `beta_ready` (0.6.0). **Merge ≠ deploy ≠ behavioural
  verification stands:** the new code paths (redact / delivery-recovery / v2 crypto) have not been
  exercised live; every remaining live item is approval-gated (list above).
