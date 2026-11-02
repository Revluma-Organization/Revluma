# Execution status — Rev Intelligence release candidate

Updated: 2026-11-01
Branch: `arena/bbc48aa5-revluma` (base `93d9d42` on `main`)
Scope: Rev Intelligence release candidate — streaming conversation, evidence contract,
financial integrity, read-only guarantees, dashboard workspace.

This file supersedes stale statements in `docs/rev-intelligence/PHASE-STATUS.md` for the
work described below. Existing roadmaps and task IDs are preserved; nothing here renumbers
or deletes a task. Where a phase is not verified, it stays unverified.

## 1. What is verified now

### 1a. CI — pull request #236 (all checks pass)

PR: https://github.com/Revluma-Organization/Revluma/pull/236
Branch `arena/bbc48aa5-revluma`, commit `19ddba0`.

| Check | Run | Conclusion | Steps observed |
| --- | --- | --- | --- |
| Backend test suite (`backend-tests.yml`) | [41364603543](https://github.com/Revluma-Organization/Revluma/actions/runs/41364603543) | **pass** | `npm ci` (Prisma generate), `npm test` — the Prisma-backed suites execute here |
| backend (`backend-refresh-regression.yml`) | [41364603470](https://github.com/Revluma-Organization/Revluma/actions/runs/41364603470) | **pass** | `node --check authController`, `npm test` |
| python-regressions (`rev-python-tests.yml`) | [41364603644](https://github.com/Revluma-Organization/Revluma/actions/runs/41364603644) | **pass** | `compileall`, Gemini/routing regressions, full `pytest tests` on **Python 3.11.9** |
| dashboard (`dashboard-auth-regression.yml`) | [41364603544](https://github.com/Revluma-Organization/Revluma/actions/runs/41364603544) | **pass** | `npm ci`, full `vitest run`, production build |
| task025–task032 isolated reconciliation workflows | individual runs | **pass** | 8/8 |
| Vercel preview | PR deployment | **pass** | Preview build only; no production deployment |

Note: CI job **logs** could not be downloaded from this sandbox (`results-receiver.actions.githubusercontent.com`
is not reachable); the conclusions and per-step results above were read from the GitHub API
(`repos/.../actions/jobs/:id`). Test counts on CI are therefore asserted by step success, not by
a quoted log line.

### 1b. Local evidence

| Area | Evidence | Result |
| --- | --- | --- |
| Python test suite | `DATABASE_URL=postgresql://u:p@localhost:5432/revluma_test pytest python/tests -q` on Python 3.11.2 | **612 passed, 3 skipped** |
| Node gateway unit/contract suites | `node src/services/__tests__/revStream.test.js` | **3 passed** |
| | `node src/services/__tests__/financialIntegrity.test.js` | **6 passed** |
| | `node src/services/__tests__/revInvestigation.contract.test.js` | **7 passed** |
| | `node src/services/__tests__/revUpstreamStream.test.js` | **7 passed** |
| | `node src/tests/shopifyRefundTotals.test.js` | **5 passed** |
| Dashboard test suite | `npx vitest run` | **19 files, 120 tests passed** |
| Dashboard production build | `npx vite build` | **succeeded** (`dist/assets/index-*.js` ≈ 1.03 MB) |
| Dashboard type check | `npx tsc -p tsconfig.app.json --noEmit` | 17 pre-existing errors in unrelated pages; **0 in Rev files** |

The placeholder `DATABASE_URL` above is a **placeholder**. It proves the suites do not need a
live database; it does **not** prove anything about a live database. The CI backend job is
different: it installs Prisma Client and runs the same `npm test`, so those suites do have
executed evidence now.

## 2. What is not verified

- **Backend `npm test` still cannot run locally.** Prisma Client is not installable in this
  sandbox (`binaries.prisma.sh` blocked; `@prisma/client-runtime-utils` missing), so any module
  that imports `prisma` fails at require time. CI now covers it (see 1a), but a developer
  working offline still cannot run the Prisma suites without a Prisma install.
- **CI test counts are not recorded.** The jobs pass; their log files are unreachable from this
  environment, so the exact number of executed tests on CI is unknown.
- **No live Postgres / Supabase verification.** Migrations were written but never applied.
- **No staging or production deployment, and no Shopify merchant-flow test** with a real store.
- **Python 3.11.9 was not available locally** (interpreter is 3.11.2). The CI workflow is now
  pinned to `3.11.9` so the certified interpreter is the one that gates merges.
- **Streaming was not exercised end-to-end** (browser → Node → Python → SSE) because that needs
  a live Python service and a connected store.

## 3. Phase status (same numbering as `docs/rev-intelligence/PHASE-STATUS.md`)

| Phase | State | What changed this cycle | What is still missing |
| --- | --- | --- | --- |
| 01 — Foundation and provider reliability | IN_PROGRESS | Lazy DB engine (import no longer dies on empty `DATABASE_URL`), CI green on PR #236 with Python pinned to 3.11.9 | Live provider HTTP evidence |
| 02 — Natural conversation | PARTIALLY COMPLETED | SSE streaming endpoint, cancel, retry-without-duplicate-turn, titles, history search; CI green | Live streaming run; browser-level test |
| 03 — Merchant intelligence | PARTIALLY COMPLETED | Merchant context builder, timezone/window semantics, coverage + freshness surfaced | Live-store verification |
| 04 — Grounded research | PARTIALLY COMPLETED | Evidence contract, attribution validator, hypotheses/unknowns separated | Live-provider narrative run |
| 05 — Memory | PARTIALLY COMPLETED | Scoped context window + invalidatable memory on verified investigations | Live DB verification |
| 06 — Diagnosis | PARTIALLY COMPLETED | Facts vs hypotheses vs unknowns, confidence basis, read-only recommendations | Acceptance review |
| 07 — Actions and proactive intelligence | PARTIALLY COMPLETED | Read-only guard (`execute` → 403) on chat and stream; findings/briefing reuse | Proactive pipeline run against a real store |
| 08 — UX and production certification | PARTIALLY COMPLETED | Conversation-first workspace, dark rail, evidence drawer, streaming states | Staging certification |

## 4. Blockers to calling this release candidate "complete"

1. ~~One green CI run of `backend-tests.yml`, `rev-python-tests.yml` and
   `dashboard-auth-regression.yml` on this branch.~~ **Closed** — all checks pass on PR #236.
2. A staging database with the `20261101120000_rev_financial_integrity` migration applied.
3. A Shopify test store to verify order/cart ingestion, refund reconciliation and currency
   capture with real webhooks.
4. A deployed Python service to exercise streaming, timeouts and cancellation end-to-end.

`docs/execution/STAGING-VERIFICATION-RUNBOOK.md` gives the exact commands and pass criteria for
closing blockers 2–4, including the Shopify webhook scenarios (refund, cancel-then-delayed-create,
currency capture) and the eight-step streaming check.

Until those exist, the status stays PARTIALLY COMPLETED for every phase above. CI alone does not
verify merchant-facing behaviour.

## 5. Constraints honoured

- Read-only release: no store mutation path was added; `execute: true` is rejected on both
  `POST /rev/chat` and `POST /rev/stream`.
- No new database, no orchestration framework, no agent-to-agent messaging.
- The LLM remains a narrator only: numbers come from tools and the evidence contract.
- No production deployment, migration, or configuration change was performed.
