# ADR-001 — Rev Intelligence: repair and harden, not rebuild

- **Status:** Accepted
- **Date:** 2026-11-02
- **Deciders:** Revluma engineering
- **Branch:** `arena/c85e524b-revluma`, based on `main@941640b`
- **Supersedes:** nothing. Constrains all Rev Intelligence work in this release.

## 1. Context

Rev Intelligence was reported broken in production: the Python service could not
boot, Business State snapshots stopped rebuilding at 08:00 UTC on 2026-11-02
while the Node service continued syncing stores normally, and the merchant-facing
chat experience offered generic suggestions that did not reflect any connected
store. The question put to engineering was whether to rebuild the feature or
repair it.

A rebuild was a live option because the production failure was total: a syntax
error in `python/src/serving/api.py` had been merged to `main` and deployed,
which means the first CI gate (`compileall -q src tests` in
`.github/workflows/rev-python-tests.yml`) was failing on `941640b` and `541d132`
and the deploy happened anyway.

## 2. Decision

**Repair the existing implementation and harden the specific failure classes that
were found. Do not rebuild.**

## 3. Evidence for the decision

The investigation measured the code rather than judging it by its production
symptoms:

| Signal | Finding |
| --- | --- |
| Python test suite at `941640b` | 558 passed, 3 skipped, 3 collection errors |
| Python test suite after repair | 713 passed, 3 skipped, 0 errors |
| Dashboard suite before / after | 120 tests / 159 tests, build green both times |
| Boot failure root cause | One line: a literal `\n` escape carried as raw text inside `logger.info(..., extra={...})` at `api.py:89` |
| Transaction discipline | Real defects, but localised: reads held pooled connections open across model calls |
| Investigation contract | Coherent and evidence-gated: deterministic routing, per-tool validation, comparison fallback, hypothesis labelling, unknowns, read-only boundary |
| Streaming | Complete SSE contract (`accepted`, `meta`, `plan`, `step`, `evidence`, `final`, `error`, `cancelled`) implemented consistently across Python, Node and the browser |
| Node controller | Already had streaming, retry, conversation-ownership checks and injection detection |
| Frontend | Complete React/TypeScript chat surface with evidence drawer, timeline and markdown rendering |

The production failure was therefore **not architectural**. It was a parse error
plus a set of lifecycle defects (transactions held across model calls, no pool
capacity budget, no retention on `business_states`, a classifier that routed most
merchant questions to a zero-tool intent) plus misleading frontend copy. A
rebuild would have discarded a working, tested, evidence-gated contract to fix
defects that were all localisable.

Equally, the defects were **not** cosmetic, so preserving the architecture did
not mean preserving the behaviour. Eight of the fifteen live-acceptance
questions routed to `INTENT_GENERAL` with an empty tool list, which means Rev
answered real merchant questions about their own store without querying it. That
is a correctness failure, and it was fixed rather than worked around.

## 4. Alternatives considered

1. **Full rebuild of the Python investigation layer.** Rejected: discards 558
   passing tests and a contract that already enforces the read-only boundary,
   org scoping and evidence validation. Highest risk of regressing tenant
   isolation, which the mandate forbids weakening.
2. **Rebuild only the frontend.** Rejected: the frontend defects were copy and
   grounding, not structure. The page already handled streaming, cancellation,
   retry and evidence.
3. **Roll back `main` to `a28aa65`** (last known-good Python deploy). Considered
   and kept as a live rollback candidate — Vercel deployment
   `dpl_h9v2Dx95Gys2gZSHeDfr6bdc7hBC` corresponds to it. Rejected as the
   *primary* remedy because it reverts the concurrency and Business State
   reliability work in `6bbd3e5`…`941640b` without fixing the classifier,
   retention or framing defects.
4. **Repair plus targeted hardening.** Accepted.

## 5. Consequences

### Positive
- The evidence-gated investigation contract, SSE streaming and tenant scoping
  survive intact and remain covered by tests.
- Every defect fixed is pinned by a regression test, so it cannot silently
  return.
- The change set is reviewable: 23 files, ~2,670 insertions, mostly tests.

### Negative / accepted risk
- The deterministic keyword classifier remains a pattern table. It is now
  plural-tolerant and ordered by specificity, but it is still a heuristic: a
  question can route to a defensible-but-imperfect intent. This is accepted
  deliberately — deterministic routing keeps behaviour stable and testable when
  the reasoning provider is unavailable, and the model is only ever allowed to
  add narrative, never routing facts.
- `business_states` carries a backlog of 33,712 superseded rows (33 MB). The
  retention policy added here drains roughly 300 rows per hour per organization,
  so the backlog clears over several days. A one-time manual prune would clear it
  immediately but is a destructive production operation and requires explicit
  approval; it has **not** been performed.

### Obligations created by this decision
- CI must actually gate deploys. A syntax error reached production while the
  `Rev Python regression tests` workflow was red. This is a process defect, not a
  code defect, and it is recorded here so it is not lost.
- No phase or scenario may be reported as verified without recorded evidence
  (consistent with `docs/rev-intelligence/MASTER-PLAN.md`).

## 6. Verification

- `python -m pytest -q tests` → **713 passed, 3 skipped** (from 558/3/3 errors).
- `npm test` in `Frontend/Dashboard` → **21 files, 159 tests passed** (from 19/120).
- `npx tsc --noEmit -p tsconfig.app.json` → clean for every Rev path.
- `npm run build` → green.
- ESLint on touched Rev files held at or below the pre-existing per-file baseline
  (`RevIntell.tsx` unchanged at 20 problems; `RevAnswerView.tsx`,
  `revStoreContext.ts`, `revAnswerState.ts` and their tests at 0).
- Transaction-leak reproduction script: before → `checkedout=1,
  in_transaction=True` held across a 25 s model call; after → `0, False`.
- Backend `npm test` **could not be executed locally** — see the acceptance
  report. It is a CI-only gate in this environment.

## 7. Related documents

- `docs/rev-intelligence/REV-INTELLIGENCE-CONTRACT.md` — architecture,
  orchestration contract, database reliability invariants, SSE event contract.
- `docs/rev-intelligence/ACCEPTANCE-REPORT-2026-11-02.md` — commit-by-commit
  record, test results, blocked gates and the truthfulness statement.
- `docs/rev-intelligence/MASTER-PLAN.md` — phase gates.
- `docs/rev-intelligence/PHASE-STATUS.md` — running phase status.
