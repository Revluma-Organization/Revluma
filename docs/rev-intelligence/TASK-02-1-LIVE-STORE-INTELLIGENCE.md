# Task 02.1 — Live Store Intelligence: code audit and implementation gates

Status: IN_PROGRESS. This document is an engineering audit, not a production verification.

## Existing execution path
- `python/src/agents/understanding.py`: model-based intent classification; deterministic fallback recognizes explicit "my store" and "analyze my" requests.
- `python/src/agents/orchestrator.py`: authenticates indirectly via the Python serving boundary, obtains organization-scoped conversation state, loads or builds a BusinessState, invokes domain specialists and intelligence agent, then validates response evidence.
- `python/src/intelligence/business_state.py`: reads store-scoped orders, carts, customers and other records; persists organization-level snapshots. Snapshot includes today's and yesterday's revenue, a seven-day revenue trend, cart and customer signals.
- `python/src/agents/responder.py`: generates analysis through the configured model provider. Provider failures and verification failures are handled separately.

## Gaps blocking the seven-day acceptance question
1. **Exact period contract:** `revenue_trend_7d` is a comparison signal, not an explicit seven-day revenue, order-count, AOV, and prior-period dataset. The existing builder uses a date-inclusive range for its recent comparison. Define precise UTC half-open windows, and label them.
2. **Completeness:** Abandoned-cart and customer snapshot metrics are not necessarily scoped to the same seven-day window. Never present them as seven-day values without a matching query.
3. **Freshness:** Store `last_synced_at`, business-state `generated_at`, `data_freshness_at` and warnings must be surfaced separately. A connected store does not prove complete or current order/checkout ingestion.
4. **Unknown vs zero:** Missing tables, query errors, unsynced data and true zero activity must remain distinguishable.
5. **Merchant isolation:** Every data retrieval must derive organization scope from authenticated server context and filter through that organization's store IDs; never trust merchant-supplied organization or store IDs.
6. **Evidence:** A model-generated number must match a scoped, period-labelled query result. Explanations of causes must be marked hypotheses unless supported by evidence.
7. **Model reliability:** General Gemini responses have previously timed out; successful deterministic connection status does not certify seven-day AI synthesis.

## Implementation sequence
1. Add a read-only organization-scoped seven-day evidence query with explicit UTC windows, order count, revenue, AOV, cart counts/value and freshness/coverage flags. Validate database schema and order/cancellation semantics before committing SQL.
2. Add typed evidence payload and unit tests for zero activity, missing data, timezone boundaries, canceled/refunded orders, cross-tenant access, and incomplete sync.
3. Route the exact seven-day briefing request to the evidence tool; do not substitute generic snapshots.
4. Compose a warm merchant briefing grounded in that payload; if the provider fails, return a transparent error rather than invented findings.
5. Run full Python tests, security tests and a genuine authenticated staging/live smoke test. Merge and deploy only on green.

## Acceptance prompt
"Rev, analyze my Shopify store's performance over the last seven days. What should I be paying attention to?"

Acceptance: every metric is traceable to a store-scoped query and period, missing evidence is disclosed, and at least one priority is explained with the relevant evidence (or Rev explicitly states there is insufficient data).
