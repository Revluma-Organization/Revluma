# REVLUMA — Master Completion Checklist (Production Recovery P1–P6)

**As of:** 2026-11-06 ~12:20Z · **Branch:** `arena/097a7439-revluma` (docs follow-up) · **Scope:** the production-recovery
certification assignment (P1–P6) and its release gate.

**Status vocabulary (binding):** NOT STARTED · IN PROGRESS · IMPLEMENTED · TESTED · MERGED ·
DEPLOYED · **PRODUCTION VERIFIED** (direct production evidence only) · BLOCKED · **APPROVAL REQUIRED**
(implemented/documented; never executed without explicit founder/user authorization).

"TESTED" = automated regression suite green in this branch or CI. "PRODUCTION VERIFIED" is granted
only by direct observation of production behaviour or state (probe, scheduler outcome, read-only
SQL), never by unit tests.

---

## P1 — Business-state persistence & scheduler recovery

| # | Item | Status | Evidence / note |
|---|------|--------|-----------------|
| P1.1 | Root-cause + fix of persistence failure (single-statement autocommit, compensation, gate) | **PRODUCTION VERIFIED** | Commit `5699c55`, PR #303, merge `eaced144b33c8`; `/ready` flips; post-deploy snapshots for all 5 orgs; scheduler tick 09:33:37Z `failed=0, succeeded=1` |
| P1.2 | Regression suites (atomicity 6, write-scope 10, persistence lock 16) | TESTED | Python suite 1567 passed / 1 skipped at merge time |
| P1.3 | Post-merge deploy verification (Node + Vercel + Python ticks) | **PRODUCTION VERIFIED** | `/ready` node_build `eaced144b33c` ~09:35Z; repeat cycle 09:47–09:48Z |
| P1.4 | Deploy-interruption self-heal via DB claim TTL (600s) | **PRODUCTION VERIFIED** | Observed at 09:21:17Z deploy flip; recovered via TTL 09:31:17Z, zero manual action |
| P1.5 | Phantom "running" heartbeat hardening (startup claim sweep) | NOT STARTED (accepted bounded degradation) | Documented in KNOWN-LIMITATIONS P1-6 |

## P2 — Shopify product ingestion

| # | Item | Status | Evidence / note |
|---|------|--------|-----------------|
| P2.1 | Sync path correctness (pagination, idempotency, decimals, variants, loud malformed failure) | TESTED | `shopifyProductSync.test.js` 8/8; `shopifyProductSync.reconciliation.test.js` 7/7 (this branch) |
| P2.2 | Loud partial-failure counters (`pages_completed`, `products_upserted` on thrown errors) | IMPLEMENTED + TESTED | `productSync.js` throws annotate sync_stage/counters; `shopifySync.js` logs `pages_completed`/`products_upserted`/`http_status`; suites green |
| P2.3 | Source-to-DB reconciliation tooling (`productReconciliation.js`, `productSyncReconcile.js`) | IMPLEMENTED + TESTED | Dry-run default; `--apply` gated on `REVLUMA_RECONCILE_CONFIRM_DELETIONS=DELETE-SOURCE-ABSENT-PRODUCTS`; empty-source hard refusal (override `REVLUMA_RECONCILE_ALLOW_EMPTY_SOURCE=ALLOW-EMPTY-SOURCE-DELETE`); 7/7 tests |
| P2.4 | Read-only access diagnostic (`GET /api/v1/admin/shopify/stores/:storeId/access`) | IMPLEMENTED + TESTED | `requireAdminKey`, no-store, allow-list output only; live vs recorded scopes; per-collection probes ok\|empty\|access_denied\|error:<code>; `scope_query_ok=false` + null flags on scope-query failure; no PII/token material; 4/4 tests |
| P2.5 | **Production evidence that the Shopify source actually contains what we persist** | **BLOCKED (permission/access)** | Live Shopify read impossible from this environment; all Shopify stores hold 0 product rows; `last_synced_at` advances with `read_products` recorded ⇒ empty-source inference only — NOT a reconciliation; founder/user action required |
| P2.6 | Full-sync deletion of source-absent rows | APPROVAL REQUIRED (documented; tool gated) | Register item 9; never executed |

## P3 — Webhook registration & delivery reliability

| # | Item | Status | Evidence / note |
|---|------|--------|-----------------|
| P3.1 | HMAC-SHA256 raw-body verification (401 pre-processing) | TESTED | `shopifyWebhookDeliverySafety.test.js` 3/3 (pre-existing) |
| P3.2 | Claim-before-process + P2002 identity checks; retry-once; never-ack-before-success | TESTED | Same suite + privacy workflow 6/6 |
| P3.3 | Read-only drift report (`shopifyWebhookDriftReport.js` + `shopifyWebhookTopics.js`) | TESTED | 5/5 drift tests; 12 required topics; exit 1 on drift / 2 on access failure; mutates nothing (operator-run only) |
| P3.4 | Rapid adoption of legacy-URI subscriptions (adopt-by-topic, no duplicates, no silent URI migration) | IMPLEMENTED + TESTED | `shopifyWebhookService.js`: on exact-URI miss, adopt existing same-topic subscription at remote URI; warn `shopify_webhook_legacy_subscription_adopted`; local row records remote URI + `last_error=legacy_callback_url_adopted:…`; 7 scenarios; zero duplicate creation |
| P3.5 | In-flight delivery recovery (`webhookDeliveryRecovery.js` + scheduler wiring, 5 min interval, 900s stale threshold) | IMPLEMENTED + TESTED | Flips wall-clock-stale `received` rows to `failed` with explicit reason so provider redelivery can re-claim; never re-executes business logic; 3/3 tests; wired into `startScheduler` + `stopScheduler` + startup passes + exports; env-tunable (`WEBHOOK_DELIVERY_RECOVERY_INTERVAL_MS`, `WEBHOOK_DELIVERY_STALE_SECONDS`) |
| P3.6 | Remote subscription remediation (register PRODUCTS_* ×3 stores; delete 16 legacy-URL duplicates; retired-store rows) | APPROVAL REQUIRED (documented; not executed) | Exact proposals in register; pre-flight = drift report per store |
| P3.7 | **Delivery reliability observed in production** | **BLOCKED (visibility)** | 0 deliveries in 7 days (idle vs dead subscriptions indistinguishable here); needs merchant traffic or an authorized live exercise |

## P4 — Store identity, tenancy & security

| # | Item | Status | Evidence / note |
|---|------|--------|-----------------|
| P4.1 | Cross-merchant webhook-routing ambiguity → fail-closed `WEBHOOK_STORE_AMBIGUOUS` | **PRODUCTION VERIFIED (deployed) 2026-11-06 ~10:56Z** | PR #305 → `726bedc1b2a8`; `/ready` flip + scheduler tick `failed=0, succeeded=1`; fixture suite 7/7 |
| P4.2 | WooCommerce scheme-mismatch findStore fix | MERGED (PR #306) and **DEPLOYED** (backend serving `55639425b3f5` since ~12:05Z) | Verified 2026-11-06 ~12:05–12:09Z; fixture-verified 7/7 |
| P4.3 | Tenant-isolation audit of all application data paths (2026-11-06) | **TESTED by inspection** | No unscoped cross-tenant read found: rev/settings/shopify/dashboard/intelligence/operational paths org- or store-scoped; churnWorker/shopifySync store-scoped; pixel path HMAC-gated (`public_tracking_key`, timing-safe; unsigned → 404); internal/admin diagnostics key-authed; ambiguity fails closed everywhere |
| P4.4 | Token encryption v2: AES-256-GCM (`v2:<iv>:<tag>:<ct>`), v1 CBC decrypt-only compat, shape-gated | IMPLEMENTED + TESTED | `encryption.js` rewritten; malformed values throw `ENCRYPTION_FORMAT_UNKNOWN`; 5/5 tests |
| P4.5 | Re-encryption tooling (`scripts/reencryptStoreTokens.js`) | IMPLEMENTED + TESTED | Dry-run default; `--apply` gated on `REVLUMA_REKEY_CONFIRM=REENCRYPT-ALL-SHOPIFY-TOKENS`; 3/3 tests |
| P4.6 | RLS inventory (17 audited tables) | **PRODUCTION VERIFIED (read-only)** | All 17 `relrowsecurity=true` (7 also FORCE); defense-in-depth gap noted (products, order_items, webhook_*, audit_logs, automation_job_state, business_states, sequence_sends, ml_session_features, privacy_requests enabled-not-forced — app-role least privilege holds via scoping; no policy change made) |
| P4.7 | Hot-path index audit (`webhook_deliveries`, products, orders, stores, events) | **PRODUCTION VERIFIED (read-only)** | Required indexes present; no migration needed; watch item: `stores.shop_domain` seq-scan fine at 4 stores, index before ~100 |
| P4.8 | Global `(platform, shop_domain)` uniqueness / transfer-delete-revoke of conflicted store `revluma-test-store.myshopify.com`; CBC→GCM re-encryption apply | APPROVAL REQUIRED | Register items 4–6; **never executed**; conflicted stores untouched |
| P4.9 | Two-merchant production isolation exercise | APPROVAL REQUIRED (would write data) | Not performed by design |

## P5 — Privacy / data governance / Shopify compliance

| # | Item | Status | Evidence / note |
|---|------|--------|-----------------|
| P5.1 | Durable-first idempotent compliance workflow (customers/data_request, customers/redact, shop/redact) | TESTED | 6/6 workflow suite green throughout |
| P5.2 | Regression pins (deterministic keys; artifact v1 schema; pseudonymisation; orders retention) | TESTED | `privacyWorkflowRegression.test.js` 4/4 |
| P5.3 | **shop/redact de-transaction**: no wrapping interactive `$transaction`; ordered idempotent single-statement steps (children→parents: sequence_events → … → customers) with per-step error tagging; final `stores.update(status=redacted, tokens NULL)` last | TESTED | Root cause of 2026-11-06 persistence incident class (pooler scatters statements; interactive tx semantics unusable); failure ⇒ `SHOP_REDACT_STEP_FAILED:<step>` with `failed_step` + `cause`; delivery row marked `failed` with that code; each statement commits independently; retry converges; privacy workflow 6/6 + regression 4/4 green after rewrite |
| P5.4 | Protected customer data + compliance webhook approval (Partner Dashboard) | APPROVAL REQUIRED (external, Shopify) | Eligibility/review state unknown — named blocker |
| P5.5 | Live end-to-end compliance exercise on production | APPROVAL REQUIRED (would write/redact merchant data) | Never executed |
| P5.6 | DSAR SLA / retention certification | BLOCKED (needs 5.4 + 5.5) | Uncertified by design |

## P6 — Rev intelligence live-data certification

| # | Item | Status | Evidence / note |
|---|------|--------|-----------------|
| P6.1 | Standing certification (deterministic layer, golden set 507, gates) | TESTED (2026-11-04 PARTIAL) | `docs/rev-intelligence/REV-CONVERSATION-EXPERIENCE-CERTIFICATION.md` — unchanged |
| P6.2 | Deterministic reply layer routing suites | TESTED | 667 passed (routing/investigation/golden/registry/metrics/failure/mode) |
| P6.3 | Conversational experiential suites | TESTED | 57 passed (routing, greeting, social, follow-ups) |
| P6.4 | **11-scenario acceptance at fixture level** (real `route_message`, gate + no-fabricated-tools assertions) | TESTED | `python/tests/test_rev_eleven_scenarios.py` **11/11**; scenario 8 asserts `gate='clarify'` + `clarification_needed`; scenario 11 asserts `gate='refuse'` before any tool invocation; scenario 5 asserts `classification.response_mode='analysis'`; see `REV-LIVE-ACCEPTANCE-RUNBOOK.md` |
| P6.5 | P6-D frontend quiet-turn rendering review (§16 contract) | REVIEWED (no defect) | Conversational/clarify/refuse turns never render report scaffolding; evidence-state pill honest; `STEP_STATUS_WORD` maps pending→“did not run”, running→“was still running” (never claims completed) |
| P6.6 | **Live 11-scenario conversational acceptance with tool-invocation counts (authenticated session)** | **APPROVAL REQUIRED (user-only; not runnable read-only)** | Counts never estimated; exact procedure in `REV-LIVE-ACCEPTANCE-RUNBOOK.md` |
| P6.7 | `metric_registry` fail-closed behaviour for non-computable metrics | TESTED | 20 metrics registered; registry suite green |

## Cross-cutting / release gate

| # | Item | Status | Evidence / note |
|---|------|--------|-----------------|
| X.1 | Full backend suite locally | BLOCKED (sandbox) — CI is truth | `prisma generate` needs `binaries.prisma.sh` (unreachable; allowlist); 9 pre-existing suites CI-only (unchanged count); npm test sweep aborts at `.prisma/client/default` |
| X.2 | npm audit (production deps) | KNOWN/limited | Backend: 7 (4 low, 3 high) — `@sendgrid/mail→deepmerge` prototype pollution (fix = 6.5.2 breaking downgrade, not applied), `prisma→deepmerge-ts` stack exhaustion (CLI-time only; fix = prisma 7 major, not applied). Frontend: 2 moderate (react-router 6→7 breaking, not applied). Rationale: no breaking dependency changes 3 days pre-launch; all three documented in KNOWN-LIMITATIONS |
| X.3 | RLS/index audit (read-only) | DONE | See P4.6/P4.7 — no schema change applied |
| X.4 | 4 recovery docs end-state rewrite + this checklist + live-acceptance runbook | **DONE** (merged as PR #308) | `docs/production-recovery/*.md` |
| X.5 | Branch hygiene | DONE | Only `arena/f9c10395-revluma`; never #299; PR not merged by tool at time of writing |
| X.6 | ONE coherent PR: code + tests + docs | **MERGED** (PR #308, 2026-11-06T11:30:16Z → `55639425b3f5`; all CI green; Vercel Production success 11:32:35Z) | — |
| X.7 | Post-merge `/ready` probe + scheduler outcome re-check | **DONE — DEPLOYED VERIFIED** (Node + Python both live since ~12:05Z) | `/ready` `node_build=55639425b3f5` (cache-busted probe ~12:05Z); deploy-interrupted pass self-completed 12:09:12Z `failed=0, succeeded=1`; all 5 orgs × 1 current snapshot each (direct SQL); http probes during ~12:05–12:12Z served edge-cached copies of the interrupted claim — direct DB read authoritative |
| X.8 | Backfill: none | — | No production data written by any step of this checklist |

## Explicit non-claims

- No live product reconciliation (P2.5), no live webhook remediation (P3.6), no live privacy exercise
  (P5.5), no global uniqueness migration (P4.8), no count-bearing live acceptance (P6.6) have been
  executed, and no evidence for them is fabricated anywhere in this tree.
- "PRODUCTION VERIFIED" appears above only where direct production observation existed at statement
  time (P1.x, P3.x post-#305/#306 probes, P4.1, P4.6/P4.7 read-only audits, X.x probe references).
