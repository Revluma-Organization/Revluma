# Revluma MVP engineering execution

This is the execution-history index for the approved 406-task MVP backlog. Source code, tests, database metadata and deployment evidence remain authoritative for current behavior. A completed audit does not certify the audited feature. Read the [audit register](audit-register.md), [approved backlog](backlog.md) and [decisions](implementation-decisions.md) before subsequent work.

## Approved phases

1. Reliable Data Foundation.
2. Operational Intelligence.
3. Rev Intelligence.
4. Command Center & Integrations UX.
5. Production Validation.
6. Controlled Beta Launch.

The MVP remains Shopify-only with Integrations, Command Center and Rev Intelligence workspaces; evidence-backed read-only operational intelligence follows observe → verify → detect → investigate → prioritize → advise → monitor. This history does not authorize autonomous campaigns, advanced attribution/CRM or extra platforms.

## Reports and lifecycle

- `diagnostics/TASK-NNN.md`: architecture, diagnosis and coverage audits.
- `validation/TASK-NNN.md`: scoped behavioral/runtime validation.
- `implementation/TASK-NNN.md`: assigned code/schema work and verification.

Directories acquire reports only when work exists; no placeholder task reports. Task sequence numbers follow backlog.md; they do not imply completion.

Normal lifecycle: **NOT STARTED → IN PROGRESS → COMPLETED — VERIFIED**. Other states: **BLOCKED**, **PARTIALLY VERIFIED**, **ALREADY IMPLEMENTED — VERIFIED**. A report may distinguish completed diagnostic work from partially verified product behavior. Missing earlier evidence is recorded verbatim as **REPORT UNAVAILABLE — PRIOR EXECUTION NOT VERIFIED**; this does not assert the task never happened. Imported reports retain their original PASS/PARTIAL/FAIL verdicts and inspected SHAs.

Finding states: OPEN, UNDER INVESTIGATION, READY FOR IMPLEMENTATION, IN PROGRESS, RESOLVED — CODE, RESOLVED — VERIFIED, ACCEPTED LIMITATION, SUPERSEDED. Stable REV-FIND-NNNN identifiers must never be reused. Merged code alone is insufficient for RESOLVED — VERIFIED.

## Evidence and maintenance

Every finding needs the inspected commit, file/function and relevant lines or immutable source link, actual test name/result, and applicable PR/deployment/database/runtime evidence. Clearly distinguish declared schema, committed migrations, connected database metadata and production behavior. An unexecuted test is not passing; mocks are not DB proof. Missing coverage is not proof of a production defect.

Record what changed, why, what was verified and what remains unknown. Preserve original reports and observations. Add dated follow-ups or resolution evidence rather than silently rewriting historical conclusions. Link later implementation/validation back to its originating REV-FIND ID and diagnosis. Revalidate older claims against the current revision. If current evidence contradicts an older report, retain both and explain the supersession. Do not mark a historical report recovered merely because its task prompt exists.

## Mandatory future implementation protocol

1. Read the assigned ID, exact requirement and approved scope.
2. Retrieve the audit register, relevant diagnostic/validation reports, decisions and earlier implementation reports.
3. Revalidate current code and production alignment; do not assume previous findings still hold.
4. Determine the minimum necessary change: existing functionality, demonstrated defect/missing safeguard, affected files, tests and any migration needs.
5. Implement only the assigned task; preserve unrelated working behavior and locked MVP scope.
6. Verify with applicable unit/integration/regression, type/build, security and data-integrity checks. Local results do not certify production.
7. Record files, commit/PR, exact test commands/results, deployment state, production evidence and limitations.
8. Update the task report, audit register, findings and applicable implementation decisions; preserve history.
9. Stop. Identify the next task without beginning it.

If the requirement is already correctly implemented **and verified**, do not rewrite it: record evidence, mark ALREADY IMPLEMENTED — VERIFIED, update the register and stop. Merge, deploy and infrastructure changes require explicit authorization and completed required checks; finishing an implementation does not grant that authorization.

## Initial consolidation

TASK-008 and TASK-009 were imported from their existing execution reports, preserving original contents/statuses. Both originally reported PARTIAL. Provenance and prior unavailable reports are indexed in the audit register. TASK-001–007 reports were not recovered; their prompts/conversation mentions are not substitutes for execution evidence. Earlier investigations were not repeated.

This initial documentation branch changes only this directory. Production remains unchanged. See TASK-010 for commands, results, commit delivery limitations and the distinction between audit completeness and product test coverage.

## 2026-10-30 follow-up

The user supplied the earlier report export and explicitly authorized publishing the documentation to GitHub main. Reports TASK-002 through TASK-007 are now separated under diagnostics/, alongside 008–010. Task001 was not included and remains marked report unavailable. Earlier consolidation/publication limitations are preserved as history, not current instructions. The main publication changes documentation only; it does not authorize unrelated application or infrastructure changes. Connected Git integrations may react automatically to publication; no manual deployment is part of this change.

## 2026-11-07 Task 202 follow-up

Task 202 consolidates the authorized original Tasks 202–206 without starting later work. Its [diagnosis](diagnostics/TASK-202-FINDING-PRODUCT-TEMPORAL-EVIDENCE.md), [implementation record](implementation/TASK-202-FINDING-PRODUCT-TEMPORAL-EVIDENCE.md) and [validation record](validation/TASK-202-FINDING-PRODUCT-TEMPORAL-EVIDENCE.md) cover lifecycle-aware finding evidence, product/variant/inventory/order-line identity and deterministic merchant-calendar comparisons. Local tests do not establish production behavior; deployment identity and authenticated read-only verification on the active test store remain required before a production-complete status.

## 2026-11-07 Task 207

Task 207 consolidates original Tasks 224–226. Its [diagnosis](diagnostics/TASK-207-INVESTIGATION-OUTCOMES.md), [implementation](implementation/TASK-207-INVESTIGATION-OUTCOMES.md) and [validation](validation/TASK-207-INVESTIGATION-OUTCOMES.md) record the versioned investigation outcome contract, integration/retry distinctions, certified history/comparison eligibility, unsupported-question policy, JSON/SSE/Node parity and continuity. Production acceptance is not inferred from local tests or a merge; deployed revisions and authenticated active-store behavior must be verified separately.

## 2026-11-07 Task 208

Task 208 consolidates original Tasks 227–229. Its [diagnosis](diagnostics/TASK-208-INTELLIGENCE-SPECIALISTS.md), [implementation](implementation/TASK-208-INTELLIGENCE-SPECIALISTS.md) and [validation](validation/TASK-208-INTELLIGENCE-SPECIALISTS.md) record the executable specialist contract, revenue metrics, retention populations/cohorts, operational evidence, coordination, persistence decision and 40-scenario acceptance suite. Production success is not inferred from tests, a merge or deployment trigger; deployed revisions and authenticated active-store behavior remain separate evidence.

## 2026-11-07 Task 212

User-assigned Task 212 consolidates original Tasks 246–251 without starting Task 213. Its [implementation](implementation/TASK-212-AI-FAILURE-HANDLING-INTELLIGENCE-REGRESSION.md) and [validation](validation/TASK-212-AI-FAILURE-HANDLING-INTELLIGENCE-REGRESSION.md) records cover bounded failure/deadline contracts, strict output, deterministic safe partial results, canonical repeats, typed long-conversation context, privacy-safe observability and exactly 110 deterministic regression scenarios. This user-assigned number is distinct from the older backlog item 212 already consolidated into Task 204. Local tests, merges, `/ready` and deployment state do not replace authenticated active-store acceptance.

## 2026-11-08 Task 216

Task 216 consolidates original Tasks 265–269 and begins Phase 4 without starting Task 217. Its [diagnosis and UI/reference study](diagnostics/TASK-216-COMMAND-CENTER-OPERATIONAL-BRIEFING.md), [implementation](implementation/TASK-216-COMMAND-CENTER-OPERATIONAL-BRIEFING.md) and [validation](validation/TASK-216-COMMAND-CENTER-OPERATIONAL-BRIEFING.md) record the authenticated business-state briefing, supported UTC-day metrics, verified finding navigation, per-resource freshness and explicit unknown/stale/partial states. Local tests and production snapshot preflight are green; deployed revisions and authenticated active-store/browser acceptance are tracked separately and are not inferred from implementation.

## 2026-11-06 Task 217

Task 217 consolidates original Tasks 270–274 without starting Task 218. Its [diagnosis](diagnostics/TASK-217-PRIORITY-FINDING-EVIDENCE.md), [implementation](implementation/TASK-217-PRIORITY-FINDING-EVIDENCE.md) and [validation](validation/TASK-217-PRIORITY-FINDING-EVIDENCE.md) record deterministic fail-closed priority selection, progressive evidence disclosure, certified refund-transaction deterioration, read-only next steps and exact Rev revalidation. Local focused Node, full Python, Dashboard tests/build and TypeScript are green. PR #371 passed all required CI and merged as `4ac2a338`; Vercel production deployment succeeded. Repeated Node/Python health checks still report the prior Render revision, and authenticated active-store acceptance is unavailable, so full production completion is not claimed.

## 2026-11-07 Task 214

Task 214 consolidates original Tasks 257–261 without starting Task 215. Its [implementation](implementation/TASK-214-INTEGRATION-RECOVERY.md), [diagnostic contract](diagnostics/TASK-214-integration-recovery-diagnostics.md) and [validation](validation/TASK-214-INTEGRATION-RECOVERY.md) cover deterministic lifecycle, independent registration/delivery evidence, required-resource sync, secure reconnect and shared truthful capability. Local evidence is green; CI, exact deployed revisions and authenticated active-store acceptance remain separate and pending.

## 2026-11-08 Task 218

User-assigned Task 218 (business health indicators + operational activity; distinct from the older backlog line 218 consolidated into Task 205). Its [implementation](implementation/TASK-218-BUSINESS-HEALTH-INDICATORS-OPERATIONAL-ACTIVITY.md), [diagnostics](diagnostics/TASK-218-business-health-operational-activity-diagnostics.md) and [validation](validation/TASK-218-BUSINESS-HEALTH-INDICATORS-OPERATIONAL-ACTIVITY.md) cover two read-only versioned contracts — `rev-business-health-v1` (five indicators; business severity asserted only on complete canonical-domain coverage; absent ≠ zero; frozen documented thresholds; currency-verified money) and `rev-operational-activity-v1` (bounded 14-day, deduplicated, cursor-paginated projection of findings/lifecycle/sync outcomes; closed-code detail only) — composed as two store-scoped sections into the Task 216 Command Center as now layered by Task 217 (Business health between Business situation and Priority findings; Operational history after the activity/evidence grid; both bound to the briefing's primary store; fail-closed contract guards; no fabricated interactivity). Local evidence (final tree rebased onto `4ac2a33`): 94/94 new backend tests, full backend run 105/105 (the `task215SyncProgressApi` test 7 failure seen on intermediate rebases was a pre-existing test bug, fixed upstream by Task 217's #371), Dashboard TypeScript clean, 627/627 tests across 43 files, production build green. Decision: REV-DEC-0026. Local evidence is green; CI, exact deployed revisions and authenticated active-store acceptance remain separate and pending.
