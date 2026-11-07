-- Task 215: idempotent manual sync-retry requests + progress contract.
-- Non-destructive; existing merchant data and credentials are preserved.
-- The (store_id, scope, request_key) uniqueness is the idempotency guarantee
-- that prevents duplicate sync jobs without any in-memory lock.

CREATE TABLE IF NOT EXISTS "sync_retry_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "scope" varchar(48) NOT NULL DEFAULT 'all',
  "request_key" varchar(160) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'requested',
  "job_id" uuid,
  "reason_code" varchar(80),
  "attempt" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  CONSTRAINT "uq_sync_retry_requests_idempotency" UNIQUE ("store_id", "scope", "request_key")
);

CREATE INDEX IF NOT EXISTS "idx_sync_retry_requests_store_status"
  ON "sync_retry_requests" ("store_id", "status", "created_at" DESC);
