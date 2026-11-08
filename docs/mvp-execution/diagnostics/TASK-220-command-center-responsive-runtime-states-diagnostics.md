# Task 220 — Command Center responsive and runtime states: audit and diagnostics

Original task mapping: **Tasks 286–290** (user-assigned Task 220). Audit date: 2026-11-08. Baseline:
main `d9150d6` (includes Task 216 Command Center, Task 217 priority finding, Task 218 business
health + operational history, and the Task 219 duplicate-removal pass as delivered on main).

## 0. Environment and method (recorded limitations)

- Repository and branch audited directly (Tasks 216–219 verified in code, not assumed: the
  `command-center-v1` page, `useCommandCenter` hook, `CommandCenterSections.tsx`, priority-finding
  section, and both Task 218 store-scoped panels are present and test-covered on main).
- **Live deployed application could not be inspected from this sandbox** — outbound egress is
  restricted to GitHub/NPM/PyPI hosts, so `https://revluma.vercel.app` and the test store
  `revluma-test-store-v1.myshopify.com` are unreachable. Deployed-revision verification is
  therefore listed under production acceptance (§15 of the task), not claimed here.
- **No real browser is available in the sandbox**: no Chromium/Firefox binary or system libraries
  (libnss3/libgbm/… absent, `apt` unreachable), and Playwright's browser download is blocked by the
  same egress policy (verified: `@playwright/browser-chromium` install fails at the
  "Chrome for Testing" download step). The device matrix is therefore executed on the **existing
  frontend test infrastructure** (Vitest + jsdom + Testing Library), which the task explicitly
  permits. What jsdom can and cannot verify is documented per scenario (Section 5): JS-driven
  responsive behavior and ARIA/keyboard/focus behavior are fully verified; pixel-level overflow at
  each width is verified by CSS-contract assertions (fixed-width audit, `min-w-0` guards,
  overflow-clip) plus a production-acceptance checklist — never claimed as a rendered-browser
  measurement.
- Backend contracts re-read from source: `command-center-v1` (200/`{success,data}`; errors via the
  global handler), store-scoped `business-health` / `business-activity` (404 `{success:false,
  error:'Store not found.'}`, 500 contract-validation), and the production error handler (no stack
  traces in production; stable 401/404/409/500 messages).

## 1. What the Command Center looks like before the change (verified in code)

Page: `src/pages/Overview.tsx` → `useCommandCenter()` (briefing) + `BusinessHealthPanel` +
`OperationalActivityPanel` (Task 218 store-scoped fetches) + the five Task 216/217 sections
(`CommandCenterHeader`, `OperationalBriefing`, `BusinessOverview`, `PriorityFindings`,
`OperationalActivity`, `EvidenceFreshness`).

Already sound (kept, not reworked):

- Fail-closed contract guards on every section (briefing shape check in the hook;
  `isValidBusinessHealth` / `isValidOperationalActivity` in the panels).
- Tenant isolation: hook clears data on workspace change and scopes rendered data to the current
  `organization_id`.
- Abort/cancel + mounted-guard on the briefing request; generation guard on the activity feed.
- Honest states: stale snapshot note, "no sufficiently supported priority", "no verified activity
  recorded", per-resource availability, `—` for unavailable values (absent ≠ zero).
- `main` uses `overflow-x-clip`, sections use `min-w-0`, values use `break-words`/`truncate`.
- Mobile hamburger exists in the Topbar; the sidebar has a collapsed mode on desktop.

## 2. Defects and gaps found (numbered; each maps to a fix in the implementation report)

### Navigation and layout

- **F-1 (high) — Mobile drawer crushes the workspace.** Below `md` (768px) the sidebar is a flex
  child of the layout row. Opening it sets `w-[252px]` *in flow*, so at 320–430px the content
  column is squeezed to a sliver (at 375px ≈ 123px). The fixed backdrop covers the content, but
  the layout itself is squashed. The drawer must overlay, not participate in the flex row, below
  `md`.
- **F-2 (high) — Drawer has no accessible-dialog behavior.** No `role`/`aria-modal`/`aria-label`
  on the mobile aside, no Escape-key dismissal, no focus move on open, no focus return on close,
  and the background stays scrollable while the drawer is open.
- **F-3 (medium) — Hamburger lacks state semantics.** The Topbar menu button has `aria-label`
  but no `aria-expanded` / `aria-controls`.
- **F-4 (medium) — User menu (sidebar footer) is not a proper menu.** No `aria-haspopup` /
  `aria-expanded`, no Escape dismissal, no outside-click dismissal; it can stay open over other
  content.
- **F-5 (medium) — Touch targets below the usable minimum.** Sidebar theme toggle hit area is
  22×42px; several "Details"/"View" text buttons in the Task 218 panels are ~22–26px tall.
- **F-6 (medium) — No global `:focus-visible` style.** `grep` of `index.css` finds no
  `focus-visible` rule; keyboard users get browser-default outlines that disappear against the
  glass surfaces in places. Component-level `focus-visible:outline-2` exists only on the two
  `details/summary` disclosures.
- **F-7 (medium) — No `prefers-reduced-motion` support.** `index.css` has no reduced-motion rule;
  the sidebar's ambient orbs, active-icon wiggle and layout entrance animations run regardless.
  Only a handful of `animate-pulse` skeletons carry `motion-reduce:animate-none`.
- **F-8 (low) — Layout root uses `h-screen`.** On mobile browsers with dynamic toolbars this
  overshoots the visual viewport; `100dvh` (with fallback) is the robust value.

### Runtime states (loading / error / partial / stale)

- **F-9 (high) — Briefing error is a boolean.** `useCommandCenter` exposes `error: boolean`, so
  the page shows the same banner for a network drop, a 500, a 404, a timeout and a malformed
  payload, and always offers "Try again" — even where retry is the wrong action (404, rate limit,
  session loss). Failure classification is missing end to end.
- **F-10 (high) — No request timeout.** `api.get` has no timeout for the Command Center request;
  a stalled connection leaves the loading skeleton (or "Refreshing…") indefinitely.
- **F-11 (high) — No recovery path in the Task 218 panels' failure states.** Both panels render
  an honest "unavailable" box on failure but **no retry control** and no request cancellation via
  `AbortSignal` (only an `active` flag / generation counter), so an unmounted or switched store
  keeps its in-flight request alive until it resolves.
- **F-12 (medium) — Background refresh completion/failure is silent to assistive tech.** No
  `aria-live` announcement for "refreshed at …" or "refresh failed, showing last successful
  snapshot from …"; the only live-region content is the initial loading state.
- **F-13 (medium) — Stale-during-refresh is not visible on the content.** The header shows
  "Snapshot Xm ago" and the button switches to "Refreshing…", but the snapshot age chip itself
  gives no "refreshing" indication next to the age, and nothing says the displayed data is the
  last *successful* snapshot while a refresh is in flight or has failed.
- **F-14 (low) — 429 guidance ignored.** `api.ts` does not surface `Retry-After`; with a
  rate-limited response the UI would invite an immediate retry.

### Responsive specifics (verified against the Tailwind classes)

- **F-15 (medium) — Business situation grid borders are wrong between `sm` and `xl`.** The metric
  cells carry `sm:border-r` (every cell, including the right edge of a 2-column row) and
  `border-b … last:border-b-0` (only the final item, not the final row of a 2-col grid) — stray
  border lines inside the card at tablet widths.
- **F-16 (low) — No width contract for the mobile drawer.** The open drawer is a fixed 252px with
  no `max-width` cap relative to the viewport; on a 320px screen it covers ~79% of the width.

## 3. Non-goals (verified boundaries)

- No backend changes: all four contracts (`command-center-v1`, `rev-business-health-v1`,
  `rev-operational-activity-v1`, auth/sync endpoints) are unchanged; no new endpoints, no new
  sync-execution mechanism — the frontend invokes only operations that already exist.
- No redesign of unrelated workspaces (RevIntell, Integrations, settings). The Topbar/sidebar
  changes are limited to the Command Center navigation shell and are shared by design with the
  rest of the dashboard.
- No fabricated progress: no percentages, no "estimated" states; the only new dynamic text is
  derived from real request outcomes and the real `retrieved_at` / `generated_at` fields.

## 4. Runtime-state model adopted (decisions)

- **One classification, one source.** A new pure module `lib/commandCenterError.ts` classifies
  any thrown value into a closed set: `network | timeout | bad_request | unauthorized |
  forbidden | not_found | conflict | rate_limited | server_error | service_unavailable |
  invalid_contract`. The `useCommandCenter` hook and both Task 218 panels use it; messages are
  closed merchant-facing strings (no backend text passthrough beyond the existing
  `ApiError.message`, which the production handler already sanitizes).
- **Retry eligibility is a function of the classification**: transient kinds
  (`network | timeout | server_error | service_unavailable | conflict`) offer a retry button;
  `not_found` does not (offers "check workspace" guidance instead); `rate_limited` offers a retry
  only after the `Retry-After` interval (button disabled until then, no auto-retry loop);
  `unauthorized` renders the signed-out message (the global 401 handler normally redirects).
- **Stale is a state, not an accident.** When a background refresh fails, the last successful
  snapshot stays visible with an explicit "last successful refresh at …" note (existing banner,
  upgraded with the real timestamp and classification); when a refresh is in flight, the snapshot
  chip shows "Refreshing…". A stale snapshot is never labelled current.
- **Partial isolation is the default.** The briefing and the two store-scoped panels remain
  independent requests with independent state; a briefing failure never blanks the panels and a
  panel failure never blanks the briefing (already true; now completed by per-panel retry and
  cancellation).
- **CancellationToken everywhere.** All three Command Center requests take an `AbortSignal`
  (the briefing already did; the two panels gain it), so navigation, store switch and new fetches
  cancel obsolete requests and their late responses are discarded (existing generation guard
  stays as the second line of defense).
- **Accessibility contracts.** Drawer: `role="dialog" aria-modal="true"` (mobile only), Escape
  closes, focus moves in on open and returns to the opener on close, background scroll locked,
  `aria-expanded`/`aria-controls` on the hamburger. Refresh outcome announced once through a
  polite live region (not on every interval tick). Global `:focus-visible` ring; global
  `prefers-reduced-motion` rule plus gating of the decorative sidebar animations via
  framer-motion's `useReducedMotion`.

## 5. Test strategy (what is verified where)

- **Pure classification** — unit tests for every status code and malformed-payload path
  (`commandCenterError.test.ts`).
- **Request lifecycle** — hook-level tests (initial load; each failure kind; background refresh
  success/failure with data retention; timeout; workspace switch clearing + abort; out-of-order
  responses; unmount cleanup; duplicate-fetch cancellation) with a controllable fake clock
  (`useCommandCenter.test.ts`).
- **Page runtime states** — page-level tests for every banner kind, retry eligibility, live
  region, stale chip, deep-link/refresh, navigation into Rev Intelligence
  (`Overview.runtime.test.tsx`).
- **Device matrix** — the required 9 widths (320/375/430/600/768/1024/1280/1440/1920) with a
  viewport-aware `matchMedia` + `window.innerWidth/innerHeight` helper, asserting the
  JS-driven responsive behavior (drawer availability, hamburger state, off-canvas classes,
  grid contracts) at each width (`Overview.viewport.test.tsx`). Pixel-overflow at each width is
  additionally bounded by a **fixed-width CSS audit** (no Command Center element declares a fixed
  width wider than the 320px floor; `min-w-0` + `overflow-x-clip` guards asserted) and by the
  production-acceptance checklist — documented as such, not as browser measurement.
- **Drawer accessibility** — keyboard/Escape/focus/scroll-lock behavior
  (`Sidebar.mobile.test.tsx`).
- **Panel retry and cancellation** — per-panel tests (`BusinessHealthPanel.retry.test.tsx`,
  `OperationalActivityPanel.retry.test.tsx`).
- The scenario-to-test mapping with ≥100 rows lives in the validation report.

## 6. Performance and observability plan (measured, not invented)

- Request-count behavior is asserted in tests (initial mount = 1 briefing + 2 store-scoped + 1
  notification count; navigation away cancels; retry re-requests exactly one resource).
- Production build output (chunk sizes, build time) and full-suite duration are recorded as the
  actual observed numbers in the validation report; no Lighthouse/Core-Web-Vitals numbers are
  claimed (no browser, no production access).
- Diagnostics remain privacy-safe: no token, customer PII or payload content is logged or rendered
  by the new code (error messages come from the closed classification strings; the backend
  handler already strips stack traces in production).

## 7. Resolution status (implementation cross-reference, 2026-11-08)

Each finding was resolved in the implementation (see the implementation and validation
reports for the file-level diff and the scenario-to-test mapping). All 16 audit findings are
closed; three further defects were discovered **during** implementation and are recorded here
because they were not visible in the pre-change audit.

| ID | Resolution | Verified by |
| --- | --- | --- |
| F-1 | Drawer is now a fixed overlay (`max-md:fixed … max-w-[85vw]`) below `md`, out of the flex row; the in-flow sidebar is `md:relative` and only ever renders its width there. | SC-NAV-10/12; SC-VIEW content matrix |
| F-2 | Drawer is `role="dialog" aria-modal="true" aria-label="Navigation"` (mobile only); Escape closes; focus moves in on open and returns to the opener on close; background scroll locked via `html.cc-drawer-open`; Tab/Shift+Tab trap. | SC-NAV-01/03/04/05/06/07 |
| F-3 | Hamburger exposes `aria-expanded`, `aria-controls="sidebar-drawer"` and a state-toggling label. | SC-NAV-02 |
| F-4 | Account control is `role="menu"`-bearing with `aria-haspopup`/`aria-expanded`/`aria-controls`; Escape and outside-click dismissal. | SC-NAV-13/14 |
| F-5 | Theme toggle hit area is a 40px row (`role="switch"`); Task 218 "Details"/"View"/retry controls are `min-h-10`/`min-h-9`. | SC-NAV-15; panel retry tests |
| F-6 | Global `:focus-visible` ring added to `index.css`. | CSS audit (production checklist) |
| F-7 | Global `prefers-reduced-motion` rule + `MotionConfig reducedMotion="user"` wraps the tree; decorative sidebar animations gated by `useReducedMotion`. | CSS audit (production checklist) |
| F-8 | Layout root uses `.app-h` (100vh, 100dvh via `@supports`); `main.cc-scroll` for the drawer's scroll lock. | CSS audit (production checklist) |
| F-9 | `lib/commandCenterError.ts` closed classifier (11 kinds) used by the hook and both panels; closed merchant-facing messages; retry only where appropriate. | SC-ERR-01..22; SC-RUN-02..05/12/13; panel SC-*-02/04/08/09/10 |
| F-10 | 30s hard timeout via `createTimedAbortController`; a timeout is classified as `timeout`, never an indefinite skeleton. | SC-ERR-21/22; SC-HOOK-05; SC-BHP-05; SC-OAP-06 |
| F-11 | Per-panel resource-scoped retry + `AbortSignal` cancellation on unmount/store change (briefing already had it). | SC-BHP-03/06/07; SC-OAP-03/07/08 |
| F-12 | Background refresh outcomes announced once via a polite `aria-live` region. | SC-HOOK-07/20; SC-RUN-08 |
| F-13 | Snapshot chip carries a live "refreshing" indicator and the header surfaces the real last-successful-refresh timestamp (never stale-as-current). | SC-RUN-10/14 |
| F-14 | `Retry-After` surfaced end-to-end (`api.ts` header → `ApiError.retryAfter` → classifier) and drives a 429 countdown (no immediate retry). | SC-ERR-09/10/17; SC-HOOK-16; SC-RUN-06 |
| F-15 | Business situation grid uses a `gap-px` background grid (no per-cell `border-r`/`border-b` stragglers). | CSS audit (production checklist) |
| F-16 | Open drawer width capped `max-w-[85vw]` against the viewport. | CSS audit (production checklist) |

**Defects discovered during implementation (not in the pre-change audit):**

- **F-17 (medium, fixed) — `retryAfterSeconds` turned invalid values into "retry now".** A pure
  negative integer such as `-5` is a valid *date* to `Date.parse` (year ~−5 AD), so an invalid
  `Retry-After: -5` fell through to date parsing and returned `0` (retry immediately), which would
  seed an immediate retry loop. Fixed: any pure integer is treated strictly as a delta-seconds and
  a negative one is rejected (`null`); only a non-integer string is attempted as an HTTP-date.
  Verified: SC-ERR-20.
- **F-18 (medium, fixed) — Operational History never aborted its in-flight request.** The panel's
  effect cleanup only bumped the generation counter; the `AbortSignal` it passed to `api.get` was
  never triggered, so the "first line of defense" the code comment claims was ineffective (an
  unmounted/switched store kept fetching to completion). Fixed with an `activeRef` that the cleanup
  clears and aborts, matching `BusinessHealthPanel`; the generation guard remains as the second line
  of defense. Verified: SC-OAP-08.
- **F-19 (low, fixed) — jest-dom matchers untyped for vitest.** `setup.ts` loads the matchers at
  runtime but the project typed *jest*'s `expect` (no `@types/jest`), so every test file using
  `expect(…).toBeInTheDocument()` carried an untyped-matcher type error (≈700 across ~30 files).
  A types-only `src/test/jest-dom.d.ts` referencing `@testing-library/jest-dom/vitest` augments
  `vitest`'s `Assertion`. Zero runtime effect; `tsc` project error count drops 749 → 29 (all 29
  pre-existing and in files this task did not touch).
