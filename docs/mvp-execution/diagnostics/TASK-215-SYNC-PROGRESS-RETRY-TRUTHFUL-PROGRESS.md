# TASK 215 — Truthful sync progress, idempotent retry, and a usable mobile Integrations experience

Status: **completed 2026-11-08** · Decision: **REV-DEC-0023** · Consolidates Tasks 262–264.

A store's synchronization is long-running, partially observable, and error-prone
(throttles, dropped workers, revoked tokens, unknown totals). Before this task the
UI had no trustworthy progress: it could not say how far along a sync really was,
could not distinguish "running" from "the worker died an hour ago", and offered no
safe way to retry without racing a second job or re-authorizing a store that only
needs a re-run. This task makes progress **authoritative and honest**, makes retry
**idempotent and gate-controlled**, and makes the Integrations screen **usable on a
phone**.

---

## 1. What already exists (extended, not replaced)

- **Task 213** (`rev-integration-state-v1`, REV-DEC-0021): the canonical 12-state
  integration state, evaluated server-side, shared by Rev and every product surface.
  Task 215 does **not** change that contract; it is the *connection/authorization*
  state. Task 215 adds a *different* axis — the *in-flight synchronization* progress
  and recovery of a connected store.
- **Task 214** (REV-DEC-0022): authorization/provider/recovery separation, the
  `sync_retry` / webhook diagnostics surfaces, and the fail-safe store list. Task 215
  reuses the persisted **sync execution ledger** (`stores`,
  `store_sync_domain_states`, `store_sync_jobs`) that 214/201 read, and the
  `finalizeSyncRetry` hook is wired into the existing `syncShopifyStore` completion
  and failure paths.
- **The execution ledger** already records, per required/optional domain:
  `total_units`, `completed_units`, `failed_units`, `discovered_count`,
  `persisted_count`, `pages_completed`, `pagination_complete`, `last_attempted_at`,
  `error_code`. Task 215 **reads** these; it invents nothing.

## 2. The gaps (what 215 implements)

1. **No honest progress.** Nothing said how far a sync really was, whether the total
   was even known, or whether a "99%" was real or guessed. A percentage must be
   *measurable* (same-unit recorded denominator) or the UI must say "working — total
   not yet known".
2. **Stall was invisible.** A worker that died mid-sync left the store "running"
   forever. Stall must be a *real heartbeat* threshold, not `updated_at`.
3. **Retry was unsafe.** There was no idempotent, tenant-scoped retry: a double-tap
   could start a second job, a healthy store could be "retried" into fabricated
   work, and a revoked store could be "retried" when it only needs reconnect.
4. **The Integrations screen was not phone-usable.** Cards could overflow or clip at
   320–430px, actions were not reliably ≥44px, and a slow network could show a blank
   area.

## 3. Design decisions

### 3.1 One authoritative contract: `rev-sync-progress-v1`
A pure, versioned progress contract evaluated **server-side**
(`Backend/src/services/integrationProgress.js`) from the ledger. The browser is a
**pure consumer**: it normalizes fail-closed
(`Frontend/src/lib/integrationProgress.ts`) and renders only what the API returns —
it never increments, estimates, or assumes a percentage locally.

- **Job status** is a closed set: `idle, queued, running, stalled, completed,
  partial, failed, unavailable`.
- **Percent truthfulness:** a numeric `overall.percent` is emitted **only** when
  every *required* domain (products, orders, abandoned_checkouts) has
  `total_known=true` (same-unit recorded denominator) and all are `ok`; otherwise
  `measurable=false` and `percent=null`. A non-`ok` required domain **caps the
  overall at 99**. `100` is emitted **only** when the job is `completed`. A domain
  is `100` only when its status is `ok`. `estimated` is always `false` for v1.
- **Stall is a real heartbeat.** `heartbeat_at` = max `last_attempted_at` across
  running domains, else `sync_started_at` while running — **never** `updated_at`.
  A running job is `stalled` only when `now − heartbeat > 7200s`.
- **Failures are typed** and split into auto-retry-eligible
  (`transient_provider, throttle, backend, worker_interrupted, unknown`) and
  not-eligible (`authorization, permission, unsupported` → reconnect). A `P`-prefixed
  reason code maps to `transient_backend` **before** the generic fallback.
- **Backoff** is `60s × 2^(n−1)`, value-capped at `3600s`; `MAX_AUTO_ATTEMPTS=5`.
  `retry_eligible` (auto) is false when exhausted; `actionable` = manual or merchant
  action exists.
- **Merchant-safe:** no tokens, raw provider payloads, or raw errors — stable
  `reason_code`, `error_code`, `next_step`, `merchant_action_required` only.

### 3.2 Idempotent, gate-controlled retry
`requestSyncRetry` (`Backend/src/services/integrationRetry.js`) is tenant-scoped and
**idempotent by `request_key`**:

- The **idempotency pre-check runs first** (`findUnique` on
  `(store_id, scope, request_key)`), so a *replayed* key returns the same accepted
  job — **even while the store is running**.
- Then the gates: running/queued → `409 already_in_progress`; permanent
  (auth/permission) → `409 retry_not_eligible`/reconnect (no sync); no actionable
  failure on a healthy/idle store → `409 NO_ACTIONABLE_FAILURE` (no fabricated work).
- Acceptance is a **short transaction**: re-check idempotency → dedup any active job
  → create `sync_retry_requests` (`requested`) + a new `job_id` + store→`running`;
  the sync is then started **fire-and-forget after the 202 response**.
- `finalizeSyncRetry` moves the active request to a terminal status **once**
  (`updateMany` active→terminal; already-terminal is a no-op), and is wired into the
  sync **completion and failure** paths, best-effort (logged, not thrown).

### 3.3 API
- `GET /api/v1/stores/:storeId/sync-progress` — tenant-scoped (404 cross-tenant, no
  existence leak), `Cache-Control: no-store`, fail-closed 500 on any invalid
  contract.
- `POST /api/v1/stores/:storeId/sync-retry` — membership-gated (403), `scope`
  defaults to `all`, `request_key` from the JSON body **or** the `idempotency-key`
  header, 202 on accept.

### 3.4 Bounded, controlled polling (frontend)
`useSyncProgress` polls **only while the job is active** (running/stalled/queued) and
**stops on a terminal state** — no unbounded polling. It backs off to a slower cadence
for stalled/queued work and hard-caps total poll time, dedupes in-flight requests,
cleans up on unmount, and `refetch` (after a retry / on focus) forces the backend to
override any stale view immediately.

### 3.5 Mobile-first Integrations card
`SyncProgressCard` is a single-column, overflow-safe card: `w-full min-w-0` +
`break-words`, stacked metadata (`grid-cols-1` → `sm:grid-cols-2`), primary actions
≥44px, accessible labelled `progressbar` (aria-valuenow only when measurable;
indeterminate omits it), visible focus rings, an accessible diagnostics disclosure,
and a **skeleton (never a blank page)** while the first response is in flight. The page
container gains `w-full` + `overflow-x-clip`.

## 4. Named scenarios (acceptance matrix)

Each scenario is pinned by at least one test (referenced). "FE" = frontend, "BE" =
backend, "API" = boundary.

### A. Percentage truthfulness
1. **A.1** A measurable percent is computed only from same-unit recorded
   `completed_units / total_units`; nothing is estimated. *BE task215SyncProgress.*
2. **A.2** A numeric percent is emitted only when **every required domain** has
   `total_known=true`; otherwise `measurable=false` and `percent=null`. *BE/FE.*
3. **A.3** When not measurable, the UI shows an honest indeterminate bar + the real
   stage, never a percentage. *FE SyncProgress, integrationProgress.*
4. **A.4** A non-`ok` required domain caps the overall at **99**, never 100. *BE.*
5. **A.5** `100` is emitted **only** when the job is `completed`; a running/partial
   job at 100 units is rejected. *BE, FE normalizer.*
6. **A.6** A domain is `100` only when its status is `ok`. *BE, FE normalizer.*
7. **A.7** `estimated` is always `false` for v1 (no silent estimation). *BE.*
8. **A.8** Record counts (retrieved/persisted) are reported as recorded results, never
   as a progress estimate. *BE.*
9. **A.9** A percent out of `[0,100]`, non-finite, or with `measurable=false` is a
   contract violation → the whole contract is rejected (fail-closed). *FE normalizer.*
10. **A.10** A wrong/stale version (`rev-sync-progress-v0`) is rejected → honest
    "no progress yet", never a rendered number. *FE normalizer, SyncProgress.*

### B. Job states
11. **B.1** Job status is the closed set (8 states); any other value is invalid. *FE normalizer.*
12. **B.2** `queued` = accepted, not started → "Queued — waiting to start". *FE.*
13. **B.3** `running` = work in progress → fast polling cadence. *FE hook.*
14. **B.4** `stalled` = running with no real heartbeat for >7200s; distinct from running/failed. *BE.*
15. **B.5** `completed` = all required domains `ok` + pagination complete → 100%. *BE.*
16. **B.6** `partial` = some required done, some failed → "Partially complete". *BE/FE.*
17. **B.7** `failed` = a required domain failed with no partial required completion. *BE/FE.*
18. **B.8** `unavailable` = source not evaluable → never a fabricated state. *FE.*
19. **B.9** `idle` = no job yet → polling stops immediately. *FE hook.*

### C. Stall is a real heartbeat
20. **C.1** Heartbeat = max `last_attempted_at` over running domains, else
    `sync_started_at` while running; **never** `updated_at`. *BE.*
21. **C.2** Stalled only when `now − heartbeat > 7200s` while running; a fresh
    heartbeat keeps it running. *BE.*
22. **C.3** A null heartbeat while running is treated as stale, never silently
    healthy, and never stalls before the threshold. *BE.*
23. **C.4** A stalled job is retryable; the UI labels it "Retry (worker stalled)". *FE.*

### D. Failure categorization & eligibility
24. **D.1** transient/throttle/backend/worker_interrupted/unknown →
    `auto_retry_eligible=true`; authorization/permission/unsupported → `false`. *BE.*
25. **D.2** A `P`-prefixed reason code → `transient_backend` (before the fallback). *BE.*
26. **D.3** `retry_eligible` (auto) is true only when auto-eligible or stalled, and
    false when backoff is exhausted. *BE.*
27. **D.4** `actionable` is true only when a manual or merchant action exists; a
    healthy/idle store is not actionable. *BE.*
28. **D.5** A permanent failure sets `merchant_action_required=true`,
    `manual_retry_eligible=false` → UI offers "Reconnect required", not "Retry". *FE.*
29. **D.6** `unsupported` is a named limitation, distinct from `failed`, not auto-retried. *BE.*
30. **D.7** `throttle` (429) is auto-retryable and does not revoke authorization. *BE.*
31. **D.8** Each failed domain carries stable `reason_code`, `error_code`,
    `next_step`, `merchant_action_required`. *BE.*
32. **D.9** No tokens/raw payloads/raw errors in the contract. *BE, FE normalizer.*

### E. Backoff & limits
33. **E.1** Auto-retry backoff = `60s × 2^(n−1)`. *BE.*
34. **E.2** Backoff is value-capped at `3600s`. *BE.*
35. **E.3** `MAX_AUTO_ATTEMPTS=5`; after exhaustion `backoff_exhausted=true`,
    `retry_eligible` (auto) false. *BE.*
36. **E.4** `next_eligible_at` / `retry_window_elapsed` reflect the backoff window. *BE.*
37. **E.5** A not-yet-eligible retry (backoff in progress) is not started. *BE.*

### F. Retry idempotency & gates
38. **F.1** `POST sync-retry` requires active membership (403) and is tenant-scoped. *API.*
39. **F.2** A replayed `request_key` returns the **same** accepted job (idempotent). *BE retry, API.*
40. **F.3** The idempotency pre-check runs **before** "already in progress" → a
    replayed key is idempotent even while running. *BE retry.*
41. **F.4** running/queued → `409 already_in_progress` (no second job). *BE retry.*
42. **F.5** permanent (auth/permission) → `409 retry_not_eligible`/reconnect (no sync). *BE retry.*
43. **F.6** healthy/idle, no actionable failure → `409 NO_ACTIONABLE_FAILURE` (no
    fabricated work). *BE retry.*
44. **F.7** eligible (stalled/transient) → 202, new `job_id`, store→`running`. *BE retry, API.*
45. **F.8** `scope` defaults to `all`. *API.*
46. **F.9** Acceptance persists a `sync_retry_requests` row with the unique
    `(store_id, scope, request_key)`. *BE retry.*
47. **F.10** A concurrent second retry (different key) on a running store is 409. *BE retry.*
48. **F.11** A rejected retry leaves no running job and no half-started sync. *BE retry.*

### G. Retry finalization
49. **G.1** On completion, `finalizeSyncRetry` moves the active request to a terminal
    status exactly once. *BE retry, shopifySync.*
50. **G.2** `finalizeSyncRetry` runs on the **failure** path too, not only success. *shopifySync.*
51. **G.3** An already-terminal request finalizes as a no-op (idempotent). *BE retry.*
52. **G.4** Finalization is best-effort: its errors are logged, not thrown into sync. *shopifySync.*

### H. API surface
53. **H.1** `GET sync-progress` is tenant-scoped; cross-tenant/unknown → 404 (no
    existence leak). *API.*
54. **H.2** The progress endpoint sets `Cache-Control: no-store`. *API.*
55. **H.3** A progress response failing contract validation → 500 (fail-closed). *API.*
56. **H.4** `POST sync-retry` → 202; the sync starts fire-and-forget after the
    response. *API, controller.*
57. **H.5** `request_key` is accepted from the body **or** the `idempotency-key`
    header. *API.*

### I. Frontend bounded polling
58. **I.1** Polls only while active; **stops** on a terminal state (no unbounded
    polling). *FE hook.*
59. **I.2** Backs off to a slower cadence for stalled/queued; total poll time is
    hard-capped. *FE hook.*
60. **I.3** No duplicate in-flight request (a pending fetch is deduped). *FE hook.*
61. **I.4** Unmount clears the timer; no request fires after unmount. *FE hook.*
62. **I.5** `refetch` (after retry/focus) forces the backend to override a stale
    view. *FE hook.*
63. **I.6** An invalid contract → `null` (honest unknown); a network error → error
    state; neither renders a fabricated percentage. *FE hook, SyncProgress.*
64. **I.7** The frontend never increments/assumes a state locally. *FE (design; asserted
    by I.5/I.6).*

### J. Frontend component truthfulness & actions
65. **J.1** The card renders a percentage only when measurable; else indeterminate +
    stage. *FE SyncProgress.*
66. **J.2** The card shows 100% only when the job is `completed`. *FE SyncProgress.*
67. **J.3** A tampered contract (100% while running) is rejected → honest "no progress
    yet", never "100% complete". *FE SyncProgress.*
68. **J.4** A failed job with manual eligibility shows "Retry sync" (≥44px target). *FE.*
69. **J.5** A stalled worker shows "Retry (worker stalled)". *FE.*
70. **J.6** A permanent failure shows "Reconnect required" and invokes reconnect. *FE.*
71. **J.7** No retry button while the job is in flight (running/queued). *FE.*
72. **J.8** Retry POSTs an idempotent request (scope + request_key) then refetches. *FE.*

### K. Mobile UX & accessibility
73. **K.1** No horizontal overflow / clipped cards / overlapping badges at
    320/360/375/390/414/430/768/1024/desktop (`w-full min-w-0 break-words`,
    `overflow-x-clip`). *FE (structure), SyncProgress.*
74. **K.2** Metadata stacks to one column on mobile (`grid-cols-1`) and expands to two
    at ≥sm. *FE SyncProgress.*
75. **K.3** Primary actions (retry/reconnect) have ≥44px touch targets. *FE SyncProgress.*
76. **K.4** The progressbar is an accessible labelled `role="progressbar"` with
    aria-valuemin/max; `aria-valuenow` only when measurable (indeterminate omits it). *FE.*
77. **K.5** Interactive elements have visible `focus-visible` rings and are
    keyboard-operable. *FE SyncProgress.*
78. **K.6** A skeleton (not a blank page) shows while the first response is in flight. *FE.*
79. **K.7** Diagnostics are an accessible disclosure (`details/summary`) that expand
    without overflow. *FE SyncProgress.*
80. **K.8** Retry/reconnect/stalled states are visually and textually distinct (no
    ambiguous "loading" for a failed store). *FE SyncProgress.*

## 5. Verification plan

- **Unit/contract:** `Backend/src/services/__tests__/task215SyncProgress.test.js`
  (contract truthfulness), `task215SyncRetry.test.js` (idempotency + gates +
  finalization), `Backend/src/tests/task215SyncProgressApi.test.js` (boundary).
- **Frontend:** `src/lib/integrationProgress.test.ts` (fail-closed normalizer +
  honest copy), `src/hooks/useSyncProgress.test.ts` (bounded polling),
  `src/components/SyncProgress.test.tsx` (truthfulness, retry states, mobile/a11y).
- **Regression:** full backend suite (`node scripts/run-tests.js`), full Python
  suite, full frontend suite, `tsc --noEmit`, `vite build`, eslint on touched files,
  `git diff --check`.
- **Live (after deploy, read-only):** Render `/ready` SHA probe for both services;
  Vercel production liveness. The authenticated `sync-progress`/`sync-retry` API and
  the phone-width Integrations UI require a merchant session — live-store end-to-end
  acceptance is the human runbook step (consistent with Tasks 201–214). The retired
  store is never touched.

## 6. Implementation status (completed 2026-11-08)

- **Progress contract** `Backend/src/services/integrationProgress.js` —
  `buildSyncProgress` + `validateSyncProgress` (fail-closed). **26 tests.**
- **Retry service** `Backend/src/services/integrationRetry.js` —
  `requestSyncRetry` (idempotency pre-check before in-progress; tenant-scoped;
  short-transaction acceptance; fire-and-forget start) + `finalizeSyncRetry`
  (active→terminal, idempotent, best-effort). **14 tests.**
- **API** (`storeController.js` + `storeRoute.js`) — `GET /:storeId/sync-progress`
  (404 cross-tenant, no-store, 500 fail-closed) + `POST /:storeId/sync-retry`
  (membership, scope default `all`, `request_key` body/header, 202, fire-and-forget
  after response). **7 tests.**
- **Schema** `prisma/schema.prisma` — `sync_retry_requests`
  (`@@unique([store_id, scope, request_key])`) + migration
  `20261108000000_task215_sync_progress_retry`.
- **Sync wiring** `Backend/src/services/shopifySync.js` — `finalizeSyncRetry` on the
  completion **and** failure paths.
- **Frontend** — `src/lib/integrationProgress.ts` (fail-closed normalizer, honest
  `progressLine`), `src/hooks/useSyncProgress.ts` (bounded polling),
  `src/components/SyncProgress.tsx` (mobile-first card), `src/pages/Integrations.tsx`
  (card wired into the store card; `w-full overflow-x-clip` page guard). **38 tests.**
- **Verification (this branch):** backend `node scripts/run-tests.js` → 98 files,
  exit 0 (incl. 47 new Task 215 tests); frontend full suite 580/580; `tsc --noEmit`
  clean; `vite build` exit 0; eslint clean on all touched Task 215 files.
