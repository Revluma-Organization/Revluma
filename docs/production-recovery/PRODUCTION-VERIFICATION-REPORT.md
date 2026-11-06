# REVLUMA — Production Verification Report

**Status: END-STATE for the recovery operation — 2026-11-06 ~13:45Z.** P1 is **PRODUCTION VERIFIED**.
P4's webhook-ambiguity fix is **PRODUCTION VERIFIED** (deployed 10:56Z). PR #306 (P4 Woo fix) is
MERGED but **Render-deploy pending an operator action**. This PR (branch `arena/f9c10395-revluma`)
ships the P2–P6 hardening batch (de-transacted redact, token encryption v2, webhook delivery
recovery, reconciliation + diagnostic tooling, fixture-level live-acceptance suite, documentation).
**Nothing in this PR is PRODUCTION VERIFIED until the post-merge `/ready` flip and scheduler-tick
re-check are recorded (see MASTER-COMPLETION-CHECKLIST.md → X.7).** No production success claim
beyond the evidence listed here is made anywhere in this tree.

## P1 — Production verification (historical, unchanged)

Fix: commit `5699c55` (single-statement autocommit persistence), PR **#303** MERGED 2026-11-06T
09:16:49Z → merge commit `eaced144b33c8d612f07820ff40874122a42f5a8`. CI on the PR: Dashboard
seed+build **pass**, Prisma bootstrap financial+security regressions **pass**, python-regressions
**pass**, Vercel **pass**.

| # | Evidence | Source |
|---|----------|--------|
| V1 | `/ready` → `node_build=eaced144b33c`; `python_ready=true` | direct fetch ~09:35Z |
| V2 | Vercel production deployment `dpl_2vptZNY2SBSWPi1qVV768TiGh13k` @ `eaced14` READY/PROMOTED | Vercel API |
| V3 | First healthy post-deploy pass 09:31:21: org `1dc6aa19…` → `outcome=rebuilt`, `computation_status=complete`, 20,324 ms | Supabase `automation_job_state` |
| V4 | Snapshot `1606d755-439c-4328-bff6-8cbf1eea5ec4` current, generated 09:31:21, 200s TTL | Supabase SQL |
| V5 | All five organizations hold fresh `is_current` snapshots (09:31–09:35Z) | Supabase SQL |
| V6 | Second rebuild cycle (1dc6aa19 09:47:21; 91d88743 09:48:21) | Supabase SQL |
| V7 | `alert_queue` row referencing `business_state_id=1606d755…`, `status=delivered` | Supabase SQL |
| V8 | Node heartbeat `business-state` 09:33:37 completed, `succeeded=1, failed=0` | Supabase SQL |
| V9 | Repeat cycles `failed=0` post-deploy | `/ready` + SQL |
| V10 | Deploy-time interruption 09:21:17; claim TTL 600s expired 09:31:17; self-healed, no intervention | `/ready` + SQL |

**Pre-fix baseline retained for audit:** snapshots frozen at 2026-11-05 23:59:53; 0 alerts/24h;
scheduler `INTELLIGENCE_UNAVAILABLE` every tick.

## Post-P1 deploy record

| Ref | Content | Deploy state |
|---|---------|--------------|
| PR #304 → `336bc8a4` | P1 production verification docs | MERGED |
| PR #305 → `726bedc1b2a8` | P4 cross-merchant webhook-routing ambiguity fix (`WEBHOOK_STORE_AMBIGUOUS`) | MERGED ~10:25Z; **DEPLOYED VERIFIED ~10:56Z** (`/ready` flip, tick 10:56:33Z `failed=0, succeeded=1`, `python_ready=true`); Vercel PROMOTED `dpl_4oMgo4k6ma1RzK9EoivguHNGS243` |
| PR #306 → `e8adae9232a026eb2dd00d9e8b6fd593a86fcfe4` | P4 WooCommerce scheme-mismatch findStore fix | MERGED ~11:15Z (all CI green); Vercel PROMOTED `dpl_6DQDRz5BXuks78wmCVH4NTSytHXy`; **Render backend NOT deployed as of ~11:35Z probe** — operator action pending |
| PR #307 → `414210b3be74` | docs-only record of #306 merge state | MERGED 11:06Z (this branch base) |

## Evidence appended by this PR (2026-11-06 ~13:45Z)

| # | Evidence | Source |
|---|----------|--------|
| V22 | P5 shop/redact de-transacted: no interactive multi-statement `$transaction`; ordered idempotent single-statement steps; per-step failure tagging `SHOP_REDACT_STEP_FAILED:<step>` (`failed_step`, `cause`); delivery row marked `failed` with that code; retry converges | code review + `privacyWebhookService.js`; workflow 6/6 + regression 4/4 green |
| V23 | P4 token encryption v2 (AES-256-GCM): new encryptions `v2:<iv(12B)>:<tag>:<ct>`; v1 CBC read-back only (shape-gated `ENCRYPTION_FORMAT_UNKNOWN`); keys 64-hex enforced at module load | `encryption.js`; 5/5 tests |
| V24 | P3 in-flight delivery recovery: stale `received` rows (wall-clock ≥ threshold, default 900s) flipped to `failed` with explicit reason → provider redelivery re-claimable; never re-executes business logic; scheduler interval 5 min, env-tunable; startup pass wired; never blocks ticks (errors logged, cycle continues) | `webhookDeliveryRecovery.js` + `schedulerService.js` diff; 3/3 tests |
| V25 | P3 adopt-by-topic: legacy-URI subscriptions adopted in place (no duplicates, no silent remote URI migration); `shopify_webhook_legacy_subscription_adopted` warn; local registration converges on remote URI | `shopifyWebhookService.js`; 7 scenarios green |
| V26 | P2 reconciliation tooling: dry-run default; `--apply` gated on `REVLUMA_RECONCILE_CONFIRM_DELETIONS=DELETE-SOURCE-ABSENT-PRODUCTS`; empty source hard-refused (override `REVLUMA_RECONCILE_ALLOW_EMPTY_SOURCE=ALLOW-EMPTY-SOURCE-DELETE`) | `productReconciliation.js`, `scripts/productSyncReconcile.js`; 7/7 tests |
| V27 | P2 access diagnostic contract: `GET /api/v1/admin/shopify/stores/:storeId/access` (admin key, no-store): allow-list output; live vs recorded scopes; per-collection probes; `scope_query_ok=false` + null flags on scope-query failure; no ids/tokens/PII anywhere | `shopifyAccessDiagnostic.js` + `adminShopifyDiagnosticsController.js` + `adminRoute.js` mount; 4/4 tests |
| V28 | P2 loud partial failure: product sync throws carry `sync_stage`/`pages_completed`/`products_upserted`; `shopifySync` logs them (+`http_status`) on `shopify_sync_failed` | code + fixture assertions; suites green |
| V29 | P6-D frontend quiet-turn rendering review: conversational/clarify/refuse turns render no report scaffolding; evidence pill honest; pending steps never claimed complete | `RevAnswerView.tsx` / `RevIntell.tsx` review — no defect found |
| V30 | P6 fixture-level live-acceptance: 11/11 (`test_rev_eleven_scenarios.py`) against real `route_message` | pytest 11/11 pass |
| V31 | Python suites: 57 conversational + 667 routing/investigation/metric/failure/golden | pytest (local) — green |
| V32 | RLS inventory READ-ONLY: 17/17 audited tables `relrowsecurity=true` (7 also FORCE) | supabase SQL 2026-11-06 |
| V33 | Index inventory READ-ONLY: hot paths indexed (`webhook_deliveries(status,received_at)` etc.); no migration applied | supabase SQL 2026-11-06 |
| V34 | npm audit (production deps): backend 7 (4 low/3 high, both highs not safely fixable pre-launch); frontend 2 moderate (react-router 6→7 breaking) — recorded as known limitations, no dependencies changed | `npm audit --omit=dev` |
| V35 | Tenant-isolation audit (2026-11-06): no unscoped cross-tenant read found; pixel path HMAC-SHA256 + timing-safe compare; unsigned → 404 | static audit (see MASTER-COMPLETION-CHECKLIST.md → P4.3) |

## Not verified (explicitly)

- P2 production source-to-DB reconciliation (permission-blocked; empty-source inference only). See P2-P6-PRODUCTION-REPORT.md.
- P3 remote subscription reconciliation (registration of PRODUCTS_*, duplicate cleanup, retired store) — approval-gated.
- P3 production delivery reliability — zero deliveries in 7 days; indistinguishable idle vs failure.
- P4 two-merchant production exercise (would write data); global domain uniqueness; re-encryption apply (approval-gated).
- P4.8/P4.9 items specifically: never executed.
- P5 live compliance run; Shopify protected-customer-data eligibility (unknown — external).
- P6 live 11-scenario acceptance with tool-invocation counts (user-only authenticated session;
  procedure in `REV-LIVE-ACCEPTANCE-RUNBOOK.md`); DSAR SLA uncertified.
- Full backend suite in sandbox (`prisma generate` needs `binaries.prisma.sh`, unreachable from this
  environment; 9 pre-existing suites are CI-only — unchanged as of this writing).
- Python-service deploys evidenced behaviorally, never by deploy metadata (Render exposes no API here).
- Post-merge verification of this PR: **pending merge**; must capture `/ready` node_build flip and
  scheduler `failed=0` tick before any PRODUCTION VERIFIED claim for V22–V28, V30.

## Incident timeline reference

See `MASTER-EXECUTION-REGISTER.md` → P1 for the 2026-11-03/2026-11-06 failure chain and the root-cause
statement (pooler does not pin backend↔transaction; single statements or one atomic message only).
