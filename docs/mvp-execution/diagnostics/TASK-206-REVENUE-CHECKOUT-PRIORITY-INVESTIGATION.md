# Task 206 — revenue, checkout and priority investigation diagnosis

Date: 2026-11-07. Inspected baseline: `215f7d48` (main, includes Tasks 197–204:
evidence contracts, revenue/checkout/order/product/finding/integration
evidence, reporting periods, evidence quality, reasoning epistemics).
Consolidates original Tasks 221 (revenue drop investigation), 222 (checkout
abandonment investigation) and 223 (priority recommendation question).

## Existing architecture retained (verified, not assumed)

- `python/src/agents/investigation.py` owns the real conversation path:
  deterministic routing (`classify_investigation` / `route_message`), period
  resolution (`resolve_reporting_period`, merchant timezone, calendar and
  rolling windows, equal-elapsed partial comparisons), tool execution with
  per-tool failure isolation, fact/comparison/hypothesis/unknown composition,
  narrative validation (unsupported-number rejection), epistemic claims
  (`rev-claim-v1`, Task 204), provenance and correction follow-ups, and
  bounded context persistence (`last_investigation`, `last_claims`,
  `order_query`, `checkout_query`).
- `python/src/agents/tools.py` exposes the authorized read-only tools;
  `python/src/intelligence/*` own retrieval: `revenue_evidence` (currency-
  separated, certified, comparison + year-over-year with zero-denominator
  guards), `checkout_evidence` (observed/completed/abandoned/unknown
  populations, per-currency recorded value, comparison windows),
  `order_evidence`, `product_evidence` (single window; per product-line-name
  units and recorded value), `finding_evidence` (lifecycle, current validity,
  bounded supporting evidence, ≤200 underlying orders), `integration_evidence`.
- Task 203 evidence quality and Task 204 epistemics already enforce: no
  cross-currency sums, verified-zero vs missing, fresh/aging/stale,
  contradiction handling, and four earned epistemic grades with fail-closed
  boundary validation (Node `validateInvestigationResponse`).
- Node boundary and persistence carry the structured result through to the
  merchant (SSE `final` + persisted content); `executed: true`
  recommendations are rejected (read-only guarantee).

## Gaps found (verified against the code, per scenario)

1. **Routing**: "What should I fix first?" / "What deserves my attention
   today?" / "What should I investigate next?" match no intent pattern and
   fall to `INTENT_GENERAL` (conversational, no tools, no findings). Priority
   phrasings that DO match (`most important`, `biggest problem`, `priorit*`,
   `look at first`, `where should I start`) land in `INTENT_OVERVIEW`, which
   answers with a store summary, not a defensible ranked recommendation.
   Priority CHALLENGES ("Why is that more important than the refund issue?")
   route to the referenced domain (`refund`), not to the priority context.
2. **Prioritization**: `retrieve_finding_evidence` returns lifecycle +
   validity + bounded evidence per finding, but nothing ranks findings. There
   is no eligibility gate (stale/historical/unverified findings would be
   presented equally to current verified ones), no duplicate grouping, no
   documented ranking methodology, no "no valid findings" distinction
   (verified-healthy vs insufficient coverage vs unavailable), and no
   invalidation explanation when a previously top finding changes state.
3. **Revenue contribution**: comparisons report per-metric changes, but there
   is no decomposition of the value change into an order-volume effect vs an
   order-value (AOV) effect, so "is this a sales-volume problem or an order-
   value problem?" / "what caused most of the decline?" cannot be answered
   deterministically from the two recorded metrics.
4. **Product contribution**: `retrieve_product_evidence` retrieves one window
   only. "Which product contributed most to the decline?" cannot be answered
   without fabricating a previous period; there is no per-product comparison
   window and no contribution computation.
5. **Checkout (D/E/F)**: the core behaviour already exists (observed
   populations, completion/abandonment rates with explicit denominators,
   "not lost or recoverable revenue" wording, comparison windows, the
   "reason a shopper abandoned is not recorded" unknown). What is missing is
   regression coverage for the scenario E/F/H-class questions through the
   real conversation path and boundary.
6. **Priority persistence**: the follow-up record (`last_claims`,
   `last_investigation`) does not carry the last priority state, so a
   challenge follow-up ("why is that more important than X?") cannot resolve
   against the recorded ranking.
7. **Node boundary**: `priority`, `contributor_analysis` and
   `priority_comparison` blocks do not exist and are not validated at the
   boundary or persisted.

## Implementation boundaries (this task)

- Add ONE prioritization module (`intelligence/finding_prioritization.py`)
  with a documented deterministic method — no invented impact scores; ties
  are explained, not broken by fabricated precision.
- Extend `retrieve_product_evidence` with an optional comparison window
  (mirroring the revenue comparison contract) and compute per-product,
  currency-matched changes there — no parallel evidence system.
- Extend the investigation pipeline with: priority intent answers (build,
  explain, challenge, no-findings, invalidation), revenue value
  decomposition, product contribution, and the `last_priority` follow-up
  record (bounded).
- Node: validate and persist the new blocks; contract tests for each
  fabrication class.
- Regression: the 12 named acceptance scenarios (A–L) run through
  `run_investigation` with the FakeDB harness (labelled synthetic fixtures),
  plus unit suites for prioritization and product comparison, plus Node
  contract and parity tests.
- No schema migration (findings, orders, checkouts, products, conversation
  context all already persist what is needed). No autonomous execution.
  Read-only boundary and tenant isolation preserved by construction (all
  retrieval goes through the existing authorized tools).

## Out of scope / dependencies

- Live-store acceptance against `revluma-test-store-v1.myshopify.com`
  requires authenticated access not available in this sandbox; covered by
  the production verification runbook after deployment.
- Finding GENERATION (detection of new findings) is a producer concern
  outside this task; Task 206 ranks and explains EXISTING findings.
