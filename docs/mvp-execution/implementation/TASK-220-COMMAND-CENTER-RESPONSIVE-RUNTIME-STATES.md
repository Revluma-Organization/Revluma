# Task 220 — Command Center responsive and runtime states

## Scope

User-assigned Task 220, mapping to **Tasks 286–290** (mobile navigation and responsive drawer;
responsive layouts 320/375/430/600/768/1024/1280/1440/1920; Command Center loading/error/partial/
stale; performance and observability; documentation). The Command Center (`/dashboard/overview`)
is the merchant's main work surface after login; it renders the Task 216 briefing, the Task 217
priority finding, and the Task 218 store-scoped Business health / Operational history panels.

This task makes that surface behave honestly at every width and across every runtime state —
without redesigning any other workspace. It is **frontend-only**: no backend route, contract,
table or write path is touched (the production error contract, `Cache-Control: no-store`, and
tenant scoping are re-read from source and consumed, not changed).

The pre-change audit (`diagnostics/TASK-220-…-diagnostics.md`) found 16 findings (F-1..F-16);
implementation added three more discovered in flight (F-17..F-19). All are resolved. This report
lists the change by area; the scenario-to-test mapping (≥100 rows) and the measured results live in
the validation report.

## Changes by area

### Navigation and layout (Tasks 286)

- **`components/layout/Sidebar.tsx`** — the mobile drawer is now a **fixed overlay** below `md`
  (`max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:max-w-[85vw] max-md:translate-x-0`),
  removed from the flex row, so opening it no longer crushes the content column (F-1). The in-flow
  sidebar is `md:relative` and only carries its width there. The drawer carries
  `role="dialog" aria-modal="true" aria-label="Navigation"` on mobile only (F-2). A `useEffect`
  moves focus in on open, traps Tab/Shift+Tab, and closes on Escape; cleanup removes the
  `keydown` listener, restores focus to the opener, and (when the drawer was the one open) clears
  the `html.cc-drawer-open` scroll-lock class (F-2). The sidebar header gains a dedicated close
  button visible only on mobile (`md:hidden`). The theme toggle is a 40px-tall `role="switch"`
  `aria-checked` row (F-5). The account control in the footer is now a real disclosure
  (`aria-haspopup="true"`, `aria-expanded`, `aria-controls`) with Escape and outside-click
  dismissal (F-4).
- **`components/layout/Topbar.tsx`** — the hamburger exposes `aria-expanded` and
  `aria-controls="sidebar-drawer"` and its `aria-label` reflects open/closed state (F-3).
- **`components/layout/DashboardLayout.tsx`** — the layout root is `app-h` (100vh, 100dvh) instead
  of `h-screen` (F-8); `main` is `cc-scroll` so the drawer can lock background scroll (F-2).
- **`index.css`** — `.app-h` (with a `@supports` 100dvh upgrade), `.cc-scroll` +
  `html.cc-drawer-open` background scroll lock, a global `:focus-visible` ring (F-6), and a global
  `prefers-reduced-motion` rule (F-7).
- **`App.tsx`** — the tree is wrapped in framer-motion `<MotionConfig reducedMotion="user">`, so
  all motion honours the OS setting; the decorative sidebar animations are additionally gated by
  `useReducedMotion()` (F-7).

### Runtime states: loading / error / partial / stale (Tasks 288)

- **`lib/commandCenterError.ts`** (new) — a single pure classifier mapping any thrown value to a
  closed set of 11 kinds: `network | timeout | bad_request | unauthorized | forbidden | not_found
  | conflict | rate_limited | server_error | service_unavailable | invalid_contract`. It is the one
  source of truth used by the hook and both Task 218 panels. A thrown value that is not an
  `ApiError`/`Error` (e.g. a rejected `string`) is **not** mislabelled `server_error` — it is
  classified `invalid_contract` when a message is present, else `network`. `retryAfterSeconds`
  is hardened (F-17): a pure integer is strictly a delta-seconds (negative → `null`), otherwise the
  value is attempted as an HTTP-date.
- **`lib/api.ts`** — `ApiError` now carries `retryAfter` (seconds), parsed from the
  `Retry-After` header (delta-seconds or an HTTP-date, else `null`); the header is read on both
  the JSON and the network-throw paths. This feeds the classifier's `rate_limited` countdown (F-14).
- **`hooks/useCommandCenter.ts`** — `error: boolean` becomes a `CommandCenterFailure`
  (`{ kind, message, retryAfterSeconds, timestamp, previousTimestamp? }`); a 30s hard timeout is
  added via `createTimedAbortController` (F-10); the classifier is applied to the thrown value so
  a timeout, 404, 500, 401 and a malformed payload are distinct. Background-refresh failure
  **retains the last successful snapshot** (sets `data: previousData`, never nulls it) and records
  the prior timestamp (F-9/F-13). The request always takes the `AbortSignal`.
- **`pages/Overview.tsx`** — the banner is now a closed `BriefingFailureBanner`: retry is offered
  only for transient kinds; `not_found` offers "check workspace" guidance; `unauthorized` renders
  the signed-out message; `rate_limited` shows a live countdown ("Retry available in N seconds",
  disabled until it elapses, no auto-retry loop). A polite `aria-live` region announces background
  refresh success/failure once (F-12). The snapshot chip shows a "refreshing" indicator and the
  header surfaces the real last-successful-refresh timestamp (F-13). The retry button and the
  429 countdown are unit-drivable (fake timers).
- **`components/dashboard/CommandCenterSections.tsx`** — the Business situation metric grid uses a
  `gap-px` background grid instead of per-cell `border-r`/`border-b` (F-15), removing stray border
  lines at tablet widths.

### Task 218 panels: retry and cancellation (Task 288, partial isolation)

- **`components/dashboard/BusinessHealthPanel.tsx`** — failure state now offers a
  resource-scoped **retry** button (re-runs the fetch, re-validates, never clobbers sibling
  sections) and passes its `AbortSignal` to `api.get`; on unmount or store change the in-flight
  request is aborted and the generation guard discards late responses (F-11).
- **`components/dashboard/OperationalActivityPanel.tsx`** — the same per-panel retry +
  `AbortSignal`. Additionally fixed **F-18**: the effect cleanup now clears an `activeRef` and
  aborts its controller (previously it only bumped the generation counter, so the passed
  `AbortSignal` was never triggered — the "first line of defense" the code claimed did not exist).
  Both panels remain independent requests; a failure in one never blanks the other or the briefing.

### Typing (F-19)

- **`src/test/jest-dom.d.ts`** (new, types-only) — references `@testing-library/jest-dom/vitest`
  so test files importing `expect` from "vitest" see the matchers. No runtime effect; the project
  `tsc` error count drops 749 → 29 (the 29 remaining are pre-existing and in files this task did
  not touch).

## Files changed

- New: `lib/commandCenterError.ts`, `lib/commandCenterError.test.ts`, `hooks/useCommandCenter.test.ts`,
  `src/test/jest-dom.d.ts`, `pages/Overview.runtime.test.tsx`, `pages/Overview.viewport.test.tsx`,
  `components/command-center/testFixtures.ts`, `components/layout/Sidebar.mobile.test.tsx`,
  `components/dashboard/BusinessHealthPanel.retry.test.tsx`,
  `components/dashboard/OperationalActivityPanel.retry.test.tsx`.
- Modified: `lib/api.ts`, `hooks/useCommandCenter.ts`, `pages/Overview.tsx`,
  `components/dashboard/CommandCenterSections.tsx`,
  `components/dashboard/BusinessHealthPanel.tsx`,
  `components/dashboard/OperationalActivityPanel.tsx`, `components/layout/Sidebar.tsx`,
  `components/layout/Topbar.tsx`, `components/layout/DashboardLayout.tsx`, `App.tsx`, `index.css`,
  `tsconfig.app.json` (target ES2020 → ES2022, needed by the new code; 0 new type errors, 7
  pre-existing fixed).

## Decisions

Recorded as **REV-DEC-0027** in `implementation-decisions.md`.

## Verification

See the validation report: 110 new frontend tests (7 files), full suite 737/737, `tsc` project
error count 29 (all pre-existing, none in touched files), production build green, and the 9-width
device matrix. Local results do not certify production; the production acceptance checklist (deployed
revisions + authenticated active-store/browser checks at each width) is recorded in the validation
report and remains separate.
