# Shopify commerce data engine implementation plan

Status: **working plan; discovery and production certification incomplete**. 2026-11-05. Baseline `4410460`; repository has separately pending Rev UI work. Prior benchmark, coverage audit and roadmap are initial drafts, not completed comparisons, canonical model or synchronization architecture. Do not conflate target with implementation. API examined: GraphQL Admin `2026-10` (repo default; deployed configuration unverified). Live production Vercel was observed READY/PROMOTED for `4410460`; it says nothing about Render's deployed commit. Supabase project is healthy; health does not prove application correctness.

## Current state and risks

| Severity | Evidence | Finding / next verification |
|---|---|---|
| P0 | `services/shopifySync.js` `syncOrders`, `syncAbandonedCheckouts` | Root pagination exists and caps at 100 pages; child `lineItems(first:250)` lacks pageInfo. Partial lines can be persisted as complete. Workspace increment adds child pagination and fail-closed validation before persistence; schema and live validation remain outstanding. |
| P0 | `services/intelligenceShopifyCoverageProducer.js` | Prior workspace change rejects missing source and local monetary totals rather than coercing them to zero. Focused stubbed tests pass; full CI and deployment outstanding. |
| P0 | `utils/shopify.js` `buildInstallUrl` | Forces `write_discounts`, `read_orders`, `read_customers` in addition to configured scopes. Document dependency and safe scope reduction; do not remove until impacted flows and merchant reauthorization are reviewed. |
| P0 | `services/shopifyWebhookService.js` | Required topics include uninstall, orders, customers and checkouts. Listing uses `first:250` without pagination. Delivery authenticity, durable failure recovery, privacy topics and live subscriptions need separate audit; do not claim complete. |
| P1 | `shopifySync.js` | Customer access-denial can be downgraded; last_synced_at is updated after orders/checkouts despite limited customer access or failed webhook setup. It cannot serve as a domain completeness certificate. |
| P1 | `shopifyInventoryObservation.js` | Live product/variant observation, incomplete child pages fail, explicitly not alert eligible; not a persisted comprehensive location-aware catalog. |
| P1 | `python/src/intelligence/{evidence,revenue_evidence,seven_day_evidence}.py` and `intelligence_order_coverage` | Evidence and bounded coverage mechanisms exist, but not universal provenance or a complete metric engine; validate every cross-tenant and claim gate before extending. |
| P1 | `prisma/schema.prisma` stores, orders, customers, order_items, business_states, conversations, intelligence_findings | Existing models do not prove complete Shopify graph. Inspect actual migrations, RLS, privileges and field usage before any additive model. |
| P1 | `shopifySyncRecovery.js` | Eligibility for stale runs exists; scheduler and recovery correctness need end-to-end verification. |
| P0 | `docs/research/REVLUMA_SHOPIFY_DATA_COVERAGE_AUDIT.md` | Stored OAuth scope list differs from a current Shopify `currentAppInstallation` verification. Actual current scopes, source counts, Render commit and Admin parity remain unknown. |

2026-11-05 Supabase observation for the authorized test store only: active store row; token present; 5 local orders, 5 order items, 21 customers, 0 rows in `products`. Local range and full recorded scopes are in the initial audit. A count is not a source comparison, and the empty local product table is not evidence Shopify has no products. Protected customer values must not be exported. No new source scopes are requested by this plan.

## Target data flow and invariant

```text
Shopify scopes + APIs + authorized events
   -> scope discovery / versioned domain adapter -> durable job/checkpoint
   -> raw minimized source + normalized tenant/store records -> reconciliation
   -> domain coverage/freshness + versioned deterministic metrics
   -> scoped evidence references + constrained Rev context -> merchant
```

```text
connect -> verify grant -> queue per-domain backfill -> page/bulk retrieve
 -> validate whole relationships -> stage -> upsert with org/store ownership
 -> compare source and stored coverage -> certify domain/window only on success
webhook -> raw HMAC -> dedupe durable inbox -> scoped authoritative re-read
 -> version/order guard -> update or tombstone -> acknowledge processing
scheduler -> overlap-window reconciliation -> correct missed changes -> re-certify
question -> intent gate -> required domains & freshness -> scoped metrics/evidence
 -> facts vs calculation vs hypothesis vs unknown -> response with limitations
```

Bulk operations are asynchronous read-only query jobs even though Shopify starts them via an API mutation; never use bulk mutations for commerce changes. Enforce download-host trust, bounded streaming, tenant-bound job IDs, expiry/retry, and prohibit partial-result certification. [Shopify bulk limitations](https://shopify.dev/docs/api/usage/bulk-operations/queries) and [webhook verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries). A merchant-initiated integration authorization or webhook registration is not a Shopify commerce mutation, but operational scope changes require review.

## Resource plan

See `docs/research/SHOPIFY_COMPLETE_DATA_ACCESS_CAPABILITY_REGISTER.md` for the living resource matrix. For every domain select exact API version, field, permission/approval, source time, limits and reconciliation method before implementing it. Unknown means unverified, not absent. All added tables must include tenant/store ownership, unique source IDs, constraints and indexed tenant-first access. Preserve money amounts with ISO currency and decimal precision; do not turn current order totals into profit or accounting revenue. No new resource is certified without live source parity, freshness, tenant tests and completeness evidence.

## Phased work and acceptance gates

1. **P0 integrity and privacy:** close nested pagination false-success, monetary nulls and currency rounding defects, audit HMAC, webhook inbox and compliance handlers. Tests: missing/null/duplicate/stalled/oversized pages, retries, cross-tenant calls, out-of-order events, redaction tests using controlled fixtures. No destructive data operations. Roll back code by revert; no schema required for first slice.
2. **P1 ingestion foundations:** domain-specific sync run states and coverage intervals; scope discovery and reauthorization diagnostics; durable worker/checkpoints, reconciliation and read-only initial backfill. Design additive migrations with reversible rollout, tenant FK/index/RLS review and independently tested recovery; avoid downgrading current tenant isolation. Do not call a partial customer/webhook run fully synchronized.
3. **P1 core graph:** orders, child lines, customers, products, variants, inventories and locations, refunds/returns and fulfillment. First specify precise Shopify fields and scopes, source-to-canonical mapping, child paging, deletion/tombstone behavior, event ordering and parity tests for each adapter; gate unavailable fields and protected data.
4. **P2 evidence and intelligence:** common deterministic decimal/timezone/currency metric definitions, source/derivation/version/freshness metadata, tenant-safe query service and claim classification. Ensure unavailable/partial/stale data stops unsupported claims. Intent gate preserves greetings and ordinary chat. Test calculations against independent fixtures and Admin values.
5. **P2/P3 breadth:** ShopifyQL, marketing, markets, content, B2B, payments, metaobjects and external integrations only after resource-specific permissions/eligibility verified and justified. Shopify merchant/staff account and billing access cannot be inferred from a shop token.
6. **Acceptance:** two genuinely independent org/store tests; compare source retrieval and stored facts against Shopify Admin on `revluma-test-store-v1.myshopify.com`; verify versions and logs for Vercel and Render, live webhook delivery, job recovery and privacy handling. Record discrepancies, evidence and external approvals. Never claim production certification from test fixtures or Vercel readiness alone.

## Execution constraints and ownership

Keep all writes and processing tenant-scoped; never expose customer PII or tokens in evidence or logs. Analyze existing schemas/policies before migrations. No paid upgrades, indiscriminate grants, destructive production SQL or Shopify business changes. Protected-data approval, Shopify owner actions and Render controls may require the user; continue independent work while blocked. PR #299 contains unrelated unverified Rev UI changes; preserve it and do not merge it as a side effect of this project.
