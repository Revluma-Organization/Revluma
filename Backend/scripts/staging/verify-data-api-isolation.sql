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

  -- 20261104 lockdown invariants (production hardening Phase 3):
  -- no open-write policy may ever return to the public schema.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND (policyname = 'events_public_insert' OR with_check = 'true')
  ) THEN
    RAISE EXCEPTION 'an open-write (WITH CHECK true) policy exists in the public schema';
  END IF;

  -- Default privileges must not re-grant table access to Data API roles.
  IF EXISTS (
    SELECT 1 FROM pg_default_acl d
    WHERE d.defaclnamespace = 'public'::regnamespace
      AND d.defaclobjtype IN ('r', 'S')
      AND d.defaclacl::text ~ '(anon|authenticated)='
  ) THEN
    RAISE EXCEPTION 'public-schema default privileges still include anon/authenticated';
  END IF;

  -- The SECURITY DEFINER membership helper must never be anon-executable.
  IF to_regprocedure('public.rev_is_org_member(uuid)') IS NOT NULL
     AND has_function_privilege('anon', 'public.rev_is_org_member(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rev_is_org_member is executable by anon';
  END IF;

  -- Trigger functions are never client-callable routines.
  IF to_regprocedure('public.revluma_enqueue_merchant_memory_embedding()') IS NOT NULL
     AND (has_function_privilege('anon', 'public.revluma_enqueue_merchant_memory_embedding()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.revluma_enqueue_merchant_memory_embedding()', 'EXECUTE')) THEN
    RAISE EXCEPTION 'merchant memory embedding trigger function is client-executable';
  END IF;
END $$;

-- Live negative access attempts: privilege checks alone do not prove runtime
-- behaviour, so the API roles actually try to touch merchant data. Each
-- attempt must fail with insufficient_privilege; success fails the build.
DO $$
DECLARE n bigint;
BEGIN
  BEGIN
    SET ROLE anon;
    EXECUTE 'SELECT count(*) FROM public.conversations' INTO n;
    RAISE EXCEPTION 'SECURITY REGRESSION: anon read conversations (% rows)', n;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'anon SELECT conversations denied';
  END;
  RESET ROLE;

  BEGIN
    SET ROLE authenticated;
    EXECUTE 'INSERT INTO public.events (id) VALUES (gen_random_uuid())';
    RAISE EXCEPTION 'SECURITY REGRESSION: authenticated inserted into events';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'authenticated INSERT events denied';
  END;
  RESET ROLE;

  BEGIN
    SET ROLE anon;
    EXECUTE 'TRUNCATE public.waitlist_users';
    RAISE EXCEPTION 'SECURITY REGRESSION: anon truncated a table';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'anon TRUNCATE denied (RLS does not apply to TRUNCATE; grants do)';
  END;
  RESET ROLE;

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('app.current_org_id', gen_random_uuid()::text, false);
    EXECUTE 'SELECT count(*) FROM public.orders' INTO n;
    RAISE EXCEPTION 'SECURITY REGRESSION: forged tenant GUC read orders (% rows)', n;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'authenticated SELECT orders denied even with forged app.current_org_id';
  END;
  RESET ROLE;

  RAISE NOTICE 'data API isolation checks passed: no privileges granted to anon/authenticated, live attempts denied';
END $$;

ROLLBACK;
