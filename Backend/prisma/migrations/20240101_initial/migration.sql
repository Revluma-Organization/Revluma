-- AddStoreConfig Migration
-- Adding store configuration and sync models

BEGIN;

-- Create store_configs table
CREATE TABLE IF NOT EXISTS "store_configs" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "store_name" TEXT NOT NULL,
    "store_url" TEXT NOT NULL,
    "callback_url" TEXT,
    "credentials_encrypted" TEXT NOT NULL,
    "cart_tracking_mode" TEXT DEFAULT 'plugin',
    "abandonment_window_minutes" INTEGER DEFAULT 60,
    "status" TEXT DEFAULT 'pending',
    "last_sync_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now(),
    UNIQUE ("tenant_id", "platform", "store_url")
);

CREATE INDEX IF NOT EXISTS "store_configs_tenant_id_idx" ON "store_configs" ("tenant_id");
CREATE INDEX IF NOT EXISTS "store_configs_status_idx" ON "store_configs" ("status");

-- Create sync_cursors table
CREATE TABLE IF NOT EXISTS "sync_cursors" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL REFERENCES "store_configs"("id") ON DELETE CASCADE,
    "resource" TEXT NOT NULL,
    "cursor" TEXT,
    "timestamp" TIMESTAMP NOT NULL,
    "processed_count" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now(),
    UNIQUE ("store_id", "resource")
);

CREATE INDEX IF NOT EXISTS "sync_cursors_store_id_idx" ON "sync_cursors" ("store_id");

-- Create sync_jobs table
CREATE TABLE IF NOT EXISTS "sync_jobs" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL REFERENCES "store_configs"("id") ON DELETE CASCADE,
    "resource" TEXT NOT NULL,
    "status" TEXT DEFAULT 'pending',
    "cursor" TEXT,
    "records_processed" INTEGER DEFAULT 0,
    "errors" TEXT[] DEFAULT '{}',
    "started_at" TIMESTAMP DEFAULT now(),
    "completed_at" TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "sync_jobs_store_id_status_idx" ON "sync_jobs" ("store_id", "status");
CREATE INDEX IF NOT EXISTS "sync_jobs_started_at_idx" ON "sync_jobs" ("started_at");

-- Create webhook_registrations table
CREATE TABLE IF NOT EXISTS "webhook_registrations" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL REFERENCES "store_configs"("id") ON DELETE CASCADE,
    "topic" TEXT NOT NULL,
    "webhook_id" TEXT,
    "callback_url" TEXT NOT NULL,
    "secret" TEXT,
    "registered_at" TIMESTAMP DEFAULT now(),
    "created_at" TIMESTAMP DEFAULT now(),
    UNIQUE ("store_id", "topic")
);

CREATE INDEX IF NOT EXISTS "webhook_registrations_store_id_idx" ON "webhook_registrations" ("store_id");

COMMIT;