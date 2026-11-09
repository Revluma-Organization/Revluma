# Task 223 implementation — conversation submission, loading and evidence

Status at implementation: **IMPLEMENTED — LOCAL/FINAL CI AND PRODUCTION VERIFICATION RECORDED IN VALIDATION REPORT**.

## Original-task mapping

- **300:** accessible Send/disabled behavior, strict shared validation, acceptance-safe draft/image retention, stable idempotency, safe failures/retry and concurrency.
- **301:** real SSE-only investigation stages, indeterminate compact loading, bounded cancellation/timeouts, malformed-response handling and no premature success.
- **302/303:** retained adaptive structured and concise response presentation from Tasks 205/210/212; no duplicate renderer or arbitrary confidence.
- **304:** retained validated evidence/citations/freshness/limitations/read-only recommendations from Tasks 204/207/209/210/211; strengthened transport and regression evidence.

## Changed behavior

### Backend

- `src/services/revSubmission.js` validates message type/content/bound, read-only guard and UUID `request_id`; resolves existing accepted turns; verifies owned conversations; atomically inserts one user acceptance marker; and maps persisted success/failure/in-progress replay outcomes.
- `src/controller/revController.js` uses that contract for both `/rev/chat` and `/rev/stream`. Duplicate in-progress requests return `REV_TURN_IN_PROGRESS` without invoking intelligence. Completed SSE/JSON requests replay their persisted result. Persisted failures replay safely.
- New conversations are deterministically derived from `request_id`; this closes the lost-first-response race without allowing client-selected arbitrary conversation ownership.
- Accepted unhandled failures persist a safe failed Rev row where possible.
- `prisma/migrations/20261108170000_task223_submission_idempotency/migration.sql` adds unique `(organization_id, conversation_id, role, correlation_id)`; `schema.prisma` declares the same constraint.

### Dashboard

- `RevIntell.tsx` creates a draft-scoped UUID and retains it across uncertain pre-acceptance retries. Edited/new questions use a new UUID. Draft and image clear only on `meta`, accepted persisted JSON, or valid final acceptance.
- `revStream.ts` sends `request_id`, handles CRLF framing, rejects missing/malformed final envelopes, and does not allow an error frame followed by bytes to become success.
- `InvestigationTimeline.tsx` removes compact fractional progress. It uses actual running labels or indeterminate copy and `aria-busy`.

No Python/provider changes were required. Existing response adaptation, confidence categories, evidence validation, source periods, finding continuity, numeric/date/currency guards and read-only recommendations remain authoritative.

## Tests added

Exactly **131 new scenarios** were added:

- `Backend/src/services/__tests__/revSubmission.test.js`: **47** validation, tenant/ownership, deterministic acceptance, race, replay and terminal-outcome scenarios.
- `Frontend/Dashboard/src/pages/Task223Submission.test.tsx`: **28** acceptance, stable retry, duplicate prevention, HTTP/network/malformed failures, image retention, bounds and nine full-workspace widths.
- `Frontend/Dashboard/src/lib/revStreamTask223.test.ts`: **37** transport, request scope, SSE sequencing/framing, nine HTTP statuses, malformed/missing final and terminal-error scenarios.
- `Frontend/Dashboard/src/components/rev/Task223Lifecycle.test.tsx`: **19** nine compact widths, truthful states, accessibility and evidence provenance/freshness/validation scenarios.

Existing tests were updated only where the intended contract changed: accepted drafts remain temporarily visible, uncertain image attachments are retained, request IDs are transmitted, and compact fractions are removed.

## Verification snapshot

- New focused Dashboard set: **75/75** scenarios pass (plus the separate updated upstream timeline test).
- Existing focused page/stream set: **139/139** pass.
- Backend submission/conversation/investigation focused run: **67/67** pass.
- `npx tsc --noEmit`: pass.
- `npm run build`: pass; historical chunk-size warning only.
- Full Dashboard final run: **52 files, 886/886 tests pass**.
- Full local backend run is blocked by the ungenerated Prisma client. `npm run prisma -- generate` cannot reach `binaries.prisma.sh` from this sandbox. This is not marked passing; CI must supply authoritative generation/migration/backend results.

See the validation report for final integrated counts, CI, migration and deployment evidence.
