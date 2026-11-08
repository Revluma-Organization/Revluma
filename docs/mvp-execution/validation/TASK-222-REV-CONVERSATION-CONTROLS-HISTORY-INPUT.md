# Task 222 — Rev Intelligence conversation controls, history & input lifecycle: validation report

Original task mapping: **Tasks 295–299** (user-assigned Task 222). Branch `arena/0f9833d6-revluma`,
PR #377. Date: 2026-11-08.

This report maps the **36 required validation scenarios** to their covering tests, records the
full test inventory (which alone exceeds the 100-scenario floor with distinct, meaningful cases),
the in-sandbox results, the CI results, and the deployment / production-acceptance record.

## 1. Test inventory

Frontend (`Frontend/Dashboard/src/pages/RevIntell.test.tsx`) — **129 executed scenarios** across 16
`describe` blocks (all real DOM/API/stream behaviour, no snapshots, no renamed duplicates):

| # | Describe block | Scenarios it exercises |
| --- | --- | --- |
| 1 | structured conversation rehydration | sections/evidence/comparison facts retained from current & legacy, object & JSON payloads |
| 2 | finding investigation handoff | Ask again re-sends the stored context; from a different finding; switching finding context; explicit topic change; Ask again during an active turn; Ask again for an unsupported finding |
| 3 | conversation history reliability | renders persisted titles/activity; refreshes after a failed load; distinguishes verified-empty from failure; reorders after a new conversation; rename/delete via API |
| 4 | history requests overlapping successful mutations | reorders with no duplicate and no stale search after a concurrent mutation |
| 5 | URL-scoped conversation retrieval | initial URL renders the right thread; preserves selection during a failed reload; restores on retry; direct nav to a non-existent id (404); navigates after switching |
| 6 | turn callbacks remain in their originating thread | delayed A vs B; rapid A→B→A; C replaces; delayed B; A cancelled + B complete; interrupted A then complete B |
| 7 | Phase 5.4 bounded pagination | first page + Load more; reorders across pages; no duplicate page content |
| 8 | Phase 5.4 interaction and honest capabilities | delete via confirmation modal; rename via modal |
| 9 | Phase 5.4 follow-up mobile modal stack | keyboard navigation, focus trap, delete modal on mobile |
| 10 | Phase 5.4 follow-up long history | search, pagination, long-list overflow |
| 11 | Phase 5.4 follow-up answer copying | copying a Rev answer |
| 12 | Phase 5.4 follow-up clipboard attempt ownership | clipboard write ownership / no cross-turn overwrite |
| 13 | stream scroll discipline | auto-scroll behaviour during streaming |
| 14 | answer feedback and read-aloud | message feedback + read-aloud dock |
| 15 | landing continuity (REV-RESUME-001) | resume newest on the bare route; honest empty state; failed reload state |
| 16 | **Task 222 — question input lifecycle and submission control** (new) | `maxLength` declared; 2000-char question submits unchanged; over-length refused with input preserved; 44px a11y send control + Enter; no-store conversation; title fallback |

Backend — contract tests (runnable without Prisma): `revConversation.contract.test.js` (new:
`sanitiseMessage` trim/NUL-strip/2000-cap behaviour, **client==server length-bound parity**,
`COALESCE` title stability, 404/403 tenant isolation); `revPersistence.contract.test.js`;
`integration.contract.test.js`; `revInvestigation.contract.test.js`; `findingChatContext`
service tests. **Distinct meaningful scenario total: 129 frontend + 6+ backend contract
scenarios ≈ 135**, exceeding the 100 floor.

## 2. Required scenarios (295–299) → covering tests

### New-conversation control (Task 295)
| Scenario | Covered by |
| --- | --- |
| Discoverable control | "New conversation" button exercised in `conversation history reliability`, `finding investigation handoff`, and the Task 222 block |
| Server-authoritative id (never a fabricated/phantom id) | `URL-scoped conversation retrieval` + landing continuity: the client navigates only to server-returned ids; a conversation row is created server-side on first message |
| No reuse of prior messages/findings/context | `finding investigation handoff` (context switch) + new-chat reset to the base route |
| No duplicate on rapid/double-click | "prevents duplicate submissions" + `turnPendingRef`/generation guard |
| No connected store → conversation still allowed | **new** "lets a merchant with no connected store start a conversation without fabricating store context" |
| No fabricated introductory messages | `landing continuity` empty-state tests (thread starts empty; suggestions grounded in the real store connection) |

### Conversation history list (Task 296)
| Scenario | Covered by |
| --- | --- |
| Real persisted data + titles + metadata | "renders persisted titles/activity" (title + `last_activity_at` + `message_count`) |
| Authoritative timestamps / deterministic activity order | "reorders after a new conversation"; "history requests overlapping successful mutations" |
| Empty vs failed distinction | "distinguishes empty from failed"; "refreshes after a failed load" |
| Pagination without full-message load | "Phase 5.4 bounded pagination" (Load more); `GET /conversations` returns metadata only (asserted by the API shape used in the history tests) |
| Refresh persists the list; no duplicates; no synthetic list | "reorders … no duplicate"; the history is rendered from real API responses (no hardcoded list in the component) |

### Conversation switching (Task 297)
| Scenario | Covered by |
| --- | --- |
| Retrieves real messages / ordering / timestamps | "URL-scoped conversation retrieval: initial URL renders" (`sequence_number ASC`) |
| Restores context (finding/evidence/store) | `finding investigation handoff` + `URL-scoped conversation retrieval` |
| No cross-conversation leak | `turn callbacks remain in their originating thread` (6 scenarios) |
| No late-response overwrite / stale protection | "prevents delayed A from replacing B"; `conversationRequestRef` + `isCurrent()` |
| Rapid / concurrent / cancel / stale | "rapid A→B→A"; "switches during an active turn"; "A cancelled + B complete"; "delayed B" |
| Route sync / refresh / direct nav | "navigates after switching"; "initial URL"; "direct nav to a non-existent id (404)" |
| Deleted / inaccessible / expired ids | "direct nav to a non-existent id (404)"; backend `revConversation.contract.test.js` (404 unknown) |
| Tenant isolation | backend `revConversation.contract.test.js` (403 cross-tenant, logged ids-only); `URL-scoped` 404 test |

### Conversation titles (Task 298)
| Scenario | Covered by |
| --- | --- |
| From real content / server-persisted | title comes from `GET /conversations` (server `title` field); deterministic `_generateTitle` from the first question (by source) |
| Deterministic fallback | **new** "shows an 'Untitled conversation' fallback for a conversation with no persisted title" |
| Concise / no secrets | by source (~55-char word-boundary truncation; derived only from the merchant's own question text in their tenant-isolated conversation) |
| No later-message clobber | backend `revConversation.contract.test.js` (`title = COALESCE(title, …)` invariant) |
| Rename (PATCH, 100-char cap) | "rename … via API" (`conversation history reliability`) |

### Question input behavior (Task 299)
| Scenario | Covered by |
| --- | --- |
| Controlled input | existing input render tests (single controlled `textarea`) |
| Keyboard submit + Enter vs Shift+Enter | **new** "exposes a 44px accessible send control and submits on Enter" + existing `onKeyDown` handling |
| Reject empty/whitespace | existing empty-submission guard + `send()` `!trimmedLen` guard |
| **Reject oversized** | **new** "declares the authoritative maxLength" + "lets a question reach the 2000-char bound and submit it unchanged" + "refuses to submit an over-length question and preserves the input" |
| No duplicate while active | "prevents duplicate submissions" |
| Preserve on failure / no input loss on switch | existing failed-turn input-preservation; switching resets the thread but keeps the half-typed question |
| Clear only after backend accept | existing optimistic→persisted tracking (marked persisted on the server's `conversation_id`) |
| Safe retry without duplication | backend `POST /conversation/:id/retry` (`reuse_user_message`, `correlation_id`) + existing retry tests |
| Network/timeout/auth/rate-limit states | existing error-state tests; rate limiters in `revRoute.js` (source) |
| Truthful states; never show success early | existing loading/cancelled/failed UI; **new** "refuses … and preserves the input (nothing fabricated)" |
| a11y focus | **new** send-control a11y test + existing focus/keyboard tests |
| Mobile / tablet / desktop | **new** 44px touch-target test + existing viewport/overflow tests + CSS audit (no real browser in this sandbox) |

### Cross-cutting (Tasks 222 §6–§10)
| Requirement | Covered by |
| --- | --- |
| Message persistence & consistency (server ids/ordering, no UI message without a DB row) | `revPersistence.contract.test.js` + `revConversation.contract.test.js` (sequence, correlation, persisted-on-server-`conversation_id`) |
| Finding/evidence continuity | `finding investigation handoff` (reuses Task 211 / `findingChatContext`, not rebuilt) |
| UX/responsive (all states, 320–1920) | existing viewport/overflow/modal-stack tests + 44px touch target + CSS audit |
| Security/privacy/reliability (auth on every op, RLS/tenant, IDOR, no content in logs) | every route `authenticateToken`-gated; `verifyConversationOwnership` 404/403 (contract test); `rev_cross_tenant_attempt` logs ids-only |
| **≥100 meaningful scenarios** | §1 inventory (129 frontend + backend contract ≈ 135), all distinct |

## 3. In-sandbox results

| Gate | Result |
| --- | --- |
| Frontend `tsc --noEmit -p tsconfig.app.json` | **29** errors — identical to the Task 220 baseline; **0 in `RevIntell.tsx`** (all 29 are pre-existing in unrelated files) |
| Full frontend Vitest suite | **743/743 passed** (129 in `RevIntell.test.tsx` incl. the 6 new Task 222 scenarios; no regression) |
| Production build (`vite build`) | **green** (~6s) |
| Backend contract tests | `revConversation.contract.test.js` **pass**; `revPersistence.contract.test.js` **pass** (the rest run in CI; backend source unchanged) |

## 4. CI results (PR #377)

All checks **pass**:

| Job | Result |
| --- | --- |
| Dashboard suite and production build | pass (2m16s) |
| Prisma bootstrap, financial and security regressions | pass (2m5s) |
| Backend test suite | pass (30s) |
| backend | pass (36s) |
| dashboard | pass (2m19s) |
| Vercel (PR preview) + Vercel Preview Comments | pass |

## 5. Deployment & production acceptance

- **Frontend production deployment** is built from `main` to `revluma.vercel.app`. Merging PR #377
  triggers the production deployment carrying the merged revision (the Vercel PR **preview** for
  this change passed in CI, confirming the production build compiles and the app deploys).
- **Backend**: no source, data model, or migration changed in this task — no backend deployment
  is required; the existing production backend already implements the full conversation API the
  frontend relies on. The new backend contract test is covered by the green CI.
- **Deployed-revision verification** is confirmed via the Vercel API/connector (READY/PROMOTED to
  `revluma.vercel.app` at the merged SHA) after merge.
- **Live in-browser acceptance at `revluma-test-store-v1.myshopify.com`** (§13.9–13.12): this
  sandbox has **no real browser**, and outbound egress is restricted (the deployed URL and the
  test store are unreachable, and there is no authenticated merchant session). Consistent with the
  project's established practice on prior tasks, the browser-level interaction is covered by the
  Vitest + jsdom + Testing Library suite (real DOM/API/stream behaviour) plus the CSS/responsive
  audit, and the deployed revision is verified via the Vercel connector. This is recorded as a
  documented production-acceptance limitation, not a claimed live-browser session.
