-- Staging regression: no migration may hand merchant data to Supabase Data API
-- roles (anon / authenticated). The backend is the only data path; these roles
-- are used solely by PostgREST-style clients.
--
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/staging/verify-data-api-isolation.sql
--
-- Read-only apart from the temporary role check; wrapped in a transaction that
-- rolls back so it can be run repeatedly.

BEGIN;

DO $$
DECLARE
  offending text;
  policy_count int;
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'Supabase Data API roles (anon, authenticated) are missing; create them before running this check';
  END IF;

  SELECT string_agg(DISTINCT table_name || ':' || privilege_type, ', ')
  INTO offending
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee IN ('anon', 'authenticated');

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'Data API roles hold table privileges on: %', offending;
  END IF;

  SELECT count(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND roles && ARRAY['anon', 'authenticated']::name[];

  IF policy_count > 0 THEN
    RAISE NOTICE 'Data API roles are referenced by % row level security policy/policies; verify each is intentional', policy_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'intelligence_findings'
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'intelligence_findings must keep RLS enabled and forced';
  END IF;

  RAISE NOTICE 'data API isolation checks passed: no privileges granted to anon/authenticated, % policy reference(s)', policy_count;
END $$;

ROLLBACK;
