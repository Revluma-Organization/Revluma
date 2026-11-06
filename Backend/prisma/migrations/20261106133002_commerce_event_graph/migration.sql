-- Commerce event graph persistence (transactions, refunds, fulfillments) and
-- additive order business scalars. Non-destructive: additive columns and new
-- tables only; no existing rows rewritten; no financial values recomputed.
-- RLS enabled, zero policies on new tables (service-role only), consistent
-- with the 20261104170000 lockdown posture.

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "presentment_currency" varchar(3),
  ADD COLUMN IF NOT EXISTS "display_fulfillment_status" varchar(48),
  ADD COLUMN IF NOT EXISTS "processed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "closed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "source_name" varchar(96),
  ADD COLUMN IF NOT EXISTS "test_flag" boolean,
  ADD COLUMN IF NOT EXISTS "tax_amount" numeric(12,2),
  ADD COLUMN IF NOT EXISTS "shipping_amount" numeric(12,2),
  ADD COLUMN IF NOT EXISTS "duties_amount" numeric(12,2),
  ADD COLUMN IF NOT EXISTS "total_received" numeric(12,2),
  ADD COLUMN IF NOT EXISTS "tags" jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS "order_transactions" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id"              uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "external_order_id"     varchar(255) NOT NULL,
  "external_id"           varchar(255) NOT NULL,
  "kind"                  varchar(64) NOT NULL,
  "status"                varchar(32) NOT NULL,
  "gateway"               varchar(255),
  "amount"                numeric(12,2),
  "currency"              varchar(3),
  "parent_transaction_id" varchar(255),
  "processed_at"          timestamptz,
  "error_code"            varchar(64),
  "error_message"         varchar(500),
  "created_at"            timestamptz,
  "synced_at"             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "order_transactions_store_external_key" UNIQUE ("store_id", "external_id")
);
CREATE INDEX IF NOT EXISTS "idx_order_transactions_order"
  ON "order_transactions" ("store_id", "external_order_id");
ALTER TABLE "order_transactions" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "order_refunds" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id"           uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "external_order_id"  varchar(255) NOT NULL,
  "external_id"        varchar(255) NOT NULL,
  "note"               text,
  "refund_amount"      numeric(12,2),
  "refund_currency"    varchar(3),
  "refunded_shipping"  numeric(12,2),
  "created_at"         timestamptz,
  "refund_line_items"  jsonb NOT NULL DEFAULT '[]'::jsonb,
  "transactions"       jsonb NOT NULL DEFAULT '[]'::jsonb,
  "synced_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "order_refunds_store_external_key" UNIQUE ("store_id", "external_id")
);
CREATE INDEX IF NOT EXISTS "idx_order_refunds_order"
  ON "order_refunds" ("store_id", "external_order_id");
ALTER TABLE "order_refunds" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "order_fulfillments" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id"         uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "external_order_id" varchar(255) NOT NULL,
  "external_id"      varchar(255) NOT NULL,
  "status"           varchar(32),
  "location_name"    varchar(255),
  "tracking_company" varchar(255),
  "tracking_info"    jsonb NOT NULL DEFAULT '[]'::jsonb,
  "line_items"       jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at"       timestamptz,
  "updated_at"       timestamptz,
  "synced_at"        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "order_fulfillments_store_external_key" UNIQUE ("store_id", "external_id")
);
CREATE INDEX IF NOT EXISTS "idx_order_fulfillments_order"
  ON "order_fulfillments" ("store_id", "external_order_id");
ALTER TABLE "order_fulfillments" ENABLE ROW LEVEL SECURITY;
