-- Per-domain sync state ledger.
--
-- Why: the single global stores.last_synced_at cannot express which
-- data domains succeeded, which failed, how many records were seen,
-- or whether pagination completed. A store can be authorized while
-- its products domain is hard-failing (F-001 post-mortem) — that must
-- be visible without reading logs.
--
-- Non-destructive: creates a new table only. No existing rows touched.
-- No financial values recomputed. RLS enabled with zero policies so
-- only the service-role path reaches it (consistent with the
-- 20261104170000 lockdown posture). Coverage is never fabricated here:
-- a domain whose sync has not completed reports pagination_complete=false
-- and status != 'ok'.

CREATE TABLE IF NOT EXISTS "store_sync_domain_states" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id"           uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "domain"             varchar(48) NOT NULL,
  "status"             varchar(24) NOT NULL DEFAULT 'never_run',
  "records_discovered" integer NOT NULL DEFAULT 0,
  "records_inserted"   integer NOT NULL DEFAULT 0,
  "records_updated"    integer NOT NULL DEFAULT 0,
  "records_deleted"    integer NOT NULL DEFAULT 0,
  "pages_completed"    integer,
  "pagination_complete" boolean NOT NULL DEFAULT false,
  "error_code"         varchar(120),
  "error_details"      text,
  "retry_count"        integer NOT NULL DEFAULT 0,
  "error_since"        timestamptz,
  "last_attempted_at"  timestamptz,
  "last_succeeded_at"  timestamptz,
  "last_checked_at"    timestamptz,
  "checkpoint"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "store_sync_domain_states_store_domain_key" UNIQUE ("store_id", "domain")
);

CREATE INDEX IF NOT EXISTS "idx_store_sync_domain_states_status"
  ON "store_sync_domain_states" ("store_id", "status");

ALTER TABLE "store_sync_domain_states" ENABLE ROW LEVEL SECURITY;
