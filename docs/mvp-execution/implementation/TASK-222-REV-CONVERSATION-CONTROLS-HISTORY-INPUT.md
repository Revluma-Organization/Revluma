# Task 222 — Rev Intelligence conversation controls, history and input lifecycle

## Scope

User-assigned Task 222, mapping to **Tasks 295–299** (verify new-conversation control; verify
conversation history list; verify conversation switching; verify conversation title display; verify
question-input behavior). This is an implementation-and-production-acceptance task against the
**existing** Rev Intelligence workspace (`/dashboard/rev-intell`).

The audit (see the diagnostics report) found the conversation lifecycle already substantially
implemented and mature — a complete, tenant-scoped data model; a full `/api/v1/rev/*` API
(history, thread, delete, rename, chat, stream, retry) gated by authentication with rate limiting
and read-only enforcement; deterministic title generation; and a large frontend (history drawer,
URL-scoped selection, streamed turns, stale-response protection, finding-context continuity). Two
genuine code defects were found and fixed; the remainder was verified correct and documented, then
productionized through testing, deployment, and verification.

This change is **frontend + one new backend contract test**. It changes **no backend source**, no
data model, no migration, and no read-only/security boundary.

## Original-task → implementation mapping

| Original task | Requirement surface | Where it is implemented & verified |
| --- | --- | --- |
| 295 — New conversation control | Discoverable control; server-authoritative id; clean state; no reuse; no duplicate; no-store behavior; no fabricated intro | `newChat()` resets to the base route; the conversation is created **only** server-side (`uuidv4()`) on the first accepted message; the client navigates only to server-confirmed ids; `turnPendingRef` + generation guard prevent duplicates; a no-store conversation is allowed and answers grounded-empty (never fabricated). Verified: `RevIntell.test.tsx` (new-chat / blank-slate / duplicate-submission scenarios) + new "no connected store" scenario. |
| 296 — Conversation history list | Real persisted data; titles + metadata; activity ordering; empty vs failed; pagination; list without full message load; refresh; no dupes; refresh-persistent | `GET /conversations` (org-scoped, `last_activity_at DESC`, escaped wildcard search, `limit≤50`/`offset`) returns **metadata only**; the history drawer shows `title`/date/`message_count`, distinguishes verified-empty from a recoverable failure, load-more pagination, and re-loads after mutations. Verified: `RevIntell.test.tsx` (history reliability, bounded pagination, overlap dedup, refresh-after-mutation). |
| 297 — Conversation switching | Retrieves real messages; ordering/timestamps; restores context; no cross-conversation leak; late-response safety; route sync; refresh/direct-nav; invalid/deleted/inaccessible ids; tenant isolation | URL-scoped selection + `GET /conversation/:id` (`sequence_number ASC`); `isCurrent()` + `conversationRequestRef` + server ordering prevent a stale response from overwriting; refresh/direct-nav resume; 404/403 from `verifyConversationOwnership`; finding/evidence/store context restored per the existing contracts. Verified: `RevIntell.test.tsx` (URL-scoped retrieval, turn-callback-origin, rapid switching) + backend `revConversation.contract.test.js` (404/403). |
| 298 — Conversation titles | From real content; concise; deterministic fallback; no later-message clobber; no secrets; persisted server-side; non-disruptive updates | `_generateTitle` (deterministic, first meaningful question, ~55-char word-boundary truncation); `COALESCE(title, hint)` so a later turn never clobbers; `PATCH …/title` rename (100-char cap); "Untitled conversation" fallback in the history; titles carry only the merchant's own question text. Verified: `RevIntell.test.tsx` (title fallback) + backend contract (`COALESCE` invariant). |
| 299 — Question input behavior | Controlled input; keyboard + accessible submit; Enter vs Shift+Enter; reject empty/whitespace/**oversized**/invalid; no duplicate submits; preserve on failure; clear only on acceptance; safe retry; truthful states; a11y; responsive | `send()` guards (empty, over-length, pending, bad conversation state); Enter submits / Shift+Enter newlines; `turnPendingRef` blocks duplicate submits; the question is retained in the thread (with retry) on failure; optimistic user message only marked persisted on the server's `conversation_id`; the **F-1 oversized-input fix** (client `maxLength=2000` matching the server bound + `send` guard + live counter) and the **F-2 44px send control**. Verified: `RevIntell.test.tsx` (new Task 222 block) + backend contract (length-bound parity). |

## Changes

### Frontend — `Frontend/Dashboard/src/pages/RevIntell.tsx`
- **F-1 (oversized input):** added `const MAX_QUESTION_LENGTH = 2000` (the authoritative bound,
  matching backend `sanitiseMessage`); applied `maxLength={maxLength}` to the question
  `textarea` (defaulting to the constant); added a defensive guard in `send()`
  (`trimmed.length > MAX_QUESTION_LENGTH` → reject before any request/message is created); and
  added a live character-count indicator in `InputToolbar` (shown once within 120 chars of the cap;
  a "shorten to send" warning and a red border only when strictly over the bound;
  `aria-live="polite"`). A message exactly at the bound is still valid and sendable.
- **F-2 (touch target):** the send control is now `h-11 w-11` (44px) instead of `w-8 h-8` (32px),
  matching the adjacent Stop control and the rename/delete controls in the same surface.

### Frontend test — `Frontend/Dashboard/src/pages/RevIntell.test.tsx`
- Added a `Task 222 — question input lifecycle and submission control` describe block (6
  scenarios): `maxLength` declared on the field; a 2000-char question submits **unchanged** (no
  silent truncation); an over-length question is refused with the input preserved and nothing
  fabricated; the send control meets the 44px floor, toggles disabled→enabled, and submits on
  Enter; a no-connected-store conversation starts without fabricating store/finding context; and a
  null-titled conversation shows the "Untitled conversation" fallback.

### Backend contract test — `Backend/src/controller/__tests__/revConversation.contract.test.js` (new)
- Evaluates the real shipped `revController.js` source in a `node:vm` sandbox (repository's
  established contract-test pattern) and asserts: `sanitiseMessage` trims, strips NUL bytes, and
  caps at exactly 2000; **the frontend `MAX_QUESTION_LENGTH` and the backend bound are equal**
  (the invariant that makes F-1's fix sound — a drift would reintroduce silent truncation);
  `COALESCE(title, …)` so a later turn cannot clobber a title; and `verifyConversationOwnership`
  → 404 (unknown) / 403 (cross-tenant, logged ids-only). Runnable in-sandbox; no Prisma needed.

## Decisions

Recorded as **REV-DEC-0028** in `implementation-decisions.md`.

## Verification

Frontend `tsc` project error count **29** (unchanged from the Task 220 baseline; no new errors,
`RevIntell.tsx` clean); full frontend suite **743/743** (129 scenarios in `RevIntell.test.tsx`
including the 6 new ones; no regression); production build **green**; backend contract tests
**pass**. See the validation report for the ≥100-row scenario mapping, CI results, and the
deployment/production-acceptance record.
