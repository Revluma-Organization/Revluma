# Rev Intelligence — acceptance report

- **Date:** 2026-11-02
- **Branch:** `arena/c85e524b-revluma`, based on `main@941640b`
- **Head at time of writing:** `46c0827` (PR #245, all 8 CI checks green)
- **Overall verdict:** **MERGED and frontend DEPLOYED. NOT production-ready and
  NOT live-verified.** Implementation, automated verification and CI are green;
  the work is on `origin/main` and the Vercel frontend is promoted to
  production. The Render services are **not confirmed deployed**, live merchant
  acceptance has **not** been executed, and production evidence at 11:38 UTC
  shows the Python service still has not rebuilt a Business State snapshot since
  08:00:20 UTC. Section 9 lists every unexecuted mandatory gate.

This report separates what was measured from what was not. Nothing below is
marked passed unless the evidence exists in this workspace.

---

## 1. Decision

Repair and harden, not rebuild. Full reasoning, evidence and rejected
alternatives in `docs/rev-intelligence/ADR-001-repair-not-rebuild.md`.

---

## 2. Commits on this branch

All authored `Splendor <splendorbenjamin4@gmail.com>`, oldest first.

| SHA | Subject |
| --- | --- |
| `c888117b4bec19e7513c346e0578d7e77958893a` | Restore Python service boot and stop reads holding pooled connections |
| `9782d880920f76dd89e87ead137bc1d7d1eef830` | Make pool and stream saturation observable while the service runs |
| `80b276555fbdc0a429996a8936c8f1ed0f36ef9c` | Ground Rev suggestions in the real store and honour the read-only boundary |
| `5f9681db833eb9ad7442af09fddcc6adc216789b` | Release the read transaction held by Business State loading |
| `5a99564fb071e80384973984f18ae92bf17c410c` | Fix Rev intent routing and quarantine untrusted store data |
| `e295f2cfac4aca9083545b8e7dbb7edd5f67eed9` | Label Rev's answers by what they actually are |
| `5e25ef8` | Record the Rev Intelligence decision, contract and acceptance evidence |
| `46c0827` | Keep the diagnostics endpoint up while the database is not |

Change set at `46c0827`: **23 code/test files plus 4 documents.**

---

## 3. Defects found and fixed

### 3.1 Production boot failure (blocking)
`python/src/serving/api.py:89` — inside `_lifespan`'s `logger.info(..., extra={...})`
a literal `\n` escape was carried as raw text, producing a `SyntaxError`. The
file could not be imported, so the service could not start. Present on `941640b`
and `541d132`; absent at `a28aa65`. Fixed in `c888117`.

Note: the first CI gate in `.github/workflows/rev-python-tests.yml` is
`compileall -q src tests`, which detects exactly this. `Rev Python regression
tests` was **FAILED** on both `941640b` and `541d132` and the code was deployed
anyway. That is a process failure recorded here, not a code failure.

### 3.2 Idle-in-transaction connections held across model calls (blocking)
Reads used bare `db.execute(...)`, leaving a connection checked out and a
transaction open for the duration of an LLM call that can take 25 seconds. With
`pool_size = 8` / `max_overflow = 4`, four concurrent investigations could
exhaust the pool and stall every other request, including Business State
rebuilds.

Reproduction script, before: `checkedout=1, in_transaction=True` held across the
model call. After: `0, False`. Fixed across `c888117` (streaming and
`rev_investigate` paths) and `5f9681d` (`load_current_business_state`, the last
remaining leak — it fired
`rev_read_transaction_open_before_model_call` on **every** investigation that ran
specialists).

`safe_query()` alone could not cover the snapshot read: SQLAlchemy `RowMapping`
rejects integer indexing and that read is positional and wide, so `read_row()`
was added to `python/src/intelligence/query.py`.

### 3.3 Intent routing sent most merchant questions to zero tools (blocking, product)
The subject patterns were singular-only. `\bproduct\b` does not match "products"
and `\bcustomer\b` does not match "customers", so real questions fell through:

| Question | Before | After |
| --- | --- | --- |
| Which products contributed the most to revenue? | `revenue_investigation` (no `product_observations`) | `product_investigation` |
| Which customers are most valuable? | `general` — **0 tools** | `customer_retention` |
| What is my conversion rate? | `general` — **0 tools** | `traffic_investigation` |
| Is your store data up to date? | `general` — **0 tools** | `data_coverage` |
| What is the most important issue I should look at first? | `general` — **0 tools** | `store_overview` |
| Why might purchases be dropping? | `general` — **0 tools** | `revenue_investigation` |
| Compare that with the month before. | `general` — **0 tools** | inherits prior intent |
| What data are you using to reach that conclusion? | `general` — **0 tools** | inherits prior intent |
| Show me my top variants by units sold. | `general` — **0 tools** | `product_investigation` |

**Nine of the fifteen live-acceptance questions routed to `general` with an empty
tool list** — Rev answered questions about the merchant's own store without
querying it. Verified end to end after the fix: a product name from the line-item
table now appears in the evidence payload for LIVE-004 (`True`, previously
`False`). Fixed in `5a99564`.

### 3.4 Untrusted store data could terminate its own quarantine (security)
Retrieved evidence was wrapped in literal delimiters, but store content is
attacker-writable. A product title containing the closing marker would end the
untrusted block early and place the remaining text where the model reads it as
instructions. `_neutralise_untrusted_markers()` now rewrites every marker
fragment inside the payload before wrapping. Fixed in `5a99564`.

### 3.5 Execution requests were investigated rather than refused (boundary)
`PROHIBITED_ACTIONS` had no generic execution-request pattern, so "Can you fix it
for me?" routed to a normal investigation. `\border\b` also missed the plural
"orders", so "Cancel those orders for me" was not detected. Both fixed in
`5a99564`.

### 3.6 Unbounded `business_states` growth (reliability)
Live Supabase held **33,717 rows — 33,712 superseded, 5 current — 33 MB
(28 MB heap)**, accumulating since 2026-10-28 14:02 with no pruning anywhere in
Python or Node. `prune_superseded_snapshots()` added in `c888117`: keeps the
newest 200 superseded snapshots per organization (floor 48 = the history reader's
`LIMIT`), deletes ≤ 500 per call, runs post-commit outside the build
transaction, structurally cannot select the current snapshot, and logs and
swallows its own failure so pruning cannot fail a successful rebuild.

Drain rate ≈ 300 rows/hour/organization × 5 organizations → the backlog clears
over several days. **A one-time manual prune of the 33,712 superseded rows has
NOT been performed** — it is a destructive production operation requiring
explicit approval (section 9).

### 3.7 Concurrency permit released before the stream ended
`RequestConcurrencyGate` released its semaphore when the handler returned rather
than when the response body finished, so the permit did not cover the true stream
lifetime. Rewritten as pure ASGI in `9782d88`, holding until the final
`http.response.body` with `more_body = False`, with `active_streams` tracked
separately from `active_requests`.

### 3.8 Generator closed before its `try` block
Closing `stream_investigation` at the first `yield` raised `GeneratorExit` before
`thread.start()`. Found by a test written for this work; the entire generator body
including the first `yield` is now inside the `try`. Fixed in `c888117`.

### 3.9 Cancellation surfaced to merchants as a malformed answer (cross-tier)
Node's `mlService.streamInvestigation` did not handle the Python `cancelled`
event, so it fell through to `INVALID_RESPONSE`. A merchant pressing Stop saw an
invalid-answer error. Now mapped to `code: 'CANCELLED'` and logged as
`rev_stream_cancelled_upstream`. Fixed in `80b2765`.

### 3.10 Frontend advertised mutations and offered ungrounded suggestions
- `STARTERS` was static filler unrelated to any connected store, including
  "What's moving in my category right now?" — **no competitor or category data
  exists** in Revluma.
- "Draft a sequence for inactive customers." **advertised a campaign mutation,
  violating the read-only MVP boundary.**
- Copy overclaimed ("detect opportunities before your competitors… tell you
  exactly what action to take").

Replaced in `80b2765` with `buildStarters(ctx)` grounded in the merchant's real
`GET /api/v1/store` response, four honest data-health banners, and an explicit
read-only disclosure. Pure logic extracted to `src/lib/revStoreContext.ts` so it
is testable without React and the page module keeps no non-component exports.

### 3.11 Answer pill mislabelled clarifications and refusals
`RevAnswerView` derived its state pill from the evidence list alone, so **any**
answer with no evidence items — clarifications, capability answers, greetings,
read-only refusals — was labelled "Insufficient store data". That tells a
merchant Rev searched their store and found nothing when Rev was asking a
question or declining to write. Fixed in `e295f2c` via `deriveAnswerState()`.

### 3.12 Literal `\n` in merchant-facing text
The Gemini grounding suffix was built from escaped `\\n` sequences in a non-raw
string, emitting literal backslash-n characters into answers whenever web search
grounding was used. Fixed in `e295f2c`.

---

## 4. Test results (executed in this workspace)

### Python
Command:
```
cd python && DATABASE_URL='postgresql+psycopg2://placeholder:placeholder@localhost:5432/placeholder' \
  python -m pytest -q tests --no-header -p no:cacheprovider --continue-on-collection-errors
```
Python 3.11.9, virtualenv `/home/user/.venv-rev`, `requirements.txt` + pytest.

| Point | Result |
| --- | --- |
| Baseline `941640b` | 558 passed, 3 skipped, **3 collection errors** |
| Head `e295f2c` | **713 passed, 3 skipped, 0 errors, 0 failures** |

New test files: `test_intelligence_query.py`, `test_business_state_retention.py`,
`test_db_diagnostics.py`, `test_rev_prompt_injection.py` (13),
`test_rev_intent_routing.py` (46). Extended: `test_rev_investigation.py` (+6
streaming-reliability), `test_request_concurrency_gate.py` (+3),
`test_model_gateway.py` (+3). `tests/rev_fakes.py` `FakeDB` made faithful about
transaction state.

### Dashboard
| Point | Result |
| --- | --- |
| Baseline | 19 files / 120 tests |
| Head | **21 files / 159 tests passed** |

`npx tsc --noEmit -p tsconfig.app.json` → clean for every Rev path.
`npm run build` → green (`✓ built in 7.74s`).
ESLint: `RevIntell.tsx` held at exactly its pre-existing baseline (20 problems);
`RevAnswerView.tsx`, `revStoreContext.ts`, `revAnswerState.ts` and their tests at
**0 problems**.

### Backend (Node)
**NOT EXECUTED — could not be run locally.** `npm install` succeeded only with
`--ignore-scripts` (267 packages), because `prisma generate` downloads its query
engine from `binaries.prisma.sh`, which is outside this environment's allowlist.
Without a generated client, `auth.organization.test.js` passes (10 cases) and
every Prisma-touching test fails with `Cannot find module '.prisma/client/default'`.
This is an environment limitation, not a code failure. **Backend test status must
be read from CI.** `Backend/src/services/mlService.js` was syntax-checked with
`node --check`.

### Continuous integration on this branch (observed)

PR #245, head `46c0827` — **all 8 checks green**:

| Check | Result | Duration |
| --- | --- | --- |
| `python-regressions` (Rev Python regression tests) | **pass** | 1m29s |
| `Backend test suite` | **pass** | 18s |
| `backend` (Backend refresh regression) | **pass** | 25s |
| `Dashboard suite and production build` | **pass** | 30s |
| `dashboard` (Dashboard authentication regression) | **pass** | 45s |
| `Prisma bootstrap, financial and security regressions` | **pass** | 2m2s |
| `Vercel` | **pass** | — |
| `Vercel Preview Comments` | **pass** | — |

This closes gate 6 (Backend tests, which could not run locally) and gate 7 (CI
observation) from section 9. `python-regressions` is the workflow that was
**FAILED** on `941640b` and `541d132` and deployed anyway; it is green here.

`Prisma bootstrap, financial and security regressions` initially **failed** on
`e295f2c` and was fixed by `46c0827`. The failure was instructive: that workflow
runs the Python suite against a **real bootstrapped PostgreSQL 16 with pgvector**,
while `rev-python-tests.yml` uses a placeholder DSN.
`test_diagnostics_reports_an_unreachable_database_honestly` assumed the ambient
`DATABASE_URL` was unreachable, so it passed in one CI job and failed in the
other — an environment-dependent test, which is a defect in the test rather than
in the endpoint. Forcing the failure by monkeypatching then exposed a real bug
beside it: `safe_query` *returning* an error tuple was handled, but `safe_query`
*raising* escaped the `try/finally` and 500'd `/internal/db/diagnostics`,
discarding the pool and request-gate counters at exactly the moment an operator
needs them. Diagnostics now catches it, names the exception type in the reason,
logs `db_diagnostics_activity_unavailable`, and still returns the rest of the
snapshot. Three tests now pin that contract, including one asserting
`database_activity` is all-or-nothing and never a zero-filled masquerade of an
idle database.

After that fix the local suite is **715 passed, 3 skipped** (up from 713).

### Pre-existing issues deliberately not touched
~15 TypeScript errors exist outside Rev paths (`Checkout.tsx`,
`WooCommerceConnect.tsx`, a duplicate `toast` export in `components/ui/index.ts`,
several `settings/*.tsx`). They predate this branch, are not compiled by the Vite
build, and fixing them would be unrelated collateral change.

---

## 4b. Merge and deployment evidence

| Item | Value |
| --- | --- |
| Pull request | #245, `arena/c85e524b-revluma` → `main` |
| Merge commit on `origin/main` | **`192b2d0ed7596796fe6aaabc6bb13e2e0a647d5d`** |
| Merge strategy | `gh pr merge 245 --merge` (no branch protection bypass) |
| All 8 branch commits verified ancestors of `origin/main` | `c888117`, `9782d88`, `80b2765`, `5f9681d`, `5a99564`, `e295f2c`, `46c0827`, `9936caa` — all **IN MAIN** |
| Vercel production deployment | **`dpl_65xZ4GTEWcmevzd5dMQhW5eGCFbe`** |
| Vercel state | `status: READY`, `ready_state: READY`, `readySubstate: PROMOTED`, `target: production` |
| Vercel git source | `github / main / 192b2d0ed7596796fe6aaabc6bb13e2e0a647d5d` |
| Vercel aliases | `revluma.vercel.app`, `revluma-splendor-dev01s-projects.vercel.app`, `revluma-git-main-splendor-dev01s-projects.vercel.app` (`aliasAssigned: true`) |
| Vercel build | `timeToReady` 96,594 ms, region `iad1`, build cache hit |
| Previous production (rollback target) | `dpl_3mXszWAt3nJKUF6aFZyy8JrieNQb` at `941640b` |
| Render Node service | **NOT CONFIRMED** — cannot be triggered or observed from this environment |
| Render Python service | **NOT CONFIRMED** — cannot be triggered or observed from this environment |

Vercel hosts the **frontend only**. A green Vercel promotion says nothing about
whether the Node or Python services are running the merged code, and it must not
be read as an end-to-end deployment.

### Production database observation after the merge (read-only, 11:38:25 UTC)

Queried directly against Supabase project `jblpgqmbgdlzitprudgt`:

| Signal | Value | Reading |
| --- | --- | --- |
| `now()` | `2026-11-02 11:38:25+00` | — |
| `max(stores.last_synced_at)` | `2026-11-02 11:33:55+00` | **Node is alive and syncing normally** |
| `max(business_states.generated_at)` | `2026-11-02 08:00:20+00` | **Python has not rebuilt in 3h38m** |
| rows created in last 30 min | `0` | No rebuild activity |
| current snapshots with `valid_until > now()` | `0` of 5 | Every snapshot is expired |
| `count(*)` business_states | `33,717` (unchanged) | Retention pruning has not yet run, consistent with Python being down |

The merge landed at 11:35:28 UTC, roughly three minutes before this query, so a
Render build may simply not have finished. **This is not evidence that the fix
failed** — but it is also not evidence that it worked. The question "is the
Python service running `192b2d0` and rebuilding snapshots?" is **open** and can
only be closed from Render logs and a later database observation.

---

## 5. Live production state observed (read-only)

Supabase project `jblpgqmbgdlzitprudgt`, inspected read-only on 2026-11-02
~10:30 UTC. 65 tables. Relevant counts: organizations 35 · users 36 · stores 5 ·
orders 6 · order_items 5 · customers 31 · products 3 · conversations 118 ·
conversation_messages 650 · business_states 33,717 · webhook_deliveries 197.

All 5 current Business State snapshots had `generated_at` 08:00:01–08:00:20 and
**`valid_until` 08:15 — expired**, `next_rebuild_at` NULL, while Node continued
syncing stores at 10:03 and 10:18 UTC. Python had therefore been failing from
~08:00 UTC, consistent with the `2b14ee3` deploy.

Vercel production at time of writing: `dpl_3mXszWAt3nJKUF6aFZyy8JrieNQb`
(`main@941640b`, READY/PROMOTED, alias `revluma.vercel.app`). Rollback candidate
for the last known-good Python: `dpl_h9v2Dx95Gys2gZSHeDfr6bdc7hBC` (`a28aa65`).

Candidate live-acceptance merchant, identified read-only from the database and
**not yet exercised**: store `3ed79446-cb6d-4a1c-b174-9ec1ab91fe15`, organization
`1dc6aa19-9737-4770-a340-ff812a8b139a`, "Splendor's Store", Shopify,
`revluma-test-store-v1.myshopify.com`, status active, access token present, all
24 granted scopes, last synced 2026-11-02 10:03:56.

---

## 6. Migrations

**No migration was added or run in this work.** The existing four indexes on
`business_states` were inspected and are adequate:
`business_states_pkey`, `idx_bstate_computing` (`WHERE computation_status <>
'complete'`), the unique partial `idx_bstate_org_current` (`WHERE is_current =
true`) and `idx_bstate_org_generated`. The retention policy needs no schema
change. `Backend/prisma/migrations/` is unchanged at 16 entries.

Nothing in this report may be read as a claim that any migration succeeded.

---

## 7. Tenant isolation

Covered by tests that exist and pass:
`test_every_database_parameter_is_organization_scoped` and
`test_tool_catalog_is_read_only_and_typed`, plus the authorization layer of
`test_rev_prompt_injection.py` and
`test_classification_never_leaks_another_tenants_scope`. `run_tool` raises
`ToolAuthorizationError` on an empty or `None` organization, and every SQL
statement is parameterised with `organization_id`.

These are **automated tests against fixtures**. They are not a substitute for a
live cross-tenant check against production data, which has not been performed.

---

## 8. Read-only boundary

Enforced at three points and tested: `detect_prohibited_actions()` before any
tool runs; the `read_only_boundary` result path; `_validate_narrative()`
rejecting execution phrases in model-written text. The frontend asserts no
suggested question contains a write verb. No Rev code path performs a write to
merchant commerce data.

---

## 9. Unexecuted mandatory gates

Every item below is **required by the mandate and NOT done**. None may be
reported as passed.

| # | Gate | Status | Exact blocker |
| --- | --- | --- | --- |
| 1 | **LIVE-001 … LIVE-015** merchant acceptance (≥ 5 must pass, including follow-up, evidence, freshness and unknown-question cases) | **NOT EXECUTED** | No outbound HTTP from this environment to `revluma-backend-vrsd.onrender.com` or `revluma.vercel.app`. Allowlisted hosts are github.com, codeload.github.com, api.github.com, registry.npmjs.org, pypi.org, files.pythonhosted.org only. Requires a human or CI runner with network access to the deployed stack and a real authorized connected merchant. |
| 2 | **Merge to `origin/main`** | **DONE** | Merged as `192b2d0` via `gh pr merge 245 --merge` after all 8 CI checks passed on `9936caa`. Branch protection was not bypassed. See section 4b. |
| 3 | **Deploy to Vercel (frontend)** | **DONE — READY/PROMOTED** | `dpl_65xZ4GTEWcmevzd5dMQhW5eGCFbe` at `192b2d0`, aliased to `revluma.vercel.app`. Frontend only; see section 4b. |
| 4 | **Deploy Node service to Render** | **NOT CONFIRMED** | Render cannot be triggered or observed from this environment (host outside the allowlist; no Render connector). Node was already healthy before the merge (store sync 11:33:55 UTC) but whether it runs `192b2d0` is unverified. **User action required.** |
| 5 | **Deploy Python service to Render** | **NOT CONFIRMED — and production still shows it down** | As of 11:38:25 UTC the newest Business State snapshot is still 08:00:20 UTC and 0 of 5 current snapshots are valid, while Node synced at 11:33:55 UTC. The merge landed only ~3 minutes earlier, so a Render build may not have completed. Render logs are required both to confirm the deploy and to close out why rebuilds stopped at ~08:00 UTC — local lifespan boot succeeds, so any residual failure is deploy/config-side and remains **undiagnosed**. **User action required.** |
| 6 | **Backend `npm test`** | **CLOSED VIA CI** | Could not run locally (`prisma generate` requires `binaries.prisma.sh`, outside the allowlist). CI `Backend test suite` and `backend` both **pass** on `46c0827`, and `Prisma bootstrap, financial and security regressions` runs the Backend suite Prisma-backed and passes. |
| 7 | **CI run on this branch** | **CLOSED — ALL GREEN** | All 8 checks pass on `46c0827`; see section 4. Note that Actions *log* download remains blocked (`results-receiver.actions.githubusercontent.com` is outside the allowlist, `gh run view --log-failed` returns EOF); failure detail was obtained from check-run **annotations** via `api.github.com` instead. |
| 8 | **One-time prune of 33,712 superseded `business_states` rows** | **NOT PERFORMED** | Destructive production data operation. Requires explicit approval. The automatic retention policy is in place and draining, so this is an optimisation, not a correctness dependency. |
| 9 | **Live provider generation against production configuration** | **NOT VERIFIED** | No authorized provider key is available in this environment, and none may be introduced. The narrative path is tested with a fake provider; when it is unavailable the deterministic composition is returned and the degradation is recorded. |

### Hard environment blockers (confirmed, do not retry)
- No outbound HTTP to `revluma-backend-vrsd.onrender.com`, `revluma.vercel.app`
  or `binaries.prisma.sh`.
- GitHub Actions log download returns EOF; logs are unobtainable via `gh`.

---

## 10. Truthfulness statement

Per the mandate's rules, explicitly:

- **Not production-ready.** Only local automated tests passed. Live acceptance
  was not executed.
- **Not live-verified.** Every test result in section 4 comes from local runs
  against fixtures, in-memory fakes or SQLite. No result in this report was
  produced against a live merchant, a live Shopify connection or a live provider.
- **Merged — this claim is now true and evidenced.** PR #245 was merged to
  `origin/main` as `192b2d0` after all 8 CI checks passed, without bypassing
  branch protection. All 8 commits were verified as ancestors of `origin/main`.
- **Partially deployed.** The **Vercel frontend** is `READY`/`PROMOTED` at
  `192b2d0` (`dpl_65xZ4GTEWcmevzd5dMQhW5eGCFbe`, aliased to `revluma.vercel.app`)
  — that is a verified fact read from the Vercel API, not an inference. The
  **Render Node and Python services are NOT confirmed deployed**: they could be
  neither triggered nor observed from this environment. Vercel hosts the frontend
  only, so its green promotion is **not** an end-to-end deployment claim.
- **The production symptom is not confirmed resolved.** At 11:38:25 UTC the
  newest Business State snapshot was still 08:00:20 UTC and 0 of 5 current
  snapshots were valid. The boot fix is merged and the frontend is live, but
  "Python is healthy in production" is **unproven** and, on the evidence
  available, still false at the time of writing.
- **No migration claim.** No migration was added, run or verified.
- **Tenant isolation** passed as *automated fixture tests only* — not as a live
  cross-tenant verification.
- **Streaming** is verified by tests that exercise the real generator lifecycle
  (cancellation mid-stream, close-before-start, permit held to final body chunk),
  not by a live streamed response from production. No claim is made that
  end-to-end streaming works in production.
- **No invented merchant facts.** No metric, revenue figure, cause, conversion
  rate, benchmark or forecast in this document is derived from a real merchant's
  data. The counts in section 5 are row counts read from the production database
  schema, not business metrics, and no customer data was exported or reproduced.
- **Fixture use** was confined to unit tests, as permitted. No mock merchant,
  synthetic store or seeded demo data is offered as evidence of production
  readiness.

---

## 11. Recommended next steps, in order

1. Push `arena/c85e524b-revluma` and open a pull request; read the CI result for
   the exact SHA — specifically `Rev Python regression tests` (must pass, and
   must gate the deploy), `Backend tests`, `dashboard-auth-regression` and
   `release-candidate-verification`.
2. Confirm Backend tests green in CI, since they could not run locally.
3. Merge to `main` only after CI is green on the merge candidate.
4. Deploy Vercel (frontend) and Render (Node, Python); capture deployment IDs and
   the exact deployed SHA.
5. Read Render Python logs to close out why rebuilds stopped at ~08:00 UTC —
   this is still undiagnosed and local boot success does not explain it.
6. Execute LIVE-001 … LIVE-015 against the real authorized connected merchant,
   read-only, recording exact requests and responses. At least five must pass,
   including a follow-up, an evidence-inspection, a freshness and an
   unknown-question case.
7. Only then update this report and `PHASE-STATUS.md` with the live evidence, and
   request approval for the one-time `business_states` prune.
