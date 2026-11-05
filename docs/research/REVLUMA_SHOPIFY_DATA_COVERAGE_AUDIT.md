# Revluma Shopify data coverage audit — initial findings

Date: 2026-11-05. **IN PROGRESS: no production certification.** Repository baseline `4410460`; the workspace also contains earlier unrelated uncommitted Rev UI changes. Findings distinguish code from live data. No Shopify credential or customer identity was retrieved.

## Test-store database observations

Read-only Supabase query filtered solely to `revluma-test-store-v1.myshopify.com`: one store row, status `active`, platform `shopify`, token field present, organization field present, installed `2026-10-26 22:45:06 UTC`, last_synced_at `2026-11-05 18:18:59 UTC`. The field is a recorded timestamp, not proof of completeness or current token validity.

At query time: 5 local orders, 5 order items, 21 customer records, 0 rows in `products`; local order timestamps range `2026-10-27 14:30:28 UTC` to `2026-10-30 08:00:34 UTC`. Counts do not establish Shopify source counts, catalog absence, customer validity, freshness or historical completeness. Do not extrapolate to other stores. `products` being empty does not rule out the separate live catalog observation path.

Stored `granted_scopes` is an OAuth record, **not a fresh `currentAppInstallation.accessScopes` result**. The record contains read_orders, read_customers, read_products, read_analytics, read_checkouts, read_draft_orders, read_inventory, read_locations, read_marketing_events, read_price_rules, read_reports, read_shopify_payments_accounts, read_shopify_payments_disputes, read_shopify_payments_payouts, read_themes, read_content, read_fulfillments, read_assigned_fulfillment_orders, read_merchant_managed_fulfillment_orders, read_shipping, read_returns, read_payment_terms, read_customer_events and `write_discounts`; it does not list `read_all_orders`. Live scope grant, token validity, deployed API version and actual source access remain **UNKNOWN / NOT VERIFIED**. `write_discounts` requires a separate review and safe reduction plan; do not change it here.

## Code inventory (not live verification)

| Domain | Code path and destination | Coverage and limitations |
|---|---|---|
| Installation | `Backend/src/controller/shopifyController.js`, `shopifyService.js`, `utils/encryption.js`; store token field | OAuth exchanges and stores scope record; encrypted-token code exists. Actual deployed encryption configuration, token validity and fresh grant unverified. |
| Orders and order items | `shopifySync.js` GraphQL -> `commerceWebhookService.js` -> `orders`, `order_items`; `verifyOrderReadScope` queries `currentAppInstallation.accessScopes` | Root connections paginated 100 per page, max 100 pages; nested `lineItems(first: 250)` lacks its own pageInfo, a potential silent truncation. Money/cancellation handling needs independent source-value reconciliation. `read_all_orders` recorded absent; actual grant and resulting history unverified. |
| Customers | `syncCustomers` -> `customers` | Selects ID, name, email, phone, state and consent; protected fields and consent source-time semantics need review. Count alone proves neither completeness nor permission. |
| Abandoned checkouts | `syncAbandonedCheckouts` -> abandoned carts and items | Root paginated; nested line items first 250 without pageInfo. Scope, source comparisons, historical and completeness unknown. |
| Products/inventory | `shopifyInventoryObservation.js` reads product and variants live with root pagination and rejects incomplete nested variant pages; it states `alertEligible: false` | Not a certified stock history or full location-specific catalog. Local product table has zero rows; actual Shopify catalog and active production usage unverified. |
| Webhooks | `shopifyWebhookService.js` reconciles configured subscriptions; deliveries tracked in `webhook_deliveries` | Live registrations, delivered events, raw body signature behavior, duplicate/order/retry handling and privacy compliance remain to be verified independently. |
| Revenue evidence | `intelligenceShopifyCoverageProducer.js` compares a 14-day source window with stored orders; `python/src/intelligence/revenue_evidence.py` and `evidence.py` construct evidence | Bounded certification, not complete lifetime/history or universal claim provenance. Disallow invalid source money; a null-to-zero bug is being fixed with regression tests. |
| Rev context | `python/src/intelligence/seven_day_evidence.py`, `revenue_evidence.py`, agents | There are scoped evidence and warning paths; comprehensive metrics and all response claims have not been audited. |

## Prioritized initial gaps

- **P0:** Source certification used JavaScript `Number(null)`/`Number('')`, permitting missing source monetary evidence to look like zero if the local value was zero. Fail closed; test with malformed inputs. No evidence this happened in production.
- **P0:** Nested line-item connections do not request pagination metadata; assess authoritative downstream impact and implement fail-closed pagination/reconciliation with tests.
- **P1:** Actually query `currentAppInstallation.accessScopes` via an authorized backend path without disclosing tokens; compare source records, timestamps and counts with database and Admin. Network/Admin access is presently unverified.
- **P1:** Domain-specific checkpoints, coverage intervals, freshness and source-vs-store reconciliation; inspect existing mechanisms before additions.
- **P1:** Map actual financial definitions, fields, currency precision and timezone; do not call current total profit, net sales or recognized revenue without required evidence.
- **P1:** Review `write_discounts` use and downstream compatibility before proposing scope reduction.

Full code, RLS/policy, webhook, uninstall/privacy, scheduler, Python, deployment and 46-domain audits remain outstanding. No coverage percentage is warranted yet.
