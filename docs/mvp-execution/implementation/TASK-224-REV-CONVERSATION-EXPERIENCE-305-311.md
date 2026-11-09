# Task 224 — Rev Intelligence conversation experience (305–311)

## Scope

User-assigned Task 224, mapping to **Tasks 305–311** (305 error classification & truthful surfaces;
306 recoverable retry with bounded backoff; 307 Command Center context handoff & independent
investigation; 308/309 responsive layout across the viewport matrix; 310 keyboard interaction; 311
accessible announcements). This is an implementation-and-production-acceptance task against the
**existing** Rev Intelligence workspace (`/dashboard/rev-intell`), built on the Task 222
conversation-lifecycle contract, the Task 211 finding-context contract, and Task 223's
draft-preserving submission. It is layered onto latest main (`3a3baa0`, including Task 223 and
Task 225), not an older fork.

The change is **frontend only** (one new pure module `src/lib/revError.ts` + `RevIntell.tsx` wiring)
plus tests. It changes **no backend source, no data model, no migration, and no
read-only/security boundary**.

## Original-task → implementation mapping

| Original task | Requirement surface | Where it is implemented & verified |
| --- | --- | --- |
| **305** — Error classification & truthful surfaces | Distinct, closed, non-leaking messages for every structured code, raw HTTP status, and transport failure; no internal detail; prior messages preserved; no fabricated success; honest recovery | New recovery-decision layer `src/lib/revError.ts` (`classifyRevFailure`, `classifyRevResponseError`, `isAssertiveRevFailure`) — 38 unit scenarios; returns `{ kind, retryable, retryAfterSeconds }` and owns no message text. `cleanError()` in `RevIntell.tsx` is the single source of merchant-facing wording (Task 226's shared workspace language), so the decision and the wording cannot drift. Wired into all `send()` failure paths (stream `catch`, stream `onFinal success:false`, `api.post` not-success, `api.post` catch). Verified: `revError.test.ts` (38) + the `RevIntell.test.tsx` "305" block (12 backend codes + 11 HTTP statuses + network fallback + no-leak + preserve-prior + no-fabricated-success + 305-nav reuse). |
| **306** — Recoverable retry with bounded backoff | Transient (5xx/429/timeout/network) → manual retry, Retry-After honoured, no auto-retry; permanent (401/403/422) → no futile retry; finding rejection → recover-in-place; recovered pre-save reuses the existing question | `RetryAfterButton` (live countdown, `disabled` until the server `Retry-After` window elapses, re-enabled on expiry). Retry offered only where an honest recovery exists (retryable, or a finding rejection via `errorCode ∈ FINDING_ERRORS`). No auto-retry anywhere. `handleRetry` prepares the retry (draft + input) and the merchant confirms; a recovered pre-save rejection re-sends the existing `questionRef` (no duplicate). Verified: the `RevIntell.test.tsx` "306" block (5xx, 429/Retry-After countdown, 3 permanent codes, finding rejection, re-sends, no-auto-retry). |
| **307** — Context handoff + independent investigation | First response addresses the finding (if carried); revalidation caveat; no raw-evidence leak; pre-filled editable draft; explicit escape to an independent conversation; separate conversation carries no findingId | Reuses the Task 211 finding-handoff surface (`?finding=` deep link, `loadFinding`, `findingSubjectLine` with the "will revalidate before offering current advice" caveat, pre-filled `draftRef` that does not auto-send, `startFindingInvestigation`/`send()` carrying `findingId`). New: a "Start a separate conversation" control in the finding banner (Task 307.17) that clears the inherited context and resets to the base route; the resulting turn sends no `findingId`, and an unrelated question stays independent. Verified: the `RevIntell.test.tsx` "307" block (6 scenarios) + the retained finding-handoff scenarios. |
| **308/309** — Responsive layout | No horizontal overflow; independent stream + composer scroll; hamburger `aria-expanded`; modal history drawer above the workspace; composer reachable at 320–1920 | Workspace root `overflow-hidden`; the message stream is its own `overflow-y-auto` scroll region separate from the fixed composer; the history trigger is a labelled `aria-expanded` hamburger; the open drawer is `role="dialog" aria-modal="true"` on a `z-[170]` overlay. Verified structurally (DOM/source) in the "308/309" block; the viewport matrix is a documented manual production-acceptance check. |
| **310** — Keyboard | Enter submits, Shift+Enter does not; Escape closes history with focus restore; retry control is keyboard-reachable | Composer `onKeyDown` (Enter submits, Shift+Enter is plain text) — Task 222, re-locked; history drawer closes on Escape with focus restored to the opener (`DialogPrimitive` `onCloseAutoFocus` + labelled-trigger fallback); the retry control is a real, focusable `<button>` not excluded from the tab order. Verified: the "310" block + retained keyboard scenarios. |
| **311** — Accessible announcements | Every required transition announced exactly once; no duplicates; polite vs assertive; no full-conversation re-announce | A single canonical `aria-live` region (`data-testid="rev-status-region"`), **polite** normally and **assertive** for `isAssertiveRevFailure` kinds, rendered only while the workspace owns focus (removed behind a modal — a background live region must not announce behind a modal, and none of the required transitions fire during a modal interaction so none is dropped). Announces: loading, context handoff ("Investigating: {finding}."), recovery ("Connection restored."), submission, acceptance ("Your message was received."), completion, and retry. Verified: the "311" block (single-region + 6 announcements) + the retained announce regressions. |

## Files changed

- **`Frontend/Dashboard/src/lib/revError.ts`** (new, pure): the closed classifier. Preserves the
  exact closed messages for every previously-handled backend code, adds distinct truthful messages
  for raw HTTP statuses (via the reused `classifyCommandCenterFailure`) and for network/timeout/
  malformed/provider, and returns the recoverable/permanent decision with `Retry-After` guidance.
  No interpolated backend/provider/SQL/credential text.
- **`Frontend/Dashboard/src/lib/revError.test.ts`** (new, 38 scenarios): covers the 12 backend codes,
  the 11 raw HTTP statuses (assertive for 5xx/429/408), network/malformed/provider, `Retry-After`
  parsing (delta-seconds only, negative → null), permanent codes never retryable, and the
  closed-message/no-leak invariant for every input.
- **`Frontend/Dashboard/src/pages/RevIntell.tsx`**: `Message` gains `retryable`/`retryAfterSeconds`;
  `cleanError()` is the single source of wording (Task 226 workspace language) while `revError.ts` supplies the recovery decision; the single `announce` region + 311 announce
  call-sites; `RetryAfterButton` (countdown) in the bubble; retry gating (retryable or finding
  rejection); the finding banner "Start a separate conversation" control (307.17) and
  `startSeparateConversation`; classifier wiring in every `send()` failure path. (Merged cleanly
  with Task 223's draft-preserving submission and Task 225's navigation — 0 conflicts.)
- **`Frontend/Dashboard/src/pages/RevIntell.test.tsx`**: +57 scenarios in a new "Task 224" block
  (305/306/307/308/309/310/311) plus 4 regression fixes from the wiring, including scoping two
  assertions to the user-message bubble for Task 223's draft-preserving submission.

## Contracts reused (not rebuilt)

- Task 211 finding-context continuity (`rev-selected-finding-v1`, `findingChatContext`, revalidation
  before current advice) — reused for the 307 handoff.
- Task 222 conversation lifecycle (URL-scoped selection, `isCurrent()`/generation guard, Enter/
  Shift+Enter submit, 2000-char bound) — reused and re-locked.
- Task 223 draft-preserving submission / idempotent replay (`draftSubmissionRef`, `acceptDraft`) —
  reused; its input-retention behavior is respected by the 305/306 assertions.
- Task 220 `classifyCommandCenterFailure` (closed HTTP-status → message kind) — reused as the
  shared raw-HTTP mapping so the two surfaces stay worded consistently.
- Task 212 AI-failure-handling closed messages — preserved verbatim by the new classifier.

## Not changed

- No backend source, controller, route, data model, migration, read-only/security boundary, or
  fixture. No snapshot inflation, no renamed duplicates, no fabricated success path.
