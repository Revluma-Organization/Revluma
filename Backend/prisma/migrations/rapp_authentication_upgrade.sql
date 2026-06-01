-- ============================================================
-- RAPP AUTHENTICATION & VETTING SYSTEM UPGRADE
-- Migration: Add Access Token System, Enhanced Status Management,
-- Social Distribution Requirements, and Vetting Workflow
-- ============================================================

-- Step 1: Add new account status enum values
DO $$ BEGIN
  -- Extend AffiliateStatus enum if needed
  ALTER TYPE "AffiliateStatus" ADD VALUE IF NOT EXISTS 'PENDING_EMAIL_VERIFICATION';
  ALTER TYPE "AffiliateStatus" ADD VALUE IF NOT EXISTS 'PENDING_ACCESS_TOKEN';
  ALTER TYPE "AffiliateStatus" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW';
  ALTER TYPE "AffiliateStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Step 2: Create RAPP Access Token table
CREATE TABLE IF NOT EXISTS "rapp_access_tokens" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "token" TEXT NOT NULL UNIQUE,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "maxUses" INTEGER DEFAULT 1,
  "usedCount" INTEGER DEFAULT 0,
  "isActive" BOOLEAN DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokedBy" TEXT,
  "revokedReason" TEXT
);

CREATE INDEX IF NOT EXISTS "rapp_access_tokens_token_idx" ON "rapp_access_tokens"("token");
CREATE INDEX IF NOT EXISTS "rapp_access_tokens_tokenHash_idx" ON "rapp_access_tokens"("tokenHash");
CREATE INDEX IF NOT EXISTS "rapp_access_tokens_isActive_idx" ON "rapp_access_tokens"("isActive");
CREATE INDEX IF NOT EXISTS "rapp_access_tokens_expiresAt_idx" ON "rapp_access_tokens"("expiresAt");

-- Step 3: Create Access Token Usage Log table
CREATE TABLE IF NOT EXISTS "rapp_token_usage_log" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "tokenId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "userId" TEXT,
  "affiliateProfileId" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "success" BOOLEAN DEFAULT true,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "rapp_token_usage_log_tokenId_idx" ON "rapp_token_usage_log"("tokenId");
CREATE INDEX IF NOT EXISTS "rapp_token_usage_log_email_idx" ON "rapp_token_usage_log"("email");
CREATE INDEX IF NOT EXISTS "rapp_token_usage_log_createdAt_idx" ON "rapp_token_usage_log"("createdAt");

-- Step 4: Add new fields to affiliate_profiles for enhanced vetting
ALTER TABLE "affiliate_profiles" 
  ADD COLUMN IF NOT EXISTS "youtubeChannel" TEXT,
  ADD COLUMN IF NOT EXISTS "tiktokHandle" TEXT,
  ADD COLUMN IF NOT EXISTS "facebookProfile" TEXT,
  ADD COLUMN IF NOT EXISTS "newsletterUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "communityUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "otherPlatform1" TEXT,
  ADD COLUMN IF NOT EXISTS "otherPlatform2" TEXT,
  ADD COLUMN IF NOT EXISTS "distributionChannelsCount" INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "accessTokenId" TEXT,
  ADD COLUMN IF NOT EXISTS "accessTokenUsedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "emailVerificationSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "vettingNotificationSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectedReason" TEXT,
  ADD COLUMN IF NOT EXISTS "suspendedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedReason" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "statusUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "statusUpdatedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "referralSource" TEXT;

-- Step 5: Add foreign key constraint for access token
ALTER TABLE "affiliate_profiles" 
  ADD CONSTRAINT "affiliate_profiles_accessTokenId_fkey" 
  FOREIGN KEY ("accessTokenId") 
  REFERENCES "rapp_access_tokens"("id") 
  ON DELETE SET NULL 
  ON UPDATE CASCADE;

-- Step 6: Create indexes for new fields
CREATE INDEX IF NOT EXISTS "affiliate_profiles_accessTokenId_idx" ON "affiliate_profiles"("accessTokenId");
CREATE INDEX IF NOT EXISTS "affiliate_profiles_status_createdAt_idx" ON "affiliate_profiles"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "affiliate_profiles_distributionChannelsCount_idx" ON "affiliate_profiles"("distributionChannelsCount");

-- Step 7: Add audit log table for status changes
CREATE TABLE IF NOT EXISTS "affiliate_status_audit_log" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "affiliateProfileId" TEXT NOT NULL,
  "previousStatus" TEXT,
  "newStatus" TEXT NOT NULL,
  "changedBy" TEXT,
  "reason" TEXT,
  "notes" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "affiliate_status_audit_log_affiliateProfileId_idx" ON "affiliate_status_audit_log"("affiliateProfileId");
CREATE INDEX IF NOT EXISTS "affiliate_status_audit_log_createdAt_idx" ON "affiliate_status_audit_log"("createdAt");

-- Step 8: Add vetting notification queue table
CREATE TABLE IF NOT EXISTS "affiliate_vetting_notifications" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "affiliateProfileId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "status" TEXT DEFAULT 'PENDING',
  "sentAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "retryCount" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "affiliate_vetting_notifications_status_idx" ON "affiliate_vetting_notifications"("status");
CREATE INDEX IF NOT EXISTS "affiliate_vetting_notifications_affiliateProfileId_idx" ON "affiliate_vetting_notifications"("affiliateProfileId");

-- Step 9: Update existing affiliate profiles to set default distribution channel count
UPDATE "affiliate_profiles" 
SET "distributionChannelsCount" = (
  CASE WHEN "twitterHandle" IS NOT NULL THEN 1 ELSE 0 END +
  CASE WHEN "instagramHandle" IS NOT NULL THEN 1 ELSE 0 END +
  CASE WHEN "linkedinProfile" IS NOT NULL THEN 1 ELSE 0 END +
  CASE WHEN "website" IS NOT NULL THEN 1 ELSE 0 END
)
WHERE "distributionChannelsCount" = 0 OR "distributionChannelsCount" IS NULL;

-- Step 10: Add constraint to ensure minimum 2 distribution channels (enforced at application level)
-- Note: This is a soft constraint - validation happens in application code

-- Step 11: Create function to automatically update distributionChannelsCount
CREATE OR REPLACE FUNCTION update_distribution_channels_count()
RETURNS TRIGGER AS $$
BEGIN
  NEW."distributionChannelsCount" := (
    CASE WHEN NEW."twitterHandle" IS NOT NULL AND NEW."twitterHandle" != '' THEN 1 ELSE 0 END +
    CASE WHEN NEW."instagramHandle" IS NOT NULL AND NEW."instagramHandle" != '' THEN 1 ELSE 0 END +
    CASE WHEN NEW."linkedinProfile" IS NOT NULL AND NEW."linkedinProfile" != '' THEN 1 ELSE 0 END +
    CASE WHEN NEW."youtubeChannel" IS NOT NULL AND NEW."youtubeChannel" != '' THEN 1 ELSE 0 END +
    CASE WHEN NEW."tiktokHandle" IS NOT NULL AND NEW."tiktokHandle" != '' THEN 1 ELSE 0 END +
    CASE WHEN NEW."facebookProfile" IS NOT NULL AND NEW."facebookProfile" != '' THEN 1 ELSE 0 END +
    CASE WHEN NEW."website" IS NOT NULL AND NEW."website" != '' THEN 1 ELSE 0 END +
    CASE WHEN NEW."newsletterUrl" IS NOT NULL AND NEW."newsletterUrl" != '' THEN 1 ELSE 0 END +
    CASE WHEN NEW."communityUrl" IS NOT NULL AND NEW."communityUrl" != '' THEN 1 ELSE 0 END +
    CASE WHEN NEW."otherPlatform1" IS NOT NULL AND NEW."otherPlatform1" != '' THEN 1 ELSE 0 END +
    CASE WHEN NEW."otherPlatform2" IS NOT NULL AND NEW."otherPlatform2" != '' THEN 1 ELSE 0 END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 12: Create trigger for distribution channels count
DROP TRIGGER IF EXISTS update_distribution_channels_count_trigger ON "affiliate_profiles";
CREATE TRIGGER update_distribution_channels_count_trigger
  BEFORE INSERT OR UPDATE ON "affiliate_profiles"
  FOR EACH ROW
  EXECUTE FUNCTION update_distribution_channels_count();

-- Step 13: Add updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 14: Add updated_at triggers
DROP TRIGGER IF EXISTS update_rapp_access_tokens_updated_at ON "rapp_access_tokens";
CREATE TRIGGER update_rapp_access_tokens_updated_at
  BEFORE UPDATE ON "rapp_access_tokens"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_affiliate_vetting_notifications_updated_at ON "affiliate_vetting_notifications";
CREATE TRIGGER update_affiliate_vetting_notifications_updated_at
  BEFORE UPDATE ON "affiliate_vetting_notifications"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Step 15: Add comments for documentation
COMMENT ON TABLE "rapp_access_tokens" IS 'RAPP access tokens for affiliate onboarding gate';
COMMENT ON TABLE "rapp_token_usage_log" IS 'Audit log for RAPP access token usage';
COMMENT ON TABLE "affiliate_status_audit_log" IS 'Audit trail for affiliate status changes';
COMMENT ON TABLE "affiliate_vetting_notifications" IS 'Queue for vetting notification emails to operations team';

-- Step 16: Grant necessary permissions (adjust based on your database user)
-- GRANT SELECT, INSERT, UPDATE ON "rapp_access_tokens" TO your_app_user;
-- GRANT SELECT, INSERT ON "rapp_token_usage_log" TO your_app_user;
-- GRANT SELECT, INSERT ON "affiliate_status_audit_log" TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE ON "affiliate_vetting_notifications" TO your_app_user;

-- Migration complete
SELECT 'RAPP Authentication & Vetting System Upgrade - Migration Complete' AS status;
