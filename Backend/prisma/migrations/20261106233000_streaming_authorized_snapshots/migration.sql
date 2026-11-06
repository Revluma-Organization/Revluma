-- Allow a complete inactive run to coexist with the last active snapshot.
DROP INDEX "uq_commerce_resource_source";
ALTER TABLE "commerce_resource_records"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT false;

UPDATE "commerce_resource_records" SET "active" = true;

CREATE UNIQUE INDEX "uq_commerce_resource_run_source"
  ON "commerce_resource_records"("store_id", "resource_id", "sync_run_id", "source_id");
CREATE INDEX "idx_commerce_resource_active"
  ON "commerce_resource_records"("store_id", "resource_id", "active");
