-- Affiliate auth state machine + nullable token usage logs
ALTER TABLE "pending_registrations"
  ADD COLUMN IF NOT EXISTS "authState" TEXT NOT NULL DEFAULT 'PENDING_EMAIL_VERIFICATION';

CREATE INDEX IF NOT EXISTS "pending_registrations_authState_idx" ON "pending_registrations"("authState");

ALTER TABLE "rapp_token_usage_log"
  ALTER COLUMN "tokenId" DROP NOT NULL;

DO $$ BEGIN
  ALTER TYPE "AffiliateStatus" ADD VALUE IF NOT EXISTS 'PENDING_EMAIL_VERIFICATION';
  ALTER TYPE "AffiliateStatus" ADD VALUE IF NOT EXISTS 'PENDING_ACCESS_TOKEN';
  ALTER TYPE "AffiliateStatus" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;