ALTER TABLE "webhook_registrations"
  ADD COLUMN IF NOT EXISTS "last_error" VARCHAR(2000),
  ADD COLUMN IF NOT EXISTS "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMPTZ(6);

-- Existing rows represent prior registration outcomes; preserve them and initialize attempt metadata safely.
UPDATE "webhook_registrations"
SET "completed_at" = COALESCE("updated_at"::timestamptz, "created_at"::timestamptz)
WHERE "status" IN ('active', 'failed') AND "completed_at" IS NULL;