# REVLUMA — Known Limitations (Production Recovery Operation)

Current as of 2026-11-06 (~13:45Z). This file is updated as each workstream closes; nothing here is
waived silently. "BLOCKED" entries name the exact external dependency.

## P1 — Business-state persistence

1. **Bounded no-current window.** If a build fails between flipping the previous `is_current`
   snapshot out and flipping the new one in, the organization has no current snapshot until the
   next successful build. Accepted by design: loud failure, never a torn write; self-healing on
   the next successful scheduler tick.
2. **Pooler behaviour is environment-fact, not a fix.** Supavisor (transaction mode) scatters
   statements across server backends and does not honour client-transaction pinning. Any code
   that relies on cross-statement transaction semantics (advisory locks, savepoints spanning
   statements, multi-statement PQexec) will silently degrade in production while passing tests
   on normal Postgres. All future persistence code must be written as single statements or
   shipped as one atomic message verified in production.
3. **Diagnostics are pids, not guarantees.** `pg_backend_pid()` differing between statements is
   expected here; it is logged for regime detection only and never gates success.
4. **Retention is best-effort housekeeping.** `prune_superseded_snapshots` failures are logged
   and swallowed by design; the table may temporarily exceed the retention window.
5. **This fix cannot be validated anywhere but production** for the pooler scatter failure mode.
   Local/CI Postgres confirm correctness and determinism; only production confirms the
   no-scatter regime is tolerated end to end.
6. **Deploy-killed scheduler passes self-heal only at the DB claim TTL (600s).** Observed live
   2026-11-06 09:21:17: the pass was interrupted by a Node redeploy; the claim sat `running`
   until 09:31:17; `/ready` reported a phantom running state meanwhile. A future hardening
   (startup claim sweep) is tracked in MASTER-EXECUTION-REGISTER.md → P1 open items.
7. **Render has no deploy API in this operating environment** (unlike Vercel); Python-service
   deploys are verified behaviorally (scheduler outcomes, snapshot persistence), not by deploy
   metadata.

## P2 — Products

- **All Shopify stores hold 0 product rows** (3 rows total, stale WooCommerce). Sync correctness is
  code-reviewed and fixture-tested (8/8 unit + **7/7 source-to-DB reconciliation suite**); the empty
  catalog is an inference from recorded OAuth scopes + completed syncs on v1, NOT a source-verified
  reconciliation — no authorized path from this environment reaches the live Shopify API.
- **Deletion reconciliation gap:** full syncs upsert but never remove rows hard-deleted in Shopify
  without a `products/delete` webhook, and products webhooks were never registered remotely. Closing
  it is a bulk-deletion behaviour change on production data — approval-gated. This PR merges the
  gated tooling (`productReconciliation.js`, dry-run default; `--apply` requires
  `REVLUMA_RECONCILE_CONFIRM_DELETIONS=DELETE-SOURCE-ABSENT-PRODUCTS`; empty source hard-refused,
  override `REVLUMA_RECONCILE_ALLOW_EMPTY_SOURCE=ALLOW-EMPTY-SOURCE-DELETE`) but executes nothing.
- **Inventory is uncertified:** `read_inventory` granted to v1, but quantities are deliberately not
  persisted by the catalogue sync; the observation module is unwired proof-of-capability. Nothing in
  the catalogue should be read as certified stock.
- **Partial product syncs persist silently until this PR:** a mid-pagination failure previously
  threw with no counters, making it impossible to tell how far a failed run had gotten. Now the
  thrown error carries `sync_stage`/`pages_completed`/`products_upserted` and the failure log
  includes them. Still true: `last_synced_at` advances only on full success (by design) and
  retries converge via idempotent upserts.

## P3 — Webhooks

- **Products webhooks have never been registered** (zero rows in `webhook_registrations` for every
  store, 2026-11-06). Registration is a remote mutation — approval-gated.
- **27 duplicate (store, topic) registration groups** trace to the backend URL migration
  (`revluma-backend.onrender.com` → `revluma-backend-vrsd.onrender.com`). **This PR stops the
  bleeding in code:** adopt-by-topic converges the local registry onto existing remote
  subscriptions (no duplicate creates ever; remote URLs never silently rewritten). It does NOT
  delete the 16 legacy subscriptions — that remains an approval-gated remote deletion.
- **In-flight deliveries are no longer invisible:** deliveries claimed (`received`) but never
  completed were previously stuck until manual DB surgery. This PR adds a scheduler worker that
  flips wall-clock-stale claims (default ≥900s) to `failed` with an explicit reason so the
  provider's redelivery re-claims them. Trade-off accepted: a delivery legitimately taking longer
  than the threshold would be marked `failed` while still running — threshold is env-tunable
  (`WEBHOOK_DELIVERY_STALE_SECONDS`) and never re-executes business logic.
- **7-day delivery silence** (0 deliveries) is unexplained from inside this environment (idle test
  stores vs silently-dead subscriptions indistinguishable). NOT diagnosed, NOT claimed healthy.
- Local sandbox cannot run `prisma generate` (blocked hosts); 9 backend suites rely on CI.

## P4 — Identity, tenancy, security

- **Conflicting store-domain pair** (`revluma-test-store.myshopify.com`: `6340092e…`/org `09ff67bf…`
  vs `009e5c86…`/org `91d88743…`) — unresolved by design; both rows untouched. Webhook resolution
  fails closed (`WEBHOOK_STORE_AMBIGUOUS`, HTTP 5xx → provider redelivery); Woo findStore matches
  bare/https candidates both directions with the same fail-closed ambiguity rule.
- **Global `(platform, shop_domain)` uniqueness does not exist** — cross-tenant domain collisions
  are possible at the data layer and prevented only by resolution fail-closed. Migration/arbitration
  is approval-gated.
- **Token ciphertexts in v1 (AES-256-CBC) remain valid** (decrypt-only compat). New encryptions are
  v2 (AES-256-GCM, authenticated). Bulk re-encryption is merged this PR as dry-run-default tooling;
  `--apply` is gated on `REVLUMA_REKEY_CONFIRM=REENCRYPT-ALL-SHOPIFY-TOKENS` and is NOT executed.
- **RLS is enabled but not forced on 9 tables** (products, order_items, webhook_deliveries,
  webhook_registrations, audit_logs, automation_job_state, business_states, sequence_sends,
  ml_session_features, privacy_requests — 10 tables). Least privilege currently holds via app-role
  scoping (every audited data path is org-/store-scoped or HMAC-gated); no policy was changed in
  this operation because flipping FORCE without rehearsing the app role's requirements could take
  production down. Recorded as defense-in-depth debt, owner: founder/infrastructure.
- **`stores.shop_domain` has no standalone index** — lookups seq-scan (4 rows today). Add an index
  before the store count approaches ~100; deliberately not added pre-launch by this operation.
- **Tenant-isolation audit (2026-11-06) found no unscoped cross-tenant read** across rev/settings/
  shopify/dashboard/intelligence/operational/scheduler/internal paths. This is an inspection result,
  not a proof; isolation for future code paths must be maintained deliberately.

## P5 — Privacy / compliance

- **shop/redact is now de-transacted by design** (this PR): ordered, idempotent single statements
  (children→parents), per-step failure tagging (`SHOP_REDACT_STEP_FAILED:<step>`), `stores.update`
  last. Consequences, accepted and documented: (a) a mid-run failure leaves earlier steps applied —
  by design, retry converges (all steps idempotent); (b) there is no atomic "all or nothing" for
  redact on this pooler, ever — do not reintroduce a wrapping transaction; (c) a permanently
  failing step halts redact at that step and requires operator attention (delivery marked failed
  with the step code; admin page shows the failure).
- **Protected customer data / compliance webhooks: Shopify approval required** — eligibility
  unknown; the app cannot claim production compliance until Shopify reviews and the partner
  dashboard is configured.
- **Live end-to-end exercise never run** (would write/redact live data); DSAR SLA and retention
  windows uncertified. Artifact v1 excludes internal identifiers (pinned by test).
- Pseudonymised emails use `redacted-<sha256[:24]>@redacted.invalid` — deterministic (same input ⇒
  same pseudonym) for cross-system erasure correlation; not reversible; not a privacy proof.

## P6 — Rev live-data certification

- **Deterministic fixtures ≠ live certification.** The 11/11 scenario suite proves routing/gate/
  tool-permission behaviour in-process; it says nothing about tool-invocation counts, latency,
  evidence quality, or prose faithfulness in a real session.
- **Golden set currency:** 507 cases as of 2026-11-04 certification; 667 routing/investigation/
  registry/metrics tests green this revision — but no live acceptance with invocation counts exists.
- **Live accuracy check** (v1: 5 orders USD 3,446.85; latest order 2026-10-30; `revenue_today=0`
  correct as of probe) describes a nearly-dormant store; it cannot demonstrate quality on a busy
  store. Certification on realistic volume is impossible without a merchant with real traffic.
- **`rev-metrics-v1` fails closed** for non-computable metrics — by design Rev says "I can't
  verify that" rather than fabricate; this is correct behaviour, not a bug, and will surface as
  "unverified" answers until data density improves.
- **Frontend quiet-turn rendering** (reviewed this PR): conversational/clarify/refuse never render
  report scaffolding — but the browser was not exercised against this build yet (no authenticated
  session); visual confirmation pending user session.

## Cross-cutting — environment, dependencies, documents

- **npm audit (production dependencies), 2026-11-06:**
  - Backend — 7 findings (4 low, 3 high): `deepmerge` prototype pollution via `@sendgrid/mail`
    (fix = downgrade to `@sendgrid/mail@6.5.2`, breaking — NOT applied), `deepmerge-ts` stack
    exhaustion via `@prisma/config` (CLI/config-time only, not request path — fix = `prisma@7`
    major, NOT applied). Risk accepted explicitly 3 days pre-launch rather than force breaking
    dependency bumps; revisit post-launch with targeted tests.
  - Frontend — 2 moderate: `react-router`/`react-router-dom` ≤7.17.0 (fix = v7 major upgrade,
    NOT applied). Dashboard is embedded + authenticated; exposure limited; revisit post-launch.
- **Sandbox cannot generate Prisma engines** (`binaries.prisma.sh` unreachable): 9 backend suites
  run only in CI. The full `npm test` sweep aborts at `.prisma/client/default`; all suites that
  can run without engines were run and are green (see register).
- **`stores.shop_domain` uniqueness is per-org by design** (`uq_stores_org_domain`); cross-org
  domain collisions are the P4 conflict — do not read the unique index as global uniqueness.
- **Diagnostics endpoints** (`/api/v1/admin/...access`, drift reports, reconcile scripts) are
  operator-only tooling: admin-key/env-gated, tenant-scoped, no PII, mutate nothing without a
  confirmation env var. They are not for merchant consumption and are not public.
- **Docs drift risk is real;** this file, the register, the checklist and the verification report
  must be updated together at every gate (they were, this revision).
