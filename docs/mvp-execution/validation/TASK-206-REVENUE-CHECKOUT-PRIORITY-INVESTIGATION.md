# Task 206 — validation record

Date: 2026-11-07. Branch: `arena/765f4bee-revluma`. Baseline `215f7d48` (main,
includes Tasks 197–204). Consolidates original Tasks 221–223. Decision:
REV-DEC-0018. Implementation:
`implementation/TASK-206-REVENUE-CHECKOUT-PRIORITY-INVESTIGATION.md`.

## Local regression evidence

- Focused Python (Task 206 suites + the finding-window regression): **140 passed** —
  `test_rev_finding_prioritization.py` 16, `test_rev_product_comparison.py` 11,
  `test_rev_value_decomposition.py` 10, `test_rev_intent_routing.py` 46,
  `test_rev_epistemic_pipeline.py` 15, `test_rev_investigation.py` 28,
  `test_rev_investigation_scenarios.py` 13,
  `test_task_202_evidence.py` +1 regression (invalid recorded measurement window
  degrades instead of crashing the findings tool).
- **Post-integration focused (this branch, rebased onto main `55b25cf` with
  Tasks 205/207/208): 233 passed** — the 140 above plus the Task 205 guardrail
  suite (`test_task_205_guardrails.py`), the Task 207 outcome suite
  (`test_task_207_investigation_outcomes.py`) and the Task 208 specialist
  suite (`test_task_208_specialists.py`, 40 scenarios) now running together
  green. The first integration run (onto `8b5477c`) produced 44 failures
  (Task 205 guardrails rejecting Task 206's derived claims; Task 207's
  capability gate preempting the findings-intent priority question) — both
  resolved per the integration section of the implementation report;
  the Task 208 rebase (onto `55b25cf`) re-applied with only the expected
  `last_specialists`/`last_priority` context-window unions; re-run clean.
- Full Python suite (fresh venv, no local PostgreSQL): **1957 passed,
  11 skipped, 4 failed** (post-integration, incl. the Task 208 specialist
  suite) — the 4 failures are the pre-existing
  `DATABASE_URL`/PostgreSQL environment failures
  (`test_api.py::test_compute_session_features_rejects_invalid_events_before_database`,
  `test_api.py::test_automation_releases_process_lock_when_database_open_fails`,
  `test_db_diagnostics.py::test_diagnostics_reports_pool_geometry_and_gate_counters`,
  `test_db_diagnostics.py::test_diagnostics_survives_an_exception_from_the_activity_read`),
  **reproduced byte-identical on a clean `main` worktree** — environment
  limitation, not a regression.
- Golden set (merge gate, spec §10): **all gates at 100%** — the routing change
  was initially too broad (6 orientation prompts reclassified as findings);
  fixed by narrowing the FINDINGS priority pattern to actionable phrasings
  (collocation rule for "most important"; orientation phrasings restored to
  OVERVIEW) — the golden set itself was not modified.
- Node focused (17 rev test files): **185 passed, 0 failed** (post-integration
  onto `55b25cf`; 173 on the pre-rebase baseline) — includes the 3 boundary
  contract files exercising the 4 new Task 206 validators
  (`revInvestigation.contract.test.js`, `revPersistence.contract.test.js`,
  `revInvestigationContract.test.js`), the Task 205 `revClaimGuardrails.test.js`
  and Task 207 `revInvestigationOutcomes.test.js` suites, the Task 208
  specialist validation, and the full rev service/test surface.
- `node --check` clean on all modified Node files (`mlService.js`,
  `revController.js`, `revClaimGuardrails.js`); Python `ast.parse`/
  `compileall` clean on all modified modules; `git diff --check` clean.
- `git diff --check` clean.
- Full `npm test` stops at the pre-existing prisma-client environment failure
  (`auth.twofactor.test.js` — `prisma generate` network-blocked in the sandbox,
  documented since Task 198); the targeted rev suite above is the authoritative
  local Node evidence, as in Tasks 201–204.

## Acceptance evidence (scenario → test)

All twelve scenarios run through the REAL conversation pipeline
(`run_investigation` + FakeDB labelled synthetic fixtures; no model — the
deterministic path is what runs in production when the provider is
unavailable): `tests/test_rev_investigation_scenarios.py`.

| # | Acceptance scenario | Evidence |
|---|---|---|
| A | Revenue drop is compared, not invented | `test_a`: current vs previous recorded value per currency; the decline is stated as the recorded change; no cause asserted |
| B | "What caused most of the decline?" → volume vs value | `test_b`: decomposition present from the reused context window; count/value effects sum to the recorded change; driver named; contribution is not called a cause |
| C | "Which product contributed most?" → contribution, not cause | `test_c`: top product-line `product_recorded_value_change` with current/previous evidence ids; text says contribution, never cause |
| D | Abandonment reasons are not invented | `test_d`: hypotheses carry `verified: false`; "the reason a shopper abandoned is not recorded" in unknowns |
| E | Incomplete checkout value is exposure, not lost revenue | `test_e`: `abandoned_checkout_recorded_value` framed as recorded value; no `lost $N` claim (outcome-claim patterns) |
| F | "Has abandonment gotten worse?" uses comparable periods | `test_f`: resolved comparison window fully precedes the reporting window with **equal elapsed time** (month-to-date → same local-calendar portion of the previous month); recorded deterioration surfaces (8 vs 4 abandoned; 400.00 vs 200.00 recorded value); no fabricated cause. Also fixed here: the checkout reference regex false-positive on "checkout a…" that silently switched aggregate questions to record drill-down |
| G | "What should I fix first?" → defensible, executable recommendation | `test_g`: ranked real finding at the top; every exclusion named; read-only next step ("Nothing has been changed or sent."); no invented severity |
| H | Challenge: "why is that more important than the refund issue?" | `test_h`: `priority_comparison.matched`; the two actual findings compared on the documented ranking slots; `ranking_changed` correct |
| I | Insufficient history → no invented comparison | `test_i`: zero-previous-window states as unavailable/named reasons, never a fabricated percentage or baseline |
| J | No valid findings ≠ fake priority | `test_j` (×2): `no_valid_findings` with reason — `verified_no_open_findings` ("verified-healthy" copy) and `stale_findings_require_reverification` (stale finding excluded, reason surfaced); no ranked item exists |
| K | Follow-up continuity reuses the recorded context | `test_k`: second question inherits the period + `last_priority`; the answer is consistent with the first (same top, `priority_change` absent) |
| L | Invalidated top is not presented as current | `test_l`: the stale recorded top is excluded; a different finding is now top; `priority_change` emitted with reason + statement; "## How this differs from what I told you before" rendered |

Boundary (Node) evidence: the 4 new validators reject each fabrication class
(wrong method version, rank gap, unknown exclusion reason, missing driver
fields, unsupported-without-reason, evidence id not in the response, missing
change note fields) and accept the documented shapes;
`_boundedResultForPersistence` carries the four new blocks into both SSE
`final` and persisted content (capped, well-formed-only — same pattern as
`last_claims`).

## Production evidence

- Both backend services (Node API + Python intelligence) are deployed to
  Render (user-confirmed 2026-11-07); the Frontend/dashboard deploys via
  Vercel. Post-merge deployment identity verification (Render services +
  Vercel revision at the merge commit) is the remaining step for this record.
- Live-store end-to-end acceptance remains the human runbook step (consistent
  with Tasks 201/203/204).
