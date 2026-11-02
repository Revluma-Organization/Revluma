# Rev Intelligence — Phase Status

Updated: 2026-10-28

| Phase | State | Evidence |
| --- | --- | --- |
| 01 — Foundation and provider reliability | IN_PROGRESS | Python deployment dep-dbh0okoae00c73dimmsg reported live at commit 47081ee; CI workflow committed at 247fb6d; no passing regression-run evidence yet; live Gemini HTTP root cause unconfirmed. |
| 02 — Natural conversation | NOT_STARTED | Existing implementation is not yet accepted. |
| 03 — Merchant intelligence | NOT_STARTED | Existing merchant context integration requires verification. |
| 04 — Grounded research | NOT_STARTED | Initial implementation committed; not verified. |
| 05 — Memory | NOT_STARTED | |
| 06 — Diagnosis | NOT_STARTED | |
| 07 — Actions and proactive intelligence | NOT_STARTED | |
| 08 — UX and production certification | NOT_STARTED | |

## Gate 01 outstanding evidence
- Recorded complete Python compile/test output.
- CI execution status and failures.
- Real provider HTTP status and successful authorized generation.
- Frontend build result and deployed revision.
- Production end-to-end smoke results.

Do not mark VERIFIED without the above evidence. Continue fixing within Phase 01 until verified.

## Execution update — 2026-10-28
- Fixed grounded research forwarding private conversation history: commit e6f3c89.
- Added test ensuring history and memories excluded from grounded prompt: commit d495565.
- Validation remains unverified: no runnable GitHub Actions workflow results returned; local environment cannot clone the private repository; no full Python suite results obtained.
- Phase 01 remains IN_PROGRESS. Do not mark VERIFIED.

## Execution update — 2026-11-01

This table is superseded for the current release candidate by
`docs/execution/EXECUTION_STATUS.md`, which records the verified local evidence and the exact
blockers. Phase numbering and task IDs above are unchanged.

- Local verification: Python 612 passed / 3 skipped; Node gateway suites 21/21 (revStream,
  financialIntegrity, revInvestigation contract, shopifyRefundTotals); Dashboard 120 tests and a
  production build.
- Streaming, cancel, retry, evidence drawer and the conversation-first workspace are implemented.
- CI, staging, a staging database and a Shopify test store were **not** available, so no phase is
  marked verified and the release candidate is **PARTIALLY COMPLETED**.
- Pre-merge defect audit: `docs/mvp-execution/TASK-199-PRE-MERGE-AUDIT.md`.

## Execution update — 2026-11-02 (branch `arena/c85e524b-revluma`, base `main@941640b`)

Decision recorded: **repair and harden, not rebuild** — see
`docs/rev-intelligence/ADR-001-repair-not-rebuild.md`. Normative contract:
`docs/rev-intelligence/REV-INTELLIGENCE-CONTRACT.md`. Full evidence and the list
of unexecuted mandatory gates:
`docs/rev-intelligence/ACCEPTANCE-REPORT-2026-11-02.md`.

Commits `c888117`, `9782d88`, `80b2765`, `5f9681d`, `5a99564`, `e295f2c`
(23 files, 2,673 insertions, 130 deletions).

Blocking defects fixed:
- `api.py:89` literal `\n` inside `logger.info(..., extra={...})` — the service
  could not import, so it could not boot. Present on `941640b` and `541d132`.
- Reads held pooled connections **in transaction** across model calls of up to
  25 s; with capacity 12 this stalled the whole service. Reproduction before:
  `checkedout=1, in_transaction=True`; after: `0, False`.
- Intent routing was singular-only, so `\bproduct\b` / `\bcustomer\b` missed the
  plurals. **Nine of the fifteen live-acceptance questions routed to `general`
  with an empty tool list** — Rev answered store questions without querying the
  store. Verified fixed end to end (LIVE-004 line item now in evidence).
- Untrusted store data could emit the closing delimiter and end its own
  quarantine; markers are now neutralised before wrapping.
- No generic execution-request boundary ("Can you fix it for me?"), and
  `\border\b` missed "orders".
- `business_states` had grown to 33,717 rows (33,712 superseded, 33 MB) with no
  pruning in either service; retention added (keep 200 newest superseded per
  organization, ≤ 500 per call, post-commit, cannot select the current snapshot).
- Concurrency permit released before the stream body finished; now held to the
  final `http.response.body` chunk, with `active_streams` tracked separately.
- Node ignored the Python `cancelled` event, so a merchant pressing Stop saw
  `INVALID_RESPONSE`.
- Frontend advertised a campaign mutation ("Draft a sequence for inactive
  customers"), offered category/competitor questions no data supports, and
  overclaimed; starters are now grounded in the merchant's real store response.
- The answer pill labelled clarifications, capability answers and read-only
  refusals "Insufficient store data".
- Gemini grounding suffix emitted literal `\n` into merchant-facing text.

Tests: Python **558 passed / 3 skipped / 3 collection errors → 713 passed /
3 skipped / 0 errors**. Dashboard **19 files / 120 tests → 21 files / 159
tests**; `tsc` clean on Rev paths; build green; ESLint at or below the
pre-existing per-file baseline. **Backend `npm test` could not be executed
locally** (`prisma generate` needs `binaries.prisma.sh`, outside the allowlist) —
CI-only.

Still NOT done, in dependency order: CI observation on this branch → merge to
`main` → Vercel + Render (Node, Python) deploys → Render Python log review to
close out why rebuilds stopped at ~08:00 UTC (still undiagnosed) → LIVE-001…015
against a real authorized merchant → one-time prune of the 33,712 superseded rows
(destructive; needs explicit approval).

### Merge and deployment — 2026-11-02

PR #245 merged to `origin/main` as **`192b2d0`** after all 8 CI checks passed on
`9936caa` (`python-regressions`, `Backend test suite`, `backend`, `Dashboard suite
and production build`, `dashboard`, `Prisma bootstrap, financial and security
regressions`, `Vercel`, `Vercel Preview Comments`). Branch protection not
bypassed; all 8 commits verified as ancestors of `origin/main`.

Vercel production **`dpl_65xZ4GTEWcmevzd5dMQhW5eGCFbe`** at `192b2d0` —
`READY` / `PROMOTED`, aliased to `revluma.vercel.app`, `timeToReady` 96,594 ms,
region `iad1`. **Frontend only.**

Render Node and Python: **not confirmed deployed**; neither can be triggered nor
observed from this environment. Production database observation at 11:41:43 UTC
(read-only): newest Business State snapshot still `08:00:20 UTC`, 0 rows in the
last 20 minutes, **0 of 5 current snapshots valid**, while Node synced a store at
`11:33:55 UTC`. The scheduler polls every 60 s and all five snapshots are
expired, so a healthy Python service would have rebuilt within about a minute of
boot. It has not. The merge landed at 11:35:28 UTC and a Render Python build
(`pip install` including scikit-learn) can take many minutes, so this is
**inconclusive rather than proof of failure** — but "Python is healthy in
production" is unproven and on current evidence still false.

Open items requiring action outside this environment:
1. Confirm the Render Python service deployed `192b2d0` and read its boot logs —
   this also closes out why rebuilds stopped at ~08:00 UTC, which is still
   undiagnosed (local lifespan boot succeeds).
2. Confirm the Render Node service deployed `192b2d0`.
3. Re-observe `business_states`: expect a new snapshot within ~60 s of a healthy
   Python boot, and `count(*)` to begin falling from 33,717 as retention prunes.
4. Execute LIVE-001…LIVE-015 read-only against the real authorized merchant
   (candidate: store `3ed79446-cb6d-4a1c-b174-9ec1ab91fe15`, organization
   `1dc6aa19-9737-4770-a340-ff812a8b139a`, `revluma-test-store-v1.myshopify.com`,
   all 24 scopes granted).
5. Decide on the one-time prune of 33,712 superseded rows (destructive; needs
   explicit approval).
