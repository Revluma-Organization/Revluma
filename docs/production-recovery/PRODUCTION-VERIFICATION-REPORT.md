# REVLUMA — Production Verification Report

**Status: INTERIM — 2026-11-06 ~10:30Z.** P1 (business-state persistence & scheduler recovery)
is **PRODUCTION VERIFIED**. P2/P3/P5 are **IMPLEMENTED, NOT PRODUCTION VERIFIED**; P4 is
**PARTIAL (cross-merchant routing fix implemented on branch, fixture-verified, NOT deployed)**;
P6 is **NOT CERTIFIED**. No production success claim beyond P1 is made anywhere in this file.

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
| V13 | P4 tenancy | Cross-merchant webhook routing ambiguity found (`findStore` findFirst) and FIXED on branch (`WEBHOOK_STORE_AMBIGUOUS` fail-closed); 4/4 new tests; zero offline regressions (43 pass vs 42 baseline; 9 prisma-generate-blocked suites identical both sides) | Fix NOT deployed; store transfer/revoke + global uniqueness + CBC→GCM re-encryption approval-gated |
| V14 | P5 privacy | Durable-first idempotent workflow reviewed; 6/6 workflow tests (incl. forced-failure no-ack leg); signature verification precedes processing | Live end-to-end would write/delete merchant data (not authorized); Shopify protected-customer-data approval state unknown |
| V15 | P6 Rev | v1 live data: 5 orders (USD 3,446.85), 21 customers; `rev-metrics-v1` registry fails closed; 7-day evidence carries metric definitions | 11-scenario conversational acceptance with real tool-invocation counts requires an authenticated session (user-only) |

## Not yet verified (explicitly)

- P2 products source-to-DB reconciliation. See MASTER-EXECUTION-REGISTER.md → P2.
- P3 remote subscription reconciliation (products topics; duplicates); delivery reliability in production.
- P4 deployment of the ambiguity fix; two-merchant production exercise; global domain uniqueness.
- P5 live compliance workflow; P6 live conversational acceptance transcripts A–E and the
  11-scenario set with tool-invocation counts.
- Python deploy metadata: Render exposes no deploy API through this environment's tooling; the
  Python-service deploy is evidenced behaviorally (V3–V6) rather than by a deploy record.
- Backend CI parity note: `prisma generate` requires `binaries.prisma.sh`, unreachable from this
  sandbox; 9 backend suites are unrunnable locally and are exercised by CI instead.

## Incident timeline reference

See `MASTER-EXECUTION-REGISTER.md` → P1 for the 2026-11-03/2026-11-06 failure chain and the
root-cause statement.
