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

## 2026-11-08 Task 220

User-assigned Task 220 (Tasks 286–290: mobile navigation and responsive drawer; responsive layouts
320–1920; Command Center loading/error/partial/stale; performance and observability; documentation).
Its [diagnostics](diagnostics/TASK-220-command-center-responsive-runtime-states-diagnostics.md),
[implementation](implementation/TASK-220-COMMAND-CENTER-RESPONSIVE-RUNTIME-STATES.md) and
[validation](validation/TASK-220-COMMAND-CENTER-RESPONSIVE-RUNTIME-STATES.md) make the Command Center
fail-closed and honest across every width and runtime state, frontend-only (no backend change): one
closed 11-kind failure classifier (`lib/commandCenterError.ts`) with retry only where appropriate
(`not_found` → guidance, `unauthorized` → session copy, `rate_limited` → a real `Retry-After`
countdown, no auto-retry loop); a 30s hard timeout; stale-as-last-successful-snapshot retention with
a real timestamp and a polite live region; per-panel retry + `AbortSignal` cancellation on
unmount/store change (fixing a cleanup that never aborted); a mobile drawer that overlays (not
crushes) the content and is a real accessible dialog (focus, Escape, scroll lock) below 768;
`100dvh`, global `:focus-visible`, and `prefers-reduced-motion` support. Three further defects found
during implementation are recorded in the diagnostics (F-17 a negative `Retry-After` read as "retry
now"; F-18 the Operational History panel never aborted its in-flight request; F-19 jest-dom matchers
untyped for vitest). Local evidence (tree on `d9150d6`): 110 new frontend tests (7 files) with a
≥100-row scenario-to-test mapping, full suite 737/737, `tsc` project error count 29 (all
pre-existing, none in touched files; the jest-dom typing fix took it from 749), production build
green. No browser/production access in this environment, so the 9-width device matrix is executed on
Vitest + jsdom for the JS-driven behavior + a CSS-contract audit, and the pixel-level checks are a
production-acceptance checklist. Decision: REV-DEC-0027. CI green (PR #375: `dashboard`
suite+build, `Vercel`, `Vercel Preview Comments`); merged to main as `7f40e70`; Vercel
production deployment `dpl_ED5HgrLxLgNVS5RVt83hdvotVwpo` READY/PROMOTED to `revluma.vercel.app`
from the exact merge commit. The 9-width authenticated
browser/active-store acceptance remains open (no real browser / merchant session / production
egress in this environment).

## 2026-11-08 Task 218

User-assigned Task 218 (business health indicators + operational activity; distinct from the older backlog line 218 consolidated into Task 205). Its [implementation](implementation/TASK-218-BUSINESS-HEALTH-INDICATORS-OPERATIONAL-ACTIVITY.md), [diagnostics](diagnostics/TASK-218-business-health-operational-activity-diagnostics.md) and [validation](validation/TASK-218-BUSINESS-HEALTH-INDICATORS-OPERATIONAL-ACTIVITY.md) cover two read-only versioned contracts — `rev-business-health-v1` (five indicators; business severity asserted only on complete canonical-domain coverage; absent ≠ zero; frozen documented thresholds; currency-verified money) and `rev-operational-activity-v1` (bounded 14-day, deduplicated, cursor-paginated projection of findings/lifecycle/sync outcomes; closed-code detail only) — composed as two store-scoped sections into the Task 216 Command Center as now layered by Task 217 (Business health between Business situation and Priority findings; Operational history after the activity/evidence grid; both bound to the briefing's primary store; fail-closed contract guards; no fabricated interactivity). Local evidence (final tree rebased onto `4ac2a33`): 94/94 new backend tests, full backend run 105/105 (the `task215SyncProgressApi` test 7 failure seen on intermediate rebases was a pre-existing test bug, fixed upstream by Task 217's #371), Dashboard TypeScript clean, 627/627 tests across 43 files, production build green. Decision: REV-DEC-0026. Local evidence is green; CI, exact deployed revisions and authenticated active-store acceptance remain separate and pending.

## 2026-11-08 Task 222

User-assigned Task 222 (original Tasks 295–299: verify the new-conversation control, the conversation
history list, conversation switching, conversation title display, and question-input behavior — i.e.
productionize the Rev Intelligence conversation lifecycle). Its [diagnostics](diagnostics/TASK-222-REV-CONVERSATION-CONTROLS-HISTORY-INPUT-diagnostics.md),
[implementation](implementation/TASK-222-REV-CONVERSATION-CONTROLS-HISTORY-INPUT.md) and
[validation](validation/TASK-222-REV-CONVERSATION-CONTROLS-HISTORY-INPUT.md) record that the
lifecycle is already implemented and production-grade (server-authoritative `uuidv4()` conversation
ids created on the first accepted message, org-scoped metadata-only `GET /conversations` in
activity order, URL-scoped switching with `isCurrent()`/`conversationRequestRef`/server-
`sequence_number` stale-response protection, deterministic `COALESCE(title, …)` titles, and
tenant-isolated 404/403 with ids-only logging), and fix the two genuine defects the audit found —
**frontend-only, no backend source / data model / migration / read-only boundary changed**:
**F-1** the question field was unbounded on the client while the backend silently truncated to 2000,
so a >2000-char question rendered full-length in the UI but persisted truncated (now a shared
`MAX_QUESTION_LENGTH=2000` with `maxLength`, a `send()` guard, an `aria-live` counter, and a backend
contract test asserting the client and server bounds are **equal**); and **F-2** the send control was
32px, now 44px (`h-11 w-11`) matching the adjacent controls. Local evidence (tree on `aecd054`):
6 new frontend scenarios + a new backend contract test, full suite 743/743 (129 in `RevIntell.test.tsx`),
`tsc` project error count 29 (unchanged; none in `RevIntell.tsx`), production build green, backend
contract tests pass. Decision: REV-DEC-0028. PR #377 CI all green (`Dashboard suite and production
build`, `Prisma bootstrap, financial and security regressions`, `Backend test suite`, `backend`,
`dashboard`, `Vercel` preview). No real browser / production egress / authenticated merchant session
in this environment, so the live in-browser acceptance at `revluma-test-store-v1.myshopify.com`
remains a documented production-acceptance step (covered by the Vitest + jsdom + Testing Library
suite and the CSS/responsive audit); the deployed production revision is verified via the Vercel
connector after merge.
## Task 219 — Command Center content hierarchy and visual system

Task 219 records: [diagnosis](diagnostics/TASK-219-COMMAND-CENTER-DESIGN.md), [implementation](implementation/TASK-219-COMMAND-CENTER-DESIGN.md), [validation](validation/TASK-219-COMMAND-CENTER-DESIGN.md), decision REV-DEC-0029. Scope is original Tasks 281–285 only. The evidence-first hierarchy, five-domain health presentation, shared visual tokens and dark/light shell preserve the authoritative read-only intelligence path. Integrated local evidence is 796 Dashboard tests, 174 focused backend tests before the frontend-only Task 220 integration, TypeScript, build and changed-file ESLint green. This is not authenticated active-store production certification; consult the validation report for CI/deployment and remaining browser-acceptance evidence.

## 2026-11-09 Task 223

User-assigned Task 223 consolidates original Tasks 300–304 without starting Task 224. Its [diagnostics](diagnostics/TASK-223-REV-CONVERSATION-SUBMISSION-LOADING-EVIDENCE-diagnostics.md), [implementation](implementation/TASK-223-REV-CONVERSATION-SUBMISSION-LOADING-EVIDENCE.md) and [validation](validation/TASK-223-REV-CONVERSATION-SUBMISSION-LOADING-EVIDENCE.md) records cover acceptance-safe submission, stable tenant/conversation-scoped idempotency, strict input/final-envelope validation, indeterminate event-backed investigation loading, and reuse of adaptive answers/evidence/uncertainty. The work adds 131 distinct new scenarios across Backend and Dashboard, including all nine required widths. Local Prisma generation/full Backend execution remains externally blocked by binary-host egress; All final PR checks and post-merge Backend CI passed; PR #378 merged as `5151cb1`, and Vercel `dpl_Fvq1aqAh4rn2fTvU39NCB2rj9gX2` is READY/PROMOTED from that exact revision. Production backend/migration and authenticated active-store browser acceptance remain pending. Decision: REV-DEC-0030.

## 2026-11-09 Task 225

Task 225 consolidates original Tasks 312–316. [Diagnostics](diagnostics/TASK-225-ONBOARDING-CROSS-WORKSPACE-JOURNEY-diagnostics.md), [implementation](implementation/TASK-225-ONBOARDING-CROSS-WORKSPACE-JOURNEY.md), and [validation](validation/TASK-225-ONBOARDING-CROSS-WORKSPACE-JOURNEY.md) map the canonical journey, OAuth/sync distinction, first-briefing readiness, exact finding context and safe return behavior. The work adds 177 new scenarios and reuses existing OAuth, tenant, RLS and read-only controls. Decision REV-DEC-0031. PR #381 merged as `1371597b`; all checks and post-merge Backend CI passed, and Vercel `dpl_DPLfVzRyfD8uJNBNghgvQ23Re3Wo` is READY/PROMOTED from that exact SHA. Production backend revision and authenticated acceptance on `revluma-test-store-v1.myshopify.com` remain pending; no live success is inferred from fixtures.

### Task 226 — Workspace consistency, language and accessibility (original Tasks 317–321)

[Diagnosis](diagnostics/TASK-226-WORKSPACE-CONSISTENCY-LANGUAGE-ACCESSIBILITY-diagnostics.md), [implementation](implementation/TASK-226-WORKSPACE-CONSISTENCY-LANGUAGE-ACCESSIBILITY.md) and [validation](validation/TASK-226-WORKSPACE-CONSISTENCY-LANGUAGE-ACCESSIBILITY.md) record the shared design/language contracts, all 160 required scenario categories, axe checks, full regressions and production limits. Task 226 adds 166 new passing scenarios and retains the complete three-workspace purpose and evidence model. Authenticated live workspaces, real-browser rendering and manual screen-reader acceptance remain external verification gates.
