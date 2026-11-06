# Revluma commerce data intelligence — architecture

Status: **implemented scope described below; certification verdict in
docs/implementation/REVLUMA_DATA_ENGINE_PRODUCTION_CERTIFICATION.md**.
Research baseline 2026-11-05; production observations 2026-11-06.

## System context

```text
Merchant store (Shopify)
   │  OAuth (admin-approved scopes, read-only for commerce)
   ▼
Revluma backend (Node/Express + Prisma, Render)
   ├─ ingestion: shopifySync (initial + scheduled), webhooks (commerceWebhookService)
   ├─ durable webhook inbox: webhook_deliveries (received → processed | failed)
   ├─ canonical model: Postgres via Prisma (org → store → commerce graph)
   ├─ metrics engine: python/src/intelligence/metric_registry.py + commerce_metrics.py (Decimal, rev-metrics-v1)
   ├─ evidence layer: python/src/intelligence/evidence.py (+ revenue_evidence.py, seven_day_evidence.py, multi_period_evidence.py)
   └─ Rev: python/src/agents/* (orchestrator → tools → evidence-backed answers)
Frontend (static + Vite Dashboard, Vercel) ── dashboards & Rev chat UI
Python intelligence service (Render) ── churn/sensitivity models, evidence builders
```

The browser never calls Shopify or the Python service directly; all commerce
data flows through tenant-scoped backend queries.

## Pipeline (connect → answer)

```text
connect        OAuth install → verify grant record → queue per-domain sync
ingest         paginated GraphQL (2026-10) with nested-page fail-closed checks
persist        org/store-scoped upserts; exact decimal strings; IDs preserved
reconcile      14-day source-vs-store window certification (fail-closed);
               webhook overlap reconciliation; hourly scheduled sync
metrics        deterministic Decimal computation; registry-gated availability
evidence       structured references + 4 claim grades (verified_fact /
               calculated_observation / hypothesis / unknown)
Rev            intent gate → domain availability/freshness → retrieve →
               compute → compare → observations → prioritized, evidence-bound
               response with explicit limitations
```

## Component map (implemented)

| Layer | Module(s) | Notes |
|---|---|---|
| OAuth & install | `Backend/src/controller/shopifyController.js`, `utils/shopify.js` | Scope union: configured + mandatory (`read_orders`, `read_customers`, `read_products`). `write_discounts` remains configured (flagged, not removed). Token encrypted at rest (`utils/encryption.js`) |
| GraphQL client | `Backend/src/services/shopifyGraphql.js` | POST to Admin GraphQL `2026-10` (env-overridable); 30s timeout; error bodies sanitized (≤5 errors, ≤300 chars each); token decrypted in-memory only |
| Initial/scheduled sync | `Backend/src/services/shopifySync.js`, `schedulerService.js`, `schedulerLocks.js` | Stages: webhook reconciliation → product_sync → customer_sync → order_sync → abandoned_checkout_sync → coverage certification (best-effort, fail-closed) → RFM. Locks prevent overlapping runs; interrupted runs detected via `status='syncing'` |
| Products | `Backend/src/services/productSync.js` (626fb51) | Root + nested variant pagination; truncated/mid-pagination-changed products abort before writes; decimal-string prices; ACCESS_DENIED downgrade for legacy installs without `read_products` |
| Webhooks | `Backend/src/controller/commerceWebhookController.js`, `services/commerceWebhookService.js`, `services/shopifyWebhookService.js` | HMAC-SHA256 verification on raw body; durable inbox with claim semantics (see SYNC strategy doc); subscription reconciliation to 12 required topics |
| Privacy | `Backend/src/services/privacyWebhookService.js` (d5f8e0a) | `customers/data_request`, `customers/redact`, `shop/redact` as durable, idempotent, tenant-scoped workflows with audit log entries |
| Coverage certification | `Backend/src/services/intelligenceShopifyCoverageProducer.js`, `intelligenceOrderCoverage.js` | Decimal-exact 14-day window compare; timestamp validation; duplicate/excluded-row rejection; writes `intelligence_order_coverage` attestation only on full pass |
| Metrics | `python/src/intelligence/metric_registry.py`, `commerce_metrics.py` | See REVLUMA_EVIDENCE_AND_PROVENANCE_ENGINE.md |
| Evidence | `python/src/intelligence/evidence.py` | Claim grades + deterministic admission rules |
| Rev entry | `Backend/src/controller/revController.js`, `python/src/agents/orchestrator.py`, `tools.py` | Intent → domain retrieval → evidence-backed answer |
| Conversational memory | `python/src/memory/vector_store.py`, `merchant_memories` tables | Separate from facts; correctable/expiring; minimal PII |

## Invariants

1. **Read-only.** No commerce write scope is exercised anywhere. The single
   write scope (`write_discounts`) is granted but unused, pending a separate
   reviewed reduction plan.
2. **Tenant isolation is non-negotiable.** Every commerce row carries
   `store_id`; stores carry `organization_id`. All queries are store- or
   org-scoped; webhook claims verify store identity; RLS enabled on new tables
   with API roles revoked.
3. **Fail closed.** Truncated nested pages, malformed money, missing currency,
   cross-store identity mismatch, or webhook-delivery state ambiguity all abort
   the operation and surface an error — never a silent partial success.
4. **Gaps are data.** Unavailable metrics raise `MetricNotComputableError`;
   partial/unverified syncs never update `last_synced_at` to imply completion
   (only the whole `syncShopifyStore` marks it, and only after orders +
   checkouts succeed); coverage attestations are deleted at the start of each
   run and re-minted only on a full pass.
5. **Provenance before prose.** Rev answers cite metric definition, window,
   currency and store; anything not computable is disclosed as unavailable.

## Context layers (A/B/C)

- **(A) Shopify store context** — synced commerce graph per store (orders,
  items, customers, products, carts).
- **(B) Merchant/Revluma account context** — organization, membership,
  `store_settings`, onboarding profile; defines what Revluma is allowed to do
  (read-only) and the merchant's plan/objectives.
- **(C) Rev conversational memory** — `merchant_memories` + embeddings,
  tenant+user+store isolated, versioned, correctable, expirable. Source wins
  over memory: when live data contradicts a memory, the data is used and the
  memory is corrected or superseded. Memory never carries credentials, tokens,
  or raw PII beyond what the conversation already holds.

Layers are never merged into a single authority: (A) is truth for commerce
facts, (B) is truth for account/permission state, (C) is hints about how the
merchant likes to work — all bounded by store/org scope.

## What is deliberately absent

- No autonomous Shopify mutations, no bulk `mutation` operations, no inventory
  or price adjustments — permanently out of scope for this MVP.
- No cross-currency aggregation (per-currency only; no FX source of truth).
- No invented ad-spend/ROAS, no "profit" without COGS, no CLV without a
  cost/revenue-history basis.
- No ShopifyQL dependency in the critical path (eligibility unverified).
