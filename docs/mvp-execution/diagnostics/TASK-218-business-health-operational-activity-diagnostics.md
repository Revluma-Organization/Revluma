# TASK 218 — Business health indicators and operational activity: architecture audit

## 1. What already exists (extended, not replaced)

- Task 213 canonical **integration state** (`revIntegrationState`, 12 closed states) with
  per-domain synchronization freshness — the coverage truth this task reads, never
  re-measures.
- Task 214/215 **sync execution ledger** (`store_sync_domain_states`,
  `integration_lifecycle_events`, `sync_retry_requests`) — the operational history this
  task's activity feed projects.
- `shopifyOrderFinancials` money semantics (net = gross − authoritative refunds,
  `null` = unknown, `0` = genuine zero, 2dp, currency-verified) — reused for the
  revenue indicator, not forked.
- `intelligence_findings` persistence (closed severity/type codes, `dedupe_key`).
- Task 216 **Command Center** (`58defb6`) as layered by Task 217 (`4ac2a33`): the
  `useCommandCenter`-driven `Overview.tsx` bound to the org-level `command-center-v1`
  projection (persisted UTC-day business snapshot, the evidence-backed deterministic
  **Priority finding** section, compact activity, per-resource evidence). This task's
  sections are inserted into that hierarchy (§3.5).
- The established "server is the evaluator, browser is a fail-closed consumer" pattern
  (Tasks 213/215/216).

## 2. The gaps (what 218 implements)

1. **No merchant-facing "how is my business doing" answer.** Prior surfaces answered
   integration health (213) and sync progress (215) — both about the *pipe*, not the
   *business*. Revenue/order/checkout/product signals existed in Python intelligence
   pipelines but had no versioned, boundary-validated Node contract for the product UI.
2. **No honest activity stream.** Findings, lifecycle transitions and sync outcomes
   were scattered across three tables with no unified, bounded, paginated,
   severity-classified feed; any UI assembled ad hoc would either fabricate recency or
   leak free-text payloads.
3. **Truthfulness hazards left unguarded in any naïve UI:** rendering `healthy` on
   missing data, showing `0` for an absent aggregate, inventing a percentage change
   from a zero base, or surfacing a "Load more"/"Investigate" action the backend says
   nothing supports.

## 3. Design decisions

### 3.1 One evaluator, one contract per question (`rev-business-health-v1`)

The Node presenter is pure (`buildBusinessHealth(bundle, now)`); the repository assembles
the bundle; the controller gates (auth, tenancy, caching) and validates the contract at
the boundary (invalid → 500, never emitted). This is the Task 203/204/207/212/213/215
pattern and keeps the business rules out of the browser and out of SQL.

- **Two orthogonal axes.** `business_status` (what the business is doing:
  `healthy|attention|deteriorating|critical|insufficient_history`) and
  `data_quality` (how much we can trust: `complete|partial|stale|unknown|unavailable|
  unsupported`). They never share a value set — a stale-but-fine week and a
  complete-but-dropping week are different answers, and the UI tones them differently
  (status green/amber/orange/red; data-quality neutral).
- **Severity is asserted only on complete evidence.** Non-complete coverage →
  `insufficient_history` + the real coverage reason. Overall = worst supported state
  across *complete* indicators; none complete → overall `insufficient_history`.
  `healthy` is therefore a claim that requires evidence, not the absence of alarms.
- **Coverage by derivation.** Each indicator names its canonical domains
  (`revenue/orders→orders`, `checkouts→abandoned_checkouts`,
  `product_availability→products+inventory`) and reads freshness from the Task 213
  state. No second clock, no re-query of sync tables for coverage, no drift between
  "what the integration says" and "what the indicator says".
- **Absent ≠ zero, everywhere.** `markAbsent` (value null + `unavailable`) is
  independent of coverage; `money(null) → null`; `pctChange(0, x) → null`;
  `conversion_rate` needs a real denominator. Zero is emitted only for an observed
  genuine zero.
- **Documented thresholds, frozen.** `THRESHOLDS` is the only place severity numbers
  live; adding/changing a threshold is a documented, unit-tested change (revenue
  −10/−40, orders −20/−50, product OOS share 20/50 over
  available+unavailable+oos).
- **Currency honesty.** Revenue carries the store currency; gross/net/refunded stay
  distinct components; the repository's orders aggregate emits dual keys
  (`count`/`order_count`, `refunded`/`refunds`) so presenter and persistence agree on
  names.
- **The integration indicator is a state, not a number.** Its value is the canonical
  12-state string, so "integration health" can never be averaged into the other four or
  rendered as a fabricated metric.

### 3.2 The activity feed is a projection, never a generator (`rev-operational-activity-v1`)

- **Sources are closed and persisted**: findings, lifecycle events, sync domain latest
  outcomes. Nothing is synthesized; an unrun/running/queued domain is *coverage*, not
  *activity*, and is excluded.
- **Stable identity.** `event_id` is derived from persisted keys
  (`finding:<dedupe_key>`, `lifecycle:<source>:<event_reference>`,
  `sync:<domain>:<status>:<occurred_at>`) → idempotent across refetches and safe for
  cursor pagination.
- **Bounded by construction.** Hard 14-day window; cursor =
  `base64(occurred_at|event_id)` (opaque, order-preserving, unforgeable); limit 20
  default / 100 max; `total` = full windowed count so the UI's "N remaining" is
  computed from server truth, never estimated.
- **Merchant-safe detail.** Finding detail = closed type code; lifecycle detail =
  closed `reason_code`; sync detail = attempt count. Free-text descriptions and raw
  error payloads never enter the feed (asserted by test).
- **Degraded, not broken.** Each repository source is fetched inside `safe()`; a
  failing source removes its items (honestly) rather than 500-ing the feed or
  fabricating substitutes.

### 3.3 API

Both endpoints are GET-only, `authenticateToken`, tenant-scoped (store must belong to
the caller's organization; cross-tenant/unknown → 404 with no existence leak),
`Cache-Control: no-store`, and fail closed on contract validation. Read-only, additive,
no migration.

### 3.4 The browser is a consumer, not a producer (frontend)

- Closed label/tone maps in `lib/businessHealth.ts`; unknown values render neutral
  fallbacks, never guesses.
- **Progressive disclosure.** Indicator cards lead with category + value + one-line
  explanation; definition/coverage/limitations/evidence/next-step are one tap away —
  the default view stays legible on mobile.
- **No fabricated interactivity.** "Investigate with Rev" renders only when the
  caller genuinely can (connected store, capability true). Activity links map to
  *existing* routes only (`/findings` → `/dashboard/overview` — there is no standalone
  findings route; `/integrations` → `/dashboard/integrations`); an unknown link target
  becomes a non-active label, never a dead link.
- **Stale-response guard.** The activity feed's loader carries a generation token
  (`genRef`): switching stores invalidates in-flight responses, so store A's feed can
  never clobber store B's view.
- **Honest lag.** Relative timestamps get an explicit "recorded …" note when the
  processing gap exceeds 5 minutes — the UI says when it knows, instead of implying
  live.
- **Fail-closed contract guards.** `isValidBusinessHealth` /
  `isValidOperationalActivity` (closed version + value checks in
  `lib/businessHealth.ts`) gate rendering: a response that does not match the closed
  contract renders the honest "unavailable" state — never speculatively, never a
  crash. This also protects the sections from unrelated payloads (e.g. the page-level
  test mock answering every route) and from future contract drift.

### 3.5 Integration into the Command Center (rebases onto Tasks 216 and 217)

Main moved twice while this task was in flight: Task 216 merged and replaced the
pre-216 page with a six-section, `useCommandCenter`-driven hierarchy bound to the
org-level `command-center-v1` projection; Task 217 then merged on top and layered the
evidence-backed deterministic *Priority finding* section into that same page. The local
clone carries disjoint shallow histories, so the Task 218 commit was cherry-picked onto
each new main (final baseline `4ac2a33`) and re-validated at each step. Decisions made
during re-integration:

- **Two separate store-scoped contracts, `command-center-v1` untouched.** Task 216
  presents a persisted UTC-day snapshot and an 8-item compact activity list and
  explicitly never recomputes; this task computes 7-day threshold-classified
  indicators and the full bounded operational history. Merging the computation into
  `command-center-v1` would have broken Task 216's documented "no recomputation"
  invariant and its deployed contract, so the two contracts stay separate and the
  page composes three endpoints (briefing + two store-scoped).
- **One store context for the whole page.** Both sections bind to
  `data.context.store` (the Command Center's primary store — the same store the
  header and briefing describe), so briefing, indicators and history never disagree
  about which store is being viewed. With no store context the sections render
  nothing rather than fabricating a subject. (A separate per-section store selector
  was rejected: it would let two sections describe different stores on one page.)
- **Placement and naming.** Business health renders between *Business situation* and
  the *Priority finding* section (Task 217's deterministic priority card); the full
  history renders after the *activity + evidence* grid under the title
  **Operational history** — the briefing keeps the "Operational activity" title for its
  compact snapshot, so the two never collide.
- **Page test contract.** The page-level API mock must answer the two store-scoped
  routes with contract-shaped payloads (shared fixtures); the refresh assertion is
  tightened to the authoritative endpoint (exactly 2 calls, still last). All of
  Task 216's 16 assertions and Task 217's 16 priority-finding assertions are
  unchanged; the Task 218 page tests were appended after Task 217's block.

## 4. Named scenarios (acceptance matrix)

| # | Scenario | Assertion |
| --- | --- | --- |
| A | All indicators complete + non-adverse | overall `healthy` (requires evidence, not silence) |
| B | Any complete indicator deteriorating/critical | overall = worst supported state; `affected_indicators_note` names it |
| C | No indicator complete | overall `insufficient_history` with honest explanation; no status asserted |
| D | Indicator coverage partial/stale | that indicator `insufficient_history` + real coverage reason; others unaffected |
| E | Absent aggregate (empty store / fetch failure) | `value: null`, `data_quality: unavailable`, explanation; never 0 |
| F | Revenue −9.9% / −10% / −39.9% / −40% | healthy / deteriorating / deteriorating / critical (boundary = worse class) |
| G | Orders −19.9% / −20% / −49.9% / −50% | healthy / deteriorating / deteriorating / critical |
| H | OOS share 19.9% / 20% / 49.9% / 50% (denominator = available+unavailable+oos) | healthy / deteriorating / deteriorating / critical |
| I | Change base 0 or unknown | `change_pct: null` (no NaN, no fabricated %) |
| J | Conversion denominator 0 | `conversion_rate: null`; else completed/(completed+abandoned) ×100, 1dp |
| K | Abandoned > 0 with at-risk value | `attention` + "at-risk exposure, not confirmed lost revenue" copy |
| L | Integration state each of 12 | closed mapping; revoked/disconnected never `healthy`; synchronizing/unknown → `insufficient_history` |
| M | Contract tampering (version/category/count/type) | `validateBusinessHealth` rejects; API 500, no emit |
| N | Activity window boundary | day-13 event kept, day-15 dropped |
| O | Duplicate identity across sources | dedup by `event_id`; item appears once |
| P | Cursor round-trip | page 2 resumes after last item, no gap/overlap; `next_cursor: null` on last page |
| Q | Limit handling | default 20, cap 100, invalid → default; `total` = full windowed count |
| R | `never_run`/`running`/`queued` domain | not an event; excluded from feed |
| S | Finding with free-text description | feed `detail` = closed type code only; description asserted absent |
| T | One repository source fails | feed returns remaining sources' items; no 500; no fabricated items |
| U | Cross-tenant / unknown store | 404 (no existence leak); unauthenticated 401; `no-store` caching |
| V | Frontend: store context from the Command Center | both sections bind to `context.store`; with `store: null` neither renders; stale store-scoped response cannot clobber (gen guard) |
| W | Frontend: unknown status/severity/link, or a payload that is not the closed contract (incl. the command-center payload) | neutral fallback label / no active button / honest "unavailable" state; no crash |

Scenarios A–U are covered by the 94 deterministic backend tests; V–W by the Task 218
frontend tests (13: 3 Command Center page tests + 5 `BusinessHealthPanel` + 5
`OperationalActivityPanel`, covering the closed maps, fail-closed contract guards,
link map, generation guard and capability gating) within the 43-file / 627-test
Dashboard suite.

## 5. Limits and known follow-ups

- **OOS math** currently uses `products.stock_status = 'outofstock'` plus inventory
  rows; the `inventory_levels.quantities` Json shape is still to be pinned for a
  quantity-based share (documented open item, not blocking v1).
- Reporting windows are rolling 7-day UTC with the store IANA timezone carried for
  display; merchant-calendar (DST-safe) periods remain the Python pipeline's domain.
- The Python intelligence pipelines are unchanged; parity between the Python revenue
  evidence (Task 198/199) and this indicator is by shared semantics
  (`shopifyOrderFinancials`), not a shared code path.
- Production acceptance (deployed revision, authenticated active-store read, browser
  check) is pending per the validation report.
