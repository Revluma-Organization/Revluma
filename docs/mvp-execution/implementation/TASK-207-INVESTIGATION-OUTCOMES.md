# TASK 207 — Implementation: investigation outcomes

**Consolidated Task:** 207 (original Tasks 224–226)
**Status:** implemented and locally/CI validated; production acceptance pending until deployed revision and authenticated conversations are verified.

## Contract

`rev-investigation-outcome-v1` distinguishes all 18 requested outcomes: success/partial success; insufficient history/coverage; disconnected, required/expired/insufficient authorization; in-progress/stale/failed sync; source/retrieval failure; unsupported capability/question; ambiguity; invalid request; and internal error.

The bounded outcome includes question/intent, tenant/store scope, required/available/unavailable domains, integration and authorization state, sync/retrieval diagnostics, coverage/freshness, requested and certified historical windows, comparison eligibility, answerability, next step, retry state and a non-reversible `REV-…` diagnostic reference. Raw exceptions, tokens, stack traces and infrastructure details are excluded.

## Behavior implemented

- `python/src/intelligence/investigation_outcomes.py` composes existing integration/evidence-quality authorities; it is not a second integration or capability registry.
- Deterministic pre-model capability decisions cover advertising/analytics/social/competitor data, external payment providers, unsupported forecasting, guarantees, definitive causation, purchase intent, unrelated general knowledge and ambiguous comparison periods.
- Read-only detection now covers pricing, inventory, messaging and other Shopify writes. No action is executed and no success is implied.
- Integration/tool failures preserve independent evidence. Permanent permission/unsupported failures are not retryable; transient network/rate-limit/API/database/scheduler classes are eligible without starting or duplicating a sync.
- Certified coverage now carries earliest/latest observation metadata. History is not inferred from OAuth age or earliest returned row. Current observations remain available when only comparison history is insufficient; verified zero remains distinct from missing, unknown or partial coverage.
- The runtime attaches outcomes to early responses, tool investigations, unsupported actions/questions and no-store/retrieval failures. Structured safe logs include investigation/correlation, intent, domains, integration/sync/history state, outcome and retry eligibility.
- Conversation context retains the original question, period and missing evidence for retry/reconnection/narrower-period follow-ups. Every follow-up retrieves authoritative current state. Long-term merchant memory excludes the raw question and failure diagnostics.
- Node independently validates outcome shape, tenant and safe diagnostics before JSON/SSE/persistence. Ordinary JSON chat now uses the same investigation runtime as SSE; the existing image path remains compatible.
- Transport retry eligibility is truthful, retrying an already completed/permanently failed turn is rejected, and persisted history retains the outcome.

## Tests

- `python/tests/test_task_207_investigation_outcomes.py`: adversarial and actual-runtime tests across integration failures, history/coverage, unsupported questions/actions, JSON/SSE, tenant safety and continuity.
- `Backend/src/services/__tests__/revInvestigationOutcomes.test.js`: independent contract, tenant, secret and retry validation.
- Existing investigation/stream/lifecycle fixtures updated for the required envelope.

Local full regression: **1,870 passed, 11 skipped**; Backend **86 test files passed**; Dashboard production build passed (2,881 modules). PostgreSQL tests that require a live server remain skipped locally and must run in CI. MLflow dependency ABI/deprecation warnings are non-blocking test-environment warnings, not production verification.

## Remaining acceptance boundary

Merge/deploy/revision identity and authenticated production behavior on `revluma-test-store-v1.myshopify.com` are separate acceptance evidence. No local mock or synthetic result is treated as production proof. Unsupported external advertising, analytics, social, competitor, payment-provider, validated forecasting, guaranteed outcomes and write execution remain honestly unsupported.
