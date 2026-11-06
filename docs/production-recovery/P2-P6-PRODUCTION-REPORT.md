# REVLUMA — Consolidated P2–P6 Production Report

**Status: END-STATE — 2026-11-06 ~13:45Z.** P1 is PRODUCTION VERIFIED (unchanged). P4's
ambiguity fix is PRODUCTION VERIFIED (live). PR #306 is MERGED but Render-deploy pending.
**This PR** (`arena/f9c10395-revluma` → `main`) is the P2–P6 hardening batch: privacy shop/redact
de-transaction, token encryption v2 + gated re-encryption tool, webhook in-flight delivery
recovery + adopt-by-topic, P2 reconciliation/diagnostic tooling, productSync failure counters,
fixture-level 11-scenario acceptance (11/11), read-only RLS/index/tenant-isolation audits.
**No item in this PR is PRODUCTION VERIFIED until the post-merge `/ready` flip is probed and
recorded** (checklist X.7). "VERIFIED" below means directly observed in production.

## Verdict table

| Workstream | Implementation | Production verification | Approval-gated residue |
|---|---|---|---|
| P2 — Shopify product ingestion | **IMPLEMENTED + TESTED** (reconciliation fixtures 7/7; dry-run-default gated reconcile tool; admin access diagnostic; loud partial-failure counters) | **NOT VERIFIED** — all Shopify stores hold 0 product rows; live source read blocked (no Render env access; inference only) | Live round-trip (create→sync→update→delete) — production mutation not authorized |
| P3 — Webhook registration & delivery | **IMPLEMENTED + TESTED** (HMAC/ack/idempotency; drift reporting; adopt-by-topic; in-flight recovery worker wired into scheduler) | **NOT VERIFIED** — 0 deliveries in 7 days; PRODUCTS_* never registered; duplicates unremediated | Products-topic registration; 16 legacy-URL deletions; retired-store rows |
| P4 — Store identity & tenant isolation | **IMPLEMENTED + HARDENED** (ambiguity fix live; Woo scheme fix merged; AES-256-GCM v2; gated rekey tool; audits clean) | **PARTIAL** — ambiguity fix deployed + verified; this PR undeployed; global uniqueness unmigrated | Transfer/revoke conflicted store; uniqueness migration; CBC→GCM apply |
| P5 — Privacy / compliance | **IMPLEMENTED + HARDENED** (durable-first; shop/redact de-transacted with per-step failure codes; pins) | **NOT VERIFIED** — never run on live merchant data; Shopify protected-customer-data approval unknown | Live end-to-end compliance exercise |
| P6 — Rev live-data certification | **PARTIAL** (fixture acceptance 11/11 this PR; deterministic layer certified 2026-11-04) | **NOT CERTIFIED** — live 11-scenario session is user-only; counts never estimated | — (user action) |

## What changed in this PR (branch `arena/f9c10395-revluma`, commit pending → merge)

| File(s) | Change | Tests |
|---|---|---|
| `src/services/privacyWebhookService.js` | **shop/redact de-transacted**: ordered idempotent single statements, children→parents (`sequence_events` → `order_items` → orders → carts/items → `events` → `ml_session_features` → sequences → `intelligence_findings` → products/images/tags/categories → `store_settings` → `webhook_deliveries` → … → customers); final `stores.update` (redacted, tokens NULL) last; per-step try/catch → throw `SHOP_REDACT_STEP_FAILED` (`failed_step`, `cause`); caller marks the delivery `failed` with `SHOP_REDACT_STEP_FAILED:<step>` | workflow 6/6 + regression 4/4 |
| `src/utils/encryption.js` | AES-256-GCM v2 (`v2:<iv12B>:<tag>:<ct>`); v1 CBC decrypt-only; shape-gated `ENCRYPTION_FORMAT_UNKNOWN`; 64-hex key enforced | 5/5 |
| `scripts/reencryptStoreTokens.js` | CBC→GCM migration tool; **dry-run default**; `--apply` requires `REVLUMA_REKEY_CONFIRM=REENCRYPT-ALL-SHOPIFY-TOKENS` | 3/3 |
| `src/services/webhookDeliveryRecovery.js` (NEW) | Stale `received` deliveries → `failed` with explicit reason (wall-clock ≥900s); bounded batch 200; logger warn; never re-executes business logic | 3/3 |
| `src/services/schedulerService.js` | `webhook-delivery-recovery` startup pass + 5-min interval + lock + env knobs + stop/export wiring; tick-safe | (via recovery suite + lint of wiring) |
| `src/services/shopifyWebhookService.js` | **Adopt-by-topic** on URI miss (no duplicate creates, no silent URI migration); warn log; local row converges to remote URI + `last_error=legacy_callback_url_adopted:…`; drift-report script path repaired | 7 scenarios + 12 subscriptions assertions |
| `src/services/productSync.js` | Loud partial failure: thrown errors carry `sync_stage`/`pages_completed`/`products_upserted`; one warn log with counters | suites green |
| `src/services/shopifySync.js` | `shopify_sync_failed` log now includes `sync_stage`/`pages_completed`/`products_upserted`/`http_status` | suites green |
| `src/services/productReconciliation.js` (NEW) + `scripts/productSyncReconcile.js` (NEW) | Source-to-DB reconciliation report; dry-run default; `--apply` gated on `REVLUMA_RECONCILE_CONFIRM_DELETIONS=DELETE-SOURCE-ABSENT-PRODUCTS`; empty source hard-refused (override `REVLUMA_RECONCILE_ALLOW_EMPTY_SOURCE=ALLOW-EMPTY-SOURCE-DELETE`) | 7/7 |
| `src/services/shopifyAccessDiagnostic.js` (NEW) + `src/controller/adminShopifyDiagnosticsController.js` (NEW) + `route/adminRoute.js` | `GET /api/v1/admin/shopify/stores/:storeId/access` — admin key, no-store; allow-list; live vs recorded scopes; per-collection probes (ok\|empty\|access_denied\|error:<code>); scope-query failure ⇒ `scope_query_ok=false` + null flags; no PII | 4/4 |
| `python/tests/test_rev_eleven_scenarios.py` (NEW) + `docs/production-recovery/REV-LIVE-ACCEPTANCE-RUNBOOK.md` (NEW) | 11 mandated scenarios, real `route_message`, patched gateway; gate + no-fabricated-tools pins; 8=clarify, 11=refuse-before-tools, 5=analysis response_mode | 11/11 |
| `docs/production-recovery/*` | END-STATE rewrite (this PR): register, verification, limitations, report + NEW `MASTER-COMPLETION-CHECKLIST.md` + NEW live-acceptance runbook | — |
| RLS / index audits (read-only prod) | 17/17 tables RLS-enabled (7 FORCE); hot-path indexes present; no schema change; `stores.shop_domain` seq-scan noted (4 rows; index before ~100 stores) | SQL (read-only) |

Full green inventory this revision: python 57 + 667 + 11 = **735**; backend offline suites green
(reconciliation 7/7, delivery-recovery 3/3, encryption 5/5, reencrypt 3/3, diagnostic 4/4,
drift 5/5, webhook-service 7 scenarios, privacy 6/6 + 4/4 pins, resolution 7/7, delivery-safety 3/3,
shopifyProductSync 8/8). **9 suites remain CI-only** (sandbox `prisma generate` blocked).

## P2 — Shopify product ingestion

**Path A (live source) — what was executable and what was not:**
- Vercel (connected app) exposes only the frontend project env (`NODE_ENV`, `VITE_API_URL`,
  `BACKEND_API_URL`) — no `SHOPIFY_TOKEN_ENCRYPTION_KEY`; backend env lives on Render with no API
  in this environment. No token material was read, decrypted, printed or transmitted.
- What the authorized installation DOES prove in production: `last_synced_at` advanced today for
  v1 (09:33:50Z, 10:03Z), `revluma-test-store` org `09ff67bf…` (09:48:20Z, 10:18Z) and org
  `91d88743…` (09:48:09Z, 10:18Z). `last_synced_at` advance ⇒ the products stage did not throw,
  and v1 has `read_products` + `read_inventory` recorded at OAuth. With both facts, "0 products in
  DB" is consistent with an empty source catalog — **inference, not reconciliation**.
- Grant verification via `currentAppInstallation.accessScopes` exists in code at sync time
  (fail-closed logging) but output is not retrievable here — no log access. The new admin
  diagnostic (V27) is the sanctioned way to obtain it, operator-invoked.

**Path B — verified against fixtures (this branch):**
`shopifyProductSync.reconciliation.test.js` (7/7): exact decimals; idempotent re-sync; `created_at`
preserved; archived ≠ purchasable; 150-variant nested expansion before persistence; malformed
nodes fail loudly (`SHOPIFY_PRODUCT_MALFORMED`) — pages persist but caller never advances
`last_synced_at`; empty source ⇒ 0 writes; source-absent deletion gap pinned (approval-gated).
`shopifyProductSync.test.js` 8/8. **Deletion of source-absent rows NOT executed** (register item 9).

**Remaining to certify P2:** live source-vs-local reconciliation against v1 (merchant-empty
confirmation, OR authorized API read, OR Render log access, OR the new diagnostic run by an
operator) and one create→sync→update→delete round-trip on a non-production catalog.

## P3 — Webhooks

**Inventory (read-only prod, 2026-11-06 ~10:20Z).** Required = **12 topics**
(`REQUIRED_SUBSCRIPTIONS`, `shopifyWebhookTopics.js`). 82 rows: v1 and `6340092e…` hold 2 active ×
9 topics each (legacy + current host split — exact-URI matching never matched legacy subscriptions,
spawning parallel sets); `009e5c86…` 1 × 9; retired store 8 × 2 `failed` + APP_UNINSTALLED ×2;
PRODUCTS_CREATE/UPDATE/DELETE zero rows. 27 duplicate groups.

**Delivery health:** 197 rows, all `processed`, latest 2026-10-30 08:00:39Z; zero in 7 days.

**NEW this PR:**
- Drift report path repair (`scripts/shopifyWebhookDriftReport.js`); operator-run, READ-ONLY;
  exit 1 on drift, 2 on access/config failure; mutates nothing.
- **Adopt-by-topic** for legacy-URI subscriptions — local registry converges without creating
  duplicates or silently rewriting remote URLs (see P3.4 in the checklist).
- **In-flight delivery recovery worker** (see V24) — closes the "claimed forever, invisible to
  provider retry" hole without ever re-executing business logic.

**Approval-gated (no execution):** (1) register PRODUCTS_CREATE/UPDATE/DELETE on `3ed79446…`
(org `1dc6aa19…`), `6340092e…` (org `09ff67bf…`), `009e5c86…` (org `91d88743…`); (2) delete the
16 legacy-host subscriptions (8 v1 + 8 `6340092e…`) identified by the drift report; (3) retired
store rows — leave unless founder orders otherwise.

## P4 — Store identity & tenant isolation

**Ambiguity — FIXED and DEPLOYED (#305 → `726bedc1b2a8…`, verified ~10:56Z: `/ready` flip, tick
10:56:33Z `failed=0, succeeded=1`; Vercel PROMOTED at ~10:27Z).** Fixture-verified
(`webhookStoreResolution.test.js` 7/7); live behavioural 5xx probe not performed (would require
sending a webhook — not authorized).

**WooCommerce scheme-mismatch — FIXED and MERGED (#306 → `e8adae9…`); Vercel PROMOTED; Render
deploy pending operator as of ~11:35Z.** 7/7 resolution tests; ambiguity still fails closed.

**This PR (hardening):**
- AES-256-GCM v2 tokens (see V23) + gated re-encryption tool (dry-run default).
- Tenant-isolation audit — no unscoped cross-tenant read found (rev/settings/shopify/dashboard/
  intelligence/operational paths org- or store-scoped; pixel HMAC + timing-safe compare; internal
  diagnostics key-authed; ambiguity fails closed everywhere inspected).
- RLS inventory — 17/17 enabled (7 forced); enabled-not-forced set documented (app-role least
  privilege via scoping). Index inventory — hot paths covered; no migration applied.

**Not remediated (approval-gated / product decisions):** either conflicted-domain association
(transfer/delete/revoke); global `(platform, shop_domain)` uniqueness migration or OAuth-install
arbitration; CBC→GCM apply; OAuth behaviour changes for conflicted domains; two-merchant production
exercise (would write data).

## P5 — Privacy / compliance

**Durable-first, idempotent, never-ack-before-success — implementation reviewed; 10 workflow tests
green.** **This PR de-transacts shop/redact** (see V22): the pooler scatters multi-statement
interactive transactions (2026-11-06 persistence incident class); redact now runs as ordered,
idempotent, individually-committed statements with per-step failure codes. On failure the delivery
and privacy-request rows are marked `failed` with `SHOP_REDACT_STEP_FAILED:<step>`; retry converges;
`stores.status=redacted` and tokens nulled only after every step is durable.

**Named external blocker (explicit, unchanged):** Shopify approval for protected customer data and
the mandatory compliance webhooks (Partner Dashboard + review); eligibility unknown. No live
exercise (would WRITE/REDACT live merchant data). DSAR SLA uncertified.

## P6 — Rev intelligence live-data certification

**Standing certification** remains `docs/rev-intelligence/REV-CONVERSATION-EXPERIENCE-CERTIFICATION.md`
(2026-11-04, PARTIAL).

**Live production accuracy cross-check (read-only, 2026-11-06 ~10:50–10:55Z):** orders 5 rows, USD
3446.85 sum (matches); `business_states` org `1dc6aa19…` `revenue_today=0.00` — CORRECT; telemetry
keys present (`baseline_event_rate_5m_30d`, `current_event_rate_5m`, `warnings`, `root_causes`,
`root_cause_verification`, `observed_drivers`, `ml_signals.inventory_signals`, `ml_signals.customer`);
no invented fields; registry fails closed for non-computable metrics.

**This PR:** fixture-level 11-scenario acceptance green (**11/11**, see V30) + runbook
(`REV-LIVE-ACCEPTANCE-RUNBOOK.md`) + full local python suites **735 passed**. **P6-D frontend review:**
quiet turns render no report scaffolding; pending steps honest; no defect found.

**NOT certified:** live 11-scenario conversational acceptance with actual tool-invocation counts
(user-only authenticated session; procedure in the runbook; counts never estimated). Once executed,
record raw counts in the certification doc and flip checklist P6.6.

## Merged commits / PRs / deploys

| Ref | Content | State |
|---|---------|-------|
| `5699c55` → PR #303 → `eaced144b33c8` | P1 single-statement autocommit persistence | MERGED + deployed + **PRODUCTION VERIFIED** |
| `0abdc35` → PR #304 → `336bc8a445b4` | P1 verification record | MERGED |
| `b7aae39` → PR #305 → **`726bedc1b2a8`** | P4 ambiguity fix; P2–P6 inspection | MERGED; Vercel PROMOTED; Render node_build flip verified 10:56Z |
| PR #306 → `e8adae9232a026eb2dd00d9e8b6fd593a86fcfe4` | P4 Woo scheme fix | MERGED ~11:15Z (CI green); Vercel PROMOTED; **Render backend deploy pending operator** |
| PR #307 → `414210b3be74` | Docs-only record of #306 state | MERGED 11:06Z (this branch base) |
| **this PR** (`arena/f9c10395-revluma`) | P2–P6 hardening batch + end-state docs (see table above) | **OPEN at writing; merge gated on CI; post-merge verification REQUIRED** |

## Remaining approvals / external actions (everything else is done or blocked)

1. **P6**: run the 11-scenario acceptance (and transcripts A–E) in an authenticated Rev session;
   record raw tool-invocation counts — user (runbook: `REV-LIVE-ACCEPTANCE-RUNBOOK.md`).
2. **P2 live round-trip** — founder/user.
3. **P3 remote remediation** (products topics ×3 stores; 16 legacy-URL deletions; drift report per
   store as pre-flight) — founder/user, explicit per-store sign-off.
4. **P3 delivery**: merchant traffic resumes or founder authorizes re-registration.
5. **P4**: conflicting-domain transfer/delete/revoke; uniqueness migration; CBC→GCM apply;
   OAuth arbitration — founder/user.
6. **P5**: Shopify protected-customer-data eligibility + one live compliance exercise — founder/user + Shopify.
7. **R-10** stale `business_states` recount + delete — unchanged approval gate.
8. **P2 item 9** (source-absent row reconciliation apply) — approve design or leave rows.
9. **Operator actions (not data approvals):** Render deploy of PR #306 (`e8adae9…`) — merged, not
   live as of ~11:35Z; then this PR's deploy + `/ready` flip probe.
10. **Docs**: this file, register, limitations, verification report, and the new checklist are
    delivered inside this PR (same changeset).
