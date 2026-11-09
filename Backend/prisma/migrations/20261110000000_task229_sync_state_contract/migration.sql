-- Task 229 §2/§4: canonical, typed, versioned sync lifecycle on the
-- per-resource ledger. The engine `status` column is left intact (backward
-- compatible); these columns carry the merchant/reporting contract and are
-- populated by the syncStateContract writers + re-derived on read.

-- AlterTable: add canonical contract columns
ALTER TABLE "store_sync_domain_states" ADD COLUMN "canonical_status" VARCHAR(48) NOT NULL DEFAULT 'never_run';
ALTER TABLE "store_sync_domain_states" ADD COLUMN "coverage_state" VARCHAR(32) NOT NULL DEFAULT 'unknown';
ALTER TABLE "store_sync_domain_states" ADD COLUMN "failure_class" VARCHAR(24) NOT NULL DEFAULT 'unknown';
ALTER TABLE "store_sync_domain_states" ADD COLUMN "capability_state" VARCHAR(24) NOT NULL DEFAULT 'unknown';
ALTER TABLE "store_sync_domain_states" ADD COLUMN "retry_eligible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "store_sync_domain_states" ADD COLUMN "schema_version" VARCHAR(8) NOT NULL DEFAULT '1';
ALTER TABLE "store_sync_domain_states" ADD COLUMN "coverage_limitations" JSONB;

-- Backfill (data-only). New syncs / the progress + recovery passes re-derive
-- these precisely via the contract; this makes existing rows inspectable now.

-- canonical_status: map legacy engine values onto the canonical lifecycle.
UPDATE "store_sync_domain_states"
SET "canonical_status" = CASE "status"
  WHEN 'ok' THEN 'resource_completed'
  WHEN 'degraded' THEN 'resource_partial'
  ELSE "status"
END
WHERE "status" IN ('ok', 'degraded');

-- failure_class: classify existing errors (approximation of the JS contract).
UPDATE "store_sync_domain_states"
SET "failure_class" = CASE
  WHEN "status" IN ('ok', 'never_run') THEN 'none'
  WHEN "status" = 'running' THEN 'none'
  WHEN "error_code" IS NULL THEN 'unknown'
  WHEN upper("error_code") LIKE '%429%' OR upper("error_code") LIKE '%RATE%' OR upper("error_code") LIKE '%THROTTLE%' THEN 'rate_limited'
  WHEN upper("error_code") LIKE '%SCOPE%' OR upper("error_code") LIKE '%PERMISSION%'
    OR upper("error_code") LIKE '%FORBIDDEN%' OR upper("error_code") LIKE '%NOT_GRANTED%'
    OR upper("error_code") LIKE '%TOKEN%' OR upper("error_code") LIKE '%EXPIRED%'
    OR upper("error_code") LIKE '%401%' OR upper("error_code") LIKE '%403%' THEN 'auth'
  WHEN upper("error_code") LIKE '%NOT_SUPPORTED%' OR upper("error_code") LIKE '%UNSUPPORTED%'
    OR upper("error_code") LIKE '%UNKNOWN_FIELD%' THEN 'unsupported'
  WHEN upper("error_code") LIKE '%PRISMA%' OR upper("error_code") LIKE '%PERSIST%'
    OR upper("error_code") LIKE '%FOREIGN%' THEN 'persistence'
  WHEN upper("error_code") LIKE '%TIMEOUT%' OR upper("error_code") LIKE '%503%'
    OR upper("error_code") LIKE '%502%' OR upper("error_code") LIKE '%ECONN%' THEN 'transient'
  ELSE 'unknown'
END;

-- coverage_state: certify existing rows (approximation of the JS contract).
UPDATE "store_sync_domain_states"
SET "coverage_state" = CASE
  WHEN "status" = 'never_run' THEN 'unknown'
  WHEN "status" = 'ok' AND "records_discovered" = 0 AND "pagination_complete" THEN 'verified_zero'
  WHEN "status" = 'ok' AND NOT "pagination_complete" THEN 'partial'
  WHEN "status" = 'ok' THEN 'complete'
  WHEN "status" = 'degraded' AND "records_discovered" = 0 AND "pagination_complete" THEN 'verified_zero'
  WHEN "status" = 'degraded' THEN 'partial'
  WHEN "status" = 'running' AND "last_succeeded_at" IS NOT NULL AND "records_discovered" > 0 THEN 'partial'
  WHEN "status" = 'running' THEN 'unknown'
  WHEN "status" = 'failed' THEN CASE
    WHEN "failure_class" = 'persistence' THEN 'persistence_failure'
    WHEN "last_succeeded_at" IS NOT NULL AND "records_discovered" > 0 THEN 'partial'
    ELSE 'retrieval_failure'
  END
  ELSE 'unknown'
END;
