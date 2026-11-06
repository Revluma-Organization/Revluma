-- Normalized per-variant persistence.
--
-- Before this migration a catalogue with 30 variants was collapsed into the
-- product row (one min/max price). Every variant is now persisted
-- independently with its own identity, pricing, inventory link and options.
-- Non-destructive: additive table only; no existing rows rewritten.
-- RLS enabled; no policies; service-role path only.

CREATE TABLE IF NOT EXISTS "product_variants" (
  "id"                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id"                   uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "product_external_id"        varchar(255) NOT NULL,
  "external_id"                varchar(255) NOT NULL,
  "title"                      varchar(500) NOT NULL DEFAULT '',
  "sku"                        varchar(255),
  "barcode"                    varchar(255),
  "price"                      numeric(12,2),
  "compare_at_price"           numeric(12,2),
  "inventory_item_external_id" varchar(255),
  "weight"                     numeric(12,4),
  "weight_unit"                varchar(32),
  "requires_shipping"          boolean,
  "tracked"                    boolean,
  "available_for_sale"         boolean,
  "selected_options"           jsonb NOT NULL DEFAULT '[]'::jsonb,
  "position"                   integer,
  "created_at"                 timestamptz,
  "updated_at"                 timestamptz,
  "synced_at"                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "product_variants_store_external_key" UNIQUE ("store_id", "external_id")
);

CREATE INDEX IF NOT EXISTS "idx_product_variants_product"
  ON "product_variants" ("store_id", "product_external_id");

ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;
