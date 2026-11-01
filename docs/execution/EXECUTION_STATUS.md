# Execution status — Rev Intelligence release candidate

Updated: 2026-11-01
Branch: `arena/bbc48aa5-revluma` (base `93d9d42` on `main`)
Scope: Rev Intelligence release candidate — streaming conversation, evidence contract,
financial integrity, read-only guarantees, dashboard workspace.

This file supersedes stale statements in `docs/rev-intelligence/PHASE-STATUS.md` for the
work described below. Existing roadmaps and task IDs are preserved; nothing here renumbers
or deletes a task. Where a phase is not verified, it stays unverified.

## 1. What is verified now (local only)

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
live database; it does **not** prove anything about a live database.

## 2. What is not verified

- **Backend `npm test` (whole suite) cannot run locally.** Prisma Client is not installable
  here (`binaries.prisma.sh` blocked; `@prisma/client-runtime-utils` missing), so any module
  that imports `prisma` fails at require time. This is an environment limitation, not a test
  failure. CI (`.github/workflows/backend-tests.yml`, `npm ci && npm test`) is the only place
  the Prisma-backed suites can execute.
- **No CI run was observed in this session.** All results above are local.
- **No live Postgres / Supabase verification.** Migrations were written but never applied.
- **No staging or production deployment, and no Shopify merchant-flow test** with a real store.
- **Python 3.11.9 was not available locally** (interpreter is 3.11.2). The CI workflow is now
  pinned to `3.11.9` so the certified interpreter is the one that gates merges.
- **Streaming was not exercised end-to-end** (browser → Node → Python → SSE) because that needs
  a live Python service and a connected store.

## 3. Phase status (same numbering as `docs/rev-intelligence/PHASE-STATUS.md`)

| Phase | State | What changed this cycle | What is still missing |
| --- | --- | --- | --- |
| 01 — Foundation and provider reliability | IN_PROGRESS | Lazy DB engine (import no longer dies on empty `DATABASE_URL`), CI Python pinned to 3.11.9 | A recorded CI run; live provider HTTP evidence |
| 02 — Natural conversation | PARTIALLY COMPLETED | SSE streaming endpoint, cancel, retry-without-duplicate-turn, titles, history search | Live streaming run; browser-level test |
| 03 — Merchant intelligence | PARTIALLY COMPLETED | Merchant context builder, timezone/window semantics, coverage + freshness surfaced | Live-store verification |
| 04 — Grounded research | PARTIALLY COMPLETED | Evidence contract, attribution validator, hypotheses/unknowns separated | Live-provider narrative run |
| 05 — Memory | PARTIALLY COMPLETED | Scoped context window + invalidatable memory on verified investigations | Live DB verification |
| 06 — Diagnosis | PARTIALLY COMPLETED | Facts vs hypotheses vs unknowns, confidence basis, read-only recommendations | Acceptance review |
| 07 — Actions and proactive intelligence | PARTIALLY COMPLETED | Read-only guard (`execute` → 403) on chat and stream; findings/briefing reuse | Proactive pipeline run against a real store |
| 08 — UX and production certification | PARTIALLY COMPLETED | Conversation-first workspace, dark rail, evidence drawer, streaming states | Staging certification |

## 4. Blockers to calling this release candidate "complete"

1. One green CI run of `backend-tests.yml`, `rev-python-tests.yml` and
   `dashboard-auth-regression.yml` on this branch.
2. A staging database with the `20261101120000_rev_financial_integrity` migration applied.
3. A Shopify test store to verify order/cart ingestion, refund reconciliation and currency
   capture with real webhooks.
4. A deployed Python service to exercise streaming, timeouts and cancellation end-to-end.

`docs/execution/STAGING-VERIFICATION-RUNBOOK.md` gives the exact commands and pass criteria for
closing blockers 1–4, including the Shopify webhook scenarios (refund, cancel-then-delayed-create,
currency capture) and the eight-step streaming check.

Until those exist, the status stays PARTIALLY COMPLETED for every phase above, and the
17-part report records the same.

## 5. Constraints honoured

- Read-only release: no store mutation path was added; `execute: true` is rejected on both
  `POST /rev/chat` and `POST /rev/stream`.
- No new database, no orchestration framework, no agent-to-agent messaging.
- The LLM remains a narrator only: numbers come from tools and the evidence contract.
- No production deployment, migration, or configuration change was performed.
