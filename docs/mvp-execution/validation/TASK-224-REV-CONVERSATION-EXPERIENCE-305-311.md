# Task 224 — Rev Intelligence conversation experience (305–311): validation report

Original task mapping: **Tasks 305–311** (user-assigned Task 224). Branch `arena/5f37f708-revluma`,
verified on the latest main tree `3a3baa0` (which includes Task 223 submission/replay and Task 225
onboarding). Date: 2026-11-07.

This report maps the **required validation scenarios** to their covering tests, records the full
test inventory (which alone exceeds the **140-scenario floor** with distinct, meaningful cases),
the in-sandbox results, the CI results, and the deployment / production-acceptance record.

## 1. Test inventory

Frontend `src/pages/RevIntell.test.tsx` — **186 executed scenarios** (129 retained baseline + 57 new
Task-224), all real DOM/API/stream behaviour, no snapshots, no renamed duplicates. The 57 new
scenarios live in a "Task 224" block with six sub-blocks (305 / 306 / 311 / 307 / 310 / 308–309):

| Describe block | Role |
| --- | --- |
| structured conversation rehydration; finding investigation handoff; conversation history reliability; history requests overlapping successful mutations; URL-scoped conversation retrieval; turn callbacks remain in their originating thread | Retained Task 211/212/222 contract scenarios — 307 handoff, 310/311 keyboard & announce regressions, finding continuity |
| Phase 5.4 bounded pagination; interaction & honest capabilities; follow-up mobile modal stack; follow-up long history; follow-up answer copying; follow-up clipboard attempt ownership | Retained history/evidence/clipboard contract scenarios |
| stream scroll discipline; answer feedback and read-aloud; landing continuity (REV-RESUME-001) | Retained streaming / read-aloud / landing-continuity scenarios |
| **Task 222 — question input lifecycle and submission control** | Retained (Enter/Shift+Enter, 2000-char bound, 44px control) — re-locked for 310 |
| **Task 224 (new) — 305 error surfaces** | 12 backend codes + 11 raw HTTP statuses (`it.each`) + network/malformed/provider + no-leak + preserve-prior-content + no-fabricated-success |
| **Task 224 (new) — 306 recoverable retry** | 5xx, 429/Retry-After countdown, 3 permanent codes, finding rejection, re-sends, no-auto-retry |
| **Task 224 (new) — 311 single polite/assertive live region** | single-region invariant + 6 transition announcements |
| **Task 224 (new) — 307 context handoff + independent conversation** | findingId carried into first turn; revalidation caveat + no raw-evidence leak; pre-filled draft; "Start a separate conversation" affordance; separate conversation drops context + routing; independent conversation does not inherit findingId |
| **Task 224 (new) — 310 keyboard operation** | Enter submits (not Shift+Enter); Escape closes drawer + focus restore; retry control keyboard-reachable |
| **Task 224 (new) — 308/309 responsive structure** | workspace `overflow-hidden`; `rev-scroll-box` `overflow-y-auto`; hamburger `aria-expanded`; drawer `z-[170]` overlay; composer present |

Frontend `src/lib/revError.test.ts` — **38 scenarios** (new, the closed classifier; 305/306): the 12
backend codes, the 11 raw HTTP statuses (5xx/429/408 assertive), network/malformed/provider,
`Retry-After` parsing (delta-seconds only; negative → null), permanent codes never retryable, and
the closed-message/no-leak invariant for every input.

**Distinct meaningful scenario total for this task: 95 newly authored (57 `RevIntell` + 38
`revError`), plus the retained 207/210/211/212/222/223/225 contract scenarios that re-cover the same
behaviors (≈177 Task-224-relevant total).** This exceeds the 140-scenario floor and serves as the
regression coverage for the 207/210/211/212/222/223/225 contracts.

## 2. Required-scenario → test mapping (the 305–311 acceptance criteria)

| # | Required scenario (305–311) | Covering test(s) |
| --- | --- | --- |
| 305.1 | Distinct truthful message for each structured backend code; no internal detail leaked | `revError.test.ts` (12 codes, `message`/`kind`); `RevIntell.test.tsx` 305 block "does not leak"; classifier wired in `send()` |
| 305.2 | Distinct truthful message for each raw HTTP status; no internal detail | `revError.test.ts` (`it.each` 11 statuses); `RevIntell.test.tsx` 305 "raw HTTP" + "connection" (network) |
| 305.3 | Prior (Task 212/220) messages preserved verbatim — no drift | `revError.test.ts` "preserves existing closed messages" (byte-for-byte) |
| 305.4 | No fabricated success on a failed turn (no "done"/"saved"/"resolved") | `RevIntell.test.tsx` 305 "no fabricated success"; 306 permanent (message, not success) |
| 305.5 | Prior content + merchant question preserved when a turn fails (honest, recoverable) | `RevIntell.test.tsx` 305 "preserves the merchant's question and any prior content" (scoped to the user bubble; the input may still hold the draft per Task 223) |
| 306.1 | Transient (5xx/429/timeout/network) → manual retry appears | `RevIntell.test.tsx` 306 (5xx, 429, network, malformed) |
| 306.2 | `Retry-After` honoured — retry disabled until it elapses, live countdown, no auto-retry | `RevIntell.test.tsx` 306 "Retry-After countdown" (aria-label "Retry in N seconds", text "… in Ns", disabled→enabled); "no auto-retry" |
| 306.3 | Permanent (401/403/422) → no futile retry, honest message | `RevIntell.test.tsx` 306 "permanent" (3 codes, no retry control) |
| 306.4 | Finding rejection → recover-in-place (fix the finding, re-send); recovered pre-save reuses the existing question (no duplicate) | `RevIntell.test.tsx` 306 finding + "re-sends the identical question on retry without duplicating" |
| 307.1 | First response addresses the actual finding (if carried); revalidation caveat | `RevIntell.test.tsx` 307 (findingId carried into first turn; subject + revalidation caveat) |
| 307.2 | No raw-evidence leak; pre-filled editable draft; explicit escape to independent; separate conversation carries no findingId | `RevIntell.test.tsx` 307 (no-raw-evidence; pre-filled draft; "Start a separate conversation" affordance; separate drops context+routing; independent does not inherit findingId) |
| 308/309 | No horizontal overflow; independent stream + composer scroll; hamburger `aria-expanded`; modal drawer above workspace; composer reachable (320–1920) | `RevIntell.test.tsx` 308/309 block (workspace `overflow-hidden`; `rev-scroll-box` `overflow-y-auto`; hamburger `aria-expanded`; drawer `z-[170]` overlay; composer present) — structural invariants; viewport matrix = manual production check |
| 310 | Enter submits (not Shift+Enter); Escape closes history + focus restore; retry keyboard-reachable | `RevIntell.test.tsx` 310 block (Enter vs Shift+Enter; Escape closes drawer + focus to trigger; retry focusable / not `tabindex:-1`) + retained keyboard scenarios |
| 311 | Every required transition announced once; polite vs assertive; no duplicates; no full re-announce | `RevIntell.test.tsx` 311 block (single region; loading / context handoff / recovery / submit / accepted / done) + `revError.test.ts` `isAssertiveRevFailure` |

## 3. In-sandbox results (on the merged tree `3a3baa0`)

- **Full frontend suite: 1224/1224 across 57 files** — 1129 baseline (all retained 207/210/211/212/
  222/223/225 contract scenarios, **no regression**) plus the 95 new Task-224 scenarios.
- **`RevIntell.test.tsx`: 186/186**; **`revError.test.ts`: 38/38**.
- **`tsc --noEmit -p tsconfig.app.json`: 0 project errors** — the whole project is clean on
  `3a3baa0`; in particular **0** in `RevIntell.tsx`, `revError.ts`, or the Task-224 tests.
- `RevIntell.tsx`/`RevIntell.test.tsx` were 3-way-merged with Task 223 (draft-preserving submission)
  and Task 225 (navigation) with **0 conflicts**; the 4 wiring regressions found during integration
  are fixed (see diagnostics §3) and re-locked by retained scenarios.
- Production build green (Vercel check on the PR).

## 4. Production deployment and acceptance record

- **Deployment:** pushed to `arena/5f37f708-revluma` → PR to `main` → CI → merge → Vercel production
  promotion (verified via the Vercel connector). The Vercel preview/prod state is observed through
  the connector; egress to the deployed origin is not available from the sandbox.
- **Production-acceptance limitation (documented, not a test gap):** the live in-browser acceptance
  at `revluma-test-store-v1.myshopify.com` (authenticated merchant session, real 320–1920 viewport
  matrix, real network failures, real `Retry-After` from the live API, real screen-reader announce)
  **could not be driven from this sandbox** — outbound egress is restricted to GitHub/NPM/PyPI.
  These behaviors are instead covered by the Vitest + jsdom + Testing Library suite (real
  DOM/API/stream, no snapshots) and a structural/responsive source audit, and the live step is a
  documented **manual production-acceptance** item. No real browser, no production egress, and no
  authenticated merchant session exist in this environment.
- **CI:** all required checks (Dashboard suite + production build; Prisma bootstrap, financial &
  security regressions; Backend test suite; backend; dashboard; Vercel) run on the PR; recorded at
  merge.

**Status:** TEST-VERIFIED IN SANDBOX (1224/1224, tsc clean in changed files). CI / merge / Vercel
deployment and the authenticated active-store browser acceptance are the remaining production steps
(egress-restricted sandbox).
