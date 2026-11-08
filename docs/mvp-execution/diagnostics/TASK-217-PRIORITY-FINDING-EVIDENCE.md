# TASK 217 — Priority Finding Evidence and Recommended Next Step

- Date: 2026-11-06
- Scope: user-assigned Task 217, consolidating original Tasks 270–274 only
- Diagnostic status: COMPLETED — VERIFIED
- Product status: PARTIALLY VERIFIED pending deployed-revision and authenticated active-store acceptance
- Inspected baseline: `58defb605c05cbb4b5ab61c5794b0a05674f1593`

## Diagnosis

Task 216 supplied the operational briefing and a verified-finding handoff, but it did not project the complete priority answer: deterministic selection, a defensible no-priority result, inspectable supporting evidence, explicit limits, and a merchant-executable next step. Rev could carry an investigation ID while a stale or invalidated finding still depended on the raw `evidence.verified` flag at the browser boundary. Existing finding types also did not include refund-transaction deterioration, so the required verified-refund scenario could not be supported honestly.

The implementation reuses Tasks 202–211 rather than creating a parallel insight engine. `finding-priority-v1` remains the canonical order: severity, freshness, measured-sample presence, last verification, then stable finding ID. Confidence and coverage affect eligibility and explanation, not an invented numeric business-impact score. Equal severity/freshness/sample candidates are explicitly disclosed as a tie even though stable IDs make presentation deterministic.

## Contract and eligibility

`command-center-priority-finding-v1` is an additive projection inside `command-center-v1`. It carries ownership, lifecycle, severity, typed observations, reporting/comparison windows, source and coverage references, duplicate provenance, validity, freshness, confidence rationale, claim-specific limitations, and `rev-recommendation-v1`. `priority_selection` exposes the method, eligible count, tie and exclusions. Rev handoff retains `rev-selected-finding-v1` and revalidates the finding by exact ID.

Only active open/acknowledged, evidence-verified, current, sufficiently covered findings are eligible. Stale, failed, unknown, resolved, invalidated, superseded and unsupported candidates fail closed. Eligibility is assessed before dedupe selection so a malformed duplicate cannot displace its valid representative. No finding, transaction or metric is created for demonstration.

## Required scenarios

- **A, verified refunds:** successful `order_transactions` are aggregated by transaction date, with certified order coverage, complete refund-domain sync and same-currency positive comparison baseline. Advice concerns affected orders/products/recorded reasons; no cause or recovery value is inferred.
- **B, inventory limits:** a missing inventory history is a local limitation, not evidence of a stockout and not a reason to discard valid order evidence.
- **C, stale evidence:** stale findings leave current priority, remain distinguishable as historical exclusions and show `stale_unreverified`; no old condition is presented as current.
- **D, incomplete orders:** revenue/refund comparisons are withheld unless the relevant certified windows and source sync are complete.
- **E, competing findings:** deterministic canonical ordering and disclosed ties replace severity-first-without-validity or a fabricated score.
- **F, duplicates:** one eligible representative is displayed; duplicate IDs remain inspectable and stores never merge.
- **G, no defensible priority:** an honest empty state states that absence of a priority is not proof of absence of problems.
- **H, changed before Rev:** ownership, current lifecycle and current evidence are checked again; Rev displays backend validity/freshness/confidence/limitations and can withhold the investigation.

## Security and UX

Command Center and finding-detail access remain authenticated and organization/store scoped. No browser-supplied tenant identity or source query is accepted. Source references are IDs and timestamps, not raw payloads, access tokens or customer records. Recommendations are read-only and have no execution action. Progressive disclosure uses native keyboard-accessible summaries; metadata wraps and grids collapse on narrow screens. Existing Task 216 hierarchy and design tokens remain intact.

## Production preflight

Read-only inspection of the active organization/store found no current trusted coverage/finding suitable for a supported priority. The defensible expected result is therefore the no-priority state, not a fixture-generated alert. This is not authenticated browser acceptance.
