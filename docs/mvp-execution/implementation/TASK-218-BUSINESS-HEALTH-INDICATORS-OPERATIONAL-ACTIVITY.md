# Task 218 — Business health indicators and operational activity

## Scope

User-assigned Task 218 (business health indicators + operational activity) adds two
read-only, versioned, fail-closed contracts to the Node backend and surfaces both in the
Dashboard Command Center. The work is additive: no existing route, contract, table, or
write path was modified, and no migration was added.

Numbering note: the older Phase 3 backlog line "TASK 218 — Prevent fabricated merchant
actions" is a different item already consolidated into Task 205 (audit-register row).
This user-assigned number is distinct, following the established 204/206/210 collision
pattern.

**Rebase note (2026-11-08):** main moved twice while this task was in flight. Task 216
(Command Center structure and operational briefing, original 265–269) merged as
`58defb6` and replaced `Overview.tsx` with a six-section, `useCommandCenter`-driven
hierarchy bound to the org-level `command-center-v1` projection; Task 217 (evidence-backed
priority findings and next step, #371) merged as `4ac2a33` and layered the priority-finding
section into that same hierarchy (hardening the finding contract with evidence, confidence,
lifecycle and a `command-center-priority-finding-v1` shape). Because the local clone
carries disjoint shallow histories, a three-way rebase was impossible, so the Task 218
delta was re-landed (cherry-picked) on top of each new main — final baseline `4ac2a33` —
and re-integrated into that page (see "Frontend" below) rather than merged against the
pre-216 page. Task 216 presented a *persisted UTC-day snapshot* and an 8-item compact
activity list; this task supplies what it explicitly does not compute — 7-day
threshold-classified business indicators and the full bounded operational history — as two
separate store-scoped contracts, leaving `command-center-v1` untouched.

Two questions the product previously could not answer truthfully:

1. **How is this business doing over the recent trend, and how much can we trust that
   answer?** (→ `GET /api/v1/stores/:storeId/business-health`)
2. **What has actually happened operationally — findings, integration state changes,
   synchronization outcomes — without fabricating activity?**
   (→ `GET /api/v1/stores/:storeId/business-activity`)

## Canonical contracts

### `rev-business-health-v1` (`Backend/src/services/businessHealth.js`, pure)

`buildBusinessHealth(bundle, now)` is a pure function over a repository bundle
(`store`, `integrationDomains`, `revenue`, `orders`, `checkouts`, `products`,
`inventory`, `integrationState`, `reportingPeriod`). It emits exactly five indicators,
one per closed category:

| category | id | value | comparison | status logic |
| --- | --- | --- | --- | --- |
| `revenue` | `revenue_health` | net sales (2dp, store currency) | previous 7 days | `change_pct` vs base: ≤ −40% `critical`, ≤ −10% `deteriorating`, else `healthy` |
| `orders` | `orders_health` | order count | previous 7 days | `change_pct`: ≤ −50% `critical`, ≤ −20% `deteriorating`, else `healthy` |
| `checkouts` | `checkout_health` | verified-abandoned count (+ `conversion_rate` when denominator > 0) | previous 7 days | abandoned > 0 with at-risk value > 0 → `attention`; else `healthy`. Abandonment is at-risk exposure, never confirmed lost revenue |
| `product_availability` | `product_availability_health` | in-stock count | — | out-of-stock share (oos / (available + unavailable + oos)) ≥ 50% `critical`, ≥ 20% `deteriorating`, else `healthy` |
| `integration` | `integration_health` | canonical integration **state** (string, one of the Task 213 12 states) | — | `connected` → `healthy`; limited/partial/needs-attention → `attention`; disconnected/authorization states → `critical`; `synchronizing`/`unknown` → `insufficient_history` |

Documented threshold constants (`THRESHOLDS`): revenue `critical_pct: -40`,
`deteriorating_pct: -10`; orders `critical_pct: -50`, `deteriorating_pct: -20`; product
`critical_oos_pct: 50`, `deteriorating_oos_pct: 20`. No magic numbers outside this
frozen table; each is unit-tested.

Key invariants (all asserted by `validateBusinessHealth` at the API boundary, which
returns 500 rather than emitting a bad contract):

- **Business severity is asserted only on complete evidence.** An indicator whose
  coverage is not `complete` gets `status = insufficient_history` with its real
  `data_quality` and a human `explanation`/`next_step`. The overall `business_status`
  is the worst *supported* state across `complete` indicators; if no indicator is
  complete, overall is `insufficient_history`. `healthy` therefore requires complete,
  current, covered evidence *and* a non-adverse signal — a lack of detected problems is
  never sufficient for `healthy`.
- **Coverage is derived, never re-measured.** `domainCoverage` maps each indicator to
  its canonical sync domains (`revenue`/`orders` → `orders`; `checkouts` →
  `abandoned_checkouts`; `product_availability` → `products` + `inventory`) and reads
  the per-domain freshness from the Task 213 canonical integration state
  (`revIntegrationState`): `fresh`/`aging` → usable (with data-quality labels), anything
  worse → partial/stale/unavailable with the canonical `reason`.
- **Absent data ≠ zero.** `markAbsent` sets `value = null`,
  `data_quality = unavailable`, independent of what sync coverage claims (a partial-fetch
  failure or an empty store never renders as a healthy zero). `money()` and `pctChange()`
  return `null` for unknown inputs and for change-from-zero — no fabricated precision.
- **Currency honesty.** Revenue carries the store reporting currency; gross/net/refunded
  are preserved as distinct `value_components`; nothing is summed across currencies.
- **Reporting period** (`businessHealthRepository.computeReportingPeriod`): rolling
  7-day UTC windows `[now−7d, now)` vs `[now−14d, now−7d)`; the store `iana_timezone` is
  carried on the period for display, and the period object is explicit in the response
  (`reporting_period` / `comparison_period` per indicator).
- Response top level: `contract_version`, `organization_id`, `store_id`, `shop_domain`,
  `generated_at`, `reporting_period`, `business_status`,
  `business_status_explanation`, `indicators[]`, `by_category`, `data_quality` (closed
  six-bucket summary), `affected_indicators_note` (named non-`healthy`/non-`insufficient`
  indicators, or an honest all-clear).

### `rev-operational-activity-v1` (`Backend/src/services/operationalActivity.js`, pure)

`buildOperationalActivity(bundle, now, limit, cursor)` builds a bounded, deduplicated,
paginated feed from three persisted sources only — no synthetic events, no clock-writes:

- `intelligence_findings` — closed finding type code in `detail` only (never the
  free-text description, so no payload/PII leak into the feed; full detail is reached by
  navigation). Severity maps from the finding's closed severity.
- `integration_lifecycle_events` — typed as `webhook` / `sync` / `integration_change`;
  severity from the closed `to_state` (a revocation or disconnection is `critical`,
  reconnection `info`); `detail` carries the stable `reason_code` only.
- `store_sync_domain_states` — one item per domain's **latest meaningful outcome**
  (`succeeded`/`failed`/`degraded`); `never_run`/`running`/`queued` are *not* events and
  are excluded (an unrun domain is coverage, not activity). `failed` is `warning`,
  repeated failures escalate to `critical` via the closed status.

Assembly invariants: stable `event_id` dedup; hard 14-day window
(`FEED_WINDOW_DAYS = 14`); cursor pagination `base64(occurred_at|event_id)` with
`limit` default 20, max 100; `total` is the full windowed count so the UI can show
"N remaining"; response items carry `event_id`, `type`, `category`, `severity`
(closed `critical|warning|attention|info`), `title` (≤140 chars), `detail`, `status`,
`occurred_at`, `received_at`, `source`, `link`. `validateOperationalActivity` enforces
the contract at the API boundary.

## API surface (`storeController` / `storeRoute`)

- `GET /api/v1/stores/:storeId/business-health` — `authenticateToken`, tenant-scoped
  (store must belong to the caller's organization; cross-tenant/unknown → 404, no
  existence leak), `Cache-Control: no-store`, 500 on contract-validation failure.
  Repository: `fetchBusinessHealthBundle` (orders aggregate emits dual keys
  `count`/`order_count` and `refunded`/`refunds` per window so the presenter and the
  repository agree; OOS share computed from products + inventory rows).
- `GET /api/v1/stores/:storeId/business-activity?limit=&cursor=` — same gating;
  `fetchOperationalActivityBundle` fetches each source inside `safe()` so one source
  failing degrades the feed honestly (missing source → absent items, never a crash and
  never fabricated items) instead of failing the request.

No token material, raw error payloads, or free-text descriptions appear in either
response (asserted in the unit suites).

## Frontend (Dashboard) — integrated into the Task 216 Command Center

The pre-216 page is gone; the Command Center is now the `useCommandCenter`-driven
hierarchy as layered by Tasks 216+217 on `4ac2a33` (header → briefing → business
situation → priority finding(s) → activity + evidence). Task 218 inserts two sections
into that hierarchy, both **store-scoped to the briefing's primary store**
(`data.context.store`), so the briefing, the indicators and the history always describe
one store — and neither renders anything when no store context exists:

- After **Business situation**: `BusinessHealthPanel` — the five
  progressive-disclosure indicator cards (collapsed: category, value, neutral
  `change_pct` text, one-line `explanation`; expanded: `metric_definition`, coverage
  reason, `limitations`, `source_evidence`, `next_step`). Overall `business_status`
  badge (green/amber/orange/red only; `insufficient_history` neutral) +
  `business_status_explanation`; amber `affected_indicators_note` box when present.
  Value formatting by category (money / order count / abandoned count / availability /
  12-state integration label map). Revenue shows gross/refunded components; checkouts
  show `conversion_rate` only when non-null. The "Investigate with Rev" button renders
  **only** when `canInvestigate` is true — the page passes
  `data.integration?.overall_status === "connected"`, so an unavailable store never
  shows a fake-active action.
- After the **activity + evidence grid**: `OperationalActivityPanel`, titled
  **Operational history** (Task 216's briefing keeps the "Operational activity" title
  for its compact 8-item snapshot; the two are distinct views — snapshot vs. bounded
  browsable history). Fetches `?limit=15`, cursor "Load more (N remaining)" via
  `next_cursor`; a generation-guarded `load(reset, cursor)` so a stale store's response
  can never clobber a newer store's feed; severity dots + closed type/severity badges;
  relative time with an explicit "recorded …" annotation when the processing gap
  exceeds 5 minutes; `LINK_TARGET` maps backend `link` values to **only real routes**
  (`/findings` → `/dashboard/overview`, `/integrations` →
  `/dashboard/integrations`; unknown link → no active button); honest empty and failed
  states.

Supporting pieces:

- `src/lib/businessHealth.ts` — contract types for both endpoints, **closed**
  label/tone maps (`BUSINESS_STATUS_LABEL/TONE`, `DATA_QUALITY_LABEL/TONE`,
  `CATEGORY_LABEL`, `ACTIVITY_SEVERITY_LABEL/DOT`, `ACTIVITY_TYPE_LABEL`), and
  **fail-closed contract guards** (`isValidBusinessHealth`,
  `isValidOperationalActivity`, closed version + value checks). A response that does
  not match the closed contract is rendered as the honest "unavailable" state — never
  speculatively, never a crash (this also protects the sections from unrelated
  payloads, e.g. the page-level test mock answering every route).
- `src/pages/Overview.tsx` (Task 216's file) — two added lines of section composition
  plus the `store` context constant; no other behavior changed.
- `src/pages/Overview.test.tsx` (Task 216's file) — the page-level API mock now
  answers the two store-scoped Task 218 routes with contract-shaped fixtures (shared
  `businessHealthFixtures.ts`), and the "manual refresh reuses the same authoritative
  endpoint" assertion is tightened to *that* endpoint (exactly 2 calls, still the last
  call) since the store-scoped panels each fetch once at mount. All 16 Task 216
  assertions are unchanged and green.
- New component tests: `BusinessHealthPanel.test.tsx` (5) and
  `OperationalActivityPanel.test.tsx` (5) covering rendering, fail-closed rejection of
  foreign/mismatched-version payloads, pagination with the server cursor, honest empty
  state, route-only navigation and capability-gated interactivity.

## Files

New (backend): `src/services/businessHealth.js`, `businessHealth.test.js` (52 tests),
`businessHealthRepository.js`, `businessHealthRepository.test.js` (11),
`operationalActivity.js`, `operationalActivity.test.js` (25),
`operationalActivityRepository.js`, `operationalActivityRepository.test.js` (6).
Modified (backend): `src/controller/storeController.js` (+2 handlers + `_private`
exports), `src/route/storeRoute.js` (+2 GET routes).
New (frontend): `src/lib/businessHealth.ts`,
`src/components/dashboard/BusinessHealthPanel.tsx`,
`src/components/dashboard/OperationalActivityPanel.tsx`,
`src/components/dashboard/businessHealthFixtures.ts`,
`src/components/dashboard/BusinessHealthPanel.test.tsx`,
`src/components/dashboard/OperationalActivityPanel.test.tsx`.
Modified (frontend, Task 216 files): `src/pages/Overview.tsx`,
`src/pages/Overview.test.tsx`. No schema/migration changes (all sources are existing
tables).

## Local evidence (final rebased tree, on `4ac2a33`)

- New backend suites: `businessHealth` 52/52, `operationalActivity` 25/25,
  `businessHealthRepository` 11/11, `operationalActivityRepository` 6/6 — **94/94
  pass**.
- Full backend per-file run (all 105 `src/**/*.test.js`, with the same test-env
  variables `scripts/run-tests.js` injects): **105 pass, 0 fail**. The one failure seen
  on the intermediate rebases — `src/tests/task215SyncProgressApi.test.js` test 7
  (`202 !== 409`), reproduced on a clean `git stash` tree → a pre-existing test bug, not
  this additive change — was fixed upstream by Task 217's #371 (the test now clears the
  idempotency state and uses fresh timestamps) and no longer reproduces. Task 216/217
  suites (`commandCenterService` 25/25, `orderTransactionBudget`, `priorityFindingService`)
  pass on this tree.
- Dashboard: `tsc --noEmit` exit 0; `vitest run` 43 files / **627 tests pass**
  (Task 216+217 baseline 614 + 13 Task 218: 3 page + 5 + 5 component); `vite build`
  success. The Task 216 page test was rebased onto Task 217's 16 new priority-finding
  tests in `Overview.test.tsx`; its refresh assertion stays tightened to its own
  endpoint and all of Task 216's and Task 217's assertions are unchanged.

Status: **IMPLEMENTED, CI VERIFIED AND MERGED — PRODUCTION ACCEPTANCE PENDING**
(merged to main as `9e2cca4` via PR #370, all 7 required checks passed). Production
acceptance (deployed revision, authenticated active-store read of both endpoints,
browser check on the live store) is recorded separately in the validation report.
