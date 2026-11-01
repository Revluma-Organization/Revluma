# Rev Intelligence — release candidate completion report

Date: 2026-11-01
Branch: `arena/bbc48aa5-revluma`, based on `main@93d9d42`
Overall verdict: **PARTIALLY COMPLETED** — code, contract and tests are in place and green
locally; CI, staging, a staging database and a real Shopify store were not available, so no
capability below is claimed as fully verified end-to-end.

This report is deliberately structured into 17 parts. A part is marked **FULLY COMPLETED** only
where the evidence exists in this workspace; every other part is **PARTIALLY COMPLETED** with
the exact blocker named.

---

## 1. Executive summary

Rev Intelligence now has one coherent path from merchant question to evidenced answer:

```
Dashboard (streaming client, conversation-first workspace)
  → Node gateway (auth, tenant isolation, persistence, sequencing, tool authorisation, SSE)
    → Python intelligence (planning, approved tools, metric calculation, evidence validation,
       specialists, findings, hypotheses, confidence)
      → evidence contract (currency, period, source, definition, coverage, freshness, ids)
```

The release is read-only by construction: `execute: true` is rejected with `403 READ_ONLY` on
both the streaming and non-streaming chat endpoints, and no merchant-mutating tool is exposed in
the catalog.

**Status: PARTIALLY COMPLETED.** Blockers: no CI run observed, no staging environment or
database, no Shopify test-store interaction, no browser-driven streaming session.

## 2. Repository and branch state

- Branch `arena/bbc48aa5-revluma`, HEAD `93d9d42` (`Merge pull request #235 …`), dirty worktree.
- 21 tracked files modified, 19 untracked source/test/migration paths. No build artefacts,
  dependency trees or datasets are untracked (`Frontend/Dashboard/dist` is ignored).
- No commit, push, merge, deployment or migration was performed in this session.

**Status: FULLY COMPLETED** (state verified with `git status`, `git diff --stat`, `git log`).

## 3. Architecture conformance

| Constraint | Implementation |
| --- | --- |
| Node owns auth, isolation, persistence, sequencing, validation, tool authorisation, SSE, rate limits | `revController.js`, `revRoute.js`, `mlService.js`, `revStream.js` |
| Python owns BI, investigation, metric math, evidence, specialists, confidence | `python/src/agents/investigation.py`, `intelligence/evidence.py`, `intelligence/revenue_evidence.py`, `agents/tools.py` |
| Existing stacks preserved | Postgres/Supabase + Prisma, Redis, Shopify integration, Render/Vercel untouched |
| No new database / orchestration framework / agent chatter | Only one new table (`order_cancellation_tombstones`) and two LTV columns; orchestration stays in the existing orchestrator |
| LLM is not the source of truth | Narrative is generated from, and validated against, computed facts; rejected on mismatch |
| Specialist contract | `success` / `partial` / `no_data` / `error`, partials preserved |

**Status: FULLY COMPLETED** (structural, verified by inspection and contract tests).

## 4. Conversational intelligence

- Streaming: `POST /api/v1/rev/stream` emits `meta`, Python frames (`accepted|plan|step|evidence`),
  then `final`, `cancelled` or `error`. SSE headers disable buffering and transformation.
- Cancel: the browser aborts the fetch; Node aborts upstream on `res.close`; a cancelled turn is
  persisted as an error turn and rendered as "Generation stopped" with Regenerate.
- Retry: `POST /api/v1/rev/conversation/:id/retry` reuses the last user message, deletes stale
  error turns, and never duplicates the user's turn (`reuse_user_message`).
- History, titles, search: server-side `q` search across titles and message content; titles
  generated on the first exchange.
- Rich rendering: safe markdown renderer (no `dangerouslySetInnerHTML`), evidence drawer,
  investigation timeline, follow-up chips.
- Persistence: bounded final turn (60 evidence items, 40 facts, 20 comparison facts, 10
  hypotheses, 12 unknowns/recommendations/warnings, 100k chars of steps).

**Status: PARTIALLY COMPLETED.** Local tests cover the SSE client, the Node gateway contract and
the renderer; no live stream was opened against a running Python service.

## 5. Commerce understanding

Merchant context is assembled per organization from verified stores, coverage certification,
freshness and reporting windows; every answer carries the period (UTC, half-open `[start, end)`)
and never assumes USD. Store currency is taken from ingested order/cart rows, not defaulted.

**Status: PARTIALLY COMPLETED.** Requires a connected store to verify currency, timezone and
coverage values against real data.

## 6. Investigation intelligence

Plans are emitted as steps before tools run; tools are restricted to an explicit catalog
(`GET /api/v1/rev/tools`, 5-minute cache, `TOOL_CATALOG_UNAVAILABLE` 503 when unavailable);
period comparisons are currency-matched; specialists run behind the shared status contract and
a failing specialist never discards another's `partial` result.

**Status: PARTIALLY COMPLETED.** Unit and contract tests pass; no live investigation was run.

## 7. Evidence and financial correctness

- Verified facts, calculated observations, hypotheses and unknowns are separate fields.
- Every monetary item carries currency, period, source, definition, coverage, freshness and a
  stable evidence id (`rev-evidence-v1`).
- Mixed currencies are never summed; missing data is `null`, never `0`; unavailable currency
  values are `unsupported` with a null value.
- New `validate_attribution()` rejects facts without evidence, unknown evidence ids, currency
  facts without currency, and hypotheses claimed as verified.
- Refund reconciliation is a pure, testable helper; cancellation is terminal via tombstones.

**Status: PARTIALLY COMPLETED.** Proven on synthetic evidence and unit tests; no live-store
ingestion was exercised.

## 8. Operational intelligence

Anomalies, cart recovery, revenue exposure and retention signals flow from the existing
business-state builder, findings engine, alert queue and morning briefing. No new monitoring
was invented.

**Status: PARTIALLY COMPLETED.** Requires a scheduled run against a real store.

## 9. Context, memory and tenant isolation

Conversations, messages, findings and evidence are organization-scoped in SQL. Memory records
are written only from verified investigations and are invalidatable and expiring. Cross-tenant
access returns 403 and logs `rev_cross_tenant_attempt`. A conversation that belongs to another
organization is never returned.

**Status: PARTIALLY COMPLETED.** Isolation logic is inspected and contract-tested; it has not
been attacked against a live multi-tenant database.

## 10. Decision support

Every answer states what is verified, what is calculated, what is only a hypothesis, what is
unknown, the confidence and its basis, the limitations of the source, and measurable next steps
framed as recommendations. Nothing is presented as an executed action.

**Status: PARTIALLY COMPLETED** (same live-evidence blocker).

## 11. Read-only guarantees

- `execute: true` → `403 READ_ONLY` on `/rev/chat` and `/rev/stream`.
- No mutating tool is in the catalog; recommendations carry `executed: false`.
- The UI states "Read-only" on answers and in the conversation rail.

**Status: FULLY COMPLETED** for the API/UI guarantee (regression-tested in
`revInvestigation.contract.test.js` and `revStream.test.ts`).

## 12. UI / UX

Conversation-first workspace: persistent dark conversation rail with search, rename, delete and
New conversation on desktop; drawer on mobile. Light workspace, blue/black/white palette, small
cards in `#1F06AC`, green/red reserved for status. Streaming shows the investigation timeline,
partial-evidence notices, cancel/regenerate controls and an evidence drawer with per-item
expanded definitions and limitations. Integrations and Command Center pages were not modified.

**Status: PARTIALLY COMPLETED.** Build and unit tests pass; no visual or accessibility review was
performed in a browser.

## 13. Proactive discovery

Reuses the existing business-state rebuild, findings engine, alert queue and scheduled morning
briefing. Findings are evidence-gated before they can be investigated from chat.

**Status: PARTIALLY COMPLETED.** No scheduled run was observed.

## 14. Tests executed (and where)

| Suite | Where | Result |
| --- | --- | --- |
| Python (`pytest python/tests -q`) | local, 3.11.2, placeholder `DATABASE_URL` | **612 passed, 3 skipped** |
| `node src/services/__tests__/revStream.test.js` | local | 3/3 |
| `node src/services/__tests__/financialIntegrity.test.js` | local | 6/6 |
| `node src/services/__tests__/revInvestigation.contract.test.js` | local | 7/7 |
| `node src/services/__tests__/revUpstreamStream.test.js` | local | 7/7 |
| `node src/tests/shopifyRefundTotals.test.js` | local | 5/5 |
| `npx vitest run` (Dashboard) | local | 19 files, 120 tests |
| `npx vite build` (Dashboard) | local | succeeded |
| `npx tsc -p tsconfig.app.json --noEmit` | local | 17 pre-existing errors in unrelated pages, 0 in Rev files |
| Backend `npm test` | — | **not run** (Prisma Client unavailable in sandbox) |
| Any CI workflow | — | **not observed** |

**Status: PARTIALLY COMPLETED** — no CI evidence, no live database evidence.

## 15. Defects found, fixed and covered

1. Refund reconciliation could not be tested without Prisma → extracted to
   `shopifyOrderFinancials.js`; 5/5 tests now run locally.
2. `customers.ltv` was consumed as a bare number in churn and offer features → gated by
   `verifiedCustomerLifetimeValue()`; Python LTV and escalation now require a verified currency.
3. Business-state customer context coerced missing LTV to `0` and compared across currencies →
   returns `null` with `ltv_currency`, and threshold matching skips unverified rows.
4. Period-comparison facts had empty `evidence_ids` → both periods' evidence ids are now cited,
   previous-period items ship with the answer, and `validate_attribution()` enforces it.
5. Streaming client/retry path could duplicate the user turn → server-side retry with
   `reuse_user_message`; the dashboard calls it.
6. Image attachments would have been silently dropped by the streaming endpoint → attachment
   turns deliberately use the non-streaming endpoint.
7. Dashboard `tsconfig.app.json` used `ignoreDeprecations: "6.0"`, which TypeScript 5.9 rejects,
   so `tsc` could not run at all → removed; the type check now runs (and exposes 17 pre-existing
   errors in unrelated pages, left untouched as out of scope).
8. Python CI was unpinned → pinned to `3.11.9`; the dashboard workflow now runs the whole suite.

**Status: FULLY COMPLETED** for the items above (each has a passing local test or a verified
inspection).

## 16. Change inventory

Modified: `Backend/prisma/schema.prisma`, `revController.js`, `revRoute.js`, `churnWorkerService.js`,
`commerceWebhookService.js`, `featureWorkerService.js`, `mlService.js`, `shopifySync.js`,
`Frontend/Dashboard/src/lib/api.ts`, `src/pages/RevIntell.tsx`,
`python/src/agents/base_agent.py`, `config/database.py`, `intelligence/business_state.py`,
`intelligence/seven_day_evidence.py`, `serving/api.py`, `models/churn/predict.py`,
`tests/test_business_state_refresh.py`, `tests/test_churn_model.py`, plus the two CI workflows and
`Frontend/Dashboard/tsconfig.app.json`.

New: migration `20261101120000_rev_financial_integrity`, `financialIntegrity.js`, `revStream.js`,
`shopifyOrderFinancials.js`, three Node suites, `Frontend/Dashboard/src/lib/revStream.ts` (+test),
`src/components/rev/{RevMarkdown,RevAnswerView,EvidencePanel,InvestigationTimeline}.tsx` (+test),
`python/src/agents/{investigation,tools}.py`, `python/src/intelligence/{evidence,query,revenue_evidence}.py`,
`python/tests/{rev_fakes,test_rev_evidence_contract,test_rev_investigation,test_rev_revenue_evidence,test_database_engine_laziness}.py`,
and this documentation set.

**Status: FULLY COMPLETED** (inventory reviewed; nothing unexplained).

## 17. Blockers and next steps

0. **Follow the staging runbook**: `docs/execution/STAGING-VERIFICATION-RUNBOOK.md`.
1. **Run CI** on this branch: `backend-tests.yml` (needs Prisma binaries), `rev-python-tests.yml`
   (now pinned to 3.11.9) and `dashboard-auth-regression.yml` (full suite + build).
2. **Apply the migration** in staging: `20261101120000_rev_financial_integrity`.
3. **Connect a Shopify test store** and verify: order/cart currency capture, refund
   reconciliation on webhook `orders/update`, cancelled-then-delayed-create ordering, coverage
   certification.
4. **Deploy the Python service** and run a browser streaming session: plan → steps → evidence →
   final, cancel mid-flight, retry, and a forced specialist failure (partial results must
   survive).
5. **Review the 17 pre-existing TypeScript errors** in unrelated pages (out of scope here).
6. **Only then** upgrade any part of this report from PARTIALLY COMPLETED to FULLY COMPLETED.

No production deployment, production migration, destructive git operation or dependency spend
was performed.
