-- Rev Intelligence release candidate: financial integrity, non-destructive.
--
-- 1. Customers carry the currency of their stored lifetime value. A customer
--    whose orders span currencies is stored with a NULL LTV and an explicit
--    mixed-currency marker instead of one silently mixed total.
-- 2. Cancellations are tombstoned so a delayed order create/update cannot
--    resurrect cancelled revenue.
--
-- 3. Orders keep the refunded amount alongside the net total they already
--    store, so gross order value can be reconstructed (total + refunded_total)
--    instead of guessed. Existing rows stay NULL: their refund history is
--    unknown, and a NULL is reported as unknown rather than as zero refunds.
--
-- No existing rows are rewritten and no monetary value is recomputed here.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "refunded_total" numeric(10,2);

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "ltv_currency" VARCHAR(3),
  ADD COLUMN IF NOT EXISTS "ltv_mixed_currency" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "order_cancellation_tombstones" (
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "external_order_id" varchar(255) NOT NULL,
  "cancelled_at" timestamptz,
  "currency" varchar(3),
  "total" numeric(10,2),
  "observed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "order_cancellation_tombstones_pkey" PRIMARY KEY ("store_id", "external_order_id")
);

CREATE INDEX IF NOT EXISTS "idx_order_cancellations_observed"
  ON "order_cancellation_tombstones" ("observed_at" DESC);
