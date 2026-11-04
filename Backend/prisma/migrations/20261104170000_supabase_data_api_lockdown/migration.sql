-- Supabase Data API lockdown (production hardening Phase 3, 2026-11-04).
--
-- Live inspection findings (production project jblpgqmbgdlzitprudgt):
--   * anon and authenticated held DELETE, INSERT, REFERENCES, SELECT, TRIGGER,
--     TRUNCATE, UPDATE on ALL 63 public tables. TRUNCATE is not subject to RLS,
--     so anyone holding the (public by design) anon key could wipe any table.
--   * Default privileges for postgres AND supabase_admin re-granted the same
--     set (arwdDxtm) to anon/authenticated on every FUTURE public table, so
--     the exposure regenerated itself with every migration.
--   * public.events carried an `events_public_insert` policy with
--     WITH CHECK (true): unauthenticated, unvalidated, unlimited inserts into
--     the table Rev reads as business evidence (data-poisoning vector).
--   * public.rev_is_org_member(uuid) (SECURITY DEFINER, hardened 2026-11-02)
--     and the trigger function revluma_enqueue_merchant_memory_embedding()
--     were executable by PUBLIC/anon/authenticated.
--
-- Access-pattern audit (why revoking is safe):
--   * No client in this repository uses supabase-js or the Supabase REST API
--     (zero createClient/rest-v1 references in Frontend, Backend, Python).
--   * Supabase Auth has 0 users; the application runs its own auth (users,
--     refresh_tokens). Storage has 0 buckets and 0 policies.
--   * The PostgREST role (authenticator) has been idle since 2026-08-28 while
--     the application roles (postgres via Node/Prisma and Python/SQLAlchemy)
--     serve all traffic.
--   * RLS stays enabled on all tables and the tenant policies stay in place
--     as defence in depth for any future Data API use.
--
-- Idempotent and environment-safe: on a plain PostgreSQL database without the
-- Supabase API roles (CI), the lockdown is skipped with a notice. Every
-- privilege-sensitive statement degrades to a notice instead of failing the
-- deployment.

DO $$
DECLARE
  has_anon  boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_auth  boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
  has_admin boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin');
  api_roles text;
BEGIN
  IF NOT (has_anon OR has_auth) THEN
    RAISE NOTICE 'Supabase API roles not present; skipping Data API lockdown.';
    RETURN;
  END IF;

  api_roles := trim(BOTH ',' FROM
    (CASE WHEN has_anon THEN ',anon' ELSE '' END) ||
    (CASE WHEN has_auth THEN ',authenticated' ELSE '' END));

  -- 1. Remove every current grant on public tables/sequences/views.
  EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %s', api_roles);
  EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %s', api_roles);

  -- 2. Stop the exposure regenerating on future objects.
  BEGIN
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %s', api_roles);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %s', api_roles);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Could not alter postgres default privileges; continuing.';
  END;
  IF has_admin THEN
    BEGIN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM %s', api_roles);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %s', api_roles);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Could not alter supabase_admin default privileges; continuing.';
    END;
  END IF;

  -- 3. Drop the open-write events policy. Events are written only by the
  --    Node gateway (eventController, postgres role); no client ever used
  --    the public insert path, and WITH CHECK (true) validated nothing.
  IF to_regclass('public.events') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS events_public_insert ON public.events';
  END IF;

  -- 4. Functions: rev_is_org_member stays executable by authenticated only
  --    (RLS policies on conversations/conversation_messages/merchant_memories
  --    reference it; anon gets nothing because auth.uid() is NULL for anon,
  --    and after step 1 anon cannot reach those tables at all). The trigger
  --    function is never client-callable: owner-only EXECUTE, like
  --    rls_auto_enable (hardened 2026-11-02).
  IF to_regprocedure('public.rev_is_org_member(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rev_is_org_member(uuid) FROM PUBLIC';
    IF has_anon THEN
      EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rev_is_org_member(uuid) FROM anon';
    END IF;
    IF has_auth THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.rev_is_org_member(uuid) TO authenticated';
    END IF;
  END IF;
  IF to_regprocedure('public.revluma_enqueue_merchant_memory_embedding()') IS NOT NULL THEN
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.revluma_enqueue_merchant_memory_embedding() FROM PUBLIC, %s', api_roles);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Could not revoke trigger-function EXECUTE; continuing.';
    END;
  END IF;
END $$;
