-- C1: Deduplicate abandoned_carts and add unique partial index.
--
-- HISTORICAL CONTEXT: 5 duplicate (store_id, external_cart_id) pairs existed
-- from a same-batch double-insert on 2026-10-27 (3-661ms apart). The webhook
-- handler already has advisory lock + findFirst protection (commerceWebhookService.js),
-- but the schema lacked a unique constraint to prevent historical duplicates.
--
-- STEP 1 (applied manually during maintenance 2026-11-27 08:05Z):
-- Deleted 5 duplicate rows, keeping the row with the latest updated_at per group.
-- For the conflicting pair (hWNIRkL9NZfXL9NdYIa53fLH: $2,245.85 vs $1,459.90),
-- the $2,245.85 row was kept (updated_at 3 hours later = more recent evidence).
-- Final count: 30 carts (was 35).
--
-- STEP 2: Unique partial index prevents future duplicates.
-- Idempotent (IF NOT EXISTS): safe to re-run, no-op where already present.
CREATE UNIQUE INDEX IF NOT EXISTS uq_abandoned_carts_store_external
  ON abandoned_carts (store_id, external_cart_id)
  WHERE external_cart_id IS NOT NULL;
