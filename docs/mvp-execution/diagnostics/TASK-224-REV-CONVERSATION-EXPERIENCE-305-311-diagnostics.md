# Task 224 — Rev Intelligence conversation experience (305–311): audit and diagnostics

Original task mapping: **Tasks 305–311** (user-assigned Task 224). Audit date: 2026-11-07.
Branch `arena/5f37f708-revluma`. Verified on the latest main tree (`3a3baa0`, which includes Task 223
submission/replay and Task 225 onboarding — this work is layered on top of both, not a fork of an
older base).

## 0. Environment and method

The Rev Intelligence surface (`Frontend/Dashboard/src/pages/RevIntell.tsx`, ~2,200 lines), the
closed error classifiers it composes (`Frontend/Dashboard/src/lib/commandCenterError.ts`, Task 220;
`Frontend/Dashboard/src/lib/revError.ts`, new this task), the streaming pipeline
(`Frontend/Dashboard/src/lib/revStream.ts`), the `ApiError` shape (`Frontend/Dashboard/src/lib/api.ts`,
which copies the server `Retry-After` onto `ApiError.retryAfter`), and the conversation/finding
backend contracts (`Backend/src/controller/revController.js`, `revRoute.js`) were re-read from
source. The preceding conversation-lifecycle contract (Task 222), the finding-context continuity
contract (Task 211), and the Task 223 draft-preserving submission / idempotent-replay contract were
inspected, not assumed, and reused.

**Live deployed application could not be driven from this sandbox** — outbound egress is restricted
to GitHub/NPM/PyPI, so the deployed URL and the test store
`revluma-test-store-v1.myshopify.com` cannot be reached with an authenticated merchant session.
Acceptance is therefore carried by the Vitest + jsdom + Testing Library suite (no snapshot
inflation) and a structural/responsive source audit, and the live in-browser step is reported as a
documented production-acceptance limitation, verified via the Vercel connector where deployment
state is observed.

## 1. Findings by original task

### 305 — Error classification and truthful surfaces
`RevIntell.tsx` already had a `cleanError()` switch, but it mapped only a **small** set of
structured backend codes and fell through to one generic sentence for **raw HTTP statuses**
(400/401/403/404/409/422/429/500/502/503/504) and for transport-level failures (network/timeout).
There was no closed recoverable/permanent decision, no `Retry-After` guidance, and the "Try again"
control was offered unconditionally (even for permanent failures). **GAP (F-1):** raw HTTP statuses
and transport failures were not mapped to distinct, truthful, non-leaking messages, and there was no
single recoverable/permanent classifier shared with tests.

**Fix:** a new closed recovery-decision classifier `src/lib/revError.ts` (38 unit scenarios) that
(a) maps every structured backend code and raw HTTP status (via the reused Task-220
`classifyCommandCenterFailure`) to a recoverable/permanent decision, and (b) exposes
`isAssertiveRevFailure(kind)`. It returns `{ kind, retryable, retryAfterSeconds }` and owns **no
message text**: after Task 226 (REV-DEC-0032) rewrote `cleanError()`, `cleanError()` is the single
source of merchant-facing wording (the shared workspace language), so the recovery decision and the
wording can never drift. Raw HTTP statuses still surface *distinct* truthful messages (404→not-found,
429→rate-limited, 502/503/504→unavailable) and a plain transport error keeps the long-standing
`"Rev is taking a moment…"` fallback. No backend/provider/SQL/credential text is interpolated.
Wired into all of `send()`'s failure paths (stream
catch, stream `onFinal success:false`, `api.post` not-success, `api.post` catch); the `Message` type
gains `retryable`/`retryAfterSeconds`.

### 306 — Recoverable retry
No `Retry-After` countdown existed and the retry control was unconditional. **GAP (F-2):** no
bounded backoff, no `Retry-After` respect, and a "Try again" offered for permanent failures.
**Fix:** a `RetryAfterButton` that renders a live countdown ("Retry in Ns" / "…in Ns"), is disabled
until the server's `Retry-After` window elapses, and re-enables exactly when it does. The retry is
offered **only where a manual retry is an honest recovery**: transient failures (429/5xx/timeout/
network/malformed) and finding rejections (which support a recover-in-place retry: fix the finding,
re-send). It is **not** offered for permanent `401/403/422` where re-sending the identical request is
futile. Retry is strictly manual — there is **no auto-retry** on recovery. A recovered pre-save
rejection reuses the existing question (no duplicate); `api.ts` already surfaces `Retry-After` on
`ApiError.retryAfter`, which the classifier reads end-to-end.

> Interaction with Task 223 (draft-preserving submission): Task 223 made `acceptDraft()` clear the
> input only once the server persists the turn, so after a pre-persistence failure the question is
> present **both** in the preserved input draft and in the user bubble in the thread. The 305/306
> assertions were scoped to the user-message bubble (via `threadQuestionCount`) so they assert
> "preserved in the thread / not duplicated in the thread" without being fooled by the preserved
> input. This is Task 223's intended behavior and is preserved, not reverted.

### 307 — Command Center context handoff + independent investigation
The finding-handoff surface (Task 211 contract, `rev-selected-finding-v1`) was present: the
`?finding=` deep link loads the finding, shows its title/description/period, pre-fills an editable
investigation draft, carries the `findingId` into the first turn, and marks an unverified finding as
"will revalidate before offering current advice" (never treated as current fact). Raw finding
evidence is not rendered. **GAP (F-3):** there was no explicit, discoverable way to *escape* the
inherited finding context and start an unrelated investigation from the finding banner. **Fix:** a
"Start a separate conversation" control in the finding banner that clears the inherited context and
resets to the base route; the resulting conversation sends **no** `findingId`. The first response
therefore always addresses the actual finding (when one is carried) and the merchant can
deliberately start independent. (Task 225's finding→Rev and conversation→Command-Center navigation
is left intact and orthogonal to this escape path.)

### 308/309 — Responsive layout
Verified structurally (source + DOM-structure tests): the workspace root is `overflow-hidden` (no
horizontal page scroll at 320–1920); the message stream lives in its own `overflow-y-auto` scroll
region separate from the fixed composer; the conversation history is reachable through a labelled,
`aria-expanded` hamburger on narrow viewports; the open history drawer is a `role="dialog"
aria-modal="true"` surface on a `z-[170]` overlay that stacks above the workspace; the composer
(question field + 44px send control) remains present and reachable. jsdom does not perform real
layout, so these are asserted as the structural invariants that *implement* the responsive behavior,
not as pixel measurements; the viewport matrix is documented as a manual production-acceptance check.

### 310 — Keyboard
Verified: the composer submits on **Enter** and does **not** on **Shift+Enter** (Task 222 contract,
re-locked); the history drawer closes on **Escape** and focus is returned to the opener (the
`DialogPrimitive` `onCloseAutoFocus` restore, with a labelled-trigger fallback); a failed-turn retry
control is keyboard-reachable (a real, focusable `<button>` not excluded from the tab order). The
modal focus trap/Escape behaviour for the nested rename/delete/evidence dialogs is pre-existing
(Task 220/222) and covered by the retained regression scenarios.

### 311 — Accessible announcements
**GAP (F-4):** there was **no** `aria-live` region in the page — none of the state transitions
(submission, acceptance, processing, completion, failure, retry, context handoff, loading, recovery)
were announced. **Fix:** a single canonical live region, rendered only while the workspace owns
focus (it is removed — not merely `aria-hidden` — behind a modal, because a background live region
must not announce behind a modal *and* a live region in the background would otherwise defeat the
modal's `aria-modal` scoping; every announcement fires in the workspace, never during a modal
interaction, so none is dropped). It holds one message (no full-conversation re-announce, no
duplicates) and is **polite** for ordinary transitions and **assertive** only for urgent
session/permission failures (`isAssertiveRevFailure`). Announced transitions: "Loading
conversation.", "Investigating: {finding}." (context handoff), "Connection restored." (recovery of a
failed load), "Sending your question." / "Retrying your question.", "Your message was received."
(acceptance), "Your answer is ready." (completion).

## 2. Defect list

| ID | Defect | Fix |
| --- | --- | --- |
| F-1 | Raw HTTP statuses + transport failures not mapped to distinct truthful messages; no shared recoverable/permanent classifier | New `src/lib/revError.ts` recovery-decision classifier (38 unit scenarios); `cleanError` (Task 226 workspace language) is the single message source and reads the decision from it; wired into all `send()` failure paths |
| F-2 | No bounded/`Retry-After`-honouring retry; "Try again" offered for permanent failures | `RetryAfterButton` (countdown, disabled until `Retry-After` elapses); retry offered only where recoverable; no auto-retry |
| F-3 | No explicit escape from an inherited finding context to an independent investigation | "Start a separate conversation" control in the finding banner; the resulting turn sends no `findingId` |
| F-4 | No `aria-live` region; no state transitions announced | Single polite/assertive live region rendered while the workspace owns focus; announces all required transitions |

## 3. Regressions found and fixed while wiring

While integrating the classifier and the live region into `RevIntell.tsx`, previously-passing
scenarios regressed and were fixed:
1. **Finding-rejection retry button** — the new `retryable !== false` gating hid "Try again" for
   finding rejections (classified permanent), but those support a recover-in-place retry. The bubble
   now offers the manual retry for a failure that is retryable **or** a finding rejection
   (`errorCode ∈ FINDING_ERRORS`), while permanent `401/403/422` still show no futile retry.
2. **Network-error text** — the richer, truthful connection message superseded the old vague
   fallback; the one existing assertion on the old text was updated to the new truthful message (the
   test's purpose is unchanged).
3. **Live region vs `aria-modal` scoping** — an always-mounted `aria-live`/`role="status"` region in
   the background defeated a modal-scoped `getByRole` query in a regression. Rendering the region
   only while the workspace owns focus (removed behind a modal) resolves it and is the correct a11y
   behaviour.
4. **Recover-in-place duplication / Task 223 draft** — the "re-send without duplicating" and
   "preserve the question" scenarios were re-scoped to the user-message bubble (`threadQuestionCount`)
   because Task 223's draft-preserving submission intentionally keeps the question in the input until
   the server persists; a plain text match saw the bubble *and* the input.

## 4. Local evidence (on the merged tree `3a3baa0`)

- Frontend: full Dashboard suite **1224/1224 across 57 files** (1129 baseline on latest main + 95 new
  Task-224: 57 in `RevIntell.test.tsx` + 38 in the new `src/lib/revError.test.ts`). No regression in
  the retained 207/210/211/212/222/223/225 contract scenarios.
- `tsc --noEmit -p tsconfig.app.json` project error count **0** — the whole project is clean on
  `3a3baa0`; in particular **0** in `RevIntell.tsx`, `revError.ts`, or the Task-224 tests.
- No backend source, data model, migration, or read-only/security boundary changed; no fixture or
  merchant record inserted.
