# Settings → Account → Profile (page override)

> Overrides `MASTER.md` for `/dashboard/settings/profile`. Anything not listed
> here follows the Master.

**Built:** 2026-11-18 with ui-ux-pro-max (`--design-system`, `--domain ux`
form validation / confirmation / labels, `--stack react`, `--stack shadcn`).
Generator palette and type (blue/orange, Plus Jakarta Sans) were discarded in
favour of the shipped Revluma roles, as the Master's reconciliation requires.

## Reference pattern

Annotated settings cards, as on Linear (Settings → Account → Profile), Vercel
account settings, Stripe and GitHub:

- Page header: title + one-line purpose. No close button; the settings nav
  and breadcrumb handle navigation.
- One card per concern, in this order:
  1. **Personal information**: photo, full name, sign-in email
  2. **Workspace access**: active workspace, role, joined date, link to Roles & permissions
  3. **Sign-in & security**: password, two-factor, active sessions
  4. **Account**: user ID (copy) and member-since date
- Each row has a label and reason on the left (13rem) and the control on the
  right from `sm` up. Rows stack on phones.
- The card footer holds the save state on the left and Discard/Save on the right.

## Behaviour contracts

- Names are always editable. There is no "Edit" toggle. Save stays disabled until
  something is dirty. Validation runs on blur and again on submit, and focus
  moves to the first invalid field. Leaving with unsaved changes triggers
  `beforeunload`.
- Photo changes apply immediately: client-side type and size checks mirror the
  API exactly (PNG/JPEG/WebP, ≤ 5 MB). The preview is optimistic and rolls back
  on failure. Remove calls `DELETE /auth/profile/picture`.
- Email is read-only, shows a Verified or Not verified badge, and tells the user
  how to change it.
- Two-factor is turned off only after an AlertDialog confirmation. Enrolment
  enables nothing until the code verifies.
- Password requirements are shown up front and mirror `validateChangePassword`.
- Every displayed fact comes from `/auth/me` or the auth store. Rows whose
  data is missing are hidden, never filled with invented values.

## Tokens

Theme-aware Master roles only (`bg-panel`, `border-line`, `text-ink*`,
`bg-subtle` footers, `brand-strong` primary, `success`/`warning`/`danger`
badges). Class contracts are in `src/lib/settingsStyles.ts`. Type scale: page
22px, card title 15px, labels 13.5px, helper text 12.5px. Inputs are 38px and
buttons 36px.
