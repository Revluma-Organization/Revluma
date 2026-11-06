-- Durable, tenant-scoped record of Shopify mandatory privacy/compliance webhooks
-- (customers/data_request, customers/redact, shop/redact).
--
-- Additive only: creates one new table and one new index set. No existing table
-- is altered. The table stores the request, its processing state and (for
-- customers/data_request) the compiled export artifact. It never stores access
-- tokens and never stores more customer data than the request itself carries.

CREATE TABLE IF NOT EXISTS "privacy_requests" (
  "id"           UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id"     UUID                     NOT NULL,
  "provider"     VARCHAR(40)              NOT NULL,
  "topic"        VARCHAR(80)              NOT NULL,
  "request_key"  VARCHAR(64)              NOT NULL,
  "status"       VARCHAR(20)              NOT NULL DEFAULT 'received',
  "payload"      JSONB,
  "result"       JSONB,
  "attempts"     INTEGER                  NOT NULL DEFAULT 0,
  "last_error"   VARCHAR(500),
  "received_at"  TIMESTAMPTZ(6)           NOT NULL DEFAULT now(),
  "processed_at" TIMESTAMPTZ(6),
  "updated_at"   TIMESTAMPTZ(6)           NOT NULL DEFAULT now(),
  CONSTRAINT "privacy_requests_store_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores" ("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "privacy_requests_store_provider_topic_key"
    UNIQUE ("store_id", "provider", "topic", "request_key")
);

CREATE INDEX IF NOT EXISTS "privacy_requests_status_received_at_idx"
  ON "privacy_requests" ("status", "received_at");

CREATE INDEX IF NOT EXISTS "privacy_requests_store_topic_received_at_idx"
  ON "privacy_requests" ("store_id", "topic", "received_at" DESC);

-- Mandatory privacy webhook payloads contain customer-identifying data. Like
-- every other business table in this project the new table keeps RLS enabled
-- with no permissive policies, so PostgREST roles cannot reach it at all; only
-- the server-side postgres role (Prisma) reads or writes it.
ALTER TABLE "privacy_requests" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
  api_roles text;
BEGIN
  IF NOT (has_anon OR has_auth) THEN
    RAISE NOTICE 'Supabase API roles not present; skipping privilege revoke.';
    RETURN;
  END IF;
  api_roles := trim(BOTH ',' FROM
    (CASE WHEN has_anon THEN ',anon' ELSE '' END) ||
    (CASE WHEN has_auth THEN ',authenticated' ELSE '' END));
  EXECUTE format('REVOKE ALL ON "privacy_requests" FROM %s', api_roles);
END $$;
