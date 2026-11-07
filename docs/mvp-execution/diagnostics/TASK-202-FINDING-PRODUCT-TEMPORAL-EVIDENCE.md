# Task 202 — finding, product and temporal evidence diagnosis

Date: 2026-11-07. Inspected baseline: `644e7c272d119f957c1ded7cffb7460ce8d28c18`. Scope consolidates original Tasks 202–206 into the authorized Task 202 implementation; no later task was started.

## Existing architecture retained

- `python/src/intelligence/evidence.py` and `evidence_schema.py` own canonical evidence identity, ownership, periods, coverage, freshness and provenance.
- `python/src/agents/tools.py` and `investigation.py` own authorized read-only Rev tools and orchestration.
- `python/src/agents/investigation.py::resolve_reporting_period` and `resolve_store_context` already own period and persisted Shopify timezone resolution.
- `Backend/src/services/revMerchantContext.js` independently supplies the same organization-scoped store context to the Node request path.
- Findings already persist organization/store identity, severity, lifecycle, timestamps, embedded evidence and action context. There is no separate finding-evidence table to invent.
- Products, variants, inventory items, per-location levels, locations, order lines and synchronization ledgers are separate persisted resources.

## Gaps found

1. The finding tool returned only an open-finding count. It did not retrieve the finding, lifecycle, evidence, provenance or supporting order records, so it could not substantiate why a finding was prioritized.
2. Finding existence could be mistaken for current validity; resolved/dismissed history and stale detections lacked explicit semantics.
3. The product tool grouped historical order-line names without stable product identity. It could not distinguish variants, current catalog state, inventory coverage or explicit finding references.
4. Legacy inventory counters could be read without complete inventory acquisition; missing records must not establish stockout or unavailability.
5. Temporal recognition omitted arbitrary previous-N-day rolling windows, explicit quarters/years/named months and several relative calendar forms. Partial comparisons could overlap the current period or compare a partial period with a full prior period.
6. UTC fallback needed an explicit unverified marker in both request-path implementations; an invalid/missing/conflicting Shopify timezone cannot silently become merchant-calendar confidence.
7. Direct finding/product identifiers need tenant/store predicates on every query, bounded results and stable references. No migration is needed.

## Required implementation boundaries

Reuse the canonical evidence constructors and existing tools. Resolve periods and timezone once, then pass the resolved comparison into retrieval. Use half-open UTC instants derived from local calendar boundaries. Comparisons must be non-empty, non-overlapping and comparable; incomplete coverage remains partial. A finding explains stored prioritization only to the extent of its source evidence, not an independent causal diagnosis. Product/order-line association is not proof of a revenue-change cause. No merchant mutation, fabricated evidence or synthetic production fixtures are permitted.
