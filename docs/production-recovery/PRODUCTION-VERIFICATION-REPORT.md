# REVLUMA — Production Verification Report

**Status: INTERIM — 2026-11-06 ~09:50Z.** P1 (business-state persistence & scheduler recovery)
is **PRODUCTION VERIFIED**. P2–P6 are **NOT STARTED** and hold no verified status.

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

## Not yet verified (explicitly)

- P2 products reconciliation (see MASTER-EXECUTION-REGISTER.md).
- P3 webhooks, P4 tenancy, P5 privacy, P6 Rev evidence.
- Python deploy metadata: Render exposes no deploy API through this environment's tooling; the
  Python-service deploy is evidenced behaviorally (V3–V6) rather than by a deploy record.

## Incident timeline reference

See `MASTER-EXECUTION-REGISTER.md` → P1 for the 2026-11-03/2026-11-06 failure chain and the
root-cause statement.
