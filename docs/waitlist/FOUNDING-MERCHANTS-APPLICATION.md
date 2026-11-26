# Founding Merchants application (/waitlist)

The old waitlist (homepage modal → `POST /waitlist/join` → unauthenticated
`PATCH /waitlist/:id/details`) was replaced by a saved, resumable, multi-step
application at `/waitlist`. It reuses the existing `waitlist_users` table,
`/api/v1/waitlist` router, rate limiter, referral codes and welcome email.

## Pieces

| Layer | Path |
|---|---|
| Page shell (served at `/waitlist` by `cleanUrls`) | `Frontend/waitlist.html` |
| React app (built into `/landing-hero/waitlist.js` by `npm run build:embed`) | `Frontend/Landing/src/waitlist/` |
| Same-origin proxy (Vercel function) | `api/waitlist/application.js`, rewrite in `vercel.json` |
| Routes | `Backend/src/route/waitlistRoute.js` |
| Controller | `Backend/src/controller/waitlistApplicationController.js` |
| Rules, normalisers, token helpers | `Backend/src/utils/waitlistApplication.js` |
| Schema + migration | `Backend/prisma/schema.prisma` (`waitlist_users`), `Backend/prisma/migrations/20261127000000_founding_merchant_applications/` |
| Design override | `design-system/revluma/pages/waitlist.md` |

## Endpoints (`/api/v1/waitlist/application/...`, browser path `/api/waitlist/application/...`)

`POST start` (step 1, `Idempotency-Key`), `PUT steps/1|2|3`, `GET resume`
(rotates the session token), `GET status`, `POST submit`,
`POST resume/request-code`, `POST resume/verify-code`, `DELETE session`.
Kept: `GET /referral/:code/check`, admin `GET /stats`.

## Session and resume

- `rv_wl_session` cookie: 256-bit random token, HttpOnly, SameSite=Strict,
  Secure behind HTTPS, path `/api`, 30 days. Only its SHA-256 is stored.
- The token rotates on every page load (`GET resume`) and on code verification.
- Another device: a 6 digit code (HMAC stored, 15 min, 5 attempts, single use)
  is emailed; the request always answers 202 so it reveals nothing.
- Nothing sensitive is put in URLs; the only URL parameter is `?ref=`.

## Rollout runbook (production database)

The migration is additive and idempotent and runs through Render's
`prestart` (`prisma migrate deploy`) on the next backend deploy.

### Before-state census (recorded 2026-11-18 through the Supabase connector)

| Measure | Value |
|---|---|
| `waitlist_users` rows | 0 |
| Columns | 41 |
| Indexes | `idx_waitlist_country, idx_waitlist_email, idx_waitlist_industry, idx_waitlist_lead_score, idx_waitlist_position, idx_waitlist_status, waitlist_users_pkey, waitlist_users_work_email_key` |
| Constraints | `waitlist_users_pkey, waitlist_users_work_email_key` |
| Latest applied Prisma migration | `20261126000000_apple_sign_in_usd_billing` |

### Backup requirements (adapted from C2 §6.5)

1. Platform backup / PITR for `Revluma-Database`: **not verifiable through the
   connector**; confirm in the Supabase dashboard before deploying.
2. Logical backup immediately before the deploy. Re-run the census; if the
   table has any rows, copy it first:
   `CREATE TABLE public.waitlist_users_backup_r6 AS TABLE public.waitlist_users;`
   With 0 rows there is no data to back up; the schema is in git.
3. After deploy, record: `_prisma_migrations` has
   `20261127000000_founding_merchant_applications` with `finished_at` set and
   `rolled_back_at` null; the four new CHECK constraints and the three new
   unique indexes exist; row count unchanged.

### Pre-merge record (2026-11-26 22:28 UTC, database clock)

- Platform backups / PITR for `Revluma-Database`: confirmed on by the owner in
  the Supabase dashboard.
- Census re-run immediately before merge: 0 rows, 41 columns, latest migration
  `20261126000000_apple_sign_in_usd_billing`, no unfinished or rolled-back
  migrations. With 0 rows there was no data to copy, so no logical backup table
  was created.

### Order

1. Merge the PR (Vercel deploys the page and proxy).
2. Deploy the backend on Render right away (it applies the migration). Until
   it is live, `/waitlist` shows "We couldn't load the application" with a
   retry; nothing is lost because nothing can be saved yet.
3. Smoke test on production: load `/waitlist`, complete step 1 with a test
   address, reload (resumes at step 2), then delete that test row.

### Rollback

The code can be reverted without touching the database (new columns are
nullable or defaulted). Only if the schema itself must go, after taking a
backup: drop the four `waitlist_users_*_check` constraints, the three new
unique indexes, then the added columns.
