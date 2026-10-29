# Implementation decisions

These decisions were made during authorized Task 010 documentation work; they are not invented historical product decisions. Consult and revalidate before proposing conflicting changes.

## REV-DEC-0001 — Preserve evidence before implementation

- Date: 2026-10-29 (client Africa/Lagos date).
- Task: 010.
- Problem: Diagnoses can disappear between builder sessions.
- Options: Conversation-only history; repository execution records.
- Selected: docs/mvp-execution with per-task reports, central register, stable findings and decisions.
- Justification: Task 010 explicitly authorizes and requires this system.
- Impact: Subsequent tasks reuse diagnosed evidence and avoid redundant rewrites.
- Constraints: Only this directory changes during Task 010; no application fixes or production actions.
- Affected: README.md, audit-register.md, diagnostics/TASK-010.md and imported reports.
- Verification: Documentation-only diff, valid relative links, source-backed reports, actual test results.
- Status: IMPLEMENTED — documentation; no product behavior changed.

## REV-DEC-0002 — Preserve partial and unavailable prior evidence

- Date: 2026-10-29; task 010.
- Problem: Prior task prompts are available, but not every execution report is retrievable.
- Options: Reconstruct prior reports; mark missing evidence and preserve recovered reports.
- Selected: Import Tasks 008/009 unchanged, keep original PARTIAL status, mark 001–007 REPORT UNAVAILABLE — PRIOR EXECUTION NOT VERIFIED.
- Justification: Explicit task restriction against fabricated reports and repeated investigations.
- Impact: Audit status remains honest without erasing earlier claimed work.
- Constraints: A recovered report is historical evidence, not fresh runtime certification.
- Affected: diagnostics/TASK-008.md, TASK-009.md, audit-register.md.
- Verification: Imported file hashes equal source artifacts; unavailable report paths are not fabricated.
- Status: IMPLEMENTED.

## REV-DEC-0003 — Separate helper tests from persisted reconciliation

- Date: 2026-10-29; task 010.
- Problem: Inactivity helpers and webhook-subscription reconciliation can be mistaken for purchase-matching proof.
- Options: Treat names as coverage; inspect assertions and map exact production functions.
- Selected: Record pure/mock/static tests separately; mark persisted matching, event sequence and real database invariants uncovered.
- Justification: Selected tests do not call upsertOrder/upsertAbandonedCart or the promotion job to verify business rows.
- Impact: Future Tasks 016–050 can address specific gaps without overstating existing verification.
- Constraints: No new tests/fixes/config changes in this audit; mocks cannot prove unique/FK/transaction behavior.
- Affected: diagnostics/TASK-010.md and REV-FIND entries.
- Verification: 44 selected Node runner entries pass; two Python source-check functions pass; explicit coverage matrix and execution limitations.
- Status: IMPLEMENTED — audit classification only.

## REV-DEC-0004 — Publish documentation on GitHub main and import recovered reports

- Date: 2026-10-30; related task: Task010 follow-up.
- Problem: Local-only history is unavailable to the team and future GitHub-based builders.
- Options: Keep local-only commit; publish authorized docs to main.
- Selected: Publish docs/mvp-execution/ to the live GitHub main branch, explicitly requested by the user; this supersedes the previous publication hold.
- Justification: User instruction: save inside the main live repo in GitHub and separate the supplied earlier reports.
- Impact: Repository-visible execution history with separate recovered Task002–007 records and original Task008–010 reports.
- Constraints: Task001 report is absent from the supplied export; do not fabricate it. Only docs/mvp-execution/ may change. No manual deployment or application modification.
- Affected: diagnostics/TASK-002.md through TASK-007.md, README, audit register, Task010 dated follow-up.
- Verification: Source/export boundaries, local link/secret/diff review, documentation-only GitHub commit and read-back from main.
- Status: ACCEPTED — main publication explicitly authorized; commit history records completion.
