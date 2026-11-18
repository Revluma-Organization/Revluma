-- Task 229 introduced the canonical store-level state
-- "initial_completed_with_limitations" (longer than the original varchar(32)).
-- Widen the persisted column so terminal sync states can be stored without
-- aborting the store update and leaving the sync lifecycle wedged.
ALTER TABLE "stores"
  ALTER COLUMN "initial_sync_status" TYPE VARCHAR(48);
