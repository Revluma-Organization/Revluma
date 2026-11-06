CREATE TABLE "commerce_resource_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "resource_id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "sync_run_id" UUID NOT NULL,
  "synced_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "commerce_resource_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_commerce_resource_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ck_commerce_resource_id" CHECK ("resource_id" ~ '^[a-z][a-z0-9._-]{0,63}$')
);
CREATE UNIQUE INDEX "uq_commerce_resource_source" ON "commerce_resource_records"("store_id", "resource_id", "source_id");
CREATE INDEX "idx_commerce_resource_run" ON "commerce_resource_records"("store_id", "resource_id", "sync_run_id");
CREATE INDEX "idx_commerce_resource_freshness" ON "commerce_resource_records"("resource_id", "synced_at");
