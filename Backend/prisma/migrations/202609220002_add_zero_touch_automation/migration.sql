CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "merchant_memory_embeddings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "memory_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "user_id" UUID,
  "embedding" vector(384) NOT NULL,
  "embedding_model" TEXT NOT NULL,
  "source_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "merchant_memory_embeddings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "merchant_memory_embeddings_memory_id_key" UNIQUE ("memory_id"),
  CONSTRAINT "merchant_memory_embeddings_memory_id_fkey"
    FOREIGN KEY ("memory_id") REFERENCES "merchant_memories"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "merchant_memory_embeddings_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "merchant_memory_embeddings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "merchant_memory_embeddings_org_user_idx"
  ON "merchant_memory_embeddings"("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "merchant_memory_embeddings_model_idx"
  ON "merchant_memory_embeddings"("embedding_model");
CREATE INDEX IF NOT EXISTS "merchant_memory_embeddings_hnsw_idx"
  ON "merchant_memory_embeddings"
  USING hnsw ("embedding" vector_cosine_ops);

CREATE TABLE IF NOT EXISTS "merchant_memory_embedding_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "memory_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "merchant_memory_embedding_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "merchant_memory_embedding_jobs_memory_id_key" UNIQUE ("memory_id"),
  CONSTRAINT "merchant_memory_embedding_jobs_memory_id_fkey"
    FOREIGN KEY ("memory_id") REFERENCES "merchant_memories"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "merchant_memory_embedding_jobs_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "merchant_memory_embedding_jobs_status_available_idx"
  ON "merchant_memory_embedding_jobs"("status", "available_at");
CREATE INDEX IF NOT EXISTS "merchant_memory_embedding_jobs_org_created_idx"
  ON "merchant_memory_embedding_jobs"("organization_id", "created_at");

CREATE OR REPLACE FUNCTION "revluma_enqueue_merchant_memory_embedding"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."is_active" = TRUE THEN
    INSERT INTO "merchant_memory_embedding_jobs" (
      "memory_id", "organization_id", "status", "attempt_count",
      "available_at", "last_error", "created_at", "updated_at"
    ) VALUES (
      NEW."id", NEW."organization_id", 'pending', 0,
      now(), NULL, now(), now()
    )
    ON CONFLICT ("memory_id") DO UPDATE SET
      "organization_id" = EXCLUDED."organization_id",
      "status" = 'pending',
      "attempt_count" = 0,
      "available_at" = now(),
      "last_error" = NULL,
      "updated_at" = now();
  ELSE
    DELETE FROM "merchant_memory_embeddings" WHERE "memory_id" = NEW."id";
    DELETE FROM "merchant_memory_embedding_jobs" WHERE "memory_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "merchant_memory_embedding_enqueue" ON "merchant_memories";
CREATE TRIGGER "merchant_memory_embedding_enqueue"
AFTER INSERT OR UPDATE OF
  "memory_key", "memory_value", "memory_type", "user_id", "is_active", "expires_at"
ON "merchant_memories"
FOR EACH ROW
EXECUTE FUNCTION "revluma_enqueue_merchant_memory_embedding"();

INSERT INTO "merchant_memory_embedding_jobs" (
  "memory_id", "organization_id", "status", "attempt_count",
  "available_at", "created_at", "updated_at"
)
SELECT "id", "organization_id", 'pending', 0, now(), now(), now()
FROM "merchant_memories"
WHERE "is_active" = TRUE
ON CONFLICT ("memory_id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "model_lifecycle_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "pipeline_name" TEXT NOT NULL,
  "data_fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "run_ids" JSONB,
  "registered_versions" JSONB,
  "previous_versions" JSONB,
  "metrics" JSONB,
  "production_eligible" BOOLEAN NOT NULL DEFAULT FALSE,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "candidate_at" TIMESTAMPTZ(6),
  "promoted_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "model_lifecycle_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "model_lifecycle_runs_pipeline_fingerprint_key"
    UNIQUE ("pipeline_name", "data_fingerprint")
);
CREATE INDEX IF NOT EXISTS "model_lifecycle_runs_status_candidate_idx"
  ON "model_lifecycle_runs"("status", "candidate_at");
CREATE INDEX IF NOT EXISTS "model_lifecycle_runs_pipeline_created_idx"
  ON "model_lifecycle_runs"("pipeline_name", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "model_lifecycle_metrics" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "model_name" TEXT NOT NULL,
  "model_version" TEXT NOT NULL,
  "metric_name" TEXT NOT NULL,
  "metric_value" DOUBLE PRECISION,
  "threshold" DOUBLE PRECISION NOT NULL,
  "passed" BOOLEAN NOT NULL DEFAULT FALSE,
  "sample_size" INTEGER NOT NULL DEFAULT 0,
  "observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "metadata" JSONB,
  CONSTRAINT "model_lifecycle_metrics_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "model_lifecycle_metrics_model_version_observed_idx"
  ON "model_lifecycle_metrics"("model_name", "model_version", "observed_at" DESC);
CREATE INDEX IF NOT EXISTS "model_lifecycle_metrics_model_metric_observed_idx"
  ON "model_lifecycle_metrics"("model_name", "metric_name", "observed_at" DESC);

CREATE TABLE IF NOT EXISTS "automation_job_state" (
  "job_name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'idle',
  "last_started_at" TIMESTAMPTZ(6),
  "last_completed_at" TIMESTAMPTZ(6),
  "next_run_at" TIMESTAMPTZ(6),
  "last_result" JSONB,
  "last_error" TEXT,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "automation_job_state_pkey" PRIMARY KEY ("job_name")
);
