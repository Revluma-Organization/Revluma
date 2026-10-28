CREATE TABLE IF NOT EXISTS "shopify_inventory_observation_runs" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "source" VARCHAR(60) NOT NULL,
  "scope_verified" BOOLEAN NOT NULL,
  "catalog_complete" BOOLEAN NOT NULL,
  "variants_complete" BOOLEAN NOT NULL,
  "product_count" INTEGER NOT NULL,
  "variant_count" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_inventory_runs_org_store_observed" ON "shopify_inventory_observation_runs" ("organization_id", "store_id", "observed_at" DESC);

CREATE TABLE IF NOT EXISTS "shopify_inventory_observations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "observation_id" UUID NOT NULL REFERENCES "shopify_inventory_observation_runs"("id") ON DELETE CASCADE,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "product_external_id" VARCHAR(255) NOT NULL,
  "variant_external_id" VARCHAR(255) NOT NULL,
  "product_title" TEXT NOT NULL,
  "product_status" VARCHAR(32) NOT NULL,
  "variant_title" TEXT NOT NULL,
  "available_for_sale" BOOLEAN NOT NULL,
  "inventory_quantity" INTEGER,
  "inventory_policy" VARCHAR(32) NOT NULL,
  "source" VARCHAR(60) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uq_inventory_observation_variant" UNIQUE ("store_id", "observation_id", "variant_external_id")
);
CREATE INDEX IF NOT EXISTS "idx_inventory_observations_org_store_observed" ON "shopify_inventory_observations" ("organization_id", "store_id", "observed_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_inventory_observations_store_variant_observed" ON "shopify_inventory_observations" ("store_id", "variant_external_id", "observed_at" DESC);
