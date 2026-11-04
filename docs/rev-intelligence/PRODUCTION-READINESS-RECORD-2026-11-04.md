# Revluma Production-Readiness Record — Final Hardening & Release Certification

Date: 2026-11-04 · Branch: `arena/4f3ee579-revluma` · Base: main `7f27913af71e26226e7db61b2879c72d2a358737`

This is the persistent certification record required by the final production
hardening directive. Every "verified" claim below names the evidence that was
actually executed or queried on 2026-11-04; every gap is stated as a gap.
**Deployment green ≠ production-ready**: rows that require a redeploy say so.

---

## 1. Commits and pull requests

| Item | Value |
|---|---|
| Base | main `7f27913` (PR #288 records) |
| Commit 1 | `ff36d5f` — Data-API lockdown migration, dependency upgrades, churn contract root-cause fix, PII redaction (both services), 25 FK indexes |
| Commit 2 | `fc5cd6e` — churn job-state observability, capacity record, three routing false-positive fixes, guard gap, 26-case Phase 7 eval set |
| Commit 3 | `b84bd7b` — this record, certification issues log, Python 0.6.0 marker |
| Commit 4 | `d4fd5b5` — FK indexes declared in `schema.prisma` (zero-drift), both hardening migrations added to the CI candidate list (root cause of the first red run: CI created `rev_is_org_member` with default PUBLIC EXECUTE) |
| PR | #289, `arena/4f3ee579-revluma` → `main` — **MERGED 2026-11-04T17:03:11Z**, merge commit `f7c2d651a0c8f2f26d210d5d039c7b27897302e0`, CI green (12/12 checks) |

## 2. CI status

**Green on `d4fd5b5`** (PR #289): Backend suite, Dashboard suite + production
build, Prisma bootstrap/financial/security regressions (runs
`verify-security-hardening.sql` and the extended
`verify-data-api-isolation.sql` — including live `SET ROLE` negative attempts —
against a disposable database with both hardening migrations applied),
python-regressions, task025, task026, Vercel ×2.

## 3. Deployed-version tracking

| Layer | Deploy ID | Version marker | Status |
|---|---|---|---|
| Node API (Render `srv-db9m6pom7kps73dtk1tg`) | `dep-dblkudjl550s73f83o80` | `/ready.node_build = 7f27913af71e` | live; **must be redeployed (user-only) to carry this branch** |
| Python ML (Render `srv-db9m923ncjis739s8co0`) | `dep-dblkud2fngtc738b04og` | `/ready.python_version = 0.5.0` | live; **redeploy (user-only) must show `0.6.0`** (bumped in this branch) |
| Frontend (Vercel `prj_4f3MJwxdXHDQguveNw5dZaVr7fQj`) | `dpl_Ewu7dt5S1vg9r6SzhvHoPVmeFLLw` | commit `2f627f3` promoted | live; this branch changes no frontend behaviour |

Post-merge verification protocol (exact, values now known): fetch
`https://revluma-backend-vrsd.onrender.com/ready` → assert
`node_build == "f7c2d651a0c8"` (merge SHA prefix) **and**
`python_version == "0.6.0"` → then run the database checks in §8 (churn
self-heal: 11 active customers scored within a day; `automation_job_state`
row `daily-churn` = `completed`, `succeeded=11`, `failed=0`).

## 4. Live health checks (executed 2026-11-04, ~16:09 UTC)

`/ready` (post-lockdown, production): `status=ready, database_ready=true,
python_ready=true, python_model_status=beta_ready, python_models_missing=[],
redis_ready=true, redis_configured=true, scheduler.available=true`,
business-state last pass `completed 16:08:27Z, failed=0, succeeded=1,
organizations=1`. `/health` is static liveness and cannot fail on an optional
downstream outage (verified in code, `app.js`).

## 5. Database security & tenant isolation (Phase 3) — VERIFIED IN PRODUCTION

Executed against project `jblpgqmbgdlzitprudgt` (not inspection alone):

- **Pre-state (queried, worse than the advisor summary):** `anon` and
  `authenticated` held full `arwdDxtm` grants — including **TRUNCATE, which
  bypasses RLS** — on all 63 public tables; `events_public_insert` policy had
  `WITH CHECK (true)`; default privileges regenerated those grants for new
  tables; `rev_is_org_member` (SECURITY DEFINER) was executable by `anon`.
- **Lockdown applied** (migration `20261104170000`, idempotent, also runs in
  CI): all direct grants for anon/authenticated revoked, policy dropped,
  default ACL reset to `{postgres, service_role}`, function execution
  restricted (member check → authenticated only; queue trigger fn → owner
  only). 25 tenant RLS policies + RLS on 65 tables retained as
  defense-in-depth.
- **Post-state (queried):** 0 remaining table grants for anon/authenticated;
  0 `events_public_insert` policies; privilege matrix all-false (anon SELECT
  conversations/orders, TRUNCATE users, INSERT events; authenticated SELECT
  messages, INSERT memories, DELETE refresh_tokens, UPDATE _prisma_migrations;
  anon EXECUTE `rev_is_org_member`).
- **Live negative access tests: 8/8 DENIED** (`pg_temp.negative_access_report`
  + DO-block attacks, run as `SET ROLE anon`/`authenticated`): forged
  `app.current_org_id` GUC read, forged `request.jwt.claims`, anon TRUNCATE,
  events INSERT, anon privileged RPC, anon SELECT users, authenticated UPDATE
  orders, authenticated DELETE merchant_memories.
- **Application path intact post-lockdown:** `/ready` healthy; business-state
  job completed 16:08Z with 0 failures (Node/Python connect as postgres —
  service-role path never exposed to clients).
- **CI pin:** `Backend/scripts/staging/verify-data-api-isolation.sql` extended
  with the lockdown invariants and live `SET ROLE` negative attempts inside
  `BEGIN…ROLLBACK`.
- Two-merchant cross-tenant HTTP test: not executable from the sandbox (no
  authenticated production session — same blocker as §6); the database-layer
  equivalents above are executed and denied-by-default.

## 6. Live merchant conversation acceptance (Phase 2) — USER-ONLY BLOCKER

The 10-message transcript on `revluma-test-store-v1.myshopify.com` requires an
authenticated production browser session that does not exist in the sandbox.
Exact steps for the user: open the dashboard chat on the test store and send,
in order: "Hey chat" · "How are you doing?" · any natural line · "I'm worried
about my sales" · "why did sales drop this week" · "What about last week?" ·
"Thanks, that helps." · a general ecommerce question · a return to the revenue
topic · "change all my prices to $10" (must refuse). Expected gates, now pinned
as executable evals (`test_conversational_evaluation_phase7.py`): conversational
/ conversational / conversational / **conversational (emotion first — fixed in
this branch)** / tools(revenue, this week) / tools(revenue, last week) /
conversational / conversational(knowledge) / tools(revenue, week-before) /
**refuse (guard, pre-model)**.

## 7. Dependency & supply-chain audit (Phase 4)

- **Backend:** `npm audit` 15 → 7 advisories; remaining are transitive,
  not reachable from production code paths, risk-accepted (documented in the
  PR description). No `--force` used. Lockfile committed.
- **Dashboard:** dead deps removed (`zod`, `@hookform/resolvers` — unused);
  `vite@^7.3.7`, `vitest@^5.1.0`, `@vitejs/plugin-react-swc@^4.3.3`;
  **0 critical/high/moderate/low**; 449/449 tests; production build clean.
- **Python:** `fastapi==0.162.0`, `uvicorn==0.54.0`, `pydantic==2.14.2`
  pinned in `requirements.txt`; remaining 104 advisories are in the
  ML toolchain (mlflow server components — unreachable: the app embeds only
  the tracking client against a remote registry; sklearn left at the version
  the registered model pickles were built with). Risk-accepted with rationale.
- Suites after upgrades: Python 1530 passed / 4 known env-only failures /
  3 skipped; Node contract tests 24/24; Dashboard 449/449 + build.

## 8. Churn-scoring failures (Phase 5) — ROOT-CAUSED, FIX IN THIS BRANCH

- **Symptom:** 11 `daily_churn_customer_failed` warnings per run, hourly.
- **Root cause (proven from production data, not assumed):** all 11 active
  test-store customers have `ltv_currency IS NULL`. The financial-integrity
  rule correctly refuses to treat unlabelled LTV as money and sends
  `avg_order_value: null` / `customer_ltv: null`; Node's
  `validateChurnFeatures` demanded a finite number for every feature and
  Python's pydantic schema rejected null with 422. Every affected customer
  failed every run since the rule shipped (last successful scores 2026-11-02
  04:23Z, model `m4-v1.0`; 0 fallback scores persisted — no fabricated data,
  contained per-customer, hourly self-healing retry).
- **Fix:** the contract now carries "unknown money": Node accepts null for
  `avg_order_value` only (all other features stay strict); Python accepts
  `Optional` for `avg_order_value`, `customer_ltv` (and `OfferFeatures.ltv` —
  same latent bug). Inference already scores None as missing and never
  escalates on an unverified LTV. Regression tests: `churnFeatureContract`
  (4), Python schema + unverified-money predict (2).
- **PII redaction:** churn failure logs on both services now carry a
  deterministic pseudonym (`sha256(customer_id)[:16]` as `customer_ref`)
  instead of the raw shopper UUID; correlation IDs pseudonymised; failure
  errors carry `error.code` so outages are distinguishable from contract
  rejections. Regression tests: `churnWorkerLogging` (1), Python fallback-log
  redaction (1).
- **Observability:** `runChurnQueue` moved to the Postgres job lock; every
  hourly pass writes status (`completed/partial/failed`), counters and latency
  to `automation_job_state` (job `daily-churn`). Regression: `churnQueueJobState` (2).
- **Post-redeploy verification (pending, user-only redeploy):**
  `SELECT count(*) FROM customers WHERE status='active' AND churn_scored_at >
  now() - interval '1 day'` must reach 11, and `automation_job_state` row
  `daily-churn` must show `completed` with `succeeded=11, failed=0`.

## 9. Reliability inventory (Phase 5) — verified in code during this audit

Per-customer failure isolation (tested); Redis locks with local fallback and
Postgres locks as system of record; startup stagger against pool bursts;
webhook dedupe/idempotency (prior hardening PRs #264–#269); sync-freshness
monitoring (>120 min stale → HIGH `INTEGRATION_FAILURE` finding) and
stuck-sync recovery (>20 min, `shopifySyncRecovery.js`); SSE stream contract
tests; readiness reports actual dependency health; pool budget logged at
startup (Node 10 + Python 12 vs Supabase 60).

## 10. Performance & capacity (Phase 6)

- 25 FK covering indexes created (migration `20261104180000`, applied to
  production): **uncovered FK count now 0**; planner usability proven via
  `enable_seqscan=off` EXPLAIN (`notifications_user_id_idx`,
  `conversation_messages_business_state_id_idx`). None redundant (prefix check
  against `pg_index`).
- Production Rev-turn latency (`conversation_messages.latency_ms`, n=15):
  p50 18.8 s, p95 44.3 s, max 45.9 s — **at the 45 s `ML_TIMEOUT_MS`
  ceiling**; documented, not masked.
- Capacity record: `docs/engineering/REV_CAPACITY_AND_PERFORMANCE.md`
  (free-tier limits, 500-merchant arithmetic, minimum viable configuration
  ≈ $39/mo + 2 code changes). **No infra upgrades performed.**

## 11. Conversational quality (Phase 7)

- 26 new labelled eval cases (76/76 across both eval files): multilingual
  (Pidgin, Yoruba, Spanish, French), adversarial injection (pure vs embedded
  legitimate read), manipulated-model readings, mixed intent, 14-turn long
  context with topic drift + returning follow-up, provider recovery, and an
  aggregate metrics test pinning **false-positive investigation rate = 0**,
  **false-negative rate = 0**, guard accuracy, clarification accuracy.
- Three real false-positive classes found and fixed: social fast path
  swallowing thanks+question mixed intents; "worried about my sales" firing
  an investigation instead of emotion-first; advice questions inheriting the
  previous investigation's subject via and/also prefixes. Plus a guard gap:
  destructive verbs against merchant data ("delete all customers") now refuse
  pre-model.
- Pinned master regression preserved: bare "hmm" still clarifies (an ACK_WORDS
  widening was reverted when it conflicted).

## 12. Advisor results

No security-advisor tool exists on the connector; every advisor finding was
replicated via direct `pg_catalog` queries (which found the grants **worse**
than summarized — TRUNCATE bypasses RLS) and is now pinned in CI SQL.
Performance advisor: 25 FKs → resolved (§10).

## 13. Scheduler results (live DB, 2026-11-04)

business-state: completed 16:08Z, failed=0 (post-lockdown). Per-organization
builds completing ~11 s each. intelligence-findings: completed 15:38Z.
monthly_model_monitoring: completed 2026-11-02 08:18Z. daily-churn: first
persisted state appears after the redeploy (§8).

## 14. DB persistence verification

conversation_messages carries `response_mode` (mapper contract tests; MODE-PERSIST-001
closed by PR #281 checks); latency_ms populated (n=15 measured); churn columns
real (`churn_probability/tier/scored_at/model_version`); 5 customers scored
2026-11-02 with model `m4-v1.0`; 0 fallback-scored rows (no fabricated scores
during the failure window); 108 churn training observations.

## 15. Limitations (honest register)

1. Phase 2 live transcript + two-merchant HTTP isolation test: user-only
   (no authenticated production session in sandbox). DB-layer equivalents
   executed instead (§5).
2. Render redeploys: user-only. Until they happen, production still runs
   `7f27913`/0.5.0 — the churn fix, redaction, job-state and routing fixes
   are merged but **not live**.
3. Churn self-heal confirmation: pending redeploy (§8 query).
4. Free-tier capacity ceiling: p95 at the ML timeout; 500-merchant plan
   documented, not executed (§10).
5. Python suite has 4 known env-only failures in the sandbox (missing
   DATABASE_URL-dependent paths); CI runs them green.

## 16. Rollback

- Migrations: both are additive/idempotent; lockdown rollback = re-grant SQL
  (kept in the migration's comments), index rollback = `DROP INDEX
  CONCURRENTLY`.
- Services: Render keeps prior deploy IDs (`dep-dblkudjl550s73f83o80`,
  `dep-dblkud2fngtc738b04og`) for one-click rollback; Vercel promotion
  history intact.
- Code: routing fixes are behaviour-additive guards; revert commit `fc5cd6e`
  to restore prior routing, `ff36d5f` for the contract/schema state.
