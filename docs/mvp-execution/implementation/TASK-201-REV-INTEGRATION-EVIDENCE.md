# TASK 201 — Verify integration evidence retrieval (implementation report)

Date: 2026-11-07. Branch: `arena/439930e3-revluma`. Baseline: `56d8ee632350cdeeb27a196ba921dd36cef11404` (main).

TASK 201 is *"Verify integration evidence retrieval"* in `backlog.md`. This report
records what the integration evidence pipeline now does, the invariants it enforces,
where each rule is implemented, and the evidence that it holds.

## What "integration evidence" claims

Integration evidence answers one question: *can this merchant's Shopify integration
actually serve the data Rev will be asked about, right now?* It is current-state
evidence (no period parameters), retrieved from five local tables only:

- `stores` (installation record, recorded scopes, sync activity timestamps)
- `store_sync_domain_states` (the per-domain synchronization ledger)
- `webhook_registrations` / `webhook_deliveries` (registration vs. observed event flow)
- `intelligence_order_coverage` (certified history window)

No Shopify API call is made at retrieval time. A stored record alone proves an
installation exists; *effective* capability is established per resource by a
successful, fully-paginated synchronization within the domain freshness policy —
the same fail-closed philosophy as revenue evidence (Task 198).

## Canonical resource catalogue

`INTEGRATION_RESOURCES` (identical in both implementations): 22 resources, 9
critical for the MVP (store identity, products, variants, orders, order line
items, order refunds, inventory items/levels, webhooks), 13 optional. Each
resource declares its required scopes, its sync ledger domain (`None` where this
build has no dedicated ledger — the state is then explicitly `unsupported`,
never silently `ok`), and any approval beyond the OAuth scope
(`read_all_orders`, `protected_customer_data`).

## State machine

Per-resource **capability state** = f(authorization, latest sync outcome,
freshness):

- `operational` — scope granted **and** a successful fully-paginated sync within
  the domain freshness policy (freshness: fresh ≤ policy, aging ≤ 2×policy,
  stale > 2×policy).
- `missing_scope` / `granted_approval_pending` — authorization gap, named.
- `failed` / `partial` — last sync failed/partial, with a classified
  `failure_class` (authorization, authentication, rate_limit, pagination,
  database, scheduler, network, shopify_api, unknown) — the classification
  drives the merchant-facing recommendation, the raw error code is kept, raw
  error prose is not.
- `stale` — succeeded but outside the freshness policy.
- `never_synchronized` — no successful sync timestamp.
- `running` / `synchronizing` — a sync is in progress; no completed result is
  asserted, and the running domain is surfaced (`health.syncing_domains`,
  "a synchronization is running now" caveat).
- `unsupported` — no dedicated sync ledger in this build; explicitly excluded
  from failure lists (it is a limitation, not a fault).

**Stable state window (by-reference stability).** A state item's evidence id
is a hash that includes its period, so the period must not depend on the wall
clock: the state window is anchored to the *latest observed synchronization*
(one second up to that instant, capped at the wall clock; wall clock only when
no sync has ever been recorded). A cited id therefore stays resolvable across
retrievals until the state actually changes (a newer sync, or a freshness-bucket
transition — which is a real state change and correctly produces a new id).
This mirrors the revenue surface, whose snapshot period is anchored to
`last_synced_at` for the same reason. (Found by the RC by-reference test: the
original wall-clock-anchored window made every cited id 404 on the next
retrieval.)

**Unrecorded scopes (production data gap).** The live test store carries
`granted_scopes = NULL`. A store record with *no* scope list is a data gap,
not proof of a missing grant, so it is never reported as `missing_scope`:
capability rests entirely on observed synchronization behaviour. A fresh
successful sync makes the resource `operational` (authorization state
`effective_verified`, "a successful synchronization proves current access");
without sync evidence the state is `unverified_unrecorded` and the health
block carries a visible warning ("No granted Shopify scopes are recorded on
this store's record; capability states rest on observed synchronization
behaviour"). A recorded-but-incomplete scope list is still a real
authorization gap (`missing_scope`, the scopes named). This is the only way a
healthy, actively-syncing production store avoids a false "unauthorized"
verdict.

Per-store **connection state** (8 states): `authenticated` (record + stored
credentials + recent successful sync), `verification_failed` (recent token
rejection), `unauthorized` (record-level authorization failure),
`disconnected` (revoked/deleted/inactive or no activity at all),
`installation_pending` (installed but never synced), `synchronizing`, `stale`,
`unknown`.

**Webhook state** separates registration from flow:
`healthy` (recent delivered **and** processed events), `degraded` (delivered
but not processed, or processed with some failures), `failed`, `unknown`
(registered but no event observed in 7 days — *a registered webhook does not
prove events are flowing*), `not_registered` (reliance on scheduled sync only).

**Overall health** is deterministic: `100 − 25·real critical failures −
5·never-synchronized critical capabilities − 10·stale resources −
5·failed optional capabilities − 15 webhook failed (10 silent) − 5 incomplete
coverage`, floored at 70 while healthy/verification-pending and capped at 59
while any real critical failure exists; `overall_status` is authoritative, the
score is diagnostic. Multi-store organizations roll up to the **worst** store.

## Invariants

1. **Tenant isolation** — retrieval takes the authenticated organization id;
   every query is org-scoped (Node `stores` probe includes `organization_id`;
   a client-supplied `store_id` must belong to the organization or the result
   is `disconnected`). No client can name another organization.
2. **Secret protection** — token values are never selected (Node uses a raw
   `(access_token IS NOT NULL)` probe; Python selects the same boolean),
   never returned, never logged. `error_details` never appear; webhook
   failures are counted, not quoted. Webhook secrets and raw headers are out
   of the query surface entirely.
3. **Contract validity** — every item passes the rev-evidence-v2 contract
   (`createEvidence`/`validate_collection`): unit `reference`, status
   `available` with the state carried in `value`/item state, freshness block
   for capability items, `store_scope="organization"` with a per-store
   discriminator, cross-tenant validation of the whole collection.
4. **Explicit, never hidden** — state items are always emitted as available
   facts (a bad state is a *value*, not a missing item), so
   status-filtered readers can never hide a failed/stale/unknown state.
5. **Current-state only** — the endpoint rejects period parameters for
   `resource_id=integration` (400, same guard as snapshot resources).

## Where it is implemented

- `python/src/intelligence/integration_evidence.py` — canonical Python
  implementation (rev-evidence-v2 items, `retrieve_integration_evidence`).
- `python/src/agents/tools.py` — the `integration_health` Rev tool
  (availability mapping: healthy→available, disconnected/unknown→unavailable,
  unauthorized→unauthorized, partial/degraded/verification_pending/
  attention_required→partial).
- `python/src/agents/investigation.py` — verification answers: verdict-first
  copy for not-installed, reconnection (credentials rejected), unauthorized
  (missing scopes named), partially-operational (≤3 priority-ordered
  "resource (state)" clauses), verification-pending, degraded caveat, healthy
  (with the running-now clause).
- `Backend/src/services/revIntegrationEvidenceService.js` — Node mirror: same
  catalogue, state machine, score formula; items built through
  `createEvidence`; `retrieveIntegrationEvidence` + by-reference lookup.
- `Backend/src/controller/revController.js` — `GET /evidence?resource_id=integration`
  and the by-reference fallback for integration item ids.
- `python/scripts/staging_integration_acceptance.py` +
  `Backend/src/tests/integrationEvidence.integration.js` — real-PostgreSQL
  RC regressions (tenant isolation, secret protection, failure visibility),
  both wired into `release-candidate-verification.yml`.

## Merchant context decision (REV-DEC-0013)

The merchant context schema (`rev-merchant-context-v3`,
`Backend/src/services/revMerchantContext.js`) is **not** extended with
integration state: the Python `integration_health` tool is the single source
of integration evidence in Rev's context. Adding a second, independently
computed integration surface in the Node context would create a two-sided
contract that could drift (two score formulas, two catalogues) for the same
question. One canonical pipeline, two surfaces (tool + endpoint).

## Local evidence

- Python module suite: 41/41 (`tests/test_rev_integration_evidence.py`),
  including the 16-scenario smoke (healthy 100, fresh install
  verification_pending 70, orders access denied 50, orders stale 80, missing
  read_orders 25, webhook failed 85, webhook silent degraded 90, revoked
  disconnected 50, running-with-no-prior partially_operational 90,
  multi-store mixed, cross-tenant disconnected 0) plus credential-leak and
  org-scoping assertions.
- Python intelligence pipeline: 12/12
  (`tests/test_rev_integration_intelligence.py`), including merchant-copy
  review assertions (verdict-first, ≤1 caveat, "running now (orders)",
  missing scopes named) and a credential-leak scan of every answer.
- Full Python suite: 1652 passed, 7 skipped, 2 errors (the two errors are the
  opt-in live-PostgreSQL revenue tests that require a disposable PG and are
  covered by the RC workflow; environment placeholder DB URLs required, same
  as CI).
- Node service unit suite: 14/14 (`src/tests/revIntegrationEvidenceService.test.js`);
  full Node backend suite: 80 files passed (`npm test`).
- Real-PostgreSQL RC regressions: both sides (see workflow steps); verified
  locally against a locally built PostgreSQL 16 + pgvector bootstrap
  (see audit register entry for the run).

## SQL validation against real PostgreSQL (read-only)

The fake-DB unit tests do not parse SQL, so every raw query in the module was
validated as a shape against real PostgreSQL 17 (production schema, read-only
SELECTs; nothing was written). This caught and fixed two real defects that
unit tests could not see:

1. **`_STORE_SQL` had a trailing comma** — `... AND s.status NOT IN ('deleted',)`.
   This is a PostgreSQL syntax error, so the Python module would have failed
   closed on *every* retrieval in production. Fixed to `NOT IN ('deleted')`.
2. **Unrecorded scopes (see above)** — the live store's `granted_scopes` is
   `NULL`, which the original code treated as every required scope missing,
   producing a false `unauthorized` for a healthy, actively-syncing store.

The Node credential probe (`(access_token IS NOT NULL)`) and org-scoped store
query were also validated against the real schema; the probe is a scalar-bound
`IN ($1, ...)` list so the SQL is explicit and parameterised (no array-literal
rendering), and the token value is never selected.

## Not verified here

- Full behavioural RC acceptance on a *disposable* PostgreSQL (seed + retrieve
  + assert) runs in CI (`release-candidate-verification.yml`, pgvector/pg16) —
  the sandbox has no local PostgreSQL and the production database is never
  seeded. Local SQL validation above is read-only.
- Live production acceptance on the test store is the remaining human runbook
  step (see audit register).
