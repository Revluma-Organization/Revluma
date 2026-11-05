# Commerce data engine roadmap — initial triage

2026-11-05. **Draft, not a complete initiative plan.** Safety: read-only Shopify, no destructive SQL, permission expansion or production migration without an independently reviewed plan.

1. **P0 — reject invalid source order money.** Evidence: `Number(null)` and `Number('')` produce zero in `intelligenceShopifyCoverageProducer.js`. Fix rejects null, blank, non-numeric and unsupported values; regression covers zero and invalid cases. No schema change. Rollback is reverting code; no production certification based on this patch alone.
2. **P0 — nested line-item completeness.** Orders and checkout GraphQL ask for only 250 child items without child pageInfo. Design per-order pagination or explicitly fail incomplete before mutation; test >250, missing pageInfo, retries and no false success. Preserve order/customer tenant scope. Production source comparisons required.
3. **P1 — verify live store.** Current grants, token, version, webhooks and source values require authenticated test-store access; never extract credentials into logs. Compare Shopify Admin, GraphQL and database with currency/period definitions and record redacted evidence. Separate unavailable access from actual absence.
4. **P1 — build source-backed domain coverage.** Inventory schema, existing checkpoints and historical evidence first; add additive tenant-safe sync/checkpoint design only after audit. Define all failure and deletion semantics and test independent tenants.
5. **P1 — metrics/evidence contracts.** Define signed decimal, timezones, returns and completeness gating before replacing any current financial definitions. Evidence IDs must retain formula/version, freshness and tenant. No invented profit or causal attribution.
6. **P2/P3 — breadth.** Add domains and external integrations according to documented merchant value, approvals, privacy and actual source constraints; no speculative capability scores.

Full dependencies, deployment/rollback plans and production acceptance tests remain to be authored after source and architecture audit. The parallel Rev UI draft is not part of this initiative's production release.
