# Shopify data access — capability register

Research date: **2026-11-05**; production observations **2026-11-06**. GraphQL
version examined: `2026-10` (repository default; deployed configuration
unverified). Shopify access is conditional on app distribution, API version,
grants, protected-data approval, merchant plan and staff permissions; field-level
requirements must be re-verified per version before relying on them.

Statuses: `VERIFIED ACCESSIBLE` = observed working live with evidence (none yet —
no credentialed Shopify call was possible in this environment) ·
`IMPLEMENTED (UNVERIFIED LIVE)` = code + tests on this branch, never exercised
against the live store · `IMPLEMENTED AND SYNCHRONIZED` = also reconciled
against the live source (none yet) · `ACCESSIBLE BUT NOT IMPLEMENTED` ·
`PARTIALLY ACCESSIBLE` · `REQUIRES ADDITIONAL SCOPE` · `REQUIRES SHOPIFY
APPROVAL` · `REQUIRES MERCHANT AUTHORIZATION` · `NOT EXPOSED` · `NOT VERIFIED`.

Store-level (shop token) vs merchant/account-level (staff/billing) vs
third-party app data are called out per row. Shopify sources:
[scopes](https://shopify.dev/docs/api/usage/access-scopes) ·
[Admin GraphQL](https://shopify.dev/docs/api/admin-graphql/latest) ·
[bulk operations](https://shopify.dev/docs/api/usage/bulk-operations/queries) ·
[privacy](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance) ·
[ShopifyQL](https://shopify.dev/docs/api/shopifyql).

| Resource (fields / relationships) | Revluma status 2026-11-06 | Notes / next step |
|---|---|---|
| Shop identity, currency, timezone | IMPLEMENTED (UNVERIFIED LIVE) | Captured at install; no live parity comparison performed |
| Products, variants | IMPLEMENTED (UNVERIFIED LIVE) | `read_products` OAuth record present; `productSync.js` (626fb51) paginates root + nested variants, fail-closed, decimal-string prices; `products.stock_quantity` usable for availability |
| Product media, collections, metafields/metaobjects | ACCESSIBLE BUT NOT IMPLEMENTED / NOT VERIFIED | `read_content` granted; field-level scope matrix unverified; no ingestion |
| Inventory levels, items, locations | ACCESSIBLE BUT NOT IMPLEMENTED | `read_inventory`, `read_locations` granted; no location model; inventory *value* not computable (no unit-cost field) |
| Orders, line items, totals | IMPLEMENTED (UNVERIFIED LIVE) | `read_orders` (60-day default); nested lineItems fully paginated with fail-closed truncation (39422b6); local: 5 orders / 5 items |
| Order history beyond 60 days | REQUIRES SHOPIFY APPROVAL | `read_all_orders` protected; not granted; do not request without authorization |
| Refunds | PARTIALLY ACCESSIBLE | order-level `refunded_total` stored; no refund table, no line attribution; `read_returns` granted for returns |
| Returns | PARTIALLY ACCESSIBLE | `read_returns` granted; no ingestion, no model |
| Fulfillments | ACCESSIBLE BUT NOT IMPLEMENTED | `read_fulfillments`, `read_assigned_fulfillment_orders`, `read_merchant_managed_fulfillment_orders` granted; no ingestion |
| Abandoned checkouts + items | IMPLEMENTED (UNVERIFIED LIVE) | Nested-item completeness hardened; 35 local carts; recovery linkage present |
| Checkout events (`read_checkouts`) | ACCESSIBLE BUT NOT IMPLEMENTED beyond carts | Direct checkout-object sync is `abandonedCheckouts`; raw checkout events not ingested |
| Customers, consent | IMPLEMENTED (UNVERIFIED LIVE) | `read_customers` present in OAuth record; protected customer-data approval state NOT VERIFIED; minimal-PII handling in place; RFM computed locally |
| Customer events / pixels | ACCESSIBLE BUT NOT IMPLEMENTED | `read_customer_events` granted; first-party pixel only today |
| Marketing events / attribution | ACCESSIBLE BUT NOT IMPLEMENTED | `read_marketing_events` granted; **no ad-spend source exists** — Revluma must never invent ROAS/ad spend |
| Discounts / price rules | ACCESSIBLE (READ) BUT NOT IMPLEMENTED | `read_price_rules` present; **`write_discounts` present and unused — flagged for separate review** |
| Draft orders | ACCESSIBLE BUT NOT IMPLEMENTED | `read_draft_orders` granted |
| Reports / analytics | ACCESSIBLE BUT NOT IMPLEMENTED | `read_reports`, `read_analytics` granted; ShopifyQL eligibility NOT VERIFIED |
| Shopify Payments accounts / disputes / payouts | REQUIRES SHOPIFY APPROVAL / NOT VERIFIED | Scopes in OAuth record; eligibility + approval unverified; no ingestion |
| Shipping / payment terms | ACCESSIBLE BUT NOT IMPLEMENTED | `read_shipping`, `read_payment_terms` granted |
| Themes | ACCESSIBLE BUT NOT IMPLEMENTED | Not commerce data; not ingested |
| B2B, markets, subscriptions, gift cards, wholesale | NOT VERIFIED | No scopes verified; would need per-section eligibility review |
| Bulk operations (queries) | NOT VERIFIED | Read-only async queries; not exercised; needs webhook opt-in verification before use |
| Merchant/staff account data (staff, merchant billing, org profile) | NOT EXPOSED | Shop token cannot see these; do not infer them |
| Third-party app data | NOT EXPOSED | Only public interfaces of this app |

**Deletion semantics.** `products/delete`, `orders/*`, `customers/*` webhooks are
subscribed (12 required topics, 626fb51 / prior). `orders/delete` tombstones via
`order_cancellation_tombstones` handling in the sync path; full per-resource
tombstone propagation for every domain remains open (see task register DE-006).

**Rules for extending this register.** A row may move to IMPLEMENTED only with
(1) code + tests merged, (2) a live reconciliation result recorded in
docs/research/REVLUMA_SHOPIFY_DATA_COVERAGE_AUDIT.md, and (3) tenant-isolation
evidence. Grants recorded at install are necessary, never sufficient.
