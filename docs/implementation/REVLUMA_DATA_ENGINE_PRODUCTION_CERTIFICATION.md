# Commerce data engine — production certification

Research 2026-11-05; certification review 2026-11-06 against branch
`arena/720ddf38-revluma` (commits 39422b6, d5f8e0a, e759dac, 626fb51 on top of
`4410460` = `origin/main`).

## Verdict

**NOT CERTIFIED FOR AUTONOMOUS OPERATION — and honestly scoped otherwise.**

This release delivers reviewed, tested ingestion and integrity hardening for the
test store's Shopify connection, plus a deterministic metrics/evidence layer. It
does **not** re-certify the whole platform, does **not** verify live Shopify
grants, and does **not** prove end-to-end behavior on two independent merchants.
It is safe to merge on the strength of CI + code review + the local test
evidence below; it is not a blanket production sign-off.

## What is certified (code + tests, this branch)

- Webhook duplicate/pending semantics fail safe (`WEBHOOK_DELIVERY_PENDING`,
  processed-only duplicates, store/topic identity on claim) — unit level.
- Nested Shopify connections (line items) are fully paginated fail-closed —
  unit level.
- Decimal-exact order-coverage certification rejects bad money, duplicate IDs,
  excluded timestamps — unit level.
- Privacy mandatory topics have a durable idempotent workflow with RLS-locked
  storage — unit level; redaction correctness vs live Shopify payloads unverified.
- Product ingestion path (mapping, pagination, webhooks) — unit level.
- Metrics engine and claim grades — unit level, deterministic, no I/O.
- Supabase production (read-only, 2026-11-06): project ACTIVE_HEALTHY; 197
  processed webhook deliveries, 0 pending/failed; store row active; orders 5 /
  customers 21 / carts 35 / products 0 (product sync not yet deployed).
- Render `/ready`: database/redis/python ready; deployed build `4410460` —
  **this branch is not deployed yet.**

## What is NOT certified

1. **Live scope grant state** — `granted_scopes` is an install-time OAuth
   record; `currentAppInstallation.accessScopes` was not queried live. Treat
   actual grants as unverified until post-merge verification.
2. **Source-vs-store parity** (orders/items/products/customers counts, refund
   totals) — not run; no credentialed Shopify access from this environment.
3. **Deployed behavior of this branch** — nothing on this branch is in
   production until merge + Render/Vercel deploy + smoke verification.
4. **Two-org tenant isolation E2E** — single test store only.
5. **60-day boundary correctness over real data** — `read_all_orders` absent;
   certification covers a 14-day window only.
6. **Full Python suite** — not all Python tests execute in this sandbox
   (missing fastapi/mlflow/pandas/httpx); those suites are unaffected by this
   branch but unverified here.
7. **CI on the release PR** — pending at the time of writing; merge is gated
   on green CI.
8. **Freshness of `business-state` scheduler** — production shows
   `INTELLIGENCE_UNAVAILABLE` for one org (visible failure). Not diagnosed;
   unrelated to this branch's diff; must not be reported as healthy.
9. **Duplicate `webhook_registrations` active rows** (2× per topic in
   production) — recorded, not remediated (no write without review).

## Conditions to full certification

1. Release PR merged with green CI (backend-tests, rev-python-tests, plus
   existing regression workflows).
2. Render deploy verified at `/ready` showing the merge SHA; Vercel production
   READY from `main`.
3. Post-deploy on test store: `product_sync` stage appears in logs; product
   rows upsert; a `PRODUCTS_UPDATE` webhook round-trips; coverage attestation
   re-minted or visibly absent with reason.
4. Live scope check vs install record; duplicate webhook subscriptions
   reconciled; findings appended to the coverage audit doc.
5. Second-organization (or sandbox-twin) isolation + privacy drill; sign-off
   recorded here.
6. `read_all_orders` / protected-customer-data decisions by Shopify
   (external). Until then: 60-day claims only; marketing-copy certification
   for protected-data use blocked.

## Rollback

- Backend: Render redeploy previous `main` (4410460). Migration
  `20261105230000_add_privacy_requests` is additive (new table, RLS, no data
  change) — safe to leave in place; revert path is "drop table" only if
  desired, never required for rollback.
- Frontend: Vercel instant-rollback to `dpl_7R7vfMJfFD1LAstPANLA3LNM7rzK`.
- No destructive SQL is part of this release.

## Final statement

Code-level safeguards requested for this project are implemented and tested.
Production behavior is partially observed (live counts, readiness) and
**unverified for every element that requires Shopify or Render credentials**.
This document will be updated after merge with deploy IDs and post-deploy
results; until then, any claim of "production certified" would be fabrication.
