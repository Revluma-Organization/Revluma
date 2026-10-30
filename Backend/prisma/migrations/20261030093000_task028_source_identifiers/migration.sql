-- Task 028: preserve distinct Shopify source identifiers; nullable and non-destructive.
ALTER TABLE "abandoned_carts" ADD COLUMN IF NOT EXISTS "source_checkout_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_checkout_token" TEXT,
  ADD COLUMN IF NOT EXISTS "source_cart_token" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "source_checkout_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_checkout_token" TEXT,
  ADD COLUMN IF NOT EXISTS "source_cart_token" TEXT;
CREATE INDEX IF NOT EXISTS "idx_carts_store_checkout_id" ON "abandoned_carts"("store_id", "source_checkout_id");
CREATE INDEX IF NOT EXISTS "idx_carts_store_checkout_token" ON "abandoned_carts"("store_id", "source_checkout_token");
CREATE INDEX IF NOT EXISTS "idx_carts_store_cart_token" ON "abandoned_carts"("store_id", "source_cart_token");
-- No automatic backfill: legacy external_cart_id mixes checkout IDs and cart tokens.
