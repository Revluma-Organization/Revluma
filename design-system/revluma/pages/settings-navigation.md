# Settings navigation (page override)

> Overrides `MASTER.md` for every `/dashboard/settings/*` route.

**Built:** 2026-11-18. The ui-ux-pro-max navigation rules (show location,
predictable Back, shallow hierarchy, keyboard reachability) apply. Its
sidebar searches had nothing settings-specific, so the pattern follows Linear
(the sidebar swaps to settings with "Back to app") and Shopify admin (Settings
is its own focused space with a single menu).

## Pattern: one sidebar with a Settings mode

- On any settings route, the **app sidebar swaps its workspace links for the
  settings menu in the same rail**. There is never a second sidebar.
- The brand row and account card stay where they are, so the frame doesn't jump.
- Top of the rail: **Back to dashboard** (returns to the last app page,
  remembered in `sessionStorage`, with Overview as the fallback), a "Settings"
  heading and a **Search settings** field that filters by label, group and
  keywords. Escape clears the search.
- Groups are **always expanded**, with small uppercase labels that are not
  buttons. Danger zone sits last, under a divider, in danger tone.
- The rail is always expanded in Settings mode, whatever the user's collapse
  preference.
- **Only built pages are listed.** Placeholder routes keep their URLs but stay
  out of the menu until they ship.
- **Role-aware:** an entry hides only when the role is *known* to be too low
  (Billing needs admin, Danger zone needs owner). The `"unknown"` role shows
  everything, and the backend `requireRole` is the real gate.
- **Billing** is one menu entry. Its four pages (Overview / Plan / Payment
  methods / Invoices) render as tabs above the content.
- **Breadcrumb:** Dashboard / Settings / {page}. "Dashboard" hides on phones.
- **Phones:** the drawer shows the settings menu. `/dashboard/settings` is a
  grouped list with a description per row; desktop redirects to Profile.
- **⌘K** reaches every settings page.

## Source of truth

`src/data/settingsNav.ts` drives the sidebar (`components/layout/SettingsNav.tsx`),
the mobile index and Billing tabs (`pages/settings/SettingsLayout.tsx`), the
breadcrumb (`resolveSettingsCrumbs`) and the command palette
(`lib/commandPalette/staticCommands.ts`). To add a page, add one entry there.
