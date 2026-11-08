# Task 222 — Rev Intelligence conversation controls, history and input lifecycle: audit and diagnostics

Original task mapping: **Tasks 295–299** (user-assigned Task 222). Audit date: 2026-11-08. Baseline:
main `aecd054` (includes Task 216 Command Center, Task 217 priority finding, Task 218 business health +
operational history, Task 219 duplicate removal, and Task 220 responsive Command Center).

## 0. Environment and method

- Repository and the deployed Vercel project inspected directly. The Rev Intelligence surface
  (`Frontend/Dashboard/src/pages/RevIntell.tsx`, 2000+ lines), the conversation API
  (`Backend/src/route/revRoute.js`, `Backend/src/controller/revController.js`, 1515 lines), the
  Prisma data model (`conversations`, `conversation_messages`, `conversation_message_feedback`),
  the auth middleware, and the streaming pipeline (`Frontend/Dashboard/src/lib/revStream.ts`) were
  all re-read from source. Preceding conversation-persistence work (the "GREET-001 /
  MODE-PERSIST-001" persistence contract, Task 211 finding-context continuity, and the
  `findingChatContext` service) was inspected, not assumed.
- **Live deployed application could not be driven from this sandbox** — outbound egress is
  restricted to GitHub/NPM/PyPI, so the deployed URL and the test store
  `revluma-test-store-v1.myshopify.com` are unreachable, and there is **no real browser** and no
  authenticated merchant session. The Vercel *API* is reachable (connector), which is how the
  deployed revision is verified. So the browser-level acceptance in the task's §13.9–13.12 is a
  recorded production-acceptance step, not something executed here; the feature is otherwise
  exercised by the existing Vitest + jsdom + Testing Library suite plus backend contract tests.
- Backend: the controller cannot be required in isolation (heavy boot-time deps), so pure/contract
  behaviour is verified by evaluating the real shipped source in a `node:vm` sandbox (the same
  approach the repository already uses in `revPersistence.contract.test.js`). Prisma-dependent API
  integration tests run in CI (the Prisma engine download is network-blocked in this sandbox).

## 1. What exists before the change (verified in code)

The conversation lifecycle is already substantially implemented and mature. Confirmed present:

- **Data model** — `conversations` (server-authoritative UUID `id`, `organization_id`,
  `user_id`, nullable `title`, `status`, `message_count`, `last_activity_at`, RLS + service-role
  access) and `conversation_messages` (server UUID, `sequence_number` ordering, `correlation_id`
  dedup key, role/content/error fields, `created_at`). A well-formed, tenant-scoped model.
- **API** (`/api/v1/rev/*`) — `GET /conversations` (org-scoped, `limit≤50`/`offset`, escaped
  wildcard search on title **or** message content, `ORDER BY last_activity_at DESC`),
  `GET /conversation/:id` (ownership check, `sequence_number ASC`, message `limit≤100`/`offset`,
  per-user feedback join, `safePersistedNarrative` on Rev content), `DELETE /conversation/:id`,
  `PATCH /conversation/:id/title`, `POST /chat` + `POST /stream` (rate-limited 30/min; org from
  JWT; `execute:true` → 403 read-only; image type+size validation; conversation created
  server-side via `uuidv4()` on first message), `POST /conversation/:id/retry` (re-runs the last
  user message without duplicating). Every route is `authenticateToken`-gated.
- **Tenant isolation** — `verifyConversationOwnership` returns **404** for an unknown id and
  **403** (with a privacy-safe `rev_cross_tenant_attempt` warn carrying ids only) for a
  cross-organisation id; the org is resolved from the JWT/DB membership, never the request body.
- **Titles** — deterministic `_generateTitle` from the first meaningful user question (strips
  conversational openers, word-boundary truncation to ~55 chars, capitalises); applied via
  `title = COALESCE(title, hint)` so a later turn never clobbers an established title; manual
  rename via `PATCH` (100-char cap).
- **Frontend** — a conversation history drawer (search with debounce + invalidation, load-more
  pagination, "No conversations yet" vs a recoverable failure, `aria-current`, 44px rename/delete),
  URL-scoped selection (`/dashboard/rev-intell/:conversationId?`), refresh/direct-nav recovery
  (resume the newest conversation on the bare route), a New-conversation control that resets to a
  clean blank state, streamed turns with plan/step/evidence frames, an `isCurrent()` generation
  guard + `conversationRequestRef` so a late response from a superseded conversation cannot
  overwrite the current one, optimistic user message retained (with retry) if a turn fails,
  persisted-vs-not-persisted tracking, cancelled-state, finding-context continuity (Ask again,
  explicit topic change), delete/rename dialogs with focus trap, and a bounded `read-aloud`/
  feedback dock.
- **Tests** — `RevIntell.test.tsx` (16 describe blocks, ~123 scenarios before this task) plus the
  backend contract tests (`revPersistence.contract.test.js`, `integration.contract.test.js`,
  `revInvestigation.contract.test.js`, …).

## 2. Defects and gaps found

The feature is production-grade in its core. The audit found **two genuine code defects** and a
set of **verified-correct design decisions** that were under-documented (recorded in §3 so they
are not re-litigated).

- **F-1 (medium) — Oversized question input was unbounded on the client.** The question textarea
  had no `maxLength` and `send()` had no length guard, while the backend `sanitiseMessage`
  silently truncates to 2000 chars. Consequences: (a) "reject oversized input" (Task 299) was not
  enforced; (b) a >2000-char question rendered optimistically in the UI at full length but was
  persisted truncated — an inconsistent state where the UI displays a message the database does
  not contain (Task 222 §7); (c) no truthful feedback that a question was too long.
- **F-2 (low) — The send control was below the mobile touch-target floor.** The send button was
  `w-8 h-8` (32px) while the adjacent Stop control and the rename/delete controls in the same
  surface are 44px (`h-11 w-11` / `min-h-11 min-w-11`). The send action is a primary control that
  must be reliably tappable on a 320px viewport (Task 299 + §9).

## 3. Verified-correct design decisions (no code change; documented so they stand on record)

- **New conversation = reset to the base route; the conversation materialises server-side.**
  `newChat()` clears thread/input/finding state and navigates to `/dashboard/rev-intell` (no id).
  A real conversation row is created **only** by the backend on the first accepted message
  (`uuidv4()`), so a "conversation" is never represented as created until the server confirms it,
  and the client only ever navigates to a **server-provided** id (no phantom/non-existent
  conversation can be shown). Double-click/rapid-send is contained by the `turnPendingRef`
  guard + `turnRequestRef` generation counter; a network retry cannot duplicate the user message
  (server `correlation_id` + `reuse_user_message`).
- **No connected store is not an error for starting a conversation.** A conversation is
  organisation-scoped, not store-gated. With no connected store the merchant can still open a
  conversation and ask a question; the answer is grounded-but-empty (the established
  absent-≠zero / `insufficient_history` contracts), never fabricated. Verified by test (Task 222).
- **No fabricated introductory messages.** A new/blank conversation starts with an empty thread
  (the welcome suggestions are grounded in the merchant's real store connection); nothing is
  canned as a conversation turn.
- **Titles carry no server secrets.** A title is derived only from the merchant's own question
  text (their data, their tenant-isolated conversation); no token, credential, or unrelated
  customer data can enter it. Deterministic generation means there is no async title job to
  duplicate or race.
- **Input is preserved, not lost, across switches.** Switching between existing conversations
  resets the *thread* but keeps the half-typed question (no input loss); the user's question is
  captured into the thread optimistically and retained (with retry) if the turn fails, so a failed
  submission never silently disappears.
- **Stale-response protection is defence-in-depth.** `isCurrent()` (turn generation),
  `conversationRequestRef`, and server-side `sequence_number` ordering together ensure a late
  response from a previously selected conversation cannot overwrite the current one; the existing
  suite already asserts this ("prevents delayed A from replacing B after rapid switching").

## 4. Fixes made (this task)

- **F-1** — Added an authoritative `MAX_QUESTION_LENGTH = 2000` constant in `RevIntell.tsx`
  (matching the backend `sanitiseMessage` bound); applied `maxLength={2000}` to the question
  field; added a defensive guard in `send()` that rejects `trimmed.length > 2000`; and added a
  live character-count indicator (shown near the cap, a "shorten to send" warning only when truly
  over, `aria-live="polite"`). A message exactly at the bound is still sendable (the server keeps
  2000), so no "shorten" warning is shown there.
- **F-2** — The send control is now `h-11 w-11` (44px), matching the adjacent controls; keyboard
  submission (Enter) remains the primary path.

## 5. Test strategy (what is verified where)

- **Frontend (Vitest + jsdom + Testing Library)** — the existing `RevIntell.test.tsx` suite plus
  six new Task 222 scenarios: `maxLength` declared on the field; a question at the 2000-char bound
  submits **unchanged** (no silent truncation); an over-length question is refused with the input
  preserved and nothing fabricated; the send control meets the 44px floor, is
  disabled→enabled correctly and submits on Enter; a no-connected-store conversation starts without
  fabricating store/finding context; and a null-titled conversation shows the "Untitled
  conversation" fallback.
- **Backend (node contract tests, `revConversation.contract.test.js`)** — evaluates the real
  shipped `revController.js` source in a `vm` sandbox: `sanitiseMessage` trims, strips NUL bytes and
  caps at exactly 2000; the **client and server length bounds are asserted equal** (the invariant
  that makes F-1's fix sound); `COALESCE(title, …)` guarantees a later turn cannot clobber an
  established title; and `verifyConversationOwnership` returns 404 (unknown) / 403 (cross-tenant,
  logged ids-only).
- The ≥100-row scenario-to-test mapping (covering all 36 required scenarios) is in the validation
  report. The full frontend suite (129 scenarios in `RevIntell.test.tsx` alone) plus the backend
  contract tests exceeds the 100-scenario floor with distinct, meaningful cases — no duplicate
  assertions, snapshots, or renamed duplicates.

## 6. Non-goals (boundaries preserved)

- No change to the conversation/message **data model** or the read-only advisor boundary
  (`execute:true` still 403; no new write path; no migration).
- No redesign of unrelated workspaces; no rebuild of Task 211 (finding context) or the
  `findingChatContext` service — reused as-is.
- No synthetic conversations, fake messages, or simulated backend success anywhere in production
  code or tests.
- No weakening of RLS, tenant isolation, authentication, or rate limiting.
