# TASK 208 — Implementation: intelligence specialists

**Consolidated Task:** 208 (original Tasks 227–229)
**Status:** merged with green CI and Vercel production verified; Render revision and authenticated production acceptance pending.

## Shared execution contract

`rev-specialist-execution-v1`, specialist version `1.0.0`, is implemented in `python/src/intelligence/specialists.py`. Each selected specialist executes all 14 required lifecycle stages and returns identity/version, execution and investigation IDs, request/intent, tenant/store scope, period/timezone, capabilities and evidence domains, facts, calculations, hypotheses, unknowns, references, coverage/freshness, currency integrity, finding state, recommendations, outcome, limitations, diagnostics and follow-up references.

Success requires nonempty facts/calculations. Retrieval failure is not zero. Exceptions become failed executions. Partial evidence remains available. Output is bounded to 40 facts, product payloads preserve only operational variant/location fields, references must resolve, and recursive PII/infrastructure-key checks fail closed. `Backend/src/services/revSpecialists.js` independently validates the same boundaries before JSON, SSE or persistence.

Specialists consume the investigation's deduplicated evidence and tool results. Cross-domain requests retrieve each source once. Contradictory same-metric/currency/period values are disclosed and downgraded, never averaged or forced into agreement. Structured safe logs carry execution ID, status, outcome, evidence count and contradictions.

## Revenue Intelligence

Implemented over canonical revenue/order/refund/product evidence:

- Recorded order value/count, gross sales, AOV, discounts, refund-date and window-order refund bases, cancellations and payment observations where available.
- Product/variant historical order-line contribution only when line values and quantities are complete.
- Same-definition/currency/period changes and independent partial findings.
- Specific diagnostic recommendations for volume/AOV, refunds/discounts and product contribution.

No independent monetary engine, mixed-currency total, recoverable-revenue estimate, causal attribution or action execution was added.

## Retention Intelligence

`python/src/intelligence/retention_evidence.py` retrieves aggregate, tenant-scoped customer/order evidence without customer PII:

- **Ordering customers:** distinct stable customer identities with a non-cancelled order in `[start,end)`.
- **Within-window repeat customers/rate:** customers with at least two orders inside that window, divided by ordering customers in the same window. A zero denominator makes the rate unavailable, not zero.
- **Returning customers/rate:** ordering customers with an earlier non-cancelled order, divided by ordering customers; requires certified lifetime customer-order history.
- **First-time:** first lifetime order inside the window only with certified lifetime history. Otherwise the separate newly-observed measure is partial and never relabelled first-time.
- **Repeat interval:** first-to-second lifetime order intervals for observed second purchases in the window; no-repeat/right-censored customers are not assigned intervals.
- **Cohorts:** merchant-calendar month of first lifetime order. The 90-day repeat rate uses only customers with a complete 90-day observation window; immature cohorts are not ranked as mature.
- Same-metric period changes, including explicit relative-change wording and prior-period evidence.

Retention does not infer satisfaction, loyalty, churn probability, future LTV, purchase intent or campaign effectiveness. Deterministic unsupported-request handling covers those claims.

## Operational Intelligence

Uses current product/variant/location evidence, canonical order lifecycle and Task 201 integration health:

- Available/on-hand/committed and other source-provided quantities stay by variant and location. One location is not a store-wide stockout; current snapshots are not historical availability or lost-revenue evidence.
- Fulfilled/unfulfilled/partially fulfilled/cancelled orders remain distinct.
- **Delayed unfulfilled:** open non-cancelled unfulfilled/partially fulfilled orders at least 72 hours old by processed/ordered timestamp. This disclosed age threshold is not an SLA or delivery estimate.
- **Split fulfillment:** distinct orders with multiple non-cancelled/non-error fulfillment records; unavailable without complete fulfillment sync evidence.
- Refund/status patterns, stale coverage, integration failures and specific next checks remain separate from business issues.

No inventory, fulfillment, refund, campaign or settings mutation was added.

## Orchestration and persistence

`investigation.py` selects only relevant revenue/retention/operational specialists. Overview/priority can execute all three; revenue+inventory and retention+order-history share evidence. Specialist recommendations augment deterministic narrative recommendations with read-only state and evidence references. A specialist exception prevents complete-success rollup.

Existing conversation/message persistence stores full validated results. Bounded `last_specialists` context stores only identity/version, execution/investigation references, intent, status, outcome and evidence IDs. Follow-ups record prior execution references and rerun fresh evidence; stale conclusions never become current facts. No new table, migration, cache or RLS change is needed.

## Verification boundary

The 40 synthetic scenarios are isolated and explicitly labelled in `python/tests/test_task_208_specialists.py`; they test real calculations/execution, not routing alone. They do not prove live Shopify data or authorization. Production acceptance requires deployed revision identity and authenticated conversations on `revluma-test-store-v1.myshopify.com`.
