# Task 234 — validation: Rev Intelligence architecture

**Status:** local regressions and required PR CI passed; affected-service deployment identity, incident attribution and authenticated production acceptance are not verified.

**Revision under test:** active branch `arena/29f26490-revluma`, based on `510517fb3a3af6021c16cfc2156bef0279985914`.

## Executed local checks

- Focused architecture, provider gateway, routing, investigation, failure-routing, orchestration, specialist, evidence, epistemic/recommendation, adaptive response, and Task 212 reliability tests:
  ```text
  .venv/bin/pytest -q \
    python/tests/test_task234_rev_architecture.py \
    python/tests/test_model_gateway.py \
    python/tests/test_task_202_evidence.py \
    python/tests/test_task_205_guardrails.py \
    python/tests/test_task_207_investigation_outcomes.py \
    python/tests/test_task_208_specialists.py \
    python/tests/test_task_209_question_orchestration.py \
    python/tests/test_task_211_recommendations.py \
    python/tests/test_task212_orchestration.py \
    python/tests/test_task212_reliability_matrix.py \
    python/tests/test_rev_adaptive_response.py \
    python/tests/test_conversational_routing.py \
    python/tests/test_conversational_evaluation.py \
    python/tests/test_conversational_evaluation_phase7.py \
    python/tests/test_rev_investigation.py \
    python/tests/test_rev_failure_routing.py
  ```
  **540 passed**.
- Additional focused run of the new architecture tests, provider gateway, Task 209 orchestration, conversational routing and Rev investigation: **138 passed** before the final role-name cleanup; the larger 540-test run above includes the final changes.
- `python3 -m compileall -q` on all changed Python modules and the new test module: passed. `git diff --check`: passed at the source-change checkpoint; rerun after final documentation updates before delivery.

The local test environment used a minimal dependency set. A full `python/tests` collection was attempted and did not complete because the sandbox lacked the full repository dependency set (`mlflow`, and initially `scikit-learn`); this is an environment/collection limitation, not a passing local full-suite claim. The full Python/real-PostgreSQL, Backend, Dashboard/build and Vercel PR CI checks passed on the corrected PR head as recorded below. Live-provider, authenticated browser and production Rev behavior remain untested.

## Test assertions added

- “What is Shopify?” is classified by a deterministic knowledge fast path even with prior revenue context; the classifier model is not called.
- Its real `run_investigation` execution invokes no store tool/specialist, returns no Shopify evidence, and still produces the normal chat response envelope.
- “What is my revenue?” is not captured by the general-definition fast path and still requests revenue evidence.
- Anthropic model selection uses the configured deep-role model; provider telemetry includes model, role and correlation ID without logging prompt or key.
- Anthropic rate-limit, authentication, timeout and network failures produce bounded normalized errors; raw message text and credentials do not enter the surfaced exception/log output.

## Production and release gates still open

- Obtain the original request correlation ID or a timestamp/tenant-safe incident reference; inspect the corresponding Node/Python safe logs and establish the actual failing stage/provider/model/status. No such identifier or logs were available in this run.
- Re-establish current Node and Python service revisions/configuration from Render (the connector is unsupported) and verify each affected service after any release.
- Run authenticated read-only production checks for the general Shopify definition (confirm no Shopify observation tools), a store-specific question, a contextual follow-up, stream final/persistence, and conversation history restoration/tenant rejection. Do not create synthetic production findings or mutate store data.
- Require CI and PR checks before merge. Do not mark production acceptance from local tests or the Vercel frontend deployment.

## CI feedback

The first PR check run exposed two stale test assertions that referenced the removed vendor-name constants (`responder.DEEP_MODEL` / `FAST_MODEL`) in `test_rev_analysis_fast_fallback.py`; the same test was the only annotated Python failure in both the Rev Python job and the release-candidate Python/PostgreSQL job. Updated that test to assert the explicit `DEEP_ROLE` / `FAST_ROLE` contract; the corrected test passes locally (**2 passed**). Initial run IDs: Rev Python `43471438244`, release-candidate verification `43471438246`. The corrected PR head passed Rev Python run `43472691397` and release-candidate verification `43472691396`, including the full Python suite with disposable PostgreSQL, Prisma bootstrap/schema drift, Backend tests, financial/security regressions, Dashboard suite/build, Vercel and Preview Comments. These are CI results for the PR head, not live provider or production Rev acceptance. The hosted log archive from the initial failed run was not retrievable through the sandbox's GitHub connection; the check-run annotation identified the stale test assertion, and the corrected run is green.
