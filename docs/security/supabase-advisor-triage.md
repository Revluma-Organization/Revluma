# Supabase advisor triage — Rev Intelligence release candidate

Status: **triage complete for everything observable in the repository; three findings
require one read-only query against the project to close.**
No production policy, grant or function was changed. Nothing in this document was
applied to the shared Supabase project.

## Findings under review

From the Supabase security advisor for the production project:

| # | Advisor finding | Count |
| --- | --- | --- |
| 1 | Tables with row level security enabled but no policies | 39 |
| 2 | Functions with a mutable `search_path` | 4 |
| 3 | `SECURITY DEFINER` functions executable by a public role | 2 |

## What the repository proves

Evidence gathered from this checkout (`Backend/`, `Frontend/`, `python/`, `.github/`):

1. **The application never uses the Supabase Data API.**
   `Frontend/Dashboard` contains no `@supabase/supabase-js` dependency and no Supabase
   client; the only mention of Supabase is a comment in
   `src/hooks/useTrendingProducts.ts` describing a possible future function call.
   No `anon` key, `service_role` key or `SUPABASE_URL` appears anywhere in the
   repository, including the environment examples.
2. **All data access is server-side Prisma** over `DATABASE_URL`
   (`Backend/src/configs/database.js`), behind authenticated Express routes that scope
   every query by `organization_id` (covered by the tenant-isolation tests listed below).
3. **Candidate migrations do not grant Data API roles anything.**
   Searching every `.sql` file under `Backend/prisma/migrations` finds exactly one
   reference to `anon`/`authenticated`: `20261027140000_intelligence_findings`, which
   *revokes* all privileges and enables `FORCE ROW LEVEL SECURITY` on the two
   intelligence tables. No `GRANT` to those roles exists anywhere in the repository.
4. **Recorded production posture (from `docs/mvp-execution/implementation/TASK-027.md`,
   a read-only inspection made earlier):** `orders` has `relrowsecurity = true`,
   `relforcerowsecurity = true`, one policy `orders_tenant_isolation` scoped by
   `app.current_org_id()` through `stores.organization_id`, **and** `UPDATE` grants on
   `orders.abandoned_cart_id` for `anon`, `authenticated`, `service_role` and `postgres`.

## Classification

| Finding | Classification | Reasoning | Action |
| --- | --- | --- | --- |
| 39 tables: RLS enabled, no policies | **Intentional deny-all, keep** | With RLS on and no policy, `anon`/`authenticated` see zero rows. Since the frontend never talks to PostgREST and no migration grants these roles table privileges, this is the safest possible default and matches the "server-side Prisma only" architecture. | Do **not** add blanket `USING (true)` or per-tenant policies. Remove only if the Data API is deliberately enabled later. |
| 4 functions: mutable `search_path` | **Needs remediation if any is `SECURITY DEFINER`, otherwise hardening** | A mutable `search_path` lets a caller shadow objects with temporary/attacker-controlled schemas. It is only exploitable when the function runs with elevated privileges (`SECURITY DEFINER`) or is reached through PostgREST with `anon`. | Pin `SET search_path = pg_catalog, <schema>` and schema-qualify references. Deploy as a normal Prisma migration; test in staging first. |
| 2 `SECURITY DEFINER` functions publicly executable | **Highest priority, unverified** | A `SECURITY DEFINER` function executes as its owner. If it reads tenant tables (for example a helper behind `app.current_org_id()`), an `anon` caller can reach data RLS would otherwise hide. If the body only reads `pg_catalog`/session settings and returns a value, exposure is limited. | Run the diagnostic below, then `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` on anything the backend does not call through RPC, and grant `EXECUTE` to the backend role only. |

The `orders` `UPDATE` grant recorded in TASK-027 is the one finding that is *not*
explained by "no Data API usage": `anon` and `authenticated` can issue an update against
`orders.abandoned_cart_id`. It stays harmless only while `orders_tenant_isolation`
resolves `app.current_org_id()` to a value the caller cannot set. Confirm this is the
case before you treat it as low risk:

```sql
-- Read-only. Run in the Supabase SQL editor.
SELECT pg_get_functiondef(p.oid) AS definition,
       p.prosecdef          AS security_definer,
       p.proconfig          AS config,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname IN ('current_org_id', 'set_org_id', 'app_current_org_id');
```

## Diagnostic SQL (read-only)

```sql
-- 1. Functions with a mutable search_path and who may execute them.
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer, p.proconfig AS pinned_path,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND NOT EXISTS (
    SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
    WHERE cfg LIKE 'search_path=%'
  )
ORDER BY p.prosecdef DESC, n.nspname, p.proname;

-- 2. SECURITY DEFINER functions callable by a Data API role.
SELECT n.nspname || '.' || p.proname AS function,
       pg_get_function_identity_arguments(p.oid) AS args,
       (SELECT string_agg(DISTINCT r.rolname, ', ')
          FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
          JOIN pg_roles r ON r.oid = a.grantee
         WHERE a.privilege_type = 'EXECUTE'
           AND r.rolname IN ('PUBLIC', 'anon', 'authenticated')) AS grantees
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

-- 3. Tables where a Data API role holds privileges (the only path to exposing
--    "RLS enabled, no policy" tables).
SELECT table_schema, table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE grantee IN ('anon', 'authenticated')
  AND table_schema = 'public'
ORDER BY table_name, grantee, privilege_type;
```

## Regression coverage added in this branch

- `Backend/scripts/staging/verify-data-api-isolation.sql` fails the staging release
  check if any migration grants `anon`/`authenticated` a table privilege, if Data API
  roles appear in a new policy without review, or if the intelligence tables lose
  `RLS`/`FORCE RLS`.
- Verified locally against the zero-cost staging database: no privileges are held by
  `anon`/`authenticated`, no policies reference them, and `intelligence_findings` keeps
  both RLS flags (see `docs/execution/EXECUTION_STATUS.md`).

## What is still unverified, and why

The advisor findings describe the shared Supabase project. This environment has no
credentials for it and the brief forbids touching it, so the function bodies and the
postgres-level grants could not be inspected. Run the three queries above and paste the
output into this document; each row then moves to either "safe, keep" or "remediate"
with a named owner. Until then, the release position is: **no evidence of a Data API
data path, three findings that a read-only query can close, one production `UPDATE`
grant that deserves explicit confirmation.**
