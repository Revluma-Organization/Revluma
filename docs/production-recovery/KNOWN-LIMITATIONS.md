# REVLUMA — Known Limitations (Production Recovery Operation)

Current as of 2026-11-06. This file is updated as each workstream closes; nothing here is
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

- Ingestion scope/grants unverified at time of writing; any field or scope Shopify withholds
  will be listed here once P2 reconciliation runs.

## P3 — Webhooks

- Remote-subscription changes (including duplicate deletion) are approval-gated; until approved,
  duplicate registrations may continue to deliver; idempotency at delivery time is the
  mitigation being verified, not deletion on suspicion.

## P4 — Store identity

- Two production store records claim one Shopify domain. Until the authorized classification,
  token ownership and tenant-scoping review completes, the correct owner of that domain is not
  certified. No transfer/revoke may occur without explicit founder approval.

## P5 — Privacy

- Protected-customer-data eligibility with Shopify may block full erasure-proof end-to-end
  verification; if so it will be named here with the exact approval required.

## P6 — Rev intelligence

- Verification is bounded by what live production data supports. Metrics with no trustworthy
  source in the canonical layer are documented as unavailable, never estimated.

## Cross-cutting

- **Stale `business_states` rows from before the fix are not automatically purged.** Retention
  prunes `is_current = FALSE` rows beyond the configured window on successful builds; bulk
  cleanup of historical rows requires explicit approval.
- Local test rig vs CI parity: local runs use a self-provisioned Postgres (`empty_ci`); CI
  replays prisma-push. Schema provisioning is kept identical in tests.
- Pre-existing provider-dependent `phase2_business_state_fidelity` failures (if observed in CI)
  are unrelated to this operation and tracked separately; they must not mask new failures.
