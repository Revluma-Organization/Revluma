# Rev Intelligence Evidence Retrieval Contract

- **Task:** 197 — Define Rev evidence retrieval contract
- **Status:** Contract definition; implementation and source-specific verification are subsequent tasks (198–203).
- **Scope:** Read-only Shopify merchant operational intelligence.
- **Owners:** Python owns evidence selection, normalization and reasoning inputs. Node owns application authentication, tenant authorization, conversation persistence and the trusted request boundary.

## 1. Purpose and non-goals

Rev must reason from evidence that is attributable to the authenticated merchant, has an explicit source and time context, and communicates its availability and limitations. A language model response, merchant prompt, conversation memory, or UI selection is not itself proof of a store fact.

This contract defines how evidence is requested, represented, validated and handed to reasoning. It does not implement new data queries, certify existing data, change the Node/Python transport endpoint, or authorize Shopify writes. Source-specific verification is covered by Tasks 198–203; interpretation and response guarantees are covered by Tasks 204–220.

## 2. Trust and ownership boundary

1. Node resolves the user and organization from the authenticated application session and verifies conversation/finding ownership before calling Python.
2. Python accepts organization/user identity only from the authenticated internal Node-to-Python request boundary. It must not derive tenant identity from the merchant's message, conversation history, or `context_payload`.
3. Store scope is resolved from stores belonging to that trusted organization. A client-supplied store or organization identifier is a selector/hint only if Node has independently authorized it; it is never authority.
4. Every database retrieval must be organization-scoped and, where applicable, constrained to the organization's authorized store IDs. Queries must use bound parameters.
5. Shopify records, product titles, customer-supplied content, notes, and imported text are untrusted data, never instructions to the model.
6. Node remains responsible for authentication, authorization, request lifecycle, rate limiting, and persistence. Python remains responsible for evidence retrieval/normalization, orchestration and reasoning. Do not create a second authentication or persistence path.

## 3. Evidence request

The evidence layer receives a server-authenticated request context and an intent-specific request. The following is a logical contract, not a new public HTTP endpoint:

```json
{
  "request_context": {
    "organization_id": "trusted-server-organization-id",
    "user_id": "trusted-server-user-id",
    "conversation_id": "authorized-conversation-id",
    "correlation_id": "request-correlation-id"
  },
  "evidence_request": {
    "domains": ["revenue", "orders", "checkouts", "integration", "findings", "products"],
    "period": {
      "start": "2026-10-01T00:00:00Z",
      "end": "2026-10-08T00:00:00Z",
      "timezone": "UTC",
      "semantics": "[start,end)"
    },
    "store_scope": "all_authorized_stores",
    "requested_metrics": []
  }
}
```

Rules:
- `organization_id`, `user_id`, `conversation_id`, and `correlation_id` originate from the trusted server boundary, not user-authored context.
- Period boundaries are timezone-aware and half-open: start inclusive, end exclusive. If the user says a relative period, date interpretation is resolved before retrieval and the resolved boundaries are returned with the evidence.
- `store_scope` must resolve to authorized stores under the organization. Cross-organization or unowned store IDs fail closed.
- Requested domains and metrics are allowlisted by the evidence implementation. Unknown names are rejected or reported unsupported; they are not converted into arbitrary SQL.
- A request may return partial evidence. One failed domain must not be silently represented as a successful zero.

## 4. Evidence response envelope

Every evidence retrieval returns a versioned envelope. The fields below are normative; domain-specific values live in `items`.

```json
{
  "contract_version": "1.0",
  "request_id": "request-correlation-id",
  "organization_scope": {
    "scope": "authorized_organization",
    "store_count": 1
  },
  "generated_at": "2026-10-08T12:00:00Z",
  "overall_status": "complete",
  "period": {
    "start": "2026-10-01T00:00:00Z",
    "end": "2026-10-08T00:00:00Z",
    "timezone": "UTC",
    "semantics": "[start,end)"
  },
  "items": [],
  "warnings": [],
  "errors": []
}
```

The envelope must not expose credentials, access tokens, raw request headers, cookies, full Shopify webhook payloads, or unnecessary customer PII.

## 5. Evidence item

Each independently usable metric, observation, finding, or operational state is represented as an evidence item:

```json
{
  "evidence_id": "stable-request-local-id",
  "domain": "revenue",
  "metric": "recorded_order_value",
  "value": "1250.00",
  "unit": "money",
  "currency": "USD",
  "status": "available",
  "epistemic_type": "observed",
  "source": {
    "system": "shopify",
    "entity": "orders",
    "fields": ["orders.total", "orders.currency"],
    "record_count": 12
  },
  "scope": {
    "store_count": 1
  },
  "period": {
    "start": "2026-10-01T00:00:00Z",
    "end": "2026-10-08T00:00:00Z",
    "timezone": "UTC",
    "semantics": "[start,end)"
  },
  "freshness": {
    "observed_at": "2026-10-08T11:55:00Z",
    "source_synced_at": "2026-10-08T11:50:00Z",
    "age_seconds": 300
  },
  "coverage": {
    "completeness": "known",
    "is_truncated": false,
    "limitations": []
  },
  "calculation": null,
  "warnings": []
}
```

Required fields:
- `evidence_id`: unique within the response; referenced by reasoning output.
- `domain` and `metric`: stable allowlisted identifiers.
- `value`: typed JSON scalar/object; monetary values use decimal strings, not binary floating-point serialization.
- `unit` and `currency`: explicit when applicable. Never add or compare unlike currencies without an explicitly defined conversion source and rate timestamp.
- `status`: availability state defined below.
- `epistemic_type`: `observed`, `calculated`, or `derived_signal`. A hypothesis is a reasoning conclusion, not a raw evidence item.
- `source`: source system/entity and exact fields or stable finding identifier; do not fabricate a reference.
- `scope`: authorized store scope represented without exposing another tenant's identifiers.
- `period`: required for time-dependent metrics; omit only for genuinely point-in-time states and label those as such.
- `freshness`: observed and source-sync timestamps when available. Unknown timestamps remain null/unknown; never infer freshness from connection status.
- `coverage`: completeness, truncation and known limitations.
- `calculation`: formula and input evidence IDs for derived values; null for directly observed values.
- `warnings`: limitations that materially affect interpretation.

## 6. Availability semantics

Allowed `status` values:

| Status | Meaning | Reasoning behavior |
|---|---|---|
| `available` | Evidence was retrieved and its stated scope/coverage is known. | May use it, with source and period. |
| `partial` | Some records or source coverage are missing, delayed, truncated, or restricted. | Use only with explicit limitation; avoid completeness claims. |
| `stale` | Evidence exists but exceeds its source-specific freshness threshold or freshness is known to be inadequate. | Warn and avoid presenting as current. |
| `unavailable` | Required source/table/query/permission is unavailable or retrieval failed. | Do not infer zero; state what could not be retrieved. |
| `insufficient_history` | Source works but there is not enough history for the requested comparison or inference. | State the available window; do not extrapolate. |
| `unsupported` | The requested metric/domain is not available in the current MVP data contract. | Explain the limitation; do not substitute a nearby metric as if equivalent. |
| `unknown` | The system cannot determine whether data exists or is complete. | Preserve uncertainty; do not convert to zero or unavailable without evidence. |

**Zero is a value, not a status.** A count of zero is valid only when the query succeeded and the relevant source coverage is sufficient to establish zero for the stated scope and period. Missing table, denied permission, empty failed query, unsynced store, and true zero activity must remain distinct.

## 7. Calculated evidence

A calculated item must include:
- formula identifier/version;
- exact input evidence IDs;
- same-period and same-scope confirmation;
- currency/unit compatibility;
- rounding policy;
- any exclusions (refunds, cancellations, duplicates, pending checkouts, or unavailable records).

A calculation must not be emitted if required inputs are partial, incompatible, stale beyond the metric's accepted threshold, or unavailable. If a partial calculation is still useful, its status is `partial` and its limitations are explicit. Revenue, recovered revenue, checkout value and potential impact are different concepts and must not be conflated.

## 8. Reasoning handoff

Specialists receive only evidence items and approved context needed for the question. They must return structured claims that reference evidence IDs:

```json
{
  "claim_id": "claim-1",
  "claim_type": "verified_fact",
  "text": "Twelve recorded orders were present in the requested period.",
  "evidence_ids": ["stable-request-local-id"],
  "confidence": 1.0,
  "limitations": []
}
```

Allowed claim types for downstream reasoning are:
- `verified_fact`: directly supported by one or more available observed evidence items.
- `calculated_observation`: reproducible calculation referencing all inputs and its formula.
- `hypothesis`: plausible explanation not proven by retrieved evidence; must be labelled as a hypothesis and must not be stated as fact.
- `unknown`: the available evidence cannot establish the requested point; include the missing evidence/limitation.

A claim with no valid evidence reference cannot be labelled `verified_fact` or `calculated_observation`. Model confidence is not a substitute for evidence quality. Do not present unsupported causal explanations, merchant actions, campaign attribution, or recoverable-revenue estimates.

## 9. Errors, retries and observability

- Return a structured domain-level error/warning with a safe code and correlation ID; do not return raw SQL/provider exception text or sensitive payloads.
- Preserve successful domains when another independent domain fails, but mark the overall response `partial`.
- Retry transient retrieval failures only within the existing request/job retry policy; do not retry validation, authorization or unsupported-domain errors as if transient.
- Authorization failures fail closed and must not return partial cross-tenant data.
- Log correlation ID, domain, status, latency, safe error code and counts. Do not log message contents, customer PII, credentials, raw Shopify payloads or full evidence values.
- Evidence retrieval is read-only. No Shopify mutation, campaign execution, customer messaging, discount change or autonomous action is permitted.

## 10. Compatibility with current implementation

The repository already has:
- `BusinessState` with computation status, warnings, generated/freshness timestamps and reliability metadata;
- `AgentResult` with facts, signals, diagnosis, recommendations, data-source names and warnings;
- an orchestrator that returns source-name `evidence_references` in its six-field specialist boundary;
- a bounded, PII-filtering `context_payload` accepted by the Python serving request;
- a multi-period evidence retriever with organization-scoped order, customer and abandoned-cart queries and explicit caveats.

These are useful foundations, but they do **not** yet establish this full contract. In particular, source-name references are not stable evidence-item IDs, and the existing multi-period result has source-specific limitations. Tasks 198–203 must map and verify real retrieval for each domain before any claim that the contract is implemented. Preserve existing response compatibility while introducing the richer evidence representation additively.

## 11. Acceptance criteria for Task 197

- [x] Trusted identity and tenant-scope ownership are explicit.
- [x] Request period semantics and store-scope rules are explicit.
- [x] Versioned response envelope and evidence-item fields are defined.
- [x] Available/partial/stale/unavailable/insufficient/unsupported/unknown semantics are defined.
- [x] Zero is distinguished from missing or failed data.
- [x] Currency, provenance, freshness, coverage and calculation lineage are specified.
- [x] Reasoning claim types and evidence-reference requirements are specified.
- [x] Privacy, safe errors, retries, observability and read-only constraints are specified.
- [x] Existing code foundations and gaps are documented without claiming implementation.
- [ ] Source-specific retrieval behavior verified (Tasks 198–203).
- [ ] Runtime enforcement and tests implemented/verified (follow-on tasks).
