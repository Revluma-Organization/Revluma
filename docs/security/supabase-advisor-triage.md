# Supabase security triage — Rev Intelligence release candidate

Updated: 2026-11-02. Project inspected **read-only** through the Supabase connector
(`Revluma-Database`, ref `jblpgqmbgdlzitprudgt`, PostgreSQL 17.6). No DDL, DML, policy,
grant, function or configuration change was applied to the project.

## What was actually measured

| Query | Result |
| --- | --- |
| Public base tables | **64** |
| Tables with RLS **disabled** | **0** |
| Tables with RLS enabled and **no policy** | **39** |
| Tables with RLS enabled and **1–2 policies** | **25** |
| Views / materialised views in `public` | 0 |
| Roles holding table privileges in `public` | `anon` and `authenticated`, on **all 64 tables**, `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` |
| `SECURITY DEFINER` functions executable by `anon`/`authenticated` | **2**: `public.rev_is_org_member(uuid)`, `public.rls_auto_enable()` |
| Functions without a pinned `search_path` | `public.rev_is_org_member`, `app.current_org_id()`, `app.current_user_id()` (plus Supabase's own `auth.*`, `extensions.*`, `storage.*` helpers) |
| Roles | `anon`, `authenticated`: NOLOGIN, not superuser, **no BYPASSRLS**; `postgres`: **BYPASSRLS**; `service_role`: BYPASSRLS, NOLOGIN; `authenticator`: LOGIN enabled, no bypass |

Function bodies were inspected verbatim:

- `public.rev_is_org_member(org_id uuid)` — `LANGUAGE sql STABLE SECURITY DEFINER`, no
  `search_path`, body `SELECT EXISTS (SELECT 1 FROM organization_members WHERE organization_id
  = org_id AND user_id = auth.uid() AND status = 'active')`. Executable by `anon` and
  `authenticated`.
- `public.rls_auto_enable()` — `SECURITY DEFINER`, `SET search_path TO 'pg_catalog'`, event
  trigger only.
- `app.current_org_id()` / `app.current_user_id()` — `SECURITY INVOKER`, no `search_path`,
  return `current_setting('app.current_org_id'|'app.current_user_id', true)::uuid` or NULL.

Policies on merchant tables:

| Table | Policy | Roles | Predicate |
| --- | --- | --- | --- |
| `orders` | `orders_tenant_isolation` | PUBLIC | `store_id IN (SELECT id FROM stores WHERE organization_id = app.current_org_id())` |
| `customers` | `customers_tenant_isolation` | PUBLIC | same shape |
| `stores` | `stores_tenant_isolation` | PUBLIC | `organization_id = app.current_org_id()` |
| `organizations` | `organizations_owner_isolation` | PUBLIC | `owner_id = app.current_user_id()` |
| `users` | `users_self_isolation` | PUBLIC | `id = app.current_user_id()` |
| `conversations`, `conversation_messages`, `merchant_memories` | `members_own_org_*` | PUBLIC | `rev_is_org_member(organization_id)` |

## Status of every finding

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 1 | 39 tables: RLS enabled, no policies | **Confirmed intentional and safe** | With RLS enabled and zero policies, `anon`/`authenticated` are denied every row regardless of the blanket grants. No such table is read by the app through the Data API (the app has no Supabase client). Deny-by-default is the desired posture; adding policies would *weaken* it. |
| 2 | `anon`/`authenticated` hold full CRUD on all 64 tables | **Confirmed unnecessary but not exploitable today; hardening recommended, not release-blocking** | Every table has RLS enabled, so the grants are gated. 39 of them have no policy at all (deny), and the 25 with policies evaluate `app.current_org_id()`/`auth.uid()`, which an unauthenticated PostgREST request cannot set (see #3). The grants add attack surface with no consumer — the frontend never calls PostgREST — so a follow-up migration should revoke them, but that is a production change requiring its own authorization window. |
| 3 | Tenant policies trust `app.current_org_id()` (a session GUC) | **Confirmed safe against the Data API today; fragile by construction** | `SET`/`set_config` can only run as SQL. PostgREST exposes only `public` schema routines via `/rpc`, and the only `public` routines are `rev_is_org_member` and `rls_auto_enable`; neither sets the GUC. `anon` has no `CREATE` on any schema, so it cannot shadow the resolvers. The backend connects as `postgres` (BYPASSRLS) and never sets the GUC, so these policies are unreachable in both paths. Replacement with `auth.uid()`-based policies is the durable fix when the Data API is ever enabled. |
| 4 | `public.rev_is_org_member` is `SECURITY DEFINER` without a pinned `search_path` | **Confirmed hardening defect — fixed in the candidate** | `SECURITY DEFINER` + mutable `search_path` is the classic privilege-escalation shape; it is only unexploitable because `anon` cannot create a schema. Fixed by `20261102090000_rev_supabase_function_hardening` (pinned `pg_catalog, public`, schema-qualified body), verified on staging with a faithful stand-in of the production object. |
| 5 | `public.rls_auto_enable()` executable by `anon`/`authenticated` | **Confirmed hardening defect — fixed in the candidate** | It is an event-trigger function; it can never be a legitimate client routine, and executing it outside a trigger context raises. The same migration revokes `EXECUTE` from `PUBLIC, anon, authenticated`. |
| 6 | `app.current_org_id()` / `app.current_user_id()` have a mutable `search_path` and call `current_setting` unqualified | **Confirmed hardening defect — fixed in the candidate** | Pinned to `pg_catalog` and the call schema-qualified. Behaviour verified unchanged (NULL when unset, NULL when malformed). |

Nothing in the inspected project is classified "unresolved and blocking release". The two
items that cannot be settled from inside the database are product decisions, not
uncertainties:

1. Whether the Data API should ever be enabled for Revluma. Today it is not used; if that
   changes, findings #2 and #3 must be re-addressed before any client ships.
2. Whether the blanket grants should be revoked now. Recommended, but it is a production
   change and must not ride along with this release.

## Candidate changes (staged, not applied to production)

`Backend/prisma/migrations/20261102090000_rev_supabase_function_hardening/migration.sql`

- Pins `search_path` on `public.rev_is_org_member`, `app.current_org_id`,
  `app.current_user_id` (identical bodies; `rev_is_org_member` is only replaced when
  `auth.uid()` exists, so the migration stays applicable to plain PostgreSQL).
- Revokes `EXECUTE` on `public.rls_auto_enable()` from `PUBLIC, anon, authenticated`.
- Touches no table, no policy, no merchant row, no grant on a merchant table.

Verification (local staging, PostgreSQL 16.2):

```
psql "$STAGING_DATABASE_URL" -f Backend/scripts/staging/verify-security-hardening.sql
→ security hardening verified: 4/4 helpers pinned, rls_auto_enable not executable by anon,
  rev_is_org_member semantics unchanged
```

The script builds the pre-hardening functions and an `auth.uid()` stand-in exactly as they
exist in the project, applies the migration, and asserts the pinned paths, the revoked grant,
and identical tenant-predicate answers for a member, an outsider and an anonymous caller.

`Backend/scripts/staging/verify-data-api-isolation.sql` remains the standing regression: it
fails if any repository migration grants `anon`/`authenticated` a table privilege, if a new
policy references a Data API role without review, or if the intelligence tables lose
RLS/FORCE RLS.

## Recommended follow-up (needs its own authorization, not part of this release)

```sql
-- 1. Close the unused Data API surface (verify nothing depends on it first).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

-- 2. Replace GUC-based tenant policies with JWT-claim policies before ever
--    enabling the Data API.
```
