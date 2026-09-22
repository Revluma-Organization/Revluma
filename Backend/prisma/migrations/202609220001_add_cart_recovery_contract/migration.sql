ALTER TABLE "abandoned_carts"
  ADD COLUMN IF NOT EXISTS "recovery_url" TEXT;

CREATE INDEX IF NOT EXISTS "idx_abandoned_carts_store_external"
  ON "abandoned_carts" ("store_id", "external_cart_id");
