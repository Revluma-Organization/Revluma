-- Additive prerequisite for the historical Shopify webhook observability migration.
-- The original baseline does not contain webhook_registrations, although the
-- following migration alters it. Create the current Prisma model shape only
-- when absent; preserve existing registrations and migration history.

CREATE TABLE IF NOT EXISTS "webhook_registrations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "external_id" VARCHAR(255) NOT NULL,
  "topic" VARCHAR(100) NOT NULL,
  "delivery_url" VARCHAR(1000) NOT NULL,
  "status" VARCHAR(50) DEFAULT 'active',
  "last_error" VARCHAR(2000),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_registrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_registrations_store_id_external_id_key"
  ON "webhook_registrations" ("store_id", "external_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_registrations_store_id_fkey') THEN
    ALTER TABLE "webhook_registrations"
      ADD CONSTRAINT "webhook_registrations_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
