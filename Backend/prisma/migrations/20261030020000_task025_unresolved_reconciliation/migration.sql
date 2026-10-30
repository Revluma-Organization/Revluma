-- Task 025: additive, non-destructive, merchant-scoped unresolved reconciliation ledger.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_orders_store_id" ON "orders" ("store_id", "id");
CREATE TABLE IF NOT EXISTS "order_checkout_reconciliation_cases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'UNRESOLVED',
  "reason" VARCHAR(60) NOT NULL,
  "source_identifier" VARCHAR(255),
  "candidate_count" INTEGER NOT NULL DEFAULT 0,
  "attempt_count" INTEGER NOT NULL DEFAULT 1,
  "first_observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(6),
  "verified_checkout_id" UUID,
  CONSTRAINT "order_checkout_reconciliation_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_checkout_reconciliation_cases_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_checkout_reconciliation_cases_order_id_fkey" FOREIGN KEY ("store_id", "order_id") REFERENCES "orders"("store_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "uq_order_checkout_reconciliation_case_store_order" UNIQUE ("store_id","order_id"),
  CONSTRAINT "order_checkout_reconciliation_cases_status_check" CHECK ("status" IN ('UNRESOLVED','RESOLVED')),
  CONSTRAINT "order_checkout_reconciliation_cases_attempt_count_check" CHECK ("attempt_count" > 0),
  CONSTRAINT "order_checkout_reconciliation_cases_resolution_check" CHECK (("status" = 'UNRESOLVED' AND "resolved_at" IS NULL AND "verified_checkout_id" IS NULL) OR ("status" = 'RESOLVED' AND "resolved_at" IS NOT NULL AND "verified_checkout_id" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "idx_order_checkout_reconciliation_case_status" ON "order_checkout_reconciliation_cases" ("store_id","status","last_observed_at");
