# REVLUMA — Known Limitations (Production Recovery Operation)

Current as of 2026-11-06 (~11:10Z). This file is updated as each workstream closes; nothing here is
waived silently. "BLOCKED" entries name the exact external dependency.

## P1 — Business-state persistence

6. **Deploy-killed scheduler passes self-heal only at the DB claim TTL (600s).** Observed live
   2026-11-06 09:21:17: the pass was interrupted by a Node redeploy; the claim sat `running`
   until 09:31:17; `/ready` reported a phantom running state meanwhile. No manual action was
   taken; the mechanism worked. A future hardening (startup claim sweep) is tracked in
   MASTER-EXECUTION-REGISTER.md → P1 open items.
7. **Render has no deploy API in this operating environment** (unlike Vercel); Python-service
   deploys are verified behaviorally (scheduler outcomes, snapshot persistence), not by deploy
   metadata.

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

## P2 — Products

- **All Shopify stores hold 0 product rows** (3 rows total, stale WooCommerce). Sync correctness is
  code-reviewed and fixture-tested (8/8 unit + **7/7 source-to-DB reconciliation suite**:
  page-flush idempotency, exact-decimal pricing, status mapping, 150-variant nested expansion,
  loud malformed-node failure, zero-write empty source); the empty catalog is an inference from recorded OAuth
  scopes + completed syncs on v1 (`read_products` recorded), NOT a source-verified reconciliation —
  no authorized path from this environment reaches the live Shopify API.
- **Deletion reconciliation gap:** full syncs upsert but never remove rows hard-deleted in Shopify
  without a products/delete webhook, and products webhooks were never registered remotely. Closing
  this is a bulk-deletion behaviour change on production data — approval-gated (register item 9).
- **Inventory is uncertified:** `read_inventory` granted to v1, but quantities are deliberately not
  persisted by the catalogue sync; the observation module is unwired proof-of-capability. Nothing in
  the catalogue should be read as certified stock.
- Local sandbox cannot run `prisma generate` (binaries.prisma.sh unreachable); 9 backend suites rely
  on CI for execution evidence.

## P3 — Webhooks

- **Products webhooks have never been registered** (PRODUCTS_CREATE/UPDATE/DELETE: zero rows in
  `webhook_registrations` for every store, 2026-11-06). Registration is a remote mutation and is
  approval-gated (register item 3).
- **27 duplicate (store, topic) registration groups** trace to the backend URL migration
  (`revluma-backend.onrender.com` → `revluma-backend-vrsd.onrender.com`): exact-URI matching in
  reconciliation never matched legacy-URI subscriptions, creating parallel sets. Old-host subscriptions
  may still deliver to the legacy domain; duplicates inside `revluma-test-store` v1 and `6340092e…`
  prove double-firing risk. Cleanup approval-gated (register item 2).
- **Zero webhook deliveries since 2026-10-30 08:00Z** (197 rows, all processed). Whether the test
  stores were simply idle or remote subscriptions are dead cannot be distinguished from inside this
  environment; both readings are documented, neither is asserted as fact.
- Remote-subscription changes (including duplicate deletion) are approval-gated; until approved,
  duplicate registrations may continue to deliver; idempotency at delivery time is the
  mitigation being verified, not deletion on suspicion.
- **Before the P4 fix deployed, the conflicted domain (`revluma-test-store.myshopify.com`) routed
  webhook writes to an ARBITRARY organization** — the fix (`WEBHOOK_STORE_AMBIGUOUS`) is DEPLOYED
  and verified (node_build `726bedc…`, 10:56Z). Deliveries to that domain are now refused fail-closed.
- **Drift report tooling now available** (`scripts/shopifyWebhookDriftReport.js`): read-only remote
  subscription reconciliation per store (missing / unexpected / duplicates-with-counts / legacy URLs);
  exit 1 on drift. It is the evidence pre-flight for any remediation; it mutates nothing.

## P4 — Store identity

- Two production store records claim one Shopify domain (`6340092e…`/org `09ff67bf…` vs
  `009e5c86…`/org `91d88743…`). Until the authorized classification, token ownership and
  tenant-scoping review completes, the correct owner of that domain is not certified. No
  transfer/revoke may occur without explicit founder approval.
- **No global `(platform, shop_domain)` uniqueness exists in `stores`** (only per-org). A third org
  could claim the domain today; arbitration at OAuth install is a product decision (register item 5).
- **Cross-merchant routing ambiguity (found + fixed + DEPLOYED):** `findStore` previously used an
  unordered `findFirst`; post-fix it fails closed with `WEBHOOK_STORE_AMBIGUOUS`. Fix merged via
  PR #305 (`726bedc1b2a8`) and verified deployed ~10:56Z (Render node_build flip + scheduler healthy).
- **WooCommerce webhooks 404 (found + fixed, deploy pending):** `stores.shop_domain` stores
  `https://revluma.local` while the Woo webhook controller strips the scheme before `findStore`.
  Fix matches bare/https candidates both directions (ambiguity still fails closed); resolution
  suite 7/7. Ships in PR #306; verified deployed only after Render node_build flips.
- Full product-sync reconciliation (source-absent row deletion) remains unimplemented and
  approval-gated (register item 9).
- **`products` has no `organization_id`** — tenancy is enforced via `store_id` joins alone; RLS on
  products is enabled with no policies (deny-by-default for API roles) while the app role bypasses RLS.
- **Access tokens are AES-256-CBC** (no AEAD/integrity tag). CBC→GCM requires ciphertext re-encryption —
  approval-gated (register item 6).
- WooCommerce store rows carry protocol-prefixed domains (`https://revluma.local`) while Shopify rows do
  not — normalization conventions differ per platform.

## P5 — Privacy

- **Shopify protected-customer-data / mandatory compliance webhook approval state is UNKNOWN in this
  environment and is the named external blocker** for any production erasure/export demonstration.
- No live compliance webhook has been exercised on production (it would write/redact live merchant
  data; not authorized). Verification is code review + 6/6 fixture workflow tests, including a
  forced-failure leg proving no acknowledgement before durable success.
- GDPR erasure is implemented at row level (events, ML session features, training observations, cart
  scrub, customer pseudonymisation); orders are retained for financial necessity with PII links
  severed. Retention windows and DSAR SLA are not certified.
- Audit trail (`audit_logs`) stores counts and identifiers only; payload artifacts stay in
  RLS-enabled `privacy_requests`.

## P6 — Rev intelligence

- Verification is bounded by what live production data supports. Metrics with no trustworthy
  source in the canonical layer are documented as unavailable, never estimated.
- **The 11-scenario conversational acceptance has not been run** (requires an authenticated production
  session — user-only); the 2026-11-04 PARTIAL CERTIFICATION of the deterministic layer is the
  standing record. Live tool-invocation counts are deliberately not estimated.
- `merchant_memories` = 0 and `context_window`/`summary` are NULL on all conversations — persistent
  business context has never completed in production (P0 noted 2026-11-02, not addressed by this operation).
- Live catalogue is EMPTY (0 Shopify products): catalogue-dependent suggestions have nothing to cite.
- `orders` holds only 5 rows on the v1 store (USD 3,446.85) — any revenue answer against v1 is
  accurate but materially thin.
- Live live-accuracy cross-check (2026-11-06 ~10:50Z) confirmed `revenue_today=0` is the CORRECT
  value (no orders on 2026-11-05/06) and that the production snapshot carries the full telemetry key
  set; no invented fields.

## Cross-cutting

- **Stale `business_states` rows from before the fix are not automatically purged.** Retention
  prunes `is_current = FALSE` rows beyond the configured window on successful builds; bulk
  cleanup of historical rows requires explicit approval.
- Local test rig vs CI parity: local runs use a self-provisioned Postgres (`empty_ci`); CI
  replays prisma-push. Schema provisioning is kept identical in tests.
- Pre-existing provider-dependent `phase2_business_state_fidelity` failures (if observed in CI)
  are unrelated to this operation and tracked separately; they must not mask new failures.
