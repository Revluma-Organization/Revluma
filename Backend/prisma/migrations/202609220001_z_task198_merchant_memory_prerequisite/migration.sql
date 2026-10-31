-- Forward-only prerequisite reconciliation for the historical zero-touch migration.
-- This migration is intentionally ordered after 202609220001_add_cart_recovery_contract
-- and before 202609220002_add_zero_touch_automation on a clean database.
-- Existing environments retain their applied migration files and data: every object
-- below is created only when absent, and no existing row is rewritten or dropped.

CREATE TABLE IF NOT EXISTS "conversations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "title" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "mode" TEXT,
  "summary" TEXT,
  "context_window" JSONB,
  "message_count" INTEGER NOT NULL DEFAULT 0,
  "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_conv_org_user"
  ON "conversations" ("organization_id", "user_id", "last_activity_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_conv_status"
  ON "conversations" ("organization_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_organization_id_fkey') THEN
    ALTER TABLE "conversations"
      ADD CONSTRAINT "conversations_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_user_id_fkey') THEN
    ALTER TABLE "conversations"
      ADD CONSTRAINT "conversations_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "merchant_memories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID,
  "memory_type" TEXT NOT NULL,
  "memory_key" TEXT NOT NULL,
  "memory_value" JSONB NOT NULL,
  "memory_source" TEXT NOT NULL DEFAULT 'explicit',
  "authority_level" INTEGER NOT NULL DEFAULT 3,
  "confidence" DOUBLE PRECISION DEFAULT 1.0,
  "importance" INTEGER NOT NULL DEFAULT 3,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "expires_at" TIMESTAMPTZ(6),
  "last_used_at" TIMESTAMPTZ(6),
  "use_count" INTEGER NOT NULL DEFAULT 0,
  "source_conv_id" UUID,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "merchant_memories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_memory_org_key"
  ON "merchant_memories" ("organization_id", "memory_key");
CREATE INDEX IF NOT EXISTS "idx_memory_source"
  ON "merchant_memories" ("organization_id", "memory_source");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchant_memories_organization_id_fkey') THEN
    ALTER TABLE "merchant_memories"
      ADD CONSTRAINT "merchant_memories_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchant_memories_user_id_fkey') THEN
    ALTER TABLE "merchant_memories"
      ADD CONSTRAINT "merchant_memories_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchant_memories_source_conv_id_fkey') THEN
    ALTER TABLE "merchant_memories"
      ADD CONSTRAINT "merchant_memories_source_conv_id_fkey"
      FOREIGN KEY ("source_conv_id") REFERENCES "conversations"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
