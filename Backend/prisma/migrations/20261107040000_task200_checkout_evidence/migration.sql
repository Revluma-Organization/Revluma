-- Task 200: source-faithful Shopify checkout evidence. All changes are additive.
ALTER TABLE "abandoned_carts"
  ADD COLUMN IF NOT EXISTS "external_checkout_name" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "source_resource" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "source_state" VARCHAR(32) NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS "source_created_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "source_updated_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "abandonment_observed_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "retrieved_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "subtotal" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "tax_amount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "shipping_amount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "duties_amount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "taxes_included" BOOLEAN;

ALTER TABLE "abandoned_cart_items"
  ADD COLUMN IF NOT EXISTS "external_line_item_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "sku" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "discounted_unit_price" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "original_line_total" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "line_subtotal" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "currency" VARCHAR(3);

CREATE INDEX IF NOT EXISTS "idx_checkouts_org_source_created" ON "abandoned_carts" ("store_id", "source_created_at");
CREATE INDEX IF NOT EXISTS "idx_checkouts_source_lifecycle" ON "abandoned_carts" ("store_id", "source_resource", "status");
CREATE INDEX IF NOT EXISTS "idx_checkout_items_source_line" ON "abandoned_cart_items" ("abandoned_cart_id", "external_line_item_id");
CREATE INDEX IF NOT EXISTS "idx_checkout_items_variant" ON "abandoned_cart_items" ("external_variant_id");
