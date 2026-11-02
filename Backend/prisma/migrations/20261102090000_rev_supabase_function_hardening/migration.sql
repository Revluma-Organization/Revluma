-- Security hardening for the Supabase-only helper functions.
--
-- These functions exist in the production Supabase project but were never
-- captured in a repository migration. The Supabase security advisor flags them
-- because they run with elevated privileges (`SECURITY DEFINER`) and/or read a
-- session setting without a pinned `search_path`.
--
-- Findings from the project (read-only inspection, 2026-11-02):
--   * public.rev_is_org_member(uuid)  SECURITY DEFINER, no pinned search_path,
--     executable by anon and authenticated.
--   * public.rls_auto_enable()        SECURITY DEFINER, search_path already
--     pinned to pg_catalog, executable by anon/authenticated (an event-trigger
--     function that can never legitimately be invoked through PostgREST).
--   * app.current_org_id() / app.current_user_id()
--     SECURITY INVOKER, no pinned search_path, call `current_setting`
--     unqualified.
--
-- Exploitability today is low: `anon`/`authenticated` hold no CREATE privilege,
-- so no schema can be injected ahead of `public` in the search path, and
-- PostgREST exposes no routine that sets `app.current_org_id`, so the tenant
-- policies evaluate to NULL and deny every row. The hardening removes the
-- fragile assumptions rather than leaving "it happens to be safe".
--
-- Safe and idempotent: functions are replaced with identical bodies plus a
-- pinned search_path; one EXECUTE grant is revoked from a function that must
-- never be called by a client. No data, policy, table or grant on a merchant
-- table is touched.

CREATE SCHEMA IF NOT EXISTS app;

-- Only present on Supabase (the function body depends on `auth.uid()`), so the
-- replacement is skipped on a plain PostgreSQL database instead of failing the
-- deployment.
DO $$
BEGIN
  IF to_regprocedure('auth.uid()') IS NOT NULL THEN
    EXECUTE $ddl$
      CREATE OR REPLACE FUNCTION public.rev_is_org_member(org_id uuid)
      RETURNS boolean
      LANGUAGE sql
      STABLE SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $function$
        SELECT EXISTS (
          SELECT 1 FROM public.organization_members
          WHERE organization_id = org_id
            AND user_id = auth.uid()
            AND status = 'active'
        );
      $function$;
    $ddl$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app.current_org_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $function$
BEGIN
  RETURN pg_catalog.current_setting('app.current_org_id', TRUE)::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $function$
BEGIN
  RETURN pg_catalog.current_setting('app.current_user_id', TRUE)::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

-- An event-trigger function is never a client-callable routine. Keep EXECUTE
-- with the owner only, so the trigger still fires and PostgREST cannot reach it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable' AND p.pronargs = 0
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END $$;
