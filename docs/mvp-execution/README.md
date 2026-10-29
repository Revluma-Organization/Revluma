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
