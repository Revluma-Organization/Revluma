CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL,
  "delivery_id" TEXT NOT NULL,
  "store_id" UUID NOT NULL,
  "topic" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'received',
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "processed_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "webhook_deliveries_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_deliveries_provider_delivery_id_key"
  ON "webhook_deliveries" ("provider", "delivery_id");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_store_received_idx"
  ON "webhook_deliveries" ("store_id", "received_at");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_received_idx"
  ON "webhook_deliveries" ("status", "received_at");