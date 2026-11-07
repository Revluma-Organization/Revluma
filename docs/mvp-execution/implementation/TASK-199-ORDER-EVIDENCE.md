# Task 199 — Order evidence implementation

## Scope and invariants

Task 199 extends the Task 197 evidence contract and reuses Task 198 revenue semantics. It does not create a second financial model or a chat-only workaround.

- Shopify acquisition remains read-only and requires `read_orders` at sync time.
- Orders, payment state, refunds, fulfillments, delivery events, cancellation and checkout activity remain separate evidence domains.
- Missing, stale, truncated, mixed-currency or failed evidence is unavailable/partial, never a certified zero.
- Every Python order query is scoped by the authenticated organization and active store scope. Relationship resolution also matches store identity, preventing same-organization cross-store relationship attachment.
- Rev receives no customer contact/address fields, refund notes, event addresses, coordinates or customer internal IDs.
- Historical product, variant, SKU, quantity and price fields come from order lines, not the current catalog.

## Acquisition and persistence

`20261107023000_task199_order_evidence` additively adds source order name/update/cancellation fields, historical variant and pricing fields, refund update/adjustment evidence, fulfillment display/delivery state and sanitized fulfillment events. Indexes support tenant/time, order-name and variant retrieval.

`shopifySync.js` uses documented Shopify 2026-10 fields, including `unfulfilledQuantity`; fulfilled quantity is derived as `quantity - unfulfilledQuantity`. It does not query the unsupported `fulfilledQuantity` field.

`orderEnrichment.js` independently paginates refund lines, refund transactions, order adjustments, fulfillment lines and fulfillment events. Every nested connection requires terminal page metadata, stable parent identity, valid IDs, unique IDs, advancing cursors and a bounded page count. A nested failure marks its domain failed and prevents stale-row reconciliation; it cannot be reported as a successful empty/partial run.

Webhook order writes preserve the same historical fields without changing cancellation/refund recovery precedence.

## Canonical evidence and Rev

`python/src/intelligence/order_evidence.py` provides:

- deterministic lifecycle counts and source-status breakdowns;
- historical product/variant quantity, distinct-order and discounted-line-value groups by currency;
- equal-length lifecycle and product/variant comparisons;
- stable order UUID/Shopify ID/name lookup with ambiguity handling and latest-order lookup;
- sanitized line items, refunds, successful/pending transaction state, adjustments, multiple fulfillments, tracking and delivery events;
- store coverage, per-domain pagination ledger and freshness evidence;
- Task 198 recorded-order value/count-derived AOV, never a second revenue calculation.

`order_observations` exposes only allowlisted filters and carries order-domain comparison items into the normal evidence contract. Product investigations now plan this tool. Rev extracts and inherits order filters for follow-ups, persists only bounded `order_query` context and explains financial, fulfillment, cancellation and delivery facts independently.

Filtered lifecycle/product queries do not receive an unfiltered AOV. Product rollups use distinct internal order IDs across variants and explicitly label historical discounted line totals as not net revenue.

## Verified Shopify fields

Shopify 2026-10 documentation was checked for `LineItem`, `Refund`, `Fulfillment`, `FulfillmentEvent` and `OrderAdjustment`. Fulfillment-event acquisition deliberately selects only ID, status, happened-at and estimated-delivery-at; documented address/geolocation fields are excluded. Refund existence is not treated as proof that money returned; transaction status remains separate.

## Validation boundary

Fixtures and mocks are regression tests, not live Shopify scenarios. Production migration, service checks, authenticated organization behavior and real Shopify reconciliation are recorded separately in the Task 199 validation record. No fixture result is presented as production verification.
