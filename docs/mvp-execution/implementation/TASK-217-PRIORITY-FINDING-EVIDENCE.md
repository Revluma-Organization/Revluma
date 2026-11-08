# TASK 217 implementation — Priority Finding Evidence and Recommended Next Step

- Date: 2026-11-06
- Scope: original Tasks 270–274; no Task 218 work
- Database migration: none
- Status: IMPLEMENTATION COMPLETE; production acceptance pending

## Changes

- Added `Backend/src/services/priorityFindingService.js`: deterministic eligibility-aware ranking/deduplication, freshness, certified coverage, confidence rationale, lifecycle validity, observations, provenance, limitations and typed read-only recommendations.
- Extended `commandCenterService.js` with `priority_finding`, `priority_selection`, exclusions and lower-priority findings while retaining `command-center-v1` and the Task 216 briefing.
- Added `refund_increase` detection/aggregation using successful `order_transactions`, transaction-date windows, certified order coverage and complete refund synchronization. Repository refresh supports the new type.
- Extended Python selected-finding evidence with bounded tenant-scoped refund transaction retrieval and scalar evidence; aligned refund recommendations across Node/Python.
- Strengthened Rev finding detail with store ownership and backend currentness/confidence/freshness/limitations; `RevIntell.tsx` consumes those values rather than trusting only `evidence.verified`.
- Added typed Dashboard contracts and progressive disclosure for observations, rationale, confidence, limits, provenance, next step, validation, ties and historical exclusions.
- Added 71 priority-service scenarios, refund detector/aggregator regressions, Python evidence/tenant/ranking/recommendation fixtures and 16 Task 217 Overview UI scenarios within the existing suites.

## Intentional limits

There is no numeric confidence percentage, estimated recoverable revenue, causal diagnosis, automatic action or generic recommendation for an unknown finding type. A finding may be current while inventory history remains unavailable; the limitation stays attached to that claim. Refund evidence describes observed refund value/count, not fraud, product quality or a guaranteed recovery.

## Verification before delivery

- Focused Node priority/Command Center/refund suites: **113/113 passed**.
- Dashboard Overview + Rev Intelligence: **155/155 passed**.
- Full Python: **2,336 passed, 11 skipped** with a non-connecting test `DATABASE_URL`; skipped tests and mocks are not production database proof.
- Dashboard production build and TypeScript no-emit: **passed**. Existing large-chunk and React Router/`act(...)` warnings remain.
- `git diff --check`: **passed**.
- Full local backend runner remains environment-blocked because Prisma client generation attempts to download its schema engine from `binaries.prisma.sh`, which is outside the sandbox allowlist. Focused suites ran independently; CI must supply the full-suite result.

## Delivery and acceptance

PR #371 merged as `4ac2a3386bf1d05e58e375afe429f67ea502688a` after all required CI passed. A minimal Task 215 test-isolation correction was required: its running-job fixture had become stalled relative to wall time and also reused an earlier idempotency key; production code was unchanged. Deployment identity and authenticated active-store results are recorded in the validation report as they occur. Local tests and a merge do not certify production behavior. No active-store fixture was inserted and no write action was added.
