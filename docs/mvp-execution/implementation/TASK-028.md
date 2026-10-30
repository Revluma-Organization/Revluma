# Task 028 — Preserve Shopify source identifiers (IN PROGRESS)

## Scope and evidence
- Task 027 source audit: Shopify Admin returned three orders with distinct checkoutToken values, two cartToken values; Supabase current abandoned_carts.external_cart_id matched zero order checkout tokens and two cart tokens. No real paired checkout.token available in existing DB.
- Existing external_cart_id mixes checkout_id, id, cart_token and checkout_token, so a lossless backfill is impossible without authoritative raw source evidence.
- Task 028 implementation branch stacked on Task027 #222, Task026 #221, Task025 #220 and Task024 #219.

## Changes committed
- Prisma: nullable source_checkout_id, source_checkout_token and source_cart_token on abandoned_carts and orders; merchant-scoped checkout indexes.
- Additive SQL migration with no speculative backfill.
- Shopify webhook order and checkout ingestion now persists distinct identifiers when supplied, without replacing existing external_cart_id or wiping known fields on missing data.

## Verification and safety gates
- **NOT YET VERIFIED:** migration apply to disposable Postgres, full webhook ingestion tests, token-based matching using new columns, reprocessing source payloads, live Shopify checkout/order pair and all-writer enforcement.
- **NOT DEPLOYED:** no production SQL or Shopify mutation performed.
- Task027 remains PARTIAL pending authoritative matched pair and verified universal ownership enforcement.
- No scope expansion, false PASS or fabricated Shopify cardinality claim.
