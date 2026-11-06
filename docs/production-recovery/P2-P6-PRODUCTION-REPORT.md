# REVLUMA — Consolidated P2–P6 Production Report

**Status: INTERIM — 2026-11-06 ~11:10Z.** P1 is PRODUCTION VERIFIED (unchanged).
No success claim in this file exceeds the evidence listed for it. "VERIFIED" here means
directly observed in production; everything else is labelled.

## Verdict table

| Workstream | Implementation | Production verification | Approval-gated residue |
|---|---|---|---|
| P2 — Shopify product ingestion | **IMPLEMENTED + reconciliation-tested** (incl. new 7-test source-to-DB fixture suite) | **NOT VERIFIED** — all Shopify stores hold 0 product rows (inference: hourly sync completes with `read_products` recorded ⇒ source returned 0 nodes; never a source-authenticated read) | Live end-to-end round-trip (create→sync→update→delete) on a real catalog — production mutation not authorized |
| P3 — Webhook registration & delivery | **IMPLEMENTED + tested** (signature/ack/idempotency; drift-report tooling added, read-only) | **NOT VERIFIED** — 0 deliveries in 7 days; products topics never registered; duplicates unremediated | Products-topic registration; 27-group duplicate cleanup; retired-store failed rows |
| P4 — Store identity & tenant isolation | **IMPLEMENTED** — cross-merchant ambiguity **FIXED and DEPLOYED** (Render flip verified) | **PARTIAL** — fix live; WooCommerce scheme-mismatch fix pending deploy; two-merchant prod exercise never performed | Store transfer/delete/revoke; global domain uniqueness migration; CBC→GCM re-encryption; OAuth arbitration change |
| P5 — Privacy / compliance | **IMPLEMENTED + tested** (durable-first, idempotent; 4 new regression pins) | **NOT VERIFIED** — never run against live merchant data; Shopify protected-customer-data approval state unknown | Live end-to-end compliance test (writes/redacts merchant data) |
| P6 — Rev live-data certification | **PARTIAL** (registry fail-closed; deterministic layer certified 2026-11-04) | **NOT CERTIFIED** — live conversational acceptance (11-scenario set with tool-invocation counts) is user-only | — (user action, not approval-gate) |

## P2 — Shopify product ingestion

**Path A (authorized installation, live source) — what was executable and what was not:**
- Vercel (connected app) exposes only the frontend project env (`NODE_ENV`, `VITE_API_URL`,
  `BACKEND_API_URL`) — no `SHOPIFY_TOKEN_ENCRYPTION_KEY`; the backend env lives on Render, which
  exposes no API in this environment. No token material was read, decrypted, printed or transmitted.
- What the authorized installation DOES prove in production: `last_synced_at` advanced today for
  v1 (09:33:50Z, 10:03Z), `revluma-test-store` org `09ff67bf…` (09:48:20Z, 10:18Z) and org
  `91d88743…` (09:48:09Z, 10:18Z). A `last_synced_at` advance means the products stage did not throw
  (any non-permission failure aborts the sync), and v1 has `read_products` + `read_inventory`
  recorded from its OAuth grant. With both facts, "0 products in DB" is consistent with an empty
  source catalog — recorded as an **inference, not a reconciliation**.
- Grant verification via `currentAppInstallation.accessScopes` exists in code at sync time
  (fail-closed logging; `shopify_order_scope_comparison` for orders) but its output is not
  retrievable from here — no log access.

**Path B (product synchronization path) — verified against fixtures (this branch, 2026-11-06):**
`shopifyProductSync.reconciliation.test.js` (7/7):
1. 120 products / 3 pages persist with exact decimal strings, zero duplicates;
2. re-sync idempotent; `created_at` preserved; source `updated_at` propagated;
3. status mapping ACTIVE/ARCHIVED/DRAFT/UNLISTED → active/archived/draft/draft; archived ≠ purchasable;
4. 150-variant product expands via nested variant pagination BEFORE persistence (`variant_count`=150);
5. malformed node fails the run loudly (`SHOPIFY_PRODUCT_MALFORMED`) — earlier pages persist but the
   run reports failure (caller never advances `last_synced_at`; next sync converges idempotently);
6. zero-product source ⇒ 0 upserts, 0 rows;
7. pinned gap: full sync never removes source-absent rows (assertion documents current behavior;
   closing it = bulk delete = approval-gated, register item 9).
Additional offline suites: `shopifyProductSync.test.js` 8/8, `shopifyWebhookDrift.test.js` 5/5,
`shopifyWebhookDeliverySafety.test.js` 3/3.

**Inventory (read-only prod, 2026-11-06 ~10:20Z):** `products` = 3 rows (all stale WooCommerce
`revluma.local`, last updated 2026-08-13); Shopify rows = 0 for every store. Pagination, idempotent
upserts, incremental semantics (full re-sync), archival handling, variants, inventory (deliberately
absent until `read_inventory` is verified at runtime — module exists, unwired, documented),
tenant-safe persistence (`store_id` tenancy; no org column — see P4) are all implemented and
fixture-tested. **Deletion of source-absent rows and any live round-trip are NOT executed.**

**Remaining to certify P2:** live source-vs-local reconciliation against v1 (merchant-empty
confirmation, OR authorized API read, OR Render log access) and one create→sync→update→delete
round-trip on a non-production catalog. Both require user/founder action or new access.

## P3 — Webhooks

**Inventory (read-only prod, 2026-11-06 ~10:20Z).** Required subscriptions (code truth) = **12
topics** (`REQUIRED_SUBSCRIPTIONS`, new pure module `shopifyWebhookTopics.js`). Registration rows
(82): v1 and `6340092e…` hold **2 active rows per each of 9 topics** (split across the legacy and
current backend hosts — the exact-URI match in reconciliation never matched legacy-URI subscriptions,
spawning parallel sets); `009e5c86…` holds 1 active × 9; retired store holds 8 topics × 2 `failed`
rows (2026-10-27) + APP_UNINSTALLED ×2 active; **PRODUCTS_CREATE/UPDATE/DELETE: zero registration
rows for every store** — products subscribe only at install/reinstall (background sync runs with
`reconcileWebhooks:false` by design) and no install has happened since the products requirement
shipped. 27 duplicate (store, topic) groups confirmed: 9+9+8+1.

**Delivery health (`webhook_deliveries`):** 197 rows, all `status=processed`, latest
2026-10-30 08:00:39Z. Zero deliveries in 7 days — idle test stores vs silently-failing remote
subscriptions cannot be distinguished from inside this environment.

**New tooling (this branch):** `scripts/shopifyWebhookDriftReport.js` — operator-run, READ-ONLY
drift report: lists live remote subscriptions via the authorized installation and diffs against
REQUIRED_SUBSCRIPTIONS (missing / unexpected / duplicates with counts / legacy URLs), exits 1 on
drift, 0 on clean, 2 on access/config failure. Never creates, updates or deletes anything.
`shopifyWebhookDrift.test.js` (5/5) pins: full-fulfilment no-drift, products-missing drift, legacy
URL classification (never counted as fulfilment), duplicates with counts, unexpected topics. This is
the exact reconciliation evidence tool the cleanup decision needs — run it per store before
approving any remediation.

**Verified in code + tests:** HMAC-SHA256 signature over the raw body (401 before processing),
claim-before-process with P2002 identity checks, retry-once on failed deliveries, never-ack-early on
pending deliveries, 200 only after successful processing. `shopifyWebhookDeliverySafety.test.js` 3/3;
privacy workflow 6/6; callback assertions pass.

**Approval-gated (exact proposals, no execution):** (1) register PRODUCTS_CREATE/UPDATE/DELETE on
`3ed79446…` (org `1dc6aa19…`), `6340092e…` (org `09ff67bf…`), `009e5c86…` (org `91d88743…`) —
3 topics × 3 stores; (2) delete the 8 legacy-host `revluma-backend.onrender.com` subscriptions per
store on v1 and `6340092e…` (16 total) identified by `shopifyWebhookDriftReport.js`; (3) retired
store failed registrations — leave unless founder orders otherwise. Every deletion needs explicit
authorization + the drift report as evidence.

## P4 — Store identity & tenant isolation

**Cross-merchant webhook-routing ambiguity — FIXED and DEPLOYED.**
`commerceWebhookService.findStore` resolved tenants via an unordered `findFirst`; for the conflicted
domain the selection was arbitrary. Fixed in #305 (fail-closed `WEBHOOK_STORE_AMBIGUOUS`; deleted
rows still excluded) and **verified live 2026-11-06 ~10:56Z: Render `/ready` `node_build=726bedc1b2a8`,
`python_ready=true`, scheduler tick 10:56:33Z completed `failed=0, succeeded=1`.** The Vercel frontend
promoted `726bedc…` at ~10:27Z (`dpl_4oMgo4k6ma1RzK9EoivguHNGS243` READY/PROMOTED). Direct behavioural
verification of the 5xx-on-ambiguity path in production was NOT possible without sending a webhook
(a write) — not authorized; the path is fixture-verified (`webhookStoreResolution.test.js` 7/7, incl.
cross-scheme and cross-org collision cases).

**WooCommerce scheme-mismatch (found + fixed this branch, undeployed):** `stores.shop_domain` keeps
`https://revluma.local` while the Woo webhook controller strips the scheme before `findStore` —
production Woo webhooks would 404 forever. Fix: match bare and `https://`-prefixed candidate domains
both directions; the ambiguity (>1 tenant) check still fails closed. 7/7 resolution tests, privacy
workflow 6/6. Ships with this report's PR; deploy pending Render flip.

**Not remediated (approval-gated / product decisions):** transfer/delete/revoke of either
`revluma-test-store.myshopify.com` association; `@@unique([platform, shop_domain])` migration or
OAuth-install arbitration; CBC→GCM token re-encryption; OAuth behaviour changes for conflicted domains.
Two-merchant isolation exercise on production: not performed (would write data).

## P5 — Privacy / compliance

**Durable-first, idempotent, never-ack-before-success — implementation reviewed; 10 workflow tests
green** (6 existing + 4 new pins: `privacyWorkflowRegression.test.js`): deterministic request keys;
export artifact schema v1 with external identifiers only (internal IDs pinned absent); deterministic
pseudonymisation of emails (`redacted-<sha256[:24]>@redacted.invalid`) with full PII nulling; financial
orders retained while personal links are severed. RLS: `privacy_requests`/`audit_logs` enabled, no
API-role policies — least privilege holds; app-role bypass noted (boundary is app-level scoping).

**Named external blocker (explicit):** Shopify's approval requirements for **protected customer
data** and the mandatory compliance webhooks (`customers/data_request`, `customers/redact`,
`shop/redact`) — the app must be configured in the Partner Dashboard to receive these, and
protected-customer-data access requires Shopify review for production use. Eligibility/review state is
**unknown** from this environment. Additionally, no live end-to-end exercise has been run (it would
WRITE and REDACT live merchant data — not authorized). DSAR response-time SLA and retention windows
are uncertified. Verification here is code + fixtures, which is what the assignment permits without
a founder-approved live exercise.

## P6 — Rev intelligence live-data certification

**Standing certification** remains `docs/rev-intelligence/REV-CONVERSATION-EXPERIENCE-CERTIFICATION.md`
(2026-11-04, PARTIAL: deterministic layer, golden set 507 cases, gates green).

**Live production accuracy cross-check (read-only, 2026-11-06 ~10:50–10:55Z):**
- v1 store orders (5 rows): 2026-10-27..30, USD totals 749.95 + 1025.00 + 0.00 + 1571.90 + 100.00 =
  **3446.85** — matches the recorded sum; the 1025.00 is the order fully refunded to 0.00 at ingestion
  (net semantics), the others are current totals.
- Current `business_states` row for org `1dc6aa19…` (`ff83f1e6-b131-40f8-9668-288172ebeab5`, generated
  2026-11-06 10:50:35Z, `computation_status=complete`): `revenue_today=0.00`, `revenue_yesterday=0.00` —
  **correct**: no v1 orders exist on either date (latest order 2026-10-30). A zero here is a fact, not
  a failure.
- Telemetry keys present in the production state (`source_data`): `baseline_event_rate_5m_30d`,
  `current_event_rate_5m`, `warnings`, `root_causes`, `root_cause_verification`, `observed_drivers`;
  `ml_signals` keys include `inventory_signals`, `customer`. No invented fields.
- Rev answers against this org are live-accurate for what exists (5 orders, 21 customers, 0 products,
  0 carts) and accurately thin — any catalogue-dependent claim has nothing to cite.

**NOT certified:** the 11-scenario conversational acceptance with actual tool-invocation counts
against the live store. This requires an authenticated Rev session (user-only) — it cannot be run
read-only by this environment, and invocation counts will not be estimated. Once executed, record
raw per-scenario tool counts against `rev-metrics-v1` gates (fail-closed for non-computable metrics).

## Merged commits / PRs / deploys

| Ref | Content | State |
|---|---|---|
| `5699c55` → PR #303 → `eaced144b33c8` | P1 single-statement autocommit persistence | MERGED + deployed + PRODUCTION VERIFIED |
| `0abdc35` → PR #304 → `336bc8a445b4` | P1 production verification record | MERGED |
| `b7aae39` → PR #305 → **`726bedc1b2a8`** | P4 cross-merchant ambiguity fix + P2–P6 inspection | MERGED; **Vercel frontend PROMOTED ~10:27Z (`dpl_4oMgo4k6…`); Render `node_build=726bedc1b2a8` verified 10:56Z (scheduler healthy, failed=0)** |
| this branch → PR #306 | Woo scheme fix (P4), webhook drift report tooling (P3), 7 reconciliation tests (P2), 4 privacy regression pins (P5), this consolidated report; `shopifyWebhookTopics.js` extraction | See PR; **deploy pending Render flip after merge** |

## Remaining approvals / external actions (everything else is done or blocked)

1. **P2 live round-trip**: authorized read of v1 source + one create→sync→update→delete cycle (mutates Shopify + DB) — founder/user.
2. **P3 remote remediation**: products-topic registration (3 stores), 16 legacy-URL duplicate deletions (v1 + `6340092e…`), drift report per store as the pre-flight evidence — founder/user, explicit per-store sign-off.
3. **P3 delivery**: either merchant traffic resumes (observable in `webhook_deliveries`) or founder confirms subscriptions may be re-registered.
4. **P4**: transfer/delete/revoke of either `revluma-test-store.myshopify.com` association; global `(platform, shop_domain)` uniqueness migration; CBC→GCM token migration; OAuth arbitration — founder/user.
5. **P5**: Shopify protected-customer-data eligibility for the app + approval to run one live compliance webhook exercise — founder/user + Shopify.
6. **P6**: run the 11-scenario acceptance (and transcripts A–E) in an authenticated Rev session; record raw tool-invocation counts — user.
7. **Docs**: MASTER-EXECUTION-REGISTER.md and KNOWN-LIMITATIONS.md updated alongside this report (same PR).
8. **R-10** stale `business_states` recount + delete — unchanged approval gate (not re-verified here).
9. **P2 item 9** (full-sync source-absent row reconciliation): approve a deletion-semantics design or leave rows (documented).
