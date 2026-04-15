-- Migration: Add avatarUrl to users table
-- Run this on your Render PostgreSQL database

ALTER TABLE users ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;

-- Also add any missing columns for new features
ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

-- Ensure recovery_events has all required fields
ALTER TABLE "recoveryEvents" ADD COLUMN IF NOT EXISTS "productName" TEXT;
ALTER TABLE "recoveryEvents" ADD COLUMN IF NOT EXISTS "customerEmail" TEXT;
ALTER TABLE "abandonedCart" ADD COLUMN IF NOT EXISTS "cartValue" DECIMAL(12,2);
ALTER TABLE "customerCrm" ADD COLUMN IF NOT EXISTS "churnScore" DECIMAL(5,2);
ALTER TABLE "customerCrm" ADD COLUMN IF NOT EXISTS "ltv" DECIMAL(12,2);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS "idx_recoveryEvents_tenantId" ON "recoveryEvents"("tenantId");
CREATE INDEX IF NOT EXISTS "idx_recoveryEvents_createdAt" ON "recoveryEvents"("createdAt");
CREATE INDEX IF NOT EXISTS "idx_abandonedCart_tenantId" ON "abandonedCart"("tenantId");
CREATE INDEX IF NOT EXISTS "idx_customerCrm_tenantId" ON "customerCrm"("tenantId");