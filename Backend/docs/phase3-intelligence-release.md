# Phase 3 intelligence: release and historical coverage contract

## What is implemented
- Organization-scoped, evidence-gated integration, revenue, and returning-customer detectors.
- Durable `intelligence_findings` with deduplication and lifecycle controls.
- Explicit `POST /api/v1/rev/findings/refresh`, read-only `GET /api/v1/rev/findings`, scoped `GET /api/v1/rev/findings/:id`, and `PATCH /api/v1/rev/findings/:id`.
- Command Center evidence drawer and Rev Intell prefilled investigation (merchant sends manually).
- Per-store `intelligence_order_coverage` certificate schema, with separate customer lifetime verification.

## Historical-data certification: required producer (NOT YET IMPLEMENTED)
The existing Shopify sync iterates GraphQL pages, but this **does not itself certify** that all requested historical orders are accessible or that cancelled/refunded orders are represented consistently. Shopify access scopes, available lookback, pagination, webhook gaps, currency and cancellation accounting must be verified before issuing a certificate.

Only trusted ingestion code may write `intelligence_order_coverage`, never a merchant-facing endpoint. The issuer must:
1. Confirm the store belongs to the organization, is authorized, and the sync run completed all required order pages without errors.
2. Record the exact, provably accessible `coverage_start` and `coverage_end` from source permissions and the completed run, not from earliest/latest local orders.
3. Verify no missing order pages, unprocessed webhook gaps, or invalid order financial statuses in the certified interval.
4. Confirm currency consistency and accurate cancellation/refund handling before enabling revenue findings.
5. Set `customer_lifetime_verified = true` only if the source provides complete **pre-period** purchase history for each relevant buyer; ordinary recent-order sync is insufficient.
6. Invalidate or replace certificates when permissions, ingestion quality, or store access changes.
7. Add integration tests with paginated source fixtures and a connected Shopify test store.

Without an applicable certificate, revenue and customer findings remain suppressed. This is intentional.

## Release gates
- [ ] Backend CI passes at final PR head.
- [ ] Frontend Vercel preview READY at final PR head.
- [ ] Prisma migration reviewed and applied to a staging database, including rollback/recovery plan.
- [ ] Real store test: failed webhook -> persisted finding -> Command Center -> Rev Intell -> lifecycle.
- [ ] Real store test: incomplete historical sync -> no business findings.
- [ ] Trusted coverage issuer + real source verification -> revenue and returning-customer findings enabled only when justified.
- [ ] Production Render workspace selected, deployment verified, database migration verified.

**Do not merge or deploy Phase 3 as complete until these gates pass.**
