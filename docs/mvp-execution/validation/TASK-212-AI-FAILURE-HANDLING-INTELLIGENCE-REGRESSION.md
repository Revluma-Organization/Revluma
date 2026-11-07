# TASK 212 — Validation: AI failure handling and intelligence regression

**Status:** implementation verification in progress; production acceptance not verified.

**Baseline:** originally `b28a77abbc2acda0fd917550d967533ac5b52fd8`; rebased onto current main `9bf9a9b` (PR #358 / Task 210) before delivery. Task 210's adaptive confidence contract is preserved, including on the new timeout path.

## Deterministic 110-scenario matrix

`python/tests/test_task212_reliability_matrix.py` asserts exactly 110 unique scenario IDs and executes production helpers. It is isolated synthetic regression evidence, not live merchant/provider evidence.

| IDs | Count | Coverage |
|---|---:|---|
| F-001–F-015 | 15 | Every failure category, safe metadata and retry policy |
| D-016–D-030 | 15 | Overall/operation remaining budgets and expiry |
| O-031–O-050 | 20 | Complete/fenced understanding output, missing fields, prose/truncation, enums/types/confidence |
| A-051–A-060 | 10 | Analysis schema, confidence, sections and non-write actions |
| R-061–R-075 | 15 | Repeat fingerprints; values, currency, status, coverage, periods and timestamp exclusions |
| C-076–C-090 | 15 | Tenant/method/context validation, bounded history, finding/claim/recommendation provenance |
| P-091–P-100 | 10 | Secret/PII-sensitive key removal without losing metric semantics |
| M-101–M-110 | 10 | Provider status-to-safe-category mapping |

Additional orchestration tests verify tenant-safe summaries, paraphrase repeat behavior without model prose, evidence-change disclosure/recalculation, overall deadline failure, one transient retry and no permanent retry. Node tests independently verify retryability, allowlisted diagnostics, timeout behavior and recommendation quarantine. Dashboard tests verify overall/initial/inactivity timeout versus Stop and failed-stage disclosure with valid evidence.

## Executed local evidence

- Post-rebase `PYTHONPATH=/tmp/revdeps:python DATABASE_URL=postgresql://test:test@localhost:5432/test python3 -m pytest python/tests -q` — **2,268 passed, 11 skipped**; warnings only.
- Post-rebase focused Node reliability + adaptive-response run — **43 passed**.
- Post-rebase full Dashboard: `npm test -- --run` — **36 files / 519 tests passed**.
- Post-rebase Dashboard production build and `npx tsc --noEmit` — **passed** (2,881 modules transformed).
- Changed-file ESLint — **0 errors**, one pre-existing `RevAnswerView` hook dependency warning.
- `git diff --check` — rerun required at delivery after the documentation updates.

The full Backend command was attempted after restoring dependencies and stops at the missing generated Prisma client. Local Prisma generation attempted to reach the blocked Prisma engine host and failed; no local real-Prisma success is claimed. CI must provide the full Backend suite and real Prisma/PostgreSQL validation. Earlier sandbox dependency-refresh failures (`speakeasy`/`vitest` missing) were environment failures and were superseded by the restored full Dashboard run above.

## Required release and production gates

- [x] Full Backend suite and real Prisma/PostgreSQL CI on code revision `874fff6`: Backend tests run `42413907939`, Backend refresh `42413907966`, and release-candidate Prisma/bootstrap/financial/security run `42413907937` all passed. This supersedes the local Prisma-engine limitation.
- [x] Full Dashboard suite, type/build and applicable security checks: Dashboard runs `42413907972` and `42413907937` passed; local TypeScript and changed-file ESLint also passed as recorded above. Python run `42413907987` passed with disposable PostgreSQL. Vercel preview check passed.
- [ ] PR review/merge identity recorded.
- [ ] Render `/ready` Node/Python exact deployed revisions and dependency state recorded; readiness alone is not behavior acceptance.
- [ ] Vercel production deployment identity and state recorded.
- [ ] Authenticated read-only checks on `revluma-test-store-v1.myshopify.com`: repeated canonical question, evidence-change correction, long-context continuation, provider/timeout/malformed-output failure injection where safely controllable, partial-domain survival, cancellation/retry and tenant isolation.
- [ ] Actual logs inspected for safe category/stage/correlation metadata and absence of prompt/secret/PII payloads.

No authenticated merchant session is available in this workspace. The active authorized store previously had zero persisted findings; no synthetic production finding may be inserted to bypass that limitation. Consequently no 100% production-completion claim is made here.
