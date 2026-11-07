-- Task 214: canonical integration recovery diagnostics. Non-destructive;
-- existing merchant data and encrypted credentials are preserved.
ALTER TABLE "stores"
  ADD COLUMN IF NOT EXISTS "integration_state" varchar(40) NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "integration_reason_code" varchar(80) NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "integration_version" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "integration_changed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "authorization_verified_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "initial_sync_status" varchar(32) NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS "current_sync_job_id" uuid,
  ADD COLUMN IF NOT EXISTS "sync_started_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "sync_completed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "sync_error_code" varchar(120),
  ADD COLUMN IF NOT EXISTS "sync_attempt_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "recovery_status" varchar(32) NOT NULL DEFAULT 'not_required';

ALTER TABLE "webhook_registrations"
  ADD COLUMN IF NOT EXISTS "required" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "last_verified_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_registration_attempt_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_error_code" varchar(120),
  ADD COLUMN IF NOT EXISTS "remediation_required" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "idx_webhook_registrations_store_topic"
  ON "webhook_registrations" ("store_id", "topic");

ALTER TABLE "webhook_deliveries"
  ADD COLUMN IF NOT EXISTS "failed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "duplicate_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "processing_latency_ms" integer;

CREATE TABLE IF NOT EXISTS "integration_lifecycle_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "event_type" varchar(60) NOT NULL,
  "from_state" varchar(40),
  "to_state" varchar(40) NOT NULL,
  "reason_code" varchar(80) NOT NULL,
  "source" varchar(40) NOT NULL,
  "event_reference" varchar(255),
  "capability" varchar(60) NOT NULL DEFAULT 'shopify',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "observed_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "integration_lifecycle_events_store_id_source_event_reference_key"
  ON "integration_lifecycle_events" ("store_id", "source", "event_reference");
CREATE INDEX IF NOT EXISTS "idx_integration_lifecycle_store_observed"
  ON "integration_lifecycle_events" ("store_id", "observed_at" DESC);

-- Service-role-only, matching the existing sync ledger lockdown. Authenticated
-- merchant access is mediated by tenant-scoped Node APIs, never direct reads.
ALTER TABLE "integration_lifecycle_events" ENABLE ROW LEVEL SECURITY;
