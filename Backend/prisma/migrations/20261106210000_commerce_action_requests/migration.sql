CREATE TABLE "commerce_action_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "requested_by_user_id" UUID,
  "action_type" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "input_json" JSONB NOT NULL,
  "preview_json" JSONB,
  "rollback_json" JSONB,
  "provider_result" JSONB,
  "status" TEXT NOT NULL DEFAULT 'awaiting_confirmation',
  "confirmation_expires_at" TIMESTAMPTZ(6),
  "confirmed_at" TIMESTAMPTZ(6),
  "executed_at" TIMESTAMPTZ(6),
  "rolled_back_at" TIMESTAMPTZ(6),
  "error_code" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commerce_action_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_commerce_action_org" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_commerce_action_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_commerce_action_user" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "ck_commerce_action_type" CHECK ("action_type" = 'product_update_description'),
  CONSTRAINT "ck_commerce_action_status" CHECK ("status" IN (
    'awaiting_confirmation', 'executing', 'executed', 'failed', 'execution_uncertain',
    'rolling_back', 'rolled_back', 'rollback_failed', 'rollback_uncertain'
  ))
);

CREATE UNIQUE INDEX "uq_commerce_action_org_idempotency" ON "commerce_action_requests"("organization_id", "idempotency_key");
CREATE INDEX "idx_commerce_action_org_created" ON "commerce_action_requests"("organization_id", "created_at" DESC);
CREATE INDEX "idx_commerce_action_store_resource" ON "commerce_action_requests"("store_id", "resource_id");
CREATE INDEX "idx_commerce_action_status_updated" ON "commerce_action_requests"("status", "updated_at");
