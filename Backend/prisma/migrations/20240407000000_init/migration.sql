-- Create initial schema
-- Created by Prisma

-- Tenants
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "industry" TEXT DEFAULT 'general',
    "businessModel" TEXT,
    "onboardingStatus" TEXT DEFAULT 'pending',
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- Users
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT DEFAULT 'user',
    "onboardingStatus" TEXT DEFAULT 'started',
    "onboardingCompletedAt" TIMESTAMP(3),
    "emailVerified" BOOLEAN DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_email_key" UNIQUE ("email")
);

CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- Tenant Profiles
CREATE TABLE "tenant_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "industry" TEXT,
    "businessModel" TEXT,
    "targetMarket" JSONB,
    "aov" DECIMAL(12,2),
    "purchaseFrequency" INTEGER,
    "salesChannels" JSONB,
    "paymentMethods" JSONB,
    "teamSize" INTEGER,
    "inventorySize" INTEGER,
    "fulfillmentSpeed" INTEGER,
    "growthGoals" JSONB,
    "brandTone" TEXT,
    "maturityScore" INTEGER DEFAULT 0,
    "preferredChannel" TEXT DEFAULT 'whatsapp',
    "touch1Delay" INTEGER DEFAULT 15,
    "touch2Delay" INTEGER DEFAULT 90,
    "discountThreshold" DECIMAL(5,2) DEFAULT 0.1,
    "fromEmail" TEXT,
    "whatsappBusinessId" TEXT,
    "platform" TEXT,
    "storeUrl" TEXT,
    "monthlyTraffic" TEXT,
    "monthlyRevenue" TEXT,
    "goals" JSONB,
    "preferredRecoveryChannel" TEXT,
    "onboardingStatus" TEXT DEFAULT 'started',
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenant_profiles_tenantId_key" UNIQUE ("tenantId")
);

-- Email Verification Codes
CREATE TABLE "email_verification_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_verification_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_verification_codes_userId_idx" ON "email_verification_codes"("userId");
CREATE INDEX "email_verification_codes_expiresAt_idx" ON "email_verification_codes"("expiresAt");

-- Password Reset Tokens
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "password_reset_tokens_token_key" UNIQUE ("token")
);

CREATE INDEX "password_reset_tokens_token_idx" ON "password_reset_tokens"("token");
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- Password History
CREATE TABLE "password_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "password_history_userId_idx" ON "password_history"("userId");

-- User Sessions
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_sessions_token_key" UNIQUE ("token")
);

CREATE INDEX "user_sessions_token_idx" ON "user_sessions"("token");

-- Abandoned Carts
CREATE TABLE "abandoned_carts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalCartId" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "cartValue" DECIMAL(12,2) NOT NULL,
    "currency" TEXT DEFAULT 'USD',
    "items" JSONB NOT NULL,
    "abandonmentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intentScore" INTEGER,
    "status" TEXT DEFAULT 'new',
    "sessionDurationSeconds" INTEGER,
    "scrollDepthPercentage" INTEGER,
    "addRemoveActions" INTEGER,
    "repeatVisits" INTEGER DEFAULT 1,
    "deviceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "abandoned_carts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "abandoned_carts_externalCartId_key" UNIQUE ("externalCartId")
);

CREATE INDEX "abandoned_carts_tenantId_abandonmentAt_idx" ON "abandoned_carts"("tenantId", "abandonmentAt");
CREATE INDEX "abandoned_carts_status_idx" ON "abandoned_carts"("status");

-- Recovery Events
CREATE TABLE "recovery_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "abandonedCartId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "touchNumber" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recovery_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recovery_events_abandonedCartId_createdAt_idx" ON "recovery_events"("abandonedCartId", "createdAt");

-- Benchmarks
CREATE TABLE "benchmarks" (
    "id" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "businessModel" TEXT NOT NULL,
    "priceBand" TEXT,
    "region" TEXT DEFAULT 'global',
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "crP25" DECIMAL(5,2),
    "crP50" DECIMAL(5,2),
    "crP75" DECIMAL(5,2),
    "aovP25" DECIMAL(10,2),
    "aovP50" DECIMAL(10,2),
    "aovP75" DECIMAL(10,2),
    "repeatRateP25" DECIMAL(5,2),
    "repeatRateP50" DECIMAL(5,2),
    "repeatRateP75" DECIMAL(5,2),
    "churnRateP25" DECIMAL(5,2),
    "churnRateP50" DECIMAL(5,2),
    "churnRateP75" DECIMAL(5,2),
    "inventoryTurnoverP25" DECIMAL(5,2),
    "inventoryTurnoverP50" DECIMAL(5,2),
    "inventoryTurnoverP75" DECIMAL(5,2),
    "cacP25" DECIMAL(10,2),
    "cacP50" DECIMAL(10,2),
    "cacP75" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "benchmarks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "benchmarks_industry_businessModel_priceBand_region_periodMonth_key" UNIQUE ("industry", "businessModel", "priceBand", "region", "periodMonth")
);

CREATE INDEX "benchmarks_industry_businessModel_region_idx" ON "benchmarks"("industry", "businessModel", "region");

-- Customer CRM
CREATE TABLE "customer_crm" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "totalPurchases" INTEGER DEFAULT 0,
    "totalSpent" DECIMAL(12,2) DEFAULT 0,
    "lastPurchase" TIMESTAMP(3),
    "ltvScore" INTEGER DEFAULT 0,
    "intentScore" INTEGER DEFAULT 0,
    "churnRisk" INTEGER DEFAULT 0,
    "segment" TEXT DEFAULT 'low-intent',
    "behaviorData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_crm_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_crm_tenantId_ltvScore_idx" ON "customer_crm"("tenantId", "ltvScore");
CREATE INDEX "customer_crm_tenantId_churnRisk_idx" ON "customer_crm"("tenantId", "churnRisk");

-- LTV Segments
CREATE TABLE "ltv_segments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "size" INTEGER DEFAULT 0,
    "revenueOpportunity" DECIMAL(12,2) DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ltv_segments_pkey" PRIMARY KEY ("id")
);

-- Churn Events
CREATE TABLE "churn_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "daysInactive" INTEGER,
    "triggerType" TEXT,
    "escalationLevel" INTEGER DEFAULT 1,
    "status" TEXT DEFAULT 'queued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "churn_events_pkey" PRIMARY KEY ("id")
);

-- Automation Tasks
CREATE TABLE "automation_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT,
    "status" TEXT DEFAULT 'pending',
    "priority" TEXT DEFAULT 'medium',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "automation_tasks_pkey" PRIMARY KEY ("id")
);

-- Newsletter Subscribers
CREATE TABLE "newsletter_subscribers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT DEFAULT 'active',
    "source" TEXT,
    "verified" BOOLEAN DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "unsubToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "newsletter_subscribers_unsubToken_key" UNIQUE ("unsubToken"),
    CONSTRAINT "newsletter_subscribers_tenantId_email_key" UNIQUE ("tenantId", "email")
);

CREATE INDEX "newsletter_subscribers_tenantId_status_idx" ON "newsletter_subscribers"("tenantId", "status");

-- Newsletter Sends
CREATE TABLE "newsletter_sends" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT DEFAULT 'queued',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "newsletter_sends_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "newsletter_sends_tenantId_sentAt_idx" ON "newsletter_sends"("tenantId", "sentAt");

-- Newsletter Send Events
CREATE TABLE "newsletter_send_events" (
    "id" TEXT NOT NULL,
    "sendId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "newsletter_send_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "newsletter_send_events_sendId_createdAt_idx" ON "newsletter_send_events"("sendId", "createdAt");

-- Foreign Keys
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "tenant_profiles" ADD CONSTRAINT "tenant_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "email_verification_codes" ADD CONSTRAINT "email_verification_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "abandoned_carts" ADD CONSTRAINT "abandoned_carts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "recovery_events" ADD CONSTRAINT "recovery_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "recovery_events" ADD CONSTRAINT "recovery_events_abandonedCartId_fkey" FOREIGN KEY ("abandonedCartId") REFERENCES "abandoned_carts"("id") ON DELETE CASCADE;
ALTER TABLE "customer_crm" ADD CONSTRAINT "customer_crm_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "ltv_segments" ADD CONSTRAINT "ltv_segments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "churn_events" ADD CONSTRAINT "churn_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "churn_events" ADD CONSTRAINT "churn_events_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_crm"("id") ON DELETE SET NULL;
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "newsletter_subscribers" ADD CONSTRAINT "newsletter_subscribers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "newsletter_sends" ADD CONSTRAINT "newsletter_sends_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "newsletter_subscribers"("id") ON DELETE CASCADE;
ALTER TABLE "newsletter_send_events" ADD CONSTRAINT "newsletter_send_events_sendId_fkey" FOREIGN KEY ("sendId") REFERENCES "newsletter_sends"("id") ON DELETE CASCADE;
ALTER TABLE "newsletter_send_events" ADD CONSTRAINT "newsletter_send_events_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "newsletter_subscribers"("id") ON DELETE CASCADE;