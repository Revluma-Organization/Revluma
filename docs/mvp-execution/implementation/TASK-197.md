# TASK 197 — Define Rev evidence retrieval contract

- **Requirement:** Define Rev evidence retrieval contract.
- **Status:** COMPLETED — VERIFIED (contract/documentation definition only; runtime implementation is not claimed).
- **Repository:** Revluma-Organization/Revluma
- **Branch:** `docs/task-197-rev-evidence-contract`
- **Scope:** Establish the contract required for subsequent evidence retrieval and reasoning tasks. No application code, schema, production data, or deployment changes.

## Work performed

Inspected the current Rev request and evidence architecture, including:
- `Backend/src/controller/revController.js`: Node resolves organization from authenticated user, validates finding ownership, and owns conversation persistence/security.
- `Backend/src/services/mlService.js`: shared Node-to-Python gateway and request contract.
- `python/src/serving/api.py`: internal serving request accepts bounded `context_payload`.
- `python/src/agents/orchestrator.py`: context normalization, specialist orchestration, and six-field specialist boundary.
- `python/src/agents/base_agent.py`: current `AgentResult` structure.
- `python/src/intelligence/business_state.py`: business-state freshness/computation status and organization-scoped state.
- `python/src/intelligence/multi_period_evidence.py`: existing rolling-period evidence retrieval and its stated limitations.
- `docs/rev-intelligence/TASK-02-1-LIVE-STORE-INTELLIGENCE.md`: prior evidence quality, freshness, period and isolation gates.

Created `docs/rev-intelligence/REV-EVIDENCE-RETRIEVAL-CONTRACT.md` defining:
1. Node/Python trust boundary and tenant-scope ownership.
2. Logical evidence request contract with authorized identity, allowlisted domains, store scope and half-open time windows.
3. Versioned response envelope and normalized evidence-item schema.
4. Explicit availability states and zero-versus-missing semantics.
5. Provenance, currency, freshness, coverage and calculation lineage.
6. Reasoning claim types and mandatory evidence references.
7. Safe error, retry, logging, privacy and read-only requirements.
8. Compatibility notes mapping existing code to remaining gaps.

## Verification

- Repository source inspection: completed for the files listed above.
- Contract completeness: reviewed against Task 197 requirement and the Task 198–220 follow-on sequence.
- No runtime test was run because this task defines the contract; no runtime behavior was changed.
- No claim is made that evidence retrieval is implemented or that source-specific metrics are verified.

## Remaining work

- Tasks 198–203: verify each source/domain retrieval against real code and tests; update the contract only if evidence shows a necessary correction.
- Tasks 204–220: verify date/currency/availability semantics, evidence classification, anti-fabrication safeguards and citations.
- Runtime implementation is additive and must preserve existing Node security ownership and current response compatibility.

## Files

- `docs/rev-intelligence/REV-EVIDENCE-RETRIEVAL-CONTRACT.md`
- `docs/mvp-execution/implementation/TASK-197.md`
- `docs/mvp-execution/audit-register.md`

## Deployment

Documentation-only branch. Not merged or deployed. No production data or infrastructure changed.

**Next:** TASK 198 — Verify revenue evidence retrieval.
