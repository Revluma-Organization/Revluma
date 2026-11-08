# Task 220 validation

## Baseline and environment

Final tree rebased onto main `d9150d6` (which already contains Task 216 Command Center
`58defb6`, Task 217 priority finding `4ac2a33`, Task 218 business health + operational history
`9e2cca4`, and the Task 219 duplicate-removal pass). Frontend-only change.

**Environment limits (recorded, not a defect):** the sandbox has no egress to the live store,
the Render/Python service, or `revluma.vercel.app`, and **no real browser** (no Chromium/Firefox
binary or system libraries; Playwright's browser download is blocked by the egress policy). The
device matrix and runtime-state behavior are therefore executed on the existing Vitest + jsdom +
Testing Library infrastructure, which the task permits. What jsdom can and cannot verify is stated
per section below; pixel-overflow claims rest on a CSS-contract audit + the production checklist,
never a rendered-browser measurement. No production row, deployment identity, or authenticated read
is claimed here.

## Automated evidence (2026-11-08, final tree)

```
Frontend/Dashboard
  npx vitest run                                   # Test Files 50 passed (50) · Tests 737 passed (737)
                                                   #   = 627 baseline (43 files) + 110 new Task 220 tests (7 files)
  ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json
                                                   # project error count 29, all pre-existing, none in files touched here
  npx vite build                                   # ✓ built (pre-existing chunk-size warning only)
```

New test files (110 tests, all pass):

| File | Tests | Scope |
| --- | --- | --- |
| `lib/commandCenterError.test.ts` | 22 | closed failure classifier + `Retry-After` parsing + timed abort |
| `hooks/useCommandCenter.test.ts` | 20 | briefing request lifecycle (initial/refresh/timeout/supersede/unmount/tenant) |
| `pages/Overview.runtime.test.tsx` | 14 | page-level banner kinds, retry eligibility, live region, stale chip, 429 countdown |
| `components/layout/Sidebar.mobile.test.tsx` | 16 | mobile drawer: accessible dialog, focus, Escape, scroll lock, breakpoint |
| `components/dashboard/BusinessHealthPanel.retry.test.tsx` | 10 | per-panel failure kinds, retry, timeout, cancel on unmount/store-change |
| `components/dashboard/OperationalActivityPanel.retry.test.tsx` | 10 | per-panel failure kinds, retry, timeout, empty, cancel on unmount/store-change |
| `pages/Overview.viewport.test.tsx` | 18 | 9-width device matrix (2 scenarios × 9 widths) |

No regression: the 627-test baseline (Tasks 216–219 Command Center and the rest of the dashboard)
passes unchanged; the only shared assertions affected are the existing `Overview.test.tsx` page-level
API mock, which now also answers the two store-scoped routes it already did.

## Scenario-to-test mapping (110 scenarios, the required ≥100)

### SC-ERR — closed failure classifier (`commandCenterError.test.ts`, 22)

| ID | Scenario | Verified by |
| --- | --- | --- |
| SC-ERR-01 | Network-level failure (status 0) → `network` | SC-ERR-01 test |
| SC-ERR-02 | Plain `Error` with no status → `network` (transport) | SC-ERR-02 |
| SC-ERR-03 | `TypeError` from malformed JSON → `network` | SC-ERR-03 |
| SC-ERR-04 | 400 → `bad_request`, carries sanitized backend message | SC-ERR-04 |
| SC-ERR-05 | 401 → `unauthorized`, never leaks a backend message | SC-ERR-05 |
| SC-ERR-06 | 403 → `forbidden` (permission) | SC-ERR-06 |
| SC-ERR-07 | 404 → `not_found` | SC-ERR-07 |
| SC-ERR-08 | 409 → `conflict` | SC-ERR-08 |
| SC-ERR-09 | 429 → `rate_limited` with embedded `Retry-After` parsed | SC-ERR-09 |
| SC-ERR-10 | 429 with an HTTP-date `Retry-After` parses the delta | SC-ERR-10 |
| SC-ERR-11 | 500 → `server_error` | SC-ERR-11 |
| SC-ERR-12 | 502/503/504 → `service_unavailable` | SC-ERR-12 |
| SC-ERR-13 | 503 with `Retry-After` carries the guidance | SC-ERR-13 |
| SC-ERR-14 | Unusual 418 still classifies (no crash) | SC-ERR-14 |
| SC-ERR-15 | Explicit `AbortError` → `network` (a leaked abort is not success) | SC-ERR-15 |
| SC-ERR-16 | The timeout sentinel → `timeout` | SC-ERR-16 |
| SC-ERR-17 | Headers shim used when the error carries no embedded `Retry-After` | SC-ERR-17 |
| SC-ERR-18 | Every closed kind has a non-empty merchant-facing message | SC-ERR-18 |
| SC-ERR-19 | Retry eligibility is closed and matches the classification | SC-ERR-19 |
| SC-ERR-20 | `retryAfterSeconds` parses a valid delta; a negative integer → `null` (never "retry now") | SC-ERR-20 |
| SC-ERR-21 | Timed abort fires after the configured timeout and reports `timedOut()` | SC-ERR-21 |
| SC-ERR-22 | `clear()` releases the timer on manual abort (no leak) | SC-ERR-22 |

### SC-HOOK — briefing request lifecycle (`useCommandCenter.test.ts`, 20)

| ID | Scenario | Verified by |
| --- | --- | --- |
| SC-HOOK-01 | Initial load success clears loading and records `lastSuccessfulAt` | SC-HOOK-01 |
| SC-HOOK-02 | Initial 500 → `server_error` with no data | SC-HOOK-02 |
| SC-HOOK-03 | Initial 404 → `not_found` | SC-HOOK-03 |
| SC-HOOK-04 | Transport-level rejection → `network` | SC-HOOK-04 |
| SC-HOOK-05 | A stalled request times out and ends the loading lifecycle | SC-HOOK-05 |
| SC-HOOK-06 | Background refresh failure keeps the last successful snapshot | SC-HOOK-06 |
| SC-HOOK-07 | Background refresh success updates data and announces the outcome | SC-HOOK-07 |
| SC-HOOK-08 | A superseded request is aborted and its response ignored | SC-HOOK-08 |
| SC-HOOK-09 | Out-of-order responses cannot overwrite newer data | SC-HOOK-09 |
| SC-HOOK-10 | Unmount cancels the in-flight request (no late state writes) | SC-HOOK-10 |
| SC-HOOK-11 | Workspace switch clears the previous tenant's data and refetches | SC-HOOK-11 |
| SC-HOOK-12 | A malformed contract → `invalid_contract` | SC-HOOK-12 |
| SC-HOOK-13 | A response for another organization is never rendered (tenant scoping) | SC-HOOK-13 |
| SC-HOOK-14 | The 60s interval triggers a background refresh | SC-HOOK-14 |
| SC-HOOK-15 | Window focus triggers a background refresh | SC-HOOK-15 |
| SC-HOOK-16 | 429 carries the server's `Retry-After` guidance through the hook | SC-HOOK-16 |
| SC-HOOK-17 | A foreground retry re-fetches and replaces the failure | SC-HOOK-17 |
| SC-HOOK-18 | Rapid duplicate refetches abort the previous request (one live at a time) | SC-HOOK-18 |
| SC-HOOK-19 | A failed background refresh leaves no indicator stuck | SC-HOOK-19 |
| SC-HOOK-20 | The announcement is cleared on workspace switch | SC-HOOK-20 |

### SC-RUN — page runtime states (`Overview.runtime.test.tsx`, 14)

| ID | Scenario | Verified by |
| --- | --- | --- |
| SC-RUN-01 | Initial load shows a skeleton; never flashes the empty or failure state | SC-RUN-01 |
| SC-RUN-02 | Initial network failure → closed message + foreground retry | SC-RUN-02 |
| SC-RUN-03 | Initial 404 → workspace guidance, no retry | SC-RUN-03 |
| SC-RUN-04 | Initial 401 → session copy, never offers a retry | SC-RUN-04 |
| SC-RUN-05 | Initial 403 distinguishes permission from session, no retry | SC-RUN-05 |
| SC-RUN-06 | 429 shows a real countdown from the backend; retry enables only at zero | SC-RUN-06 |
| SC-RUN-07 | A background failure keeps verified siblings visible (isolated) | SC-RUN-07 |
| SC-RUN-08 | A background refresh outcome is announced once in a polite live region | SC-RUN-08 |
| SC-RUN-09 | No data → the honest "no operational briefing" empty state | SC-RUN-09 |
| SC-RUN-10 | A refresh in flight labels the snapshot (not stale-as-current) | SC-RUN-10 |
| SC-RUN-11 | A failed briefing offers a background retry when data already exists | SC-RUN-11 |
| SC-RUN-12 | A timeout is described as a cancelled request and is retryable | SC-RUN-12 |
| SC-RUN-13 | An unusable contract is shown as an honest failure with no retry | SC-RUN-13 |
| SC-RUN-14 | The snapshot chip surfaces the last successful refresh time | SC-RUN-14 |

### SC-NAV — mobile navigation drawer (`Sidebar.mobile.test.tsx`, 16)

| ID | Scenario | Verified by |
| --- | --- | --- |
| SC-NAV-01 | The hamburger opens the drawer as an accessible dialog | SC-NAV-01 |
| SC-NAV-02 | The hamburger exposes and reflects the drawer state (`aria-expanded`/`aria-controls`) | SC-NAV-02 |
| SC-NAV-03 | Opening the drawer moves focus into it | SC-NAV-03 |
| SC-NAV-04 | Opening locks background scroll; closing restores it | SC-NAV-04 |
| SC-NAV-05 | Escape closes the drawer and returns focus to the opener | SC-NAV-05 |
| SC-NAV-06 | Tab wraps from the last focusable back to the first (trap) | SC-NAV-06 |
| SC-NAV-07 | Shift+Tab wraps from the first focusable to the last (trap) | SC-NAV-07 |
| SC-NAV-08 | Clicking the backdrop (outside the drawer) closes it | SC-NAV-08 |
| SC-NAV-09 | Choosing a navigation destination closes the drawer | SC-NAV-09 |
| SC-NAV-10 | Growing past the mobile breakpoint closes the drawer and removes dialog semantics | SC-NAV-10 |
| SC-NAV-11 | At a mobile width the sidebar cannot remain collapsed | SC-NAV-11 |
| SC-NAV-12 | On desktop the sidebar is not a dialog while the drawer is closed | SC-NAV-12 |
| SC-NAV-13 | The account control exposes menu semantics | SC-NAV-13 |
| SC-NAV-14 | The account menu opens as a menu and dismisses on Escape and outside click | SC-NAV-14 |
| SC-NAV-15 | The theme control is a switch whose state mirrors the theme | SC-NAV-15 |
| SC-NAV-16 | The drawer exposes a labelled close affordance | SC-NAV-16 |

### SC-BHP — Business Health panel (`BusinessHealthPanel.retry.test.tsx`, 10)

| ID | Scenario | Verified by |
| --- | --- | --- |
| SC-BHP-01 | A valid contract renders its indicators (no failure) | SC-BHP-01 |
| SC-BHP-02 | A 500 shows the closed section failure with a resource-scoped retry | SC-BHP-02 |
| SC-BHP-03 | Retry re-requests only this section and recovers on success | SC-BHP-03 |
| SC-BHP-04 | A malformed contract fails closed (`invalid_contract`) | SC-BHP-04 |
| SC-BHP-05 | A stalled request times out and is described honestly (retryable) | SC-BHP-05 |
| SC-BHP-06 | Unmount cancels the in-flight request (no late write) | SC-BHP-06 |
| SC-BHP-07 | A store change aborts the previous store's in-flight request | SC-BHP-07 |
| SC-BHP-08 | A 404 is described as store-specific not-found | SC-BHP-08 |
| SC-BHP-09 | A transport-level failure is described as a connection problem | SC-BHP-09 |
| SC-BHP-10 | A 429 is described as rate limiting (no immediate retry loop) | SC-BHP-10 |

### SC-OAP — Operational History panel (`OperationalActivityPanel.retry.test.tsx`, 10)

| ID | Scenario | Verified by |
| --- | --- | --- |
| SC-OAP-01 | A valid contract renders the recorded events and the running total | SC-OAP-01 |
| SC-OAP-02 | A 500 shows the closed section failure with a resource-scoped retry | SC-OAP-02 |
| SC-OAP-03 | Retry re-requests only this section and recovers on success | SC-OAP-03 |
| SC-OAP-04 | A malformed contract fails closed (`invalid_contract`) | SC-OAP-04 |
| SC-OAP-05 | A genuine empty history is shown as "nothing happened" (not a failure) | SC-OAP-05 |
| SC-OAP-06 | A stalled request times out and is described honestly (retryable) | SC-OAP-06 |
| SC-OAP-07 | Unmount cancels the in-flight request (no late write) | SC-OAP-07 |
| SC-OAP-08 | A store change aborts the previous store's in-flight request | SC-OAP-08 |
| SC-OAP-09 | A 404 is described as store-specific not-found | SC-OAP-09 |
| SC-OAP-10 | A transport-level failure is described as a connection problem | SC-OAP-10 |

### SC-VIEW — 9-width device matrix (`Overview.viewport.test.tsx`, 18 = 2 × 9)

Widths: 320, 375, 430, 600, 768, 1024, 1280, 1440, 1920 (a 2.4×1.33 aspect). At each width two
scenarios run:

| ID | Scenario | Verified by |
| --- | --- | --- |
| SC-VIEW-01 ×9 | Content is preserved at the width (the full Command Center set of landmarks renders; no Command Center element declares a fixed width above the 320px floor) | `it.each(WIDTHS)` content-preservation |
| SC-VIEW-02 ×9 | The JS-driven 768px breakpoint is correct at the width (below 768 the drawer/hamburger mobile mode is active; at/above 768 it is not) | `it.each(WIDTHS)` breakpoint |

**jsdom limitation (recorded):** jsdom does not evaluate CSS media queries, so a `@media`/`md:`
Tailwind class cannot be *observed* as applied. SC-VIEW asserts (a) the JS-driven responsive state
that the drawer/hamburger actually key on, and (b) content preservation plus the fixed-width audit;
the pixel-level overflow at each width is bounded by the CSS-contract audit (the fixed-width scan in
`CommandCenterSections`, `min-w-0`/`overflow-x-clip` guards, the drawer's `max-w-[85vw]` cap) and the
production-acceptance browser checklist below — documented as such, not as a browser measurement.

## Performance and observability (measured, not invented)

- **Request-count behavior** (asserted in tests, not inferred): initial mount issues exactly the
  expected independent requests (briefing + the two store-scoped panels + the notification count);
  navigating away / unmounting cancels the in-flight request (SC-HOOK-10, SC-BHP-06, SC-OAP-07); a
  retry re-requests exactly one resource (SC-BHP-03, SC-OAP-03); rapid refetches keep one live
  request at a time (SC-HOOK-18).
- **Production build** (observed): `npx vite build` succeeds; bundle `index-*.js` ≈ 1.10 MB
  (gzip ≈ 318 kB), CSS ≈ 135 kB (gzip ≈ 22 kB); the only warning is the pre-existing chunk-size
  advisory. Build time ≈ 7s.
- **Full-suite duration** (observed): 737 tests across 50 files in ≈ 115s.
- **No Lighthouse / Core-Web-Vitals numbers are claimed** — there is no browser and no production
  access in this environment. The production checklist below is the honest substitute.
- **Diagnostics are privacy-safe:** the new code logs/renders no token, customer PII, or payload
  content; every failure message comes from the closed classification strings, and the production
  error handler already strips stack traces.

## Required acceptance after deployment (NOT inferred from local tests)

1. Deploy the merged revision (Render backend + Vercel dashboard) and record the exact deployed
   revision ids (backend + frontend).
2. Browser device checks at each of the 9 widths (320/375/430/600/768/1024/1280/1440/1920) on the
   deployed app: no horizontal overflow; the mobile hamburger appears below 768 and the sidebar is
   persistent above 768; opening the drawer overlays (not crushes) the content; the drawer is
   dismissible (Escape / backdrop / close button) and returns focus.
3. Runtime states: with the active store, verify each is reached honestly (never a blank page or a
   silent error) — initial load skeleton; a real failure shows the closed message with retry only
   where appropriate; a 429 shows a real countdown; a background refresh failure keeps the last
   successful snapshot with its timestamp; reduced-motion and keyboard (`:focus-visible`) paths
   work.
4. Cross-store: switching the header store re-fetches and cancels the previous store's request
   (devtools network tab) and the sections re-bind to the new store.
5. Record results here, update the audit register status, and move to RESOLVED — VERIFIED only then.

Until 1–5 complete, this task's status is **IMPLEMENTED LOCALLY — NOT PRODUCTION VERIFIED**.

## CI result

PR #375 (head `f78ac46`, frontend-only) — **all required checks passed**:

| Check | Result |
| --- | --- |
| dashboard (`npm ci` + full `vitest run` suite + production `vite build`) | pass (1m46s) |
| Vercel | pass |
| Vercel Preview Comments | pass |

The `dashboard` check is authoritative for this frontend-only change (a clean install
reproduces the local 737/737 result and a clean production build); the backend / Prisma /
security jobs are not in scope for a change that touches no backend file. Vercel reports the
deployment for the merge; exact deployed revision ids and the authenticated active-store/browser
checks above remain the open production-acceptance step.

Status: **IMPLEMENTED, CI VERIFIED, MERGED — AUTHENTICATED ACTIVE-STORE / BROWSER ACCEPTANCE PENDING.**
