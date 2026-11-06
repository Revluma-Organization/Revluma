# Revluma Shopify data coverage audit

Research and observation date: **2026-11-05/06**. Baseline commit `4410460`
(`origin/main`); branch work `arena/720ddf38-revluma`. This is an audit of what
exists and what is granted — **not a production certification**. See
docs/implementation/REVLUMA_DATA_ENGINE_PRODUCTION_CERTIFICATION.md for the
certification verdict and docs/implementation/REVLUMA_DATA_ENGINE_ACCEPTANCE_TESTS.md
for the acceptance matrix.

No Shopify credential, customer PII or token was read, printed or stored during
this audit. Production reads were aggregate counts only, scoped to
`revluma-test-store-v1.myshopify.com`.

## Production observations (2026-11-06 05:35 UTC, read-only)

Test store `revluma-test-store-v1.myshopify.com`; Supabase project
`jblpgqmbgdlzitprudgt` (eu-west-1, PostgreSQL 17.6.1, ACTIVE_HEALTHY; db/rest/
storage/auth healthy).

| Observation | Value | Caveat |
|---|---|---|
| `stores` row | platform `shopify`, status `active`, installed 2026-10-26 22:45:06 UTC, token present | `last_synced_at` 2026-11-06 05:18:50 UTC is a recorded timestamp of the last sync run, **not** proof of completeness or token validity |
| Stored `granted_scopes` (OAuth record) | `read_orders, read_customers, read_products, read_analytics, read_checkouts, read_draft_orders, read_inventory, read_locations, read_marketing_events, read_price_rules, read_reports, read_shopify_payments_accounts, read_shopify_payments_disputes, read_shopify_payments_payouts, read_themes, read_content, read_fulfillments, read_assigned_fulfillment_orders, read_merchant_managed_fulfillment_orders, read_shipping, read_returns, read_payment_terms, read_customer_events, write_discounts` | OAuth record at install time. **Not** a fresh `currentAppInstallation.accessScopes` result. Live grant state is NOT VERIFIED (no credentialed Shopify call possible from this environment) |
| `read_all_orders` | **absent** | Order history is limited to the default 60-day window unless Shopify grants `read_all_orders` (protected; Shopify approval). Not applied for by this work |
| Rows: `orders` | 5 (ordered_at 2026-10-27 → 2026-10-30) | Counts are not source parity |
| Rows: `order_items` | 5 | |
| Rows: `customers` | 21 | Not proof of completeness or consent state |
| Rows: `products` | 0 | Product sync did not exist in deployed code at observation time; empty ≠ absent in Shopify |
| Rows: `abandoned_carts` | 35 | |
| `webhook_deliveries` | 197 `processed`, 0 `pending`, 0 `failed` | Lifetime count; see duplicate-subscription note below |
| `webhook_registrations` | 9 commerce topics × (2 × `active` + 1 × `succeeded`) rows | Two active rows per topic indicates duplicate Shopify-side subscriptions or re-registration rows; **not deleted** here (no authorized write). Needs reconciliation via Shopify API when credentials are available |
| Render `/ready` (revluma-backend-vrsd.onrender.com) | `node_build` `4410460de483`, `database_ready: true`, `python_ready: true` (python_version 0.6.0, models `beta_ready`), `redis_ready: true` | `/ready` is a liveness/readiness surface; it is not a data-certification |
| Render scheduler `business-state` job | status `failed` at 2026-11-06T05:34:52Z, `INTELLIGENCE_UNAVAILABLE` for one organization; latency 12.2s, 1 failed / 0 succeeded | Visible failure — the platform surfaces it; it is NOT silently swallowed. Cause not diagnosed from this environment; no evidence ties it to the commerce changes on this branch (deployed build is still `4410460`) |
| Vercel production (`revluma` project) | deployment `dpl_7R7vfMJfFD1LAstPANLA3LNM7rzK`, READY/PROMOTED from `main` @ `4410460` | Frontend is static + Dashboard; deploys on push to `main` |

## Capability register — per-resource status

Statuses: `VERIFIED ACCESSIBLE` (live API call succeeded with evidence) ·
`IMPLEMENTED AND SYNCHRONIZED` (code + deployed + reconciled) ·
`IMPLEMENTED (UNVERIFIED LIVE)` (code + tests, never exercised against the live
store) · `ACCESSIBLE BUT NOT IMPLEMENTED` (scope granted, no ingestion path) ·
`PARTIALLY ACCESSIBLE` · `REQUIRES ADDITIONAL SCOPE` · `REQUIRES SHOPIFY
APPROVAL` · `REQUIRES MERCHANT AUTHORIZATION` · `NOT EXPOSED` ·
`NOT VERIFIED`.

Two layers are recorded separately wherever relevant: **store-level** (shop
token) and **merchant/account-level** (staff, billing, organization) and
**third-party app data** (other apps' records in the store).

| Domain | Store-level status (2026-11-06) | Evidence / notes |
|---|---|---|
| Store identity/config (shop, currency, timezone) | IMPLEMENTED (UNVERIFIED LIVE) | `shopifyController`/`stores` row; currency/timezone captured at install; no live Admin comparison performed |
| Orders + line items | IMPLEMENTED (UNVERIFIED LIVE) | `shopifySync.syncOrders` → `orders`/`order_items`; nested-line completeness hardened (commit 39422b6); 5 local orders; **60-day window** (`read_all_orders` absent); refunds/transactions have no tables |
| Customers | IMPLEMENTED (UNVERIFIED LIVE) | `syncCustomers` → `customers` (RFM fields computed in-house); protected-data approval state unverified |
| Products/variants | IMPLEMENTED (UNVERIFIED LIVE) — **this release** | `productSync.js` (626fb51): paginated root+nested variants, fail-closed; `products` table empty at audit time because code was not deployed |
| Inventory/levels | ACCESSIBLE BUT NOT IMPLEMENTED | `read_inventory` + `read_locations` in OAuth record; `products.stock_quantity` populated by product sync; no location-level inventory history, no inventory-item API sync |
| Locations | ACCESSIBLE BUT NOT IMPLEMENTED | scope present; no sync path |
| Refunds/returns | PARTIALLY ACCESSIBLE | `read_returns` granted; order-level `refunded_total` stored; **no refunds/returns tables**; no line-level refund attribution |
| Fulfillments | ACCESSIBLE BUT NOT IMPLEMENTED | `read_fulfillments` (+ assigned/merchant-managed fulfillment orders) granted; no ingestion |
| Checkouts / abandoned carts | IMPLEMENTED (UNVERIFIED LIVE) | `abandonedCheckouts` sync; 35 local `abandoned_carts`; nested-item completeness hardened; recovery linkage via `orders.abandoned_cart_id` |
| Marketing events | ACCESSIBLE BUT NOT IMPLEMENTED | `read_marketing_events` granted; no ingestion, no ad-spend source (correct: none exists via this API) |
| Discounts / price rules | ACCESSIBLE BUT NOT IMPLEMENTED | `read_price_rules` granted for reads; **`write_discounts` is granted and unused by Revluma** (flagged for separate review; not removed) |
| Draft orders | ACCESSIBLE BUT NOT IMPLEMENTED | `read_draft_orders` granted; no ingestion |
| Reports / analytics / ShopifyQL | ACCESSIBLE BUT NOT IMPLEMENTED | `read_reports`, `read_analytics` granted; `shopifyqlQuery` eligibility not verified for this app; no ingestion |
| Shopify Payments (accounts/disputes/payouts) | REQUIRES SHOPIFY APPROVAL / NOT VERIFIED | scopes in OAuth record; Shopify Payments eligibility and approval not verified; no ingestion; Revluma's own billing uses Paystack, unrelated |
| Customer events / pixels | ACCESSIBLE BUT NOT IMPLEMENTED | `read_customer_events` granted; `events` table is populated by first-party pixel, not by Shopify customer events |
| Themes / content | ACCESSIBLE BUT NOT IMPLEMENTED | `read_themes`, `read_content` granted; not commerce data; no ingestion |
| Shipping | ACCESSIBLE BUT NOT IMPLEMENTED | `read_shipping` granted; no ingestion |
| Payment terms | ACCESSIBLE BUT NOT IMPLEMENTED | `read_payment_terms` granted; no ingestion |
| Merchant/staff account data (staff list, billing of merchant, org data) | NOT EXPOSED | Shop app token does not grant staff or merchant billing data; no path exists or is sought |
| Third-party app data | NOT EXPOSED | Cannot read other apps' private data; only public webhooks/API of this app |
| Order history before 60 days | REQUIRES SHOPIFY APPROVAL | `read_all_orders` protected; not granted; backfill blocked until approval |
| Bulk operations | NOT VERIFIED | Administratively available; not exercised; would require correct webhook opt-in flow — not implemented |

## Cross-tenant and RLS posture

- Every commerce table carries `store_id`; stores carry `organization_id`.
  RLS is enabled on `privacy_requests` (migration `20261105230000`), with the
  API-role grants revoked, matching the `20261104170000_supabase_data_api_lockdown`
  pattern: the database API (PostgREST/GraphQL) roles hold **no** table grants;
  access is only via the backend service role with explicit `organization_id`/
  `store_id` filters.
- `rev_is_org_member(uuid)` remains granted to `authenticated` for policy use;
  `PUBLIC` execute revoked.
- Two-tenant behavior is covered by focused tests (store-identity verification on
  webhook claims, store-scoped redaction/delete). A genuine second live
  organization was **not** available for end-to-end verification — see
  REVLUMA_DATA_ENGINE_PRODUCTION_CERTIFICATION.md §Limitations.

## What this audit does NOT establish

- Live scope grants, token validity, deployed API version parity, source-vs-
  store row parity, deletion propagation, or historical completeness.
- That `last_synced_at` reflects any particular domain's completeness.
- That any number above generalizes beyond the single authorized test store.

## Immediate actions taken from this audit

1. Products ingestion path added (626fb51) so `products` is no longer empty by
   code default; deploy pending via normal merge → CI → deploy flow.
2. `read_products` added to the OAuth mandatory scope union (read-only; no new
   write scopes).
3. Duplicate webhook-registration rows recorded for review; left untouched.
4. `write_discounts` flagged for a separate, reviewed scope-reduction plan.
