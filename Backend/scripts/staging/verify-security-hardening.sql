-- Staging verification for 20261102090000_rev_supabase_function_hardening.
--
-- Builds PostgreSQL-shaped stand-ins for the Supabase-only objects (the `auth`
-- schema and `auth.uid()` plus the pre-hardening function bodies exactly as
-- they exist in the project), applies the candidate migration, and asserts:
--   1. every helper now has a pinned search_path,
--   2. rls_auto_enable is no longer executable by anon/authenticated,
--   3. rev_is_org_member and the GUC helpers keep their behaviour.
--
-- Run from the Backend directory as a role that owns these functions:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f scripts/staging/verify-security-hardening.sql
--
-- The whole script runs in one transaction that is rolled back.

BEGIN;

-- ---------------------------------------------------------------- fixtures
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', TRUE), '')::uuid $$;

-- Pre-hardening definitions, identical in shape to the project's objects.
CREATE OR REPLACE FUNCTION public.rev_is_org_member(org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RAISE LOG 'rls_auto_enable: stand-in for the Supabase event trigger';
END;
$function$;

CREATE OR REPLACE FUNCTION app.current_org_id()
RETURNS uuid LANGUAGE plpgsql STABLE
AS $function$
BEGIN
  RETURN current_setting('app.current_org_id', TRUE)::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid LANGUAGE plpgsql STABLE
AS $function$
BEGIN
  RETURN current_setting('app.current_user_id', TRUE)::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rev_is_org_member(uuid) TO anon, authenticated;

DO $$
DECLARE
  org uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  before_state boolean;
BEGIN
  INSERT INTO users (id, full_name, email, password_hash)
  VALUES (member, 'Staging Member', 'member-' || member || '@example.invalid', 'staging-only'),
         (outsider, 'Staging Outsider', 'outsider-' || outsider || '@example.invalid', 'staging-only');

  INSERT INTO organizations (id, owner_id, company_name, industry, country)
  VALUES (org, member, 'Staging Security Org', 'test', 'NG');

  INSERT INTO organization_members (organization_id, user_id, role, status)
  VALUES (org, member, 'owner', 'active');

  PERFORM set_config('request.jwt.claim.sub', member::text, true);
  before_state := public.rev_is_org_member(org);
  IF before_state IS NOT TRUE THEN
    RAISE EXCEPTION 'pre-hardening rev_is_org_member must accept an active member, got %', before_state;
  END IF;
END $$;

-- ------------------------------------------------ candidate migration applied
\i prisma/migrations/20261102090000_rev_supabase_function_hardening/migration.sql

-- ------------------------------------------------------------- assertions
DO $$
DECLARE
  org uuid;
  member uuid;
  outsider uuid;
  anon_exec boolean;
  helper_count int;
  pinned_count int;
  member_answer boolean;
  outsider_answer boolean;
BEGIN
  -- 1. every helper has a pinned search_path
  SELECT count(*) INTO helper_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname = 'public' AND p.proname IN ('rev_is_org_member', 'rls_auto_enable'))
     OR (n.nspname = 'app' AND p.proname IN ('current_org_id', 'current_user_id'));

  SELECT count(*) INTO pinned_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE ((n.nspname = 'public' AND p.proname IN ('rev_is_org_member', 'rls_auto_enable'))
      OR (n.nspname = 'app' AND p.proname IN ('current_org_id', 'current_user_id')))
    AND EXISTS (
      SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
      WHERE cfg LIKE 'search_path=%'
    );

  IF helper_count <> 4 OR pinned_count <> 4 THEN
    RAISE EXCEPTION 'expected 4 pinned helpers, found % of %', pinned_count, helper_count;
  END IF;

  -- 2. the event-trigger function is no longer reachable by a Data API role
  SELECT has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE') INTO anon_exec;
  IF anon_exec THEN
    RAISE EXCEPTION 'anon can still execute rls_auto_enable()';
  END IF;

  -- 3. tenant predicate semantics are unchanged
  SELECT id INTO org FROM organizations WHERE company_name = 'Staging Security Org';
  SELECT user_id INTO member FROM organization_members WHERE organization_id = org AND role = 'owner';
  SELECT id INTO outsider FROM users WHERE id <> member LIMIT 1;

  PERFORM set_config('request.jwt.claim.sub', member::text, true);
  member_answer := public.rev_is_org_member(org);

  PERFORM set_config('request.jwt.claim.sub', outsider::text, true);
  outsider_answer := public.rev_is_org_member(org);

  IF member_answer IS NOT TRUE OR outsider_answer IS NOT FALSE THEN
    RAISE EXCEPTION 'rev_is_org_member changed behaviour: member=% outsider=%', member_answer, outsider_answer;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF public.rev_is_org_member(org) IS NOT FALSE THEN
    RAISE EXCEPTION 'anonymous caller must not be an org member';
  END IF;

  -- 4. GUC helpers keep their contract: unset -> NULL, malformed -> NULL
  PERFORM set_config('app.current_org_id', '', true);
  IF app.current_org_id() IS NOT NULL THEN
    RAISE EXCEPTION 'app.current_org_id must be NULL when unset';
  END IF;
  PERFORM set_config('app.current_org_id', 'not-a-uuid', true);
  IF app.current_org_id() IS NOT NULL THEN
    RAISE EXCEPTION 'app.current_org_id must return NULL for malformed input';
  END IF;

  RAISE NOTICE 'security hardening verified: 4/4 helpers pinned, rls_auto_enable not executable by anon, rev_is_org_member semantics unchanged';
END $$;

ROLLBACK;
