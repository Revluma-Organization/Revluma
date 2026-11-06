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

## Merge and post-merge verification (2026-11-06)

- PR **#300** merged at 2026-11-06T05:54:53Z as merge commit
  `89ce2d8ca4ffb8e196daea370b8641ba87829b41` (16/16 checks green: backend,
  Backend test suite, python-regressions, Dashboard, Prisma bootstrap /
  financial & security regressions on real PG 16, task025–032 integration,
  Vercel, Vercel Preview Comments).
- One CI regression was found and fixed during the release: eager
  `productSync` require pulled the token-encryption key check into module
  load, crashing integration contexts that do not set
  `SHOPIFY_TOKEN_ENCRYPTION_KEY` (b2c0d4e). No test was weakened; no checks
  bypassed.
- **Vercel production**: `dpl_3CQ7vKtHV5wR8eHH3NU8FUo6qHXQ` READY/PROMOTED,
  aliased to `revluma.vercel.app`, built from `main` @ `89ce2d8`.
- **Render backend**: NOT YET OBSERVED on the new build — `/ready`
  reported `node_build` `4410460de483` at 2026-11-06T06:10Z (16+ minutes
  post-merge; auto-deploy timing/enabled state is not verifiable from this
  environment). On next backend boot, `prestart` runs
  `prisma migrate deploy`, which applies `20261105230000_add_privacy_requests`.
  Until then `privacy_requests` does not exist in production (verified via
  read-only information_schema query, 2026-11-06T06:02Z: table absent).
  **Action: trigger/verify the Render Node service deploy of `main`; then
  confirm `/ready` shows `89ce2d8`, `privacy_requests` exists, and the first
  scheduled sync logs `product_sync`.**
- `products` row count and first live `product_sync` evidence: pending the
  backend deploy above; do not claim catalogue coverage until then.

## Final statement

Code-level safeguards requested for this project are implemented and tested;
CI on the merge commit is fully green and the frontend is deployed. Production
backend migration + live-store behavior remain **pending deploy verification**.
Any claim of full production certification before those checks would be
fabrication; the verdict above therefore remains **NOT CERTIFIED** until the
Render deploy is verified.
