# Settings → Account → Profile (page override)

> Overrides `MASTER.md` for `/dashboard/settings/profile`. Anything not listed
> here follows the Master.

**Rebuilt:** 2026-11-18 (round 2). The two-column form from #541 was replaced
on purpose, so do not bring it back. The ui-ux-pro-max searches (`--design-system`,
`--domain ux`/`style`/`landing`) contributed the centred identity hero and the
general accessibility and validation rules. Their generated palette and type
(blue/orange, Plus Jakarta Sans, glassmorphism) were discarded in favour of the
shipped Revluma roles.

## Reference pattern

The page is modelled on **Google Account → Personal info** and the **Atlassian
account "Profile and visibility"** page, with Linear and Vercel profile pages
as secondary references:

1. **Identity header first.** A restrained brand band, then a large centred
   avatar (96px, or 112px from `sm`) that overlaps the band and carries a
   camera badge. Below it come the name (h2), the email with a Verified or
   Not verified badge, and a 3-fact strip: Workspace (+N) · Role · Member since.
   On phones the strip becomes label/value rows.
2. **Read-first rows** grouped under headings that sit *outside* the cards:
   - **Personal info**: Name (Edit) · Email (Managed, read-only) · Photo (Add/Change)
   - **Sign-in & security**: Password (Change) · 2-step verification (Set up / Turn off) · Active sessions (Manage ›)
   - **Account details**: Permissions (View roles ›) · Workspaces · User ID (Copy)
3. Each row is a grid of label (11rem from `sm`), value, and **one** trailing
   action. Rows stack on phones, with the action beside the label.
4. Edits **expand inline in the row** on a `bg-subtle` surface (click-to-edit,
   as Google and Atlassian do). There is no page-level save bar.

## Behaviour contracts

- **Name:** Edit opens First/Last inputs, focused, with Save disabled until a
  value changes. Validation runs on blur and on submit (1–100 characters after
  trim, matching `PATCH /auth/profile`). Escape or Cancel discards. A failed
  save keeps the editor open with the API message (`role="alert"`). On success
  the hero, the row and the sidebar (`patchAuthUser`) update together. While
  the draft is dirty, `beforeunload` guards against leaving.
- **Photo:** the hero avatar, or the Photo row action, opens a dialog. The
  dialog shows a 160px preview; picking a file validates it client-side
  (PNG/JPEG/WebP ≤5MB) and previews it. **Nothing uploads until "Save photo"**,
  following Google's explicit-confirm pattern. "Remove photo" appears only when
  a photo exists and no file is pending, and it calls `DELETE
  /auth/profile/picture`. Errors stay inside the dialog.
- **Password:** Change expands `ChangePasswordForm` inline with live requirement checks.
- **2-step verification:** Set up opens the QR/secret/code dialog and turns on
  only after a verified code. Turn off always asks for confirmation in an
  `alertdialog` first.
- **Email** is read-only, marked "Managed", with a support hint.
- **Load failure:** a banner with Retry; the page renders from the cached auth user.
- Every fact comes from `GET /auth/me`. Nothing is invented, and missing values
  show "Unavailable" or "Not set".

## Testids (kept stable for tests)

`profile-hero-avatar`, `profile-hero-name`, `profile-email`, `profile-workspace`,
`profile-role`, `profile-row-name`, `profile-name-value`, `profile-photo-input`,
`profile-2fa-status`, `profile-user-id`.

## Files

- `src/pages/settings/Profile.tsx`: page and data flow
- `src/pages/settings/components/profile/ProfileHero.tsx`: identity header
- `src/pages/settings/components/profile/ProfileList.tsx`: `ProfileSection` and `ProfileRow`
- `src/pages/settings/components/profile/ProfilePhotoDialog.tsx`: preview + confirm upload
- `src/pages/settings/components/ChangePasswordForm.tsx`, `TwoFactorDialogs.tsx`
- `src/lib/profileSettings.ts`, `src/lib/settingsStyles.ts`
