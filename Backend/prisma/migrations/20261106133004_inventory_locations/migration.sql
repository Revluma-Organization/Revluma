-- Inventory & locations acquisition. Non-destructive; additive tables.
-- RLS enabled; zero policies; service-role only.

CREATE TABLE IF NOT EXISTS "locations" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id"      uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "external_id"   varchar(255) NOT NULL,
  "name"          varchar(500),
  "is_active"     boolean,
  "country_code"  varchar(3),
  "province_code" varchar(3),
  "address1"      varchar(500),
  "city"          varchar(120),
  "zip"           varchar(32),
  "synced_at"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "locations_store_external_key" UNIQUE ("store_id", "external_id")
);
CREATE INDEX IF NOT EXISTS "idx_locations_store" ON "locations" ("store_id");
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "inventory_items" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id"          uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "external_id"       varchar(255) NOT NULL,
  "sku"               varchar(255),
  "tracked"           boolean,
  "requires_shipping" boolean,
  "weight"            numeric(12,4),
  "weight_unit"       varchar(32),
  "created_at"        timestamptz,
  "updated_at"        timestamptz,
  "synced_at"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_items_store_external_key" UNIQUE ("store_id", "external_id")
);
CREATE INDEX IF NOT EXISTS "idx_inventory_items_store" ON "inventory_items" ("store_id");
ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "inventory_levels" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id"                    uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "inventory_item_external_id"  varchar(255) NOT NULL,
  "location_external_id"        varchar(255) NOT NULL,
  "quantities"                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  "synced_at"                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_levels_store_item_location_key" UNIQUE ("store_id", "inventory_item_external_id", "location_external_id")
);
CREATE INDEX IF NOT EXISTS "idx_inventory_levels_store" ON "inventory_levels" ("store_id", "inventory_item_external_id");
ALTER TABLE "inventory_levels" ENABLE ROW LEVEL SECURITY;
