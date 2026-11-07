# TASK 213 — Integration state model and backend-truthful UI (diagnosis & design)

Date: 2026-11-07. Branch: `arena/4be98e37-revluma`. Baseline: `e465a6d` (main,
includes Tasks 197–212). Consolidates original Tasks 252–256. Numbering note:
the pre-existing backlog line "TASK 213 — Label calculated findings in
reasoning output" was already delivered and checked off (consolidated into
Task 204); the user-assigned number for this task is the same 213, and the
backlog will carry both lines with an explicit cross-reference (same pattern
as the Tasks 204/206/210 collisions).

## 1. What already exists (extended, not replaced)

Investigation of the actual implementation found a substantial, working
foundation that this task extends — it does not start from scratch:

- **DB (authoritative records, no migration needed):**
  - `stores` — `status` (`not_connected|connecting|connected|syncing|active|
    error|disconnected|revoked|inactive|deleted`), `granted_scopes` (nullable
    CSV), `access_token` (secret — never exposed), `installed_at`,
    `last_synced_at`, unique `(organization_id, shop_domain)`.
  - `store_sync_domain_states` — per `(store_id, domain)`: `status`
    (`never_run|running|ok|degraded|failed`), record counters,
    `pagination_complete`, `error_code` (short class code, not prose),
    `retry_count`, `error_since`, `last_attempted_at`, `last_succeeded_at`.
    This is the real synchronization ledger; `stores.status` alone is NOT
    sync health (a setup failure rewrites `stores.status` back to `active` by
    design so OAuth is never revoked by a sync bug).
  - `webhook_registrations` / `webhook_deliveries` — registration vs observed
    flow (the Task 201 "registered ≠ flowing" distinction).
  - `intelligence_order_coverage` — certified history windows.
- **Python (Rev context only today):** `intelligence/integration_evidence.py`
  (Task 201) — 23-resource capability map (critical/optional, scopes,
  approval gates), per-domain freshness policy, `classify_failure` (auth /
  authentication / rate_limit / network / database / scheduler / pagination),
  connection-state derivation from record + ledger evidence, webhook
  evidence, and a deterministic health rollup with documented precedence.
  Consumed only by the Rev `integration_health` tool.
- **Node:** `services/revIntegrationEvidenceService.js` — byte-level mirror of
  the above for `GET /api/v1/rev/evidence?resource_id=integration`
  (Task 201: "two implementations, one contract").
- **Node `GET /api/v1/stores` (`storeController.getStores`)** — the endpoint
  the dashboard actually uses. It computes a SHALLOW, boolean-based state:
  `connection_status = Boolean(access_token) && status not in (inactive,
  deleted)`; `sync_status` from `stores.status` + `updated_at` age +
  `last_synced_at`; `setup_status`/`monitoring_mode` from webhook
  registrations. It never reads the sync ledger, never evaluates
  capabilities, never distinguishes expired vs revoked vs missing-scope.
- **Frontend (the defect this task removes):**
  - `pages/Integrations.tsx` — re-derives a local 5-state
    `ConnectionStatus` from the shallow fields (`statusesFromStores`,
    `isStoreSetupComplete`), and **caches store status in
    `sessionStorage`** (stale-state risk after disconnect/revocation).
  - `pages/Overview.tsx` (Command Center) — same shallow derivation
    (`connection_status === 'connected'`, `setup_status/sync_status ===
    'failed'` → "attention needed").
  - `pages/RevIntell.tsx` — no local store-status logic (Rev answers already
    respect capabilities through the Python evidence channel); the gap is
    that the Rev context carries the Task 201 health rollup but not a single
    canonical state the product surfaces can share.
- **Events (exist, reused):** OAuth install/callback (`shopifyService`,
  `shopifyController`), `app/uninstalled` webhook handler
  (`commerceWebhookService` L904 — updates the store record), sync lifecycle
  (`shopifySync`: `syncing` → `active` + `last_synced_at`, or `active` on
  failure), webhook registration retry (`/shopify/retry-setup`).

## 2. The gaps (what 213 implements)

- **G1 — No canonical state contract.** The Task 201 rollup has 8
  `overall_status` values (healthy/degraded/partially_operational/…) that
  serve Rev's evidence narrative; the product needs the 12 merchant-facing
  states (connected / synchronizing / limited_access / needs_attention /
  disconnected / authorization_required / authorization_expired /
  authorization_revoked / sync_failed / sync_partial / unsupported / unknown)
  as ONE versioned, typed contract shared by backend and frontend, with a
  full property set (authorization validity, scope reconciliation, capability
  availability, sync dimensions, error recoverability, merchant action, next
  step, evaluation timestamp, freshness).
- **G2 — No backend-authoritative product API.** The only state API is the
  shallow `GET /stores`; there is no authenticated, tenant-scoped endpoint
  returning a versioned integration state per store.
- **G3 — Frontend manufactures status locally.** Local 5-state derivation +
  `sessionStorage` caching = exactly the anti-patterns the task forbids
  (stale cache after disconnect, status inferred from a database boolean,
  per-workspace conflicting derivations).
- **G4 — Command Center and Integrations derive independently.** Overview and
  Integrations each re-derive from the shallow fields; there is no shared
  consumer.
- **G5 — Rev context lacks the canonical state.** Rev evidence carries the
  Task 201 rollup but not the canonical state, so the product surfaces cannot
  agree with what Rev says.

## 3. Design decisions

1. **Contract `rev-integration-state-v1`** — one versioned, typed object per
   store (below). The 12 overall states are a CLOSED set; the Node boundary
   and the frontend normalizer both fail closed on anything outside it
   (unknown input renders/returns `unknown`, never `connected`).
2. **Canonical evaluator: Python keystone + Node mirror + golden parity** —
   the established house pattern (Tasks 203/204/207/208/210/212).
   - Python: `intelligence/integration_state.py` — PURE function
     `evaluate_integration_state(records, now)`; reuses the Task 201
     capability map, `classify_failure`, freshness policy and scope
     semantics from `integration_evidence.py` (ONE capability registry — no
     competing definitions).
   - Node: `services/revIntegrationState.js` — semantic mirror
     `evaluateIntegrationState(records)` + `retrieveIntegrationState({
     prisma, organizationId, storeId, now })` (tenant-scoped Prisma reads) +
     `validateIntegrationState` (fail-closed contract validator).
   - Golden: `python/scripts/gen_integration_state_golden.py` →
     `revIntegrationState.golden.json` (Python-generated, Node-consumed).
   - The Task 201 evidence tools keep working exactly as before; the Python
     tool now ADDS the canonical block (`integration_state`) to its
     collection, and the Node mirror does the same — Rev and the product
     surfaces read one contract.
3. **Precedence (deterministic, first match wins; documented in code):**
   1. no store record → `disconnected` (`no_installation_record`)
   2. recorded `revoked` / app-uninstalled → `authorization_revoked`
   3. recorded `disconnected|inactive|deleted` → `disconnected`
   4. platform not supported by this build → `unsupported`
   5. no access token recorded → `authorization_required`
      (`no_credentials_recorded`)
   6. unrecognized/contradictory record → `unknown`
   7. latest ledger evidence: credentials rejected — token-expired class
      → `authorization_expired`; permission/scope class →
      `authorization_required`
   8. required (critical) scopes missing from a RECORDED scope list →
      `authorization_required` (reconnect with scopes)
   9. synchronization currently running (critical domain `running` or
      store `syncing` with fresh heartbeat) → `synchronizing`
   10. critical sync outcomes: mix succeeded + failed/partial →
      `sync_partial`; all critical failed (non-auth) → `sync_failed`
   11. repeated/stalled failures (`retry_count >= 3`, `error_since` > 24h,
      stalled running job, persistent webhook failure) → `needs_attention`
   12. capability restrictions without active failures (optional missing
      scopes, approval gates, unsupported capabilities, stale/aging
      freshness, incomplete certified coverage) → `limited_access`
   13. all critical capabilities operational + fresh + authorization
      verified → `connected`
   14. otherwise → `unknown`
   Invariants enforced by the rules (task §3.C): a revoked authorization can
   never display as connected (rules 2/5/7 precede 13); disconnected never
   synchronizing (2/3 precede 9); an active sync never conceals an
   authorization failure (7/8 precede 9); a failed sync never invalidates a
   valid connection (authorization component stays independent); a
   historical successful sync never implies current health (rule 12's
   freshness gate precedes 13); unknown never silently becomes connected
   (default 14); unsupported resources are availability limits (rule 12),
   never sync failures (rule 10 only counts domains that exist).
4. **API (Node, authenticated, tenant-scoped, RLS intact):**
   - `GET /api/v1/stores/integration-states` — all org stores, each with its
     canonical state (Integrations workspace, multi-store orgs).
   - `GET /api/v1/stores/:storeId/integration-state` — single store; store
     must belong to the caller's org, else **404** (cross-tenant rejection
     without existence leak).
   - `GET /api/v1/stores` KEEPS its existing shape (other consumers) and
     gains an additive `integration_state` per store so every client can
     switch over.
   - Evaluator input comes from bounded Prisma reads (store row, domain
     ledger, webhook registrations, 7-day webhook deliveries, coverage row) —
     no provider calls on the status path; no tokens in any response (the
     evaluator sees `has_token`, never the token).
5. **Live authorization verification is bounded and honest.** No Shopify API
   call is made on the status path (task §4/§15). Authorization truth is
   derived from the strongest recorded evidence: a recent successful sync is
   `verified` (with `verification_basis: successful_synchronization`,
   `last_verified_at` = that success); a recorded scope grant without success
   evidence is `granted_unverified`; a failed ledger attempt with an
   authentication-class error is `failed`. The contract never claims
   real-time verification that did not occur.
6. **Frontend — one shared consumer, three workspaces:**
   - `src/lib/integrationState.ts` — contract types, `normaliseIntegrationState`
     (fail-closed), labels/colors for the 12 states (green only for
     `connected`; amber for `synchronizing`/`limited_access`; red for
     `needs_attention`/`sync_failed`/`authorization_*`; neutral for
     `disconnected`/`unsupported`/`unknown`), multi-store rollup (worst state
     per the contract precedence).
   - `src/hooks/useIntegrationStates.ts` — fetches the org state list;
     bounded refresh: 15 s while any store is `synchronizing` or
     `needs_attention`, 60 s otherwise, immediate refetch on OAuth callback
     return and window focus; the `sessionStorage` cache is REMOVED.
   - `src/components/dashboard/IntegrationStatus.tsx` — shared badge + detail
     panel (overall state, explanation, authorization / synchronization /
     capability components, missing scopes, merchant action, next step).
   - `Integrations.tsx` — platform badge and store card driven by the
     canonical state (local derivation removed); the existing setup checklist
     and retry flow are kept (they operate on webhook_details, which the
     contract also carries).
   - `Overview.tsx` — "Store connection" indicator and needs-attention logic
     driven by the canonical state.
   - `RevIntell.tsx` — no local status logic exists; Rev answers respect the
     canonical state through the backend context (G5 fix), so the Rev
     surface requires no local derivation.
7. **Refresh/event consistency.** Existing events (OAuth callback return,
   `app/uninstalled` store update, sync lifecycle status writes) all land in
   the same records the evaluator reads, so the next bounded poll reflects
   them; `app/uninstalled` → `authorization_revoked` within one poll. No new
   event machinery, no duplicate sync jobs, no unbounded polling.
8. **No migration.** Every input is already persisted; all state is derived
   per evaluation. Nothing is newly stored, so nothing can drift.
9. **Security.** No tokens/refresh tokens/secrets in any response or log
   (evaluator takes `has_token` only); error exposure limited to the
   classified failure class + short code (never raw prose/stacks); tenant
   isolation via `requireMembership` + org-scoped queries (the API test suite
   asserts cross-tenant rejection); existing auth middleware and RLS
   untouched.
10. **Testing** (task §13, 35 scenarios mapped to fixtures):
    - Python `tests/test_rev_integration_state.py` — the 12-state matrix,
      precedence invariants, capability semantics, fixture coverage of the
      35 scenarios at the evaluator level.
    - Node `revIntegrationState.test.js` — mirror parity against the Python
      golden, contract validator rejections, 12-state spot checks.
    - Node `revIntegrationStateApi.test.js` — real controller with a mocked
      database module (the repo's established pattern, no Prisma client
      needed): auth required, tenant isolation (cross-tenant storeId → 404),
      schema validation, multi-store org, missing record, token absence from
      responses.
    - Frontend — normalizer fail-closed + rollup; component rendering for
      all 12 states (no green for unhealthy, no locally manufactured
      success); `Integrations`/`Overview` regression tests that status comes
      from the contract.

## 4. Verification plan

- Unit: Python state evaluator (12 states × precedence × capabilities) +
  Node mirror/golden/validator + API contract tests + frontend normalizer/
  component tests.
- Regression: full Python suite, full Node rev* suite (incl. Task 201
  evidence parity — the evidence tools must keep passing unchanged), full
  frontend suite, `tsc --noEmit`, `git diff --check`.
- Live (after deploy, only safe read-only verification): Render `/ready` SHA
  probe for both services; Vercel production liveness; the authenticated
  integration-state API and the merchant UI require a merchant session —
  live-store end-to-end acceptance (sign-in, ask Rev about a capability,
  inspect Integrations/Command Center) is the human runbook step, consistent
  with Tasks 201–212. The retired store is never touched.

## 5. Implementation status (completed 2026-11-07)

**Decision:** REV-DEC-0021 (docs/mvp-execution/implementation-decisions.md).

- **Python keystone** `src/intelligence/integration_state.py` — 12-state
  machine with the documented precedence, `normalize_store_record`
  (token-dropping), `validate_integration_state`-equivalent contract,
  `canonical_state_summary` (compact bounded-context projection),
  `worst_state`. **57 tests** (`tests/test_rev_integration_state.py`),
  including the 35-scenario matrix, precedence invariants, the credential
  non-leakage assertions, and the golden-summary pin.
- **Golden** `python/scripts/gen_integration_state_golden.py` →
  `Backend/src/services/__tests__/revIntegrationState.golden.json` (29 cases
  incl. all 12 states + 6 rollups; now includes `expected_summary` per case,
  so both runtimes are pinned to the same compact projection).
- **Node keystone** `Backend/src/services/revIntegrationState.js` —
  `evaluateIntegrationState`, `normalizeStoreRecord`,
  `canonicalStateSummary`, `validateIntegrationState` (fail-closed,
  regex-guards credential material in the serialized output),
  `retrieveIntegrationStates` (single-store → one state or null; list →
  array), lazy DB resolution. **42 parity tests** against the golden.
- **API** (`storeController.js` + `storeRoute.js`):
  `GET /api/v1/stores/integration-states` →
  `{contract_version, states[]}`; `GET /api/v1/stores/:storeId/
  integration-state` → one state (404 cross-tenant, no existence leak);
  `GET /api/v1/stores` gains additive per-store `integration_state`.
  Membership-gated (403 without active membership); any invalid contract →
  500 fail-closed. **8 boundary tests**
  (`Backend/src/tests/revIntegrationStateApi.test.js`).
- **Evidence surfaces** (Python `integration_evidence.py` + Node
  `revIntegrationEvidenceService.js`): each store entry carries the compact
  `integration_state` (bounded for the Rev context; the full contract stays
  on the product API). Python store SQL selects `updated_at` additively for
  the syncing-heartbeat stall rule; the Node select matches. **3 + 2 new
  evidence tests** per runtime.
- **Rev tool** (`python/src/agents/tools.py` `_integration`): availability
  governed by the canonical worst state via `_CANONICAL_STATUS_BY_STATE`
  (connected→available; synchronizing/limited/needs_attention/sync
  partial/failure→partial; disconnected/authorization states/unsupported/
  unknown→unavailable); diagnostics carry `canonical_states` per store.
- **Frontend** (all fail-closed; green ONLY for `connected`):
  - `src/lib/integrationState.ts` — contract types,
    `normalizeIntegrationState` (rejects unknown versions, out-of-set
    statuses, missing store identity, malformed sub-blocks, and any block
    containing credential material), labels/styles (green accent reserved
    for `connected`, asserted in tests), `worstIntegrationState` rollup,
    `platformStatusFromStates`, `integrationStateCopy` (capability-aware
    page copy). **15 unit tests.**
  - `src/hooks/useIntegrationStates.ts` — polls
    `GET /stores/integration-states`; 15s while any store is
    `synchronizing`/`needs_attention`, else 60s (first tick scheduled after
    the initial fetch so it already reflects activity); refetch on window
    focus and via `refetch` (called on OAuth callback return and during the
    2s setup-poll); **no sessionStorage**. **7 unit tests.**
  - `src/components/IntegrationStatus.tsx` — shared badge.
  - `src/pages/Integrations.tsx` — platform badge + per-store badge driven
    by canonical states (store list's additive block as fallback); the
    `sessionStorage` cache, `ConnectionStatus`/`statusesFromStores`/
    `StatusBadge` local derivation are deleted; header pill green only when
    the worst canonical state is `connected`; store records exist but no
    valid canonical state → `unknown`, never `connected`. Setup checklist +
    retry flow unchanged (they operate on webhook_details).
  - `src/pages/Overview.tsx` — headline copy, Operational health tiles
    (connection = canonical label; Synchronization = sync phase; Webhook
    health = webhook state; Data completeness = certified coverage), CTA
    routing ("Investigate with Rev" only when the canonical state has
    usable data: connected/synchronizing/limited_access), findings panel
    gate — all driven by the canonical worst state.
- **Verification (this branch):** Python `test_rev_integration_state.py`
  57/57; Python `test_rev_integration_evidence.py` 48/48; full Python suite
  2328 passed (4 pre-existing `test_db_diagnostics` failures also fail on
  clean `e465a6d` — unrelated, environment-dependent); Node
  `revIntegrationState.test.js` 42/42; Node
  `revIntegrationEvidenceService.test.js` 19/19; Node
  `revIntegrationStateApi.test.js` 8/8; frontend full suite 539/539;
  `tsc --noEmit` clean; eslint clean on all touched files.
