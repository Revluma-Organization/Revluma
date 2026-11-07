-- Task 199: preserve source order identity, lifecycle and historical line-item evidence.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "external_order_name" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "source_updated_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "cancel_reason" VARCHAR(128);

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "variant_title" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "sku" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "quantity_fulfilled" INTEGER,
  ADD COLUMN IF NOT EXISTS "quantity_remaining" INTEGER,
  ADD COLUMN IF NOT EXISTS "discounted_unit_price" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "original_line_total" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "currency" VARCHAR(3);

CREATE INDEX IF NOT EXISTS "idx_orders_store_ordered_at" ON "orders" ("store_id", "ordered_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_orders_store_external_name" ON "orders" ("store_id", "external_order_name");
CREATE INDEX IF NOT EXISTS "idx_order_items_store_variant" ON "order_items" ("store_id", "external_variant_id");
ALTER TABLE "order_refunds" ADD COLUMN IF NOT EXISTS "source_updated_at" TIMESTAMPTZ(6);
ALTER TABLE "order_fulfillments"
  ADD COLUMN IF NOT EXISTS "display_status" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMPTZ(6);
ALTER TABLE "order_fulfillments" ADD COLUMN IF NOT EXISTS "fulfillment_events" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "order_refunds" ADD COLUMN IF NOT EXISTS "order_adjustments" JSONB NOT NULL DEFAULT '[]'::jsonb;
