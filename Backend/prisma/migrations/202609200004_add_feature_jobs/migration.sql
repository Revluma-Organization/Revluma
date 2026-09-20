CREATE TABLE IF NOT EXISTS "feature_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "feature_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "feature_jobs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE,
  CONSTRAINT "feature_jobs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "feature_jobs_idempotency_key_key" ON "feature_jobs" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "feature_jobs_status_available_idx" ON "feature_jobs" ("status", "available_at");
CREATE INDEX IF NOT EXISTS "feature_jobs_store_created_idx" ON "feature_jobs" ("store_id", "created_at");