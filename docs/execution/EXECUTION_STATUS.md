# Execution status — Rev Intelligence release candidate

Updated: 2026-11-02
Branch: `arena/bbc48aa5-revluma` (base `93d9d42` on `main`)
Scope: Rev Intelligence release candidate — streaming conversation, evidence contract,
financial integrity, read-only guarantees, dashboard workspace.

This file supersedes stale statements in `docs/rev-intelligence/PHASE-STATUS.md` for the
work described below. Existing roadmaps and task IDs are preserved; nothing here renumbers
or deletes a task. Where a phase is not verified, it stays unverified.

## 1. What is verified now

### 1a. CI — pull request #236 (13/13 workflows green)

PR: https://github.com/Revluma-Organization/Revluma/pull/236
Branch `arena/bbc48aa5-revluma`, **certified candidate `887ff9b`** (pushed; `origin` matches).

| Check | Run | Conclusion |
| --- | --- | --- |
| Release candidate verification (see 1e) | [41407771654](https://github.com/Revluma-Organization/Revluma/actions/runs/41407771654) | **pass**, all 21 steps |
| Backend test suite (`backend-tests.yml`) | [41407771652](https://github.com/Revluma-Organization/Revluma/actions/runs/41407771652) | **pass** |
| Rev Python regression tests (`rev-python-tests.yml`) | [41407771755](https://github.com/Revluma-Organization/Revluma/actions/runs/41407771755) | **pass** on 3.11.9 |
| Dashboard authentication regression (suite + production build) | [41407771671](https://github.com/Revluma-Organization/Revluma/actions/runs/41407771671) | **pass** |
| task025–task032 isolated reconciliation workflows | 41407771653, 41407771667, 41407771707, 41407771670, 41407771669, 41407771708, 41407771774, 41407771790 | **pass**, 8/8 |
| `backend-refresh-regression.yml` | [41407771753](https://github.com/Revluma-Organization/Revluma/actions/runs/41407771753) | **pass** |

Note: CI job **logs** still cannot be downloaded from this sandbox (the signed blob URL returns
`EOF`), so results are read from the jobs/steps API. To keep failures diagnosable, every
verification step now emits its failing assertion as a **check-run annotation**; that mechanism is
what made defects 15–18 visible and fixable.

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

### 1c. Zero-cost local staging — verified on 2026-11-02

Isolated PostgreSQL **16.2** with **pgvector 0.8.0** on `127.0.0.1:55432`, database
`revluma_staging`, a dedicated `revluma_staging` role, synthetic fixtures only, destroyable by
deleting `/tmp/revstaging`. No paid service, no Supabase project, no production connection.

| Step | Command | Result |
| --- | --- | --- |
| Migration replay | `psql -v ON_ERROR_STOP=1 -f prisma/migrations/…` | 11 of 13 directories apply; `0_baseline`/`manual_changes.sql` needed the UTF-16→UTF-8 fix that is part of this branch |
| Candidate migration | `psql -f prisma/migrations/20261101120000_rev_financial_integrity/migration.sql` | **applied** (idempotent re-run): `refunded_total numeric(10,2)`, `ltv_currency`, `ltv_mixed_currency`, tombstone table + index |
| Intelligence migration | `psql -f prisma/migrations/20261027140000_intelligence_findings/migration.sql` | **applied** after creating Supabase-style `anon`/`authenticated` roles; RLS + FORCE RLS + revokes in place |
| Financial behaviour | `psql -f Backend/scripts/staging/verify-financial-integrity.sql` | **PASS** — `usd_net=120.00 usd_gross=1275.00 eur_net=25.00`; #1004 and #1001 net to zero; partial refund 70/100; cancelled 999 excluded; tombstone survives |
| Data API isolation | `psql -f Backend/scripts/staging/verify-data-api-isolation.sql` | **PASS** — no privileges for `anon`/`authenticated`, intelligence tables keep RLS |
| Revenue evidence (live DB) | `TASK198_DATABASE_URL=… pytest tests/test_revenue_evidence_postgres.py` | **2 passed** (after fixing the stale fixture) |
| Revenue acceptance (live DB) | `python scripts/staging_revenue_acceptance.py` | **PASS** — `available`, `USD 120.00` / `EUR 25.00`, counts 4/1, refund limitation stated |

**Schema-bootstrap gap (recorded, not hidden):** replaying the whole migration history yields
**27 tables against 64 Prisma models**. This repository bootstraps with
`prisma db push --skip-generate --accept-data-loss` (see `.github/workflows/task030-delayed-events.yml`)
followed by targeted migrations; the Prisma CLI cannot fetch its engines in this sandbox
(`binaries.prisma.sh` unreachable), so the full application schema was **not** bootstrapped here.
The candidate migration, its behaviour and the revenue-evidence data path were verified against
the tables they touch (organizations, users, stores, customers, orders, coverage, findings).
`prisma generate` / `prisma validate` and `prisma migrate deploy` remain **unverified locally**
and are covered by CI's `npm ci` + `npm test` on the pushed head only.

### 1d. Release-candidate hardening — 2026-11-02 (second pass)

| Area | What was done | Evidence |
| --- | --- | --- |
| Refund ordering | A delayed pre-refund `orders/create` could overwrite a refunded order back to its gross total. Added `reconcileOrderMoney` (monotonic refunded amount, unseen refunds still deducted) and wired it into `upsertOrder`. | `src/tests/orderMoneyReconciliation.test.js` **12/12**; integration scenario in `financialIntegrity.integration.js` |
| Supabase security | Read-only inspection of the production project (64 tables, 0 without RLS, 39 with no policy, 2 anon-executable `SECURITY DEFINER` functions, blanket CRUD grants). All findings classified; hardening migration added and verified on staging. | `docs/security/supabase-advisor-triage.md`; `verify-security-hardening.sql` **PASS** |
| Full Prisma bootstrap | Cannot run locally (Prisma engines unreachable). `release-candidate-verification.yml` does it in CI: real `prisma generate`, `validate`, `db push`, `migrate diff --exit-code` (twice), model/table assertion, `npm test`, 19 DB-backed financial scenarios, SQL checks, Python suite and dashboard build on PostgreSQL 16 + pgvector. | **Green on `887ff9b`** (run 41407771654); surfaced and closed defects 15–18 |
| Downstream revenue consumers | Four other revenue queries ignored cancellations (`business_state` daily revenue/anomaly detection, seven-day evidence, historical ingestion features, lab seed LTV). All now exclude cancelled/voided/deleted orders; the seven-day field is renamed `net_recorded_order_value` because `orders.total` is net of refunds. | `pytest` **614 passed, 3 skipped** on staging PostgreSQL (616 passed, 1 skipped without it); new SQL-filter regression tests |
| Tenant isolation (API boundary) | New `revTenantIsolation.test.js` mocks only the database and exercises the real controller: cross-tenant read/rename/delete → 403, no message query executes for another tenant, listing is org-scoped, missing/foreign membership → 403, `execute: true` → 403 before any DB access. | **8/8 local**; DB-backed ownership suites (`task027Ownership.integration.js`) run in CI |
| DB-backed financial suite | 19 scenarios through the production ingestion functions against real PostgreSQL (refunds, cancellations, delayed/duplicate/out-of-order delivery, missing evidence, currency, LTV, gross reconstruction). | `src/tests/financialIntegrity.integration.js`; **not executed locally** (needs Prisma Client) — runs in the workflow above |

### 1e. Full Prisma bootstrap executed in CI — 2026-11-02 (third pass)

`release-candidate-verification.yml` now performs the bootstrap that this sandbox cannot:
PostgreSQL 16 + pgvector service container → `npm ci` (real `prisma generate`) → `prisma validate`
→ `prisma db push` (full 64-model schema) → `prisma migrate diff --exit-code` → apply both
candidate migrations → drift re-asserted → every Prisma model asserted present in PostgreSQL →
`npm test` → 19 financial-integrity scenarios against the live database → three behavioural SQL
check scripts → Python suite on real PostgreSQL → revenue acceptance.

Four real defects were surfaced and closed in the process; see
`docs/rev-intelligence/RELEASE-CANDIDATE-REPORT.md` §15 items 15–18:

| # | Defect | Fix |
| --- | --- | --- |
| 15 | Migration created `idx_order_cancellations_observed`, `schema.prisma` never declared it → drift | `@@index([observed_at(sort: Desc)], map: …)` |
| 16 | `parseAmount()` rejected Prisma `Decimal`, so every `NUMERIC` read was dropped | exact decimal-string read; arrays/objects still fail closed |
| 17 | Verification fixtures predated `organizations.slug` (`NOT NULL UNIQUE`) | fixtures in both psql scripts and the Python acceptance script supply it |
| 18 | The Python suite step never installed `pytest` and had never run | `pip install -r requirements.txt pytest` |

## 2. What is not verified

- **Backend `npm test` still cannot run locally.** Prisma Client is not installable in this
  sandbox (`binaries.prisma.sh` blocked; `@prisma/client-runtime-utils` missing), so any module
  that imports `prisma` fails at require time. CI now covers it (see 1a), but a developer
  working offline still cannot run the Prisma suites without a Prisma install.
- **CI test counts are not recorded.** The jobs pass; their log files are unreachable from this
  environment, so the exact number of executed tests on CI is unknown.
- **Local schema bootstrap is still impossible** (Prisma engines unreachable from this sandbox),
  and the hand-replayed staging database still holds 27 of 64 models. This is now covered in CI,
  which builds the full schema with `prisma db push` on every run.
- **No Supabase verification.** The shared project was not touched; advisor findings are triaged
  in `docs/security/supabase-advisor-triage.md` with the three read-only queries that close them.
- **Connected-service behaviour remains unverified**: no real Shopify webhook delivery, no
  credential access from the app, no deployed streaming session, no live merchant flow.
- **No Shopify webhook delivery, no Supabase credential access from the app, no deployed
  streaming session.** The repository has no `.env` at all, so no provider key, Shopify token
  or database URL exists in this workspace.
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
2. ~~A staging database with the `20261101120000_rev_financial_integrity` migration applied.~~
   **Closed** (1c locally, and 1e on every CI run with the full schema).
3. A Shopify test store to verify order/cart ingestion, refund reconciliation and currency
   capture with real webhooks. **Open — requires operator-supplied store credentials.**
4. A deployed Python service to exercise streaming, timeouts and cancellation end-to-end.
   **Open — requires a deployment authorization.**
5. ~~A push of the candidate commit so CI can execute `release-candidate-verification.yml`.~~
   **Closed** — 13/13 workflows green on `887ff9b`.

`docs/execution/STAGING-VERIFICATION-RUNBOOK.md` gives the exact commands and pass criteria for
closing blockers 2–4, including the Shopify webhook scenarios (refund, cancel-then-delayed-create,
currency capture) and the eight-step streaming check.

**2026-11-02 update:** stage 2 closed, and a release-blocking refund defect was found and fixed
(sync stored the pre-refund total when Shopify omitted `currentTotalPriceSet`; `orders.refunded_total`
added so gross can be reconstructed). Merchant-facing phases 02–08 stay PARTIALLY COMPLETED until
a Shopify development store and a deployed streaming stack exercise them; CI alone does not verify
merchant-facing behaviour.

## 5. Constraints honoured

- Read-only release: no store mutation path was added; `execute: true` is rejected on both
  `POST /rev/chat` and `POST /rev/stream`.
- No new database, no orchestration framework, no agent-to-agent messaging.
- The LLM remains a narrator only: numbers come from tools and the evidence contract.
- No production deployment, migration, or configuration change was performed.
