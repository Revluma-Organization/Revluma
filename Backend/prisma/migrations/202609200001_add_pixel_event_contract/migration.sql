ALTER TABLE "stores"
  ADD COLUMN IF NOT EXISTS "public_tracking_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "stores_public_tracking_key_key"
  ON "stores" ("public_tracking_key")
  WHERE "public_tracking_key" IS NOT NULL;

ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "source" TEXT;

UPDATE "events"
SET "source" = 'pixel'
WHERE "source" IS NULL;

ALTER TABLE "events"
  ALTER COLUMN "source" SET DEFAULT 'pixel',
  ALTER COLUMN "source" SET NOT NULL;

ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "source_event_id" TEXT,
  ADD COLUMN IF NOT EXISTS "received_at" TIMESTAMPTZ(6);

UPDATE "events"
SET "received_at" = COALESCE("created_at", now())
WHERE "received_at" IS NULL;

ALTER TABLE "events"
  ALTER COLUMN "received_at" SET DEFAULT now(),
  ALTER COLUMN "received_at" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "events_pixel_source_event_key"
  ON "events" ("store_id", "source", "source_event_id")
  WHERE "source_event_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "events_customer_created_at_idx"
  ON "events" ("customer_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "events_customer_type_created_at_idx"
  ON "events" ("customer_id", "event_type", "created_at" DESC);