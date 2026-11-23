-- Self-managing operations: Postgres-authoritative coordination, durable sync
-- retry state, capability authorization requests and dead-letter records.
-- Non-destructive: only new tables and new nullable/defaulted columns.

-- Coordination leases. Replaces Redis for every correctness-critical lock or
-- one-time claim (store sync, scheduler jobs, OAuth replay, reconnect).
CREATE TABLE IF NOT EXISTS "coordination_leases" (
  "lease_key" varchar(200) PRIMARY KEY,
  "owner" varchar(64) NOT NULL,
  "purpose" varchar(48) NOT NULL,
  "acquired_at" timestamptz(6) NOT NULL DEFAULT now(),
  "heartbeat_at" timestamptz(6) NOT NULL DEFAULT now(),
  "expires_at" timestamptz(6) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS "idx_coordination_leases_expires" ON "coordination_leases" ("expires_at");

-- Durable store-level sync retry state for the sync supervisor.
ALTER TABLE "stores"
  ADD COLUMN IF NOT EXISTS "sync_consecutive_failures" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sync_next_attempt_at" timestamptz(6),
  ADD COLUMN IF NOT EXISTS "sync_last_failure_class" varchar(24);

-- Capability authorization requests (one pending per store + capability).
CREATE TABLE IF NOT EXISTS "authorization_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "organization_id" uuid NOT NULL,
  "capability" varchar(64) NOT NULL,
  "missing_scopes" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "status" varchar(24) NOT NULL DEFAULT 'pending',
  "trigger" varchar(32) NOT NULL,
  "explanation" text NOT NULL,
  "resume" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "requested_by" uuid,
  "pending_key" varchar(160),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "expires_at" timestamptz(6) NOT NULL,
  "resolved_at" timestamptz(6),
  "resolution_detail" varchar(120)
);
CREATE UNIQUE INDEX IF NOT EXISTS "authorization_requests_pending_key_key" ON "authorization_requests" ("pending_key");
CREATE INDEX IF NOT EXISTS "idx_authorization_requests_store_status"
  ON "authorization_requests" ("store_id", "status", "created_at" DESC);

-- Dead-letter records for operations that exhausted the fast retry budget.
CREATE TABLE IF NOT EXISTS "operation_dead_letters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" varchar(48) NOT NULL,
  "subject_key" varchar(200) NOT NULL,
  "store_id" uuid REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "status" varchar(16) NOT NULL DEFAULT 'open',
  "open_key" varchar(260),
  "failure_class" varchar(24) NOT NULL,
  "error_code" varchar(120),
  "attempts" integer NOT NULL DEFAULT 0,
  "first_failed_at" timestamptz(6) NOT NULL DEFAULT now(),
  "last_failed_at" timestamptz(6) NOT NULL DEFAULT now(),
  "next_retry_at" timestamptz(6),
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "resolved_at" timestamptz(6),
  "resolution" varchar(64),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "operation_dead_letters_open_key_key" ON "operation_dead_letters" ("open_key");
CREATE INDEX IF NOT EXISTS "idx_operation_dead_letters_status_kind" ON "operation_dead_letters" ("status", "kind");
CREATE INDEX IF NOT EXISTS "idx_operation_dead_letters_store_status" ON "operation_dead_letters" ("store_id", "status");

-- Service-role-only, matching the existing ledger lockdown. Merchant access is
-- mediated by tenant-scoped Node APIs, never direct Data API reads.
ALTER TABLE "coordination_leases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "authorization_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "operation_dead_letters" ENABLE ROW LEVEL SECURITY;

-- Defence in depth: the Data API lockdown already removed default grants, but
-- never rely on that for operational tables. Only roles that exist are touched.
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "coordination_leases", "authorization_requests", "operation_dead_letters" FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
