# REVLUMA — Production Verification Report

**Status: INTERIM — 2026-11-06 ~11:35Z.** P1 is **PRODUCTION VERIFIED**. **P4 ambiguity fix
MERGED (PR #305 → `726bedc1b2a8`) and DEPLOYED VERIFIED (Render `/ready` node_build flip,
10:56Z; scheduler `failed=0`; Vercel PROMOTED).** P3 gained read-only drift-report tooling; P2
gained a source-to-DB reconciliation suite (7/7); P5 gained 4 regression pins (10/10). P2/P3/P5
remain **IMPLEMENTED, NOT PRODUCTION VERIFIED**; P6 remains **NOT CERTIFIED**. No production
success claim beyond P1 and the P4 fix deployment is made anywhere in this file.

## P1 — Production verification evidence (2026-11-06)

Fix: commit `5699c55` (single-statement autocommit persistence), PR **#303** MERGED
2026-11-06T09:16:49Z → merge commit `eaced144b33c8d612f07820ff40874122a42f5a8`.
CI on the PR: Dashboard seed+build **pass**, Prisma bootstrap financial+security regressions
**pass**, python-regressions **pass**, Vercel **pass** (all five checks green before merge).

| # | Evidence | Source |
|---|----------|--------|
| V1 | `/ready` → `node_build=eaced144b33c`; `python_ready=true` | direct fetch ~09:35Z |
| V2 | Vercel production deployment `dpl_2vptZNY2SBSWPi1qVV768TiGh13k` @ `eaced14` READY/PROMOTED (dashboard scope) | Vercel API |
| V3 | First healthy post-deploy pass 09:31:21: build for org `1dc6aa19…` → `outcome=rebuilt`, `computation_status=complete`, duration 20,324 ms | Supabase `automation_job_state` |
| V4 | New snapshot `1606d755-439c-4328-bff6-8cbf1eea5ec4` `is_current=true`, `computation_status=complete`, generated 09:31:21, `valid_until` 09:46:21 | Supabase SQL |
| V5 | All five organizations hold fresh `is_current` snapshots (09:31:21, 09:32:22, 09:33:21, 09:34:21, 09:35:21) | Supabase SQL |
| V6 | Second rebuild cycle: 1dc6aa19 again at 09:47:21 (`9afffec9…`); 91d88743 again at 09:48:21 (`be01b035…`) | Supabase SQL |
| V7 | `alert_queue`: `revenue/medium` row referencing `business_state_id=1606d755…`, `status=delivered`, dedupe_key `<state_id>:revenue` | Supabase SQL |
| V8 | Node heartbeat row `business-state`: 09:33:19 → 09:33:37, `status=completed`, `failed=0`, `succeeded=1`, `last_error=""` | Supabase SQL |
| V9 | Repeat cycles `failed=0`; `/ready` reports `failed=0` after the deploy | `/ready` + SQL |
| V10 | Deploy-time interruption at 09:21:17 (process replaced mid-pass); DB claim `running` persisted; TTL (600s) expired 09:31:17; scheduler self-healed with no intervention | `/ready` age growth + recovery at 09:31/09:33 passes |

**Pre-fix baseline retained for audit:** snapshots frozen at 2026-11-05 23:59:53; 0 alerts/24h;
scheduler `INTELLIGENCE_UNAVAILABLE` on every tick (evidence 2026-11-06 08:33–09:21Z).

**Node `/ready` phantom-"running" observation (pre-existing, not introduced by #303):** during the
09:21:17 deploy flip, `/ready` reported `business_state.status=running` with growing `age_seconds`
for ~10 minutes although the build behind it had completed; recovery happened via DB claim TTL
(600s), not via code. If this class of stall recurs it will persist until TTL expiry; raising it
as a future hardening item (startup claim sweep / wedged-call detection), not a P1 defect.

## P2–P6 evidence summary (2026-11-06, all read-only against production)

| ID | Workstream | Outcome | Blocking dependency |
|----|------------|---------|---------------------|
| V11 | P2 products | All Shopify stores hold 0 product rows; store v1 has `read_products` recorded at OAuth and its syncs complete; catalogue emptiness is INFERENCE, not reconciliation; fixture tests 8/8 | Authorized live Shopify read/API or log access (none in this environment); merchant confirmation of empty store |
| V12 | P3 webhooks | 82 registration rows mapped; 12 required topics; PRODUCTS_* never registered for any store; 27 duplicate groups split across backend URL migration; deliveries: 197 processed, latest 2026-10-30; commerceWebhookService HMAC/ack/idempotency verified by tests 3/3 + callback assertions | Founder authorization for remote subscription creation/cleanup; delivery health otherwise unverifiable |
| V13 | P4 tenancy | Cross-merchant webhook routing ambiguity found (`findStore` findFirst) and FIXED (`WEBHOOK_STORE_AMBIGUOUS` fail-closed); PR #305 MERGED 10:25Z → `726bedc1b2a8`; **DEPLOYED + VERIFIED 10:56Z** (`node_build=726bedc1b2a8`, scheduler tick 10:56:33Z failed=0/succeeded=1, `python_ready=true`); Vercel PROMOTED (`dpl_4oMgo4k6…`); resolution suite 7/7 | Store transfer/revoke + global uniqueness + CBC→GCM approval-gated; Woo scheme-mismatch fix (this branch) deploy-pending |
| V14 | P5 privacy | Durable-first idempotent workflow reviewed; **10/10 workflow tests** (6 existing + 4 new regression pins: deterministic request keys, artifact v1 schema with external identifiers only + internal-ID absence pinned, deterministic pseudonymisation + PII strip, financial-order retention) | Live end-to-end would write/delete merchant data (not authorized); Shopify protected-customer-data approval state unknown |
| V15 | P6 Rev | v1 live data: 5 orders (USD 3,446.85), 21 customers; `rev-metrics-v1` registry fails closed; 7-day evidence carries metric definitions | 11-scenario conversational acceptance with real tool-invocation counts requires an authenticated session (user-only) |
| V16 | P4 deploy | **PR #305 deployed on Render; `/ready` returns `node_build=726bedc1b2a8` (probe ~10:56Z); scheduler completed tick 10:56:33→10:56:37Z `failed=0, succeeded=1`; `redis_ready=true`; `python_ready=true`; Vercel frontend PROMOTED for same commit (`dpl_4oMgo4k6ma1RzK9EoivguHNGS243`, READY ~10:27Z)** | Direct behavioural probe of the ambiguous-delivery path needs a live webhook (write) — not authorized |
| V17 | P2 reconciliation | `shopifyProductSync.reconciliation.test.js` **7/7**: 120-product/3-page idempotent persistence with exact decimals; status mapping (archived≠purchasable); 150-variant nested expansion before persistence; malformed-node loud failure with pages-persisted semantics; empty source = zero writes; source-absent-row gap pinned (approval-gated) | Live source-to-DB read impossible from this environment |
| V18 | P3 drift tooling | `scripts/shopifyWebhookDriftReport.js` (read-only; per-store remote reconciliation: missing / unexpected / duplicates-with-counts / legacy URLs; exit 1 on drift, 2 on access failure; mutates NOTHING; never prints tokens) + pure `diffSubscriptions` (5/5 tests) + `shopifyWebhookTopics.js` extraction (12 required topics, Prisma-free) | Running it needs founder/operator invocation with Render env access; it cannot fix anything itself |
| V19 | P4 Woo fix | `commerceWebhookService.findStore` now matches bare and scheme-prefixed domains both directions (Woo `shop_domain=` here `https://revluma.local` vs controller-stripped headers); ambiguity (>1 tenant) still fails closed; resolution suite 7/7; privacy workflow 6/6 after stub alignment; **MERGED as PR #306 → `e8adae9232a026eb2dd00d9e8b6fd593a86fcfe4` (~11:15Z, all checks green); Vercel production PROMOTED (`dpl_6DQDRz5BXuks78wmCVH4NTSytHXy`, READY ~11:22Z); Backend NOT yet deployed — Render `/ready` still `node_build=726bedc1b2a8` at ~11:35Z probe; manual Render deploy required** | Operator Render deploy pending; verified only after node_build flips to `e8adae9…` |
| V20 | Suite parity | Offline backend suites: **46 pass / 9 prisma-generate-blocked** (unchanged pre-existing set) vs 43/9 prior; zero regressions; new suites: reconciliation 7/7, drift 5/5, privacy pins 4/4 | Local sandbox cannot run prisma generate (binaries.prisma.sh unreachable) |
| V21 | P6 accuracy cross-check | Current `business_states` row org `1dc6aa19…` (`ff83f1e6-b131-40f8-9668-288172ebeab5`, generated 10:50:35Z, complete) shows `revenue_today=0.00`/`revenue_yesterday=0.00` — CORRECT (latest v1 order 2026-10-30); telemetry keys present (`baseline_event_rate_5m_30d`, `current_event_rate_5m`, `warnings`, `root_causes`, `root_cause_verification`, `observed_drivers`, `ml_signals.inventory_signals`, `ml_signals.customer`) | Confirms truthfulness of output; does NOT certify conversational accuracy |

## Not yet verified (explicitly)

- P2 products source-to-DB reconciliation. See MASTER-EXECUTION-REGISTER.md → P2.
- P3 remote subscription reconciliation (products topics; duplicates); delivery reliability in production.
- P4 deployment of the Woo scheme fix (PR #306 merged ~11:15Z; Render deploy pending, probed ~11:35Z); two-merchant production exercise; global domain uniqueness.
- P5 live compliance workflow; P6 live conversational acceptance transcripts A–E and the
  11-scenario set with tool-invocation counts.
- Python deploy metadata: Render exposes no deploy API through this environment's tooling; the
  Python-service deploy is evidenced behaviorally (V3–V6) rather than by a deploy record.
- Backend CI parity note: `prisma generate` requires `binaries.prisma.sh`, unreachable from this
  sandbox; 9 backend suites are unrunnable locally and are exercised by CI instead.

## Incident timeline reference

See `MASTER-EXECUTION-REGISTER.md` → P1 for the 2026-11-03/2026-11-06 failure chain and the
root-cause statement.
