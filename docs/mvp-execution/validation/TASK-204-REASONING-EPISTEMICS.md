# Task 204 — validation record

Date: 2026-11-07. Branch: `arena/c34b1912-revluma`. Baseline `ff0b8d71` (main,
includes Tasks 197–203 and the Task 202 follow-up, PR #345). Consolidates
original Tasks 212–216. Decision: REV-DEC-0015.

## Local regression evidence

- Focused Python (epistemics contract, epistemic pipeline scenarios,
  investigation, merchant-memory persistence): **114 passed**
  (`test_rev_epistemics.py` 51, `test_rev_epistemic_pipeline.py` 15,
  `test_rev_investigation.py` 28, `test_merchant_memory_persist.py` 20).
- Full Python suite (CI-equivalent env: placeholder `DATABASE_URL` +
  `TASK198_DATABASE_URL`): **1788 passed, 7 skipped**. The 3 remaining errors
  are the real-PostgreSQL integration tests (`test_checkout_evidence_postgres`,
  `test_revenue_evidence_postgres`) that require a reachable PostgreSQL
  server — no local server exists in the sandbox; they connect and run in CI
  on the `postgres:16` service. Reproduced locally as connection errors at
  setup only; no logic failures.
- Python `compileall` passed on all modified modules.
- Node focused: `revEpistemics.test.js` **53/53** (golden contract, 46-case
  Python/Node parity, set-level all-or-nothing, rollup parity, boundary
  extras) and `revInvestigation.contract.test.js` **19/19** (7 pre-existing +
  12 new Task 204 boundary tests) — **72 combined, 0 failed**.
- Full Node suite triage: **75 files pass**; the 8 failing files are the
  pre-existing prisma-engine-download environment failures (the sandbox
  cannot reach `binaries.prisma.sh`; `npm install --ignore-scripts` avoids the
  blocked postinstall). These files import the Prisma client and cannot load
  locally; they run in CI where `npm ci` generates the client. Not a genuine
  full-suite pass — CI is authoritative, as established in Tasks 198–203.
- Golden fixture: `python/scripts/gen_epistemic_golden.py` regenerated
  `Backend/src/services/__tests__/revEpistemics.golden.json` (46 cases + set
  case + rollup cases) deterministically; the Node parity loop consumes it
  directly, so a Python/Node divergence fails the Node test.
- `git diff --check` clean.

## Acceptance evidence (scenario → test)

| Acceptance | Evidence |
|---|---|
| A. Facts labelled as facts | S1/S4: count and money claims carry `classification: verified_fact`; merchant copy cross-checked (`assert_claims_consistent_with_text`); boundary rejects a "verified" hypothesis (`revInvestigation.contract.test.js`) |
| B. Calculated findings labelled as calculations | S4: 0.0% comparison claims are `calculated_observation` with `calculation_inputs`; false precision and zero-denominator claims rejected at the boundary |
| C. Hypotheses labelled as hypotheses | S4: shipping/payment hypothesis recorded with `candidate_causes`, no numeric value; a hypothesis carrying a value fails validation (`hypothesis_cannot_carry_value`) |
| D. Unknowns labelled as unknowns | S6/S7/S11: "cannot be determined" statements become `unknown` claims with explicit `limitation`; an unknown carrying a value is rejected |
| E. No fabricated numbers | S11: revenue tool failure → no `recorded_order_value` claim exists, warning present; validation error codes are fail-closed (unknown evidence, asserted impact without method, cross-tenant, cross-store all rejected at the Node boundary); merchant text scanned for figures that have no recorded claim |
| F. Provenance from recorded claims | S8: restated claim with preserved grade, human-readable retrieval time, no raw ISO timestamps, explicit no-re-estimation; foreign-tenant claims never presented |
| G. Corrections invalidate memory | S9: corrections pair with preserved claim id, correction recorded as `unknown`, retraction language in text, `merchant_memories … is_active = false` |
| H. Follow-up record survives boundaries | S12: `checkout_query` persisted in `last_investigation`, inherited on follow-up; `last_claims` capped at 10, well-formed-only (write- and read-time filters); Node `_boundedResultForPersistence` carries claims/epistemics/corrections into both the SSE `final` payload and persisted content |

## Production/database evidence

Not executed from this sandbox: CI (both workflows) pending; Vercel (Node)
and Render (Python) deployment verification pending after merge;
authenticated end-to-end production acceptance (a real merchant provenance
and correction conversation against the live store) is the remaining human
runbook step. No live production data was used or copied; no PII in any test.

## Not verified here

- PostgreSQL array adaptation / Prisma migration execution (no migration in
  this task — persistence uses existing jsonb columns).
- Live Shopify responses, authenticated service authorization and production
  tenant isolation (covered by CI integration paths and the production
  acceptance runbook).
