-- Forward-only reconciliation: the historical baseline omitted the required
-- organizations.slug field even though the current Prisma model requires it.
-- Preserve any existing non-empty slug; deterministically backfill only missing
-- values so pre-existing organizations remain addressable and unique.

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "slug" TEXT;

UPDATE "organizations"
SET "slug" =
  COALESCE(
    NULLIF(BTRIM("slug"), ''),
    LOWER(REGEXP_REPLACE(BTRIM("company_name"), '[^a-zA-Z0-9]+', '-', 'g'))
      || '-' || LEFT("id"::text, 8)
  )
WHERE "slug" IS NULL OR BTRIM("slug") = '';

ALTER TABLE "organizations"
  ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_key"
  ON "organizations" ("slug");
