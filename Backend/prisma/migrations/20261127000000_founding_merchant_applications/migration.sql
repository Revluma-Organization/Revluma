-- Founding Merchants application: progressive, resumable waitlist applications.
--
-- Extends the existing waitlist_users table (no new table). Additive and
-- idempotent: new nullable/defaulted columns, IF NOT EXISTS indexes, and
-- constraints guarded by a catalogue check. Production had 0 waitlist rows when
-- this was written (2026-11-18); the status backfill below only matters for
-- environments that still hold rows from the retired one-step join form.

ALTER TABLE "waitlist_users"
  ADD COLUMN IF NOT EXISTS "store_age" TEXT,
  ADD COLUMN IF NOT EXISTS "challenges" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "challenge_other" TEXT,
  ADD COLUMN IF NOT EXISTS "problem_discovery" TEXT,
  ADD COLUMN IF NOT EXISTS "price_willingness" TEXT,
  ADD COLUMN IF NOT EXISTS "valuable_capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "founding_interest" TEXT,
  ADD COLUMN IF NOT EXISTS "current_step" SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "resume_token_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "resume_token_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "resume_code_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "resume_code_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "resume_code_attempts" SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "start_key_hash" TEXT;

-- Legacy profile columns the application does not collect.
ALTER TABLE "waitlist_users"
  ALTER COLUMN "industry" SET DEFAULT '',
  ALTER COLUMN "country" SET DEFAULT '',
  ALTER COLUMN "biggest_challenge" SET DEFAULT '';

-- Rows from the retired join form were complete sign-ups: they count as
-- submitted, with their original sign-up time.
UPDATE "waitlist_users"
   SET "status" = 'submitted',
       "submitted_at" = COALESCE("submitted_at", "created_at", now()),
       "current_step" = 4
 WHERE "status" IS NULL OR "status" = 'pending';

ALTER TABLE "waitlist_users" ALTER COLUMN "status" SET DEFAULT 'in_progress';
ALTER TABLE "waitlist_users" ALTER COLUMN "status" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_users_resume_token_hash_key" ON "waitlist_users" ("resume_token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_users_start_key_hash_key" ON "waitlist_users" ("start_key_hash");
-- Share codes are looked up as unique keys (referral check, attribution).
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_users_referral_code_key" ON "waitlist_users" ("referral_code");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_users_status_check') THEN
    ALTER TABLE "waitlist_users" ADD CONSTRAINT "waitlist_users_status_check"
      CHECK ("status" IN ('in_progress', 'submitted', 'reviewed', 'accepted', 'rejected'));
  END IF;
  -- An application is never marked submitted without a submission time.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_users_submitted_at_check') THEN
    ALTER TABLE "waitlist_users" ADD CONSTRAINT "waitlist_users_submitted_at_check"
      CHECK ("status" = 'in_progress' OR "submitted_at" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_users_current_step_check') THEN
    ALTER TABLE "waitlist_users" ADD CONSTRAINT "waitlist_users_current_step_check"
      CHECK ("current_step" BETWEEN 1 AND 4);
  END IF;
  -- At most three "most valuable capabilities", enforced here as well as in the API.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_users_capabilities_check') THEN
    ALTER TABLE "waitlist_users" ADD CONSTRAINT "waitlist_users_capabilities_check"
      CHECK (cardinality("valuable_capabilities") <= 3);
  END IF;
END $$;
