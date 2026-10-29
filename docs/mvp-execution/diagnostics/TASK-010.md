# REVLUMA — TASK 010 EXECUTION REPORT

## A. Task identification

- Task 010 of 406: Map existing checkout reconciliation tests.
- Phase 1 — Reliable Data Foundation; category 1A Baseline and Architecture.
- Execution date: 2026-10-29, client Africa/Lagos context.
- Application/test baseline: `d41074872561cd84edf47d7d2374dfc6df847f37` (`origin/main`).
- Working branch: `docs/mvp-execution-task-010`.
- Production backend: `cfb41b7b468bfecd537d841d55c450ff21673342`, Render deployment `dep-dbhqdso8v5cc7395g6i0`, reported live on inspection.
- Alignment: Branch differs from production, but `git diff cfb41b7 origin/main -- Backend` was empty. Backend/test conclusions apply to identical Backend content; the dashboard-auth workflow differs and is outside the audited purchase tests.
- Diagnostic work: completed. Product reconciliation verification: PARTIAL; direct persistence/event-sequence coverage is missing.
- Final execution verdict: PARTIAL because remote publication/deployment suppression and historical records remain limited; see Q/R. This is not a verdict that the production reconciler fails.

Prior [Task 008](TASK-008.md) and [Task 009](TASK-009.md) are preserved with original SHAs, evidence, limitations and PARTIAL statuses. No repeat architecture/schema investigation was undertaken. Reports 001–007 were not found in repository docs or targeted Library report-title searches; their available task prompts and conversation mentions were not treated as completed reports. No placeholders were fabricated.

## B. Test infrastructure

| Component | Existing implementation | Evidence |
|---|---|---|
| Runtime here | Node v24.22.1; npm 11.9.0; CommonJS | Local version commands; Backend/package.json type commonjs |
| Framework | node:test with node:assert/strict, plus self-executing assertion scripts | Tests in Appendix 1 |
| Normal backend command | `npm test` → `node scripts/run-tests.js` | Backend/package.json scripts; scripts/run-tests.js:1–36 |
| Discovery | Recursively every `.test.js` under Backend/src, sorted and run individually with node | scripts/run-tests.js:5–14,17–35 |
| Directories | src/tests, src/services/__tests__, src/controller/__tests__, colocated service tests; also Backend/tests | No formal unit/integration/E2E split |
| Excluded from npm test | Backend/tests/revDirectAnswerContract.test.js | Runner starts at src only; this file is a Rev response contract, not reconciliation |
| Test configuration | No backend Jest/Vitest/Mocha/Supertest setup or dedicated reconciliation suite found | package.json, file inventory and import searches |
| Test database | No real reconciliation test DB configuration/fixture found | Tests use stubs, injected clients/DBs or source inspection |
| Default runner env | Supplies dummy JWT/cookie/encryption/SendGrid defaults but otherwise inherits environment | run-tests.js:19–27; task used a stricter isolated environment |
| CI | Backend tests workflow runs npm ci/npm test on matching PRs and main pushes (Node 22); refresh workflow on matching PRs/manual dispatch (Node 20) | .github/workflows/backend-tests.yml; backend-refresh-regression.yml |
| Python adjacency | pytest configured in workflow; this local Python lacks pytest | .github/workflows/rev-python-tests.yml; actual command failure in N |

The default test runner inherits environment rather than provisioning a disposable database. That is not proof tests will write production, but commands must be scoped/safety-reviewed before execution. For this audit only inspected pure/mock/static cases ran, with production connection env omitted and no .env files present. No application server, scheduler, sync runner or live provider call was started.

## C. Existing tests and actual scope

The exact cases, lines, assertions and results are inventoried in Appendix 1. Selected Node set: 13 files, 44 runner entries. Four assertion-style scripts count as one runner entry each rather than each internal verification function. No direct test invoking persisted checkout-to-order matching was found.

Relevant groups:

- `checkoutInactivity.test.js`: eight helper tests covering inactivity boundaries, source timestamp preference, pending/recovered/stale state decisions and invalid date eligibility. These do not call the database promotion job or persistence handler.
- `shopify.callback.test.js`: seven mock-backed verification functions. One calls real `claimDelivery` with a Prisma mock that always simulates P2002 and allows a failed → received transition once. The rest cover OAuth/setup/status projection, not purchase matching.
- `integration.contract.test.js`: source substring assertions for raw webhook placement, signature/delivery function names and internal sync wiring. It does not send HTTP requests or verify signed payload processing.
- `shopifyWebhookService.test.js`: four module-mocked verification functions for **subscription registration reconciliation**. This is distinct from checkout/order reconciliation.
- `intelligenceShopifyPagination.test.js`: nine cursor/scope/financial normalization/optional prediction utility tests. Does not call syncOrders, syncAbandonedCheckouts or syncShopifyStore.
- `shopifySyncRecovery.test.js`: four pure eligibility-predicate tests, not job restart or checkpoint/persistence verification.
- `shopifyRefundTotals.test.js`: five pure refund-math tests, not order financial persistence or checkout recovery.
- `intelligenceShopifyCoverageProducer.test.js` and `intelligenceOrderCoverage.test.js`: six mock-backed bounded-order-coverage proof/issuer tests. These verify dataset evidence gates, not purchase/cart relationships.
- `mvpCheckoutCoverage.test.js`: one supplied-DB test that order coverage never implies complete checkout-funnel evidence.
- `intelligenceFindingsAggregator.test.js`: three supplied-DB tests including tenant argument checks and unverified funnel/lifetime suppression.
- `operationalOverviewRepository.test.js`: one assertion-script runner entry checks organization/store query filters, including cart groupBy; not cross-store matching rejection.
- `shopifyInventoryObservation.test.js`: four injected-client catalog completeness/scope tests; inventoried as adjacent, not checkout reconciliation proof.

Python `test_business_state_cart_dedup.py` has two static SQL-source checks: partition-by-store/external cart identity, unrecovered filter and retained 48-hour window. `test_historical_ingestion.py` uses mock SQLAlchemy for RFM/baseline/memory seeding; it is not the Node Shopify import path and contains a weak empty-store assertion accepting complete/partial/failed. Python event/pipeline/ML/briefing tests mentioning checkout exercise feature extraction or response quality, not Node FK/order-cart persistence. These were inspected for relevance; no broad Python suite was run.

## D. Production-to-test mapping

| Production function | Source | Existing relevant test | Coverage type / status |
|---|---|---|---|
| `upsertOrder` (order create/update and relationship matching) | commerceWebhookService.js:117–258 | None | NOT COVERED — No automated test found |
| `cancelOrder` | commerceWebhookService.js:261–272 | None | NOT COVERED — No automated test found |
| `upsertAbandonedCart` (checkout create/update) | commerceWebhookService.js:275–337 | None | NOT COVERED — No automated test found |
| `processCommerceWebhook` dispatcher | commerceWebhookService.js:358–389 | Source contract refers to controller, not dispatcher execution | NOT COVERED for persisted event routing |
| `claimDelivery` | commerceWebhookService.js:37–54 | callback:verifyFailedWebhookDeliveryCanRetryOnce | Mock Prisma; PARTIAL delivery retry/dedup only |
| `lastCheckoutActivity`, `isCheckoutInactive`, `nextCheckoutStatus` | checkoutInactivity.js:5–24 | checkoutInactivity eight cases | Pure helper assertions; VERIFIED locally within that scope |
| `promoteInactiveCheckouts` | schedulerService.js:719–733 | None | NOT COVERED — no job/DB eligibility assertion |
| `syncOrders`, `syncAbandonedCheckouts`, `syncShopifyStore` | shopifySync.js:184,248,321 | Utility tests only; callback mocks runner | NOT COVERED for actual reconciliation/persistence |
| `fetchConnection`, `verifyOrderReadScope`, `orderPayload`, optional deadline | shopifySync.js | intelligenceShopifyPagination | Pure/injected client; VERIFIED locally for tested utilities |
| `storeSyncEligibility` | shopifySyncRecovery.js:5–22 | shopifySyncRecovery | Pure predicate; not restart/resume proof |
| `shopifyNetOrderTotal` | commerceWebhookService.js:99–115 | shopifyRefundTotals | Pure financial helper, not relationship proof |
| `verifyShopifyOrderCoverage`, `certifyOrderCoverage` | intelligenceShopifyCoverageProducer.js; intelligenceOrderCoverage.js | coverage producer/issuer tests | Supplied DB/API; not database constraint verification |
| `fetchTenantOperations` | operationalOverviewRepository.js:4–30 | colocated repository test | Query-argument checks only |

## E. Identifier matching coverage

No selected or discovered backend test passes a Shopify order+checkout identity set through upsertOrder and verifies the chosen cart, stored FK and final lifecycle. **Checkout ID, checkout_token and cart_token matching are all missing direct tests.**

Also missing: normalization of ID/GID/token formats; missing order/checkout references; two candidate IDs selecting different carts; existing verified-link preservation; one checkout already claimed by another order; duplicate identifiers across stores; large numeric Shopify identifiers; refusing matches based only on email/customer/value/time; coupon fallback false-match rejection. An orderPayload test supplies a GID but asserts only adjusted money and currency, so it does not verify GID normalization or linkage. Missing scope tests concern permissions, not missing checkout identifiers.

This confirms a coverage gap, not an observed matching defect. Existing source-supported identity concerns remain in Tasks 008/009; future Tasks 017–028,038,041–045 must consult those reports.

## F. Event sequence coverage

No checkout-first or order-first persisted lifecycle test was found. There is no sequence fixture that creates the two business rows, links them and asserts abandonment exclusion. Order-update-before-create, checkout-update-before-create, stale order update, checkout-first then historical import, historical-first then late checkout, and historical sync/webhook overlap are not tested end-to-end or against a test DB.

`nextCheckoutStatus({existingStatus:'recovered'})` and `nextCheckoutStatus({isStale:true,...})` test state decisions in isolation. They do not derive staleness from two incoming webhook timestamps, exercise locks, or demonstrate preserved FK/items. Consequently delayed-update coverage is PARTIAL at helper level only.

## G. Completion and abandonment coverage

| Scenario | Existing assertion | Quality for persisted business invariant | Status |
|---|---|---|---|
| Purchase before abandonment | CompletedAt/recovered input returns recovered in helper | PARTIAL; promotion job not called | Helper pass; sequence missing |
| Purchase after abandonment | CompletedAt returns recovered, without an existing abandoned input in that test | PARTIAL; actual abandoned→purchase row transition absent | Helper pass; transition missing |
| Delayed checkout after completion | Existing recovered returns recovered | PARTIAL; no timestamp/persistence/handler execution | Helper pass; lifecycle missing |
| Concurrent classification/completion | None | No test | Missing |

Threshold details: fixed now is supplied explicitly, not a global fake clock. Tests cover 14 minutes, boundary minus 1 ms, exactly threshold, 16 minutes, a recent activity reset, source historical updated_at, and invalid isCheckoutInactive input. Missing/future activity timestamps and duplicate event timestamps have no dedicated case. The helper constant drives expected values, so the threshold test does **not** independently assert 900000 milliseconds: a wrong constant could move both expected boundary and implementation together. No test checks actual promotion query where-clause, recovered_at guard, source-time vs processing-time overwrite or job atomicity.

## H. Reliability coverage

Delivery claiming is distinct from business-state idempotency. Mocked failed-delivery reclaim is tested once; repeated business order create/update and checkout create/update with different delivery IDs are not. No assertion checks final row count, relationship count, completion preservation or repeated downstream effects after replay.

No simulated parallel purchase/cart writes or database-backed concurrency test was found for: two orders, two checkouts, order+checkout, completion+classification, or historical sync+webhook. Sequential function calls in delivery-retry tests do not prove lock/transaction isolation.

Tenant tests verify query arguments for operational reads and order-coverage ownership, not checkout lookup/write or rejection of a foreign-store cart/customer. No cross-merchant persistence, same-external-ID/different-store purchase fixture or composite-FK enforcement test was found. Task 009's schema limitations are therefore not counterbalanced by demonstrated application-level reconciliation tests.

## I. Database persistence coverage

No isolated real PostgreSQL test database, migrations-to-test-DB setup or fixture rollback harness was found for reconciliation. None of the selected tests connects to a DB. Actual cart/order FK storage, uniqueness, recovered_at, completion state, transaction rollback, no-orphan behavior and lock behavior remain unverified by these tests. Supplied Prisma objects proving query inputs or certificate counts do not prove PostgreSQL constraints. Importing Prisma through a module is not evidence a test uses it against a DB.

## J. Historical synchronization coverage

Verified utilities include explicit terminal/malformed/stalled pagination, two pages in order, 100-page rejection, order scopes, adjusted totals, optional prediction deadline/rejection and stale-store selection. The historical timestamp test preserves updated_at in a helper. Bounded financial coverage is checked against injected source/local rows.

Missing relationship scenarios: historical order before checkout, existing checkout before historical order, live order before import, imported completed order with associated cart, imported abandoned checkout with completed purchase, missing historical checkout identities, overlapping webhook/import, duplicate rows, preserved relationship/status and stale item replacement. Python cold-start ingestion tests operate on local analytics seeding and must not be counted as tests of Shopify API ingestion or Node reconciliation.

## K. Errors and retries

- Mock delivery P2002 is handled by failed→received reclaim; a second in-flight claim returns null. No full failed processing followed by successful business-row retry is verified.
- Callback persistence error test injects P2021 at mocked store upsert and checks safe error redirect/stage. It does not test failed checkout/order transaction recovery.
- Subscription setup tests cover list errors, topic rejection, persistence error continuation and retry, strictly within webhook registrations.
- Sync utility tests reject bad pages/scopes and contain optional prediction failure. They do not demonstrate resumed import or rollback after partial cart/order writes.
- No reconciliation test was found for DB connection failure, transaction error, unique-conflict recovery, invalid commerce payload, missing parent record, ambiguous identifiers, preserved relation after error or background process interruption.

## L. Fixtures and assertion quality

| Fixture/assertion group | Actual data | Assessment |
|---|---|---|
| Checkout state helpers | Controlled Dates and status strings, no complete Shopify webhook | STRONG for narrow helper outputs; PARTIAL for completed-purchase invariant |
| Callback delivery test | Fake store/delivery IDs; create always throws P2002; closure changes status | STRONG for mocked reclaim branch; PARTIAL for delivery lifecycle; no real DB |
| Scope/pagination | Injected connection pages, simple IDs a/b and GID Order/123 | STRONG for asserted utility behavior; not schema-valid complete checkout/order fixtures |
| Coverage proof | One refunded order, UUID store/org; mock DB totals and gap count | STRONG for evidence gate; no authoritative cart relationship fixture |
| Operational tenant queries | org-owned/store-owned sentinel strings; captured args | STRONG for stated filters; PARTIAL for full authorization/foreign-store matching |
| Subscription reconciliation | Mock GraphQL topic/error/subscription rows | STRONG for subscription behavior; no purchase matching coverage |
| Static controller contract | Source substring/indexOf checks | WEAK as HTTP, signature validation or persistence proof |
| Python cart aggregate | SQL substrings/ROW_NUMBER partition/filter | PARTIAL; verifies source pattern, not returned DB aggregate |
| Python historical empty store | status may be complete, partial or failed | WEAK as successful-ingestion proof; excluded from reconciliation execution |

No shared full Shopify order+checkout payload fixture with checkout IDs/tokens, line items, source timestamps, conflicting matches and multiple merchants was found in the relevant tests. OAuth/header cryptography fixtures belong to OAuth tests, not a full signed commerce webhook replay. Tests configure/mock the 2026-10 scope path where applicable; this does not validate commerce fixture compatibility with a live Shopify 2026-10 API schema. No API operation or fixture modification was performed.

## M. CI integration

| Workflow | Trigger / execution | Evidence and limits |
|---|---|---|
| Backend tests | PR paths Backend/** or its own YAML; main push same paths; Node 22; npm ci; npm test | Test script exits at first nonzero file; configured selected src tests are discoverable |
| Backend refresh regression | PR paths Backend/**/its own YAML; workflow_dispatch; Node 20; syntax check then npm test | Same src discovery; manual dispatch possible; no dedicated reconciliation job |
| Rev Python regression | PR/main paths python/**/its YAML or manual; Python3.11; pytest tests | Includes downstream source checks and historical analytics tests, not Node persistence |
| This docs-only change | Only docs/mvp-execution paths | Does not match these backend/Python workflow path filters |

No continue-on-error was found in these backend test steps. Failure blocks that workflow's success, but repository required-check/branch-protection rules were not verified. Thus execution before every merge or deployment is not guaranteed. Path filters, excluded Backend/tests directory, manual skips and direct merges can affect coverage. Render tracking main does not establish a CI dependency. Local Node24 differs from CI20/22; no cross-version claim is made.

A read of PR-triggered runs for d410748 returned an empty workflow_runs list; this limited API is not proof CI never ran. A separate workflow-specific history URL was rejected by the connector and was not treated as evidence of a failing CI run. No workflow rerun, dispatch or deployment was triggered.

## N. Safe test execution

Executed from Backend with a fresh subprocess environment containing only PATH/HOME/TMPDIR/LANG as available, NODE_ENV=test, SHOPIFY_API_VERSION=2026-10 and dummy JWT/cookie/encryption values. DATABASE_URL, DIRECT_URL, REDIS_URL/HOST and Python/provider credentials were not inherited. No local .env files existed. Existing generated local Prisma client/dependencies from the earlier audit were reused; no generation or install ran in Task 010.

Exact Node command (working directory Backend):

```bash
node --test src/tests/intelligenceShopifyPagination.test.js src/tests/shopifySyncRecovery.test.js src/tests/shopifyRefundTotals.test.js src/tests/intelligenceShopifyCoverageProducer.test.js src/tests/shopifyInventoryObservation.test.js src/tests/intelligenceOrderCoverage.test.js src/tests/mvpCheckoutCoverage.test.js src/services/__tests__/checkoutInactivity.test.js src/services/__tests__/shopifyWebhookService.test.js src/controller/__tests__/shopify.callback.test.js src/controller/__tests__/integration.contract.test.js src/tests/intelligenceFindingsAggregator.test.js src/services/operationalOverviewRepository.test.js
```

Result: exit 0; **44 pass, 0 fail, 0 skipped, 0 cancelled**, 13 files, runner duration approximately 326 ms. Self-executing assertion files each appear as one entry. This was a selected relevant set, not npm test/full backend suite, and not a dedicated reconciliation suite (none found).

Python working directory python:

```bash
python3 -m pytest -q tests/test_business_state_cart_dedup.py
```

Blocked: exit 1, `No module named pytest`; no test failure was inferred. Since this file only reads source text and imports pathlib, the two unchanged test functions were safely executed directly:

```python
import runpy
m = runpy.run_path('tests/test_business_state_cart_dedup.py')
for name in sorted(m):
    if name.startswith('test_'):
        m[name]()
        print('PASS', name)
```

Both passed: `test_cart_aggregate_remains_48_hour_window`, `test_cart_aggregation_and_opportunities_are_deduplicated`. These are two direct function executions, not a successful pytest session. Python historical-ingestion and other unrelated tests were not run. No tests were authored/changed to obtain these results.

## O. Requirement-by-requirement coverage matrix

| Requirement | Existing test / assertion | Quality for reconciliation | Execution | Coverage / future task |
|---|---|---|---|---|
| Checkout-first persisted reconciliation | None found | — | Not available | Missing; 031–033,049 |
| Order-first persisted reconciliation | None found | — | Not available | Missing; 031–032,043–045 |
| Checkout ID exact matching | None found | — | Not available | Missing; 017 |
| Checkout token matching | None found | — | Not available | Missing; 018 |
| Cart token matching | None found | — | Not available | Missing; 019 |
| ID/GID normalization | None found | — | Not available | Missing; 028 |
| Missing checkout reference | None found | — | Not available | Missing; 041–043 |
| Missing checkout token/cart token | None found | — | Not available | Missing; 018–019,041 |
| Conflicting identifiers | None found | — | Not available | Missing; 026 |
| One checkout already claimed by another order | None found | — | Not available | Missing; 027 |
| Large Shopify numeric ID parsing | None found | — | Not available | Missing; 013–014,028 |
| Preserve existing verified relationship | None found | — | Not available | Missing; 024,030 |
| Reject email/customer/amount/time-only match | None found | — | Not available | Missing; 020–022 |
| Coupon fallback false-match rejection | None found | — | Not available | Missing; 023 |
| Business idempotency: order create/update | None found | — | Not available | Missing; 034,074 |
| Business idempotency: checkout create/update | None found | — | Not available | Missing; 035,075 |
| Order update before order creation | None found | — | Not available | Missing; 004,049 |
| Checkout update before checkout creation | None found | — | Not available | Missing; 006,049 |
| Concurrent order webhooks | None found | — | Not available | Missing; 034,036 |
| Concurrent checkout webhooks | None found | — | Not available | Missing; 035–036 |
| Concurrent order and checkout | None found | — | Not available | Missing; 036 |
| Concurrent classification/completion | None found | — | Not available | Missing; 029,036 |
| Cross-store lookup/write and conflicting external IDs | None found | — | Not available | Missing; 082–086 |
| Real DB relationship/unique/FK/rollback assertions | None found | — | Not available | Missing; 024,036,094 |
| Historical order before/after checkout | None found | — | Not available | Missing; 044–045 |
| Live webhook before historical import | None found | — | Not available | Missing; 074–076 |
| Historical sync/webhook overlap and stale data | None found | — | Not available | Missing; 036,076 |
| Invalid commerce payload/missing order ID | None found | — | Not available | Missing; 014,041,049 |
| Transaction/database failure retry | None found | — | Not available | Missing; 064,049,357 |
| Background interruption/restart preserving relationships | None found | — | Not available | Missing; 351–352 |
| Completed checkout protection | checkoutInactivity: completed checkouts remain recovered even after late webhook events | PARTIAL: pure output only | Pass | 029–030 |
| Abandoned-to-completed transition | completedAt helper case; no persisted abandoned input/sequence | PARTIAL | Pass helper; no transition test | 029,033 |
| Delayed checkout update | existingStatus recovered / isStale helper inputs | PARTIAL: no handler timestamps/DB | Pass | 030 |
| 15-minute before/exact/after boundary | checkoutInactivity first two cases | STRONG helper boundary; no job | Pass | 007,029 |
| Recent activity / source historical timestamp | checkoutInactivity activity reset/source update cases | STRONG helper; no sync DB write | Pass | 067,076 |
| Missing/future timestamp or duplicate-time update | None dedicated | — | Not available | Missing; 007,049 |
| Invalid activity date | isCheckoutInactive invalid input case | STRONG helper eligibility only | Pass | 007 |
| Webhook delivery retry/dedup | callback verifyFailedWebhookDeliveryCanRetryOnce | PARTIAL: mocked P2002 branch | Pass assertion script | 063–064 |
| Store query scoping on operation reads | operationalOverviewRepository captured args | PARTIAL: not reconciliation | Pass assertion script | 082–086 |
| Bounded order coverage tenant ownership | intelligenceOrderCoverage issuer test | PARTIAL: not order-cart matching | Pass | 082–086 |
| Pagination/scopes and adjusted total normalization | intelligenceShopifyPagination | STRONG for utilities; no relationship proof | 9 pass | 066,078 |
| Refund financial arithmetic | shopifyRefundTotals | STRONG for pure helper | 5 pass | 078 |
| No checkout-funnel claim from order proof | mvpCheckoutCoverage | STRONG for evidence suppression | Pass | 080,123–124 |
| Stale syncing store selection | shopifySyncRecovery | STRONG predicate; not job recovery | 4 pass | 073,351–352 |
| Subscription registration retry | shopifyWebhookService mock tests | Not purchase matching | Pass assertion script | 059–061 |
| Downstream cart aggregate dedup/source filter | Python business-state source checks | PARTIAL: static SQL patterns | 2 direct functions pass; pytest unavailable | 119 |

## P. Findings register

Existing source/schema risks retain their original report references and are indexed in the [central register](../audit-register.md). The following are Task 010 **verification gaps**, not demonstrated production failures. No coverage percentage is invented.

| Finding ID | Severity | Description / impact | Evidence | Future task | Status |
|---|---|---|---|---|---|
| REV-FIND-0038 | Critical | No direct persisted checkout/order matching tests. Purchases can be unverified despite green helper tests. | D/E/I; full Backend test search | 017–028,049 | OPEN |
| REV-FIND-0039 | High | No checkout-first/order-first or full completion-override lifecycle tests. Completed purchases and false abandonment lack sequence regression proof. | F/G | 029–033,044–045,049 | OPEN |
| REV-FIND-0040 | High | Delivery dedup is not business-state idempotency coverage. Replays with new delivery IDs have no row-count/downstream-effect assertions. | H/K; callback.test.js:289–296 | 034–035,063–064,074–075 | OPEN |
| REV-FIND-0041 | High | No concurrency/transaction rollback database harness. Races, uniqueness and rollback correctness remain untested. | H/I; no matching DB setup found | 036,049,094,357 | OPEN |
| REV-FIND-0042 | High | Tenant query-filter tests do not prove cross-store matching rejection. Wrong-store association prevention lacks behavioral proof. | H; operationalOverviewRepository.test.js | 082–086,093–094 | OPEN |
| REV-FIND-0043 | High | Historical import/webhook reconciliation overlap untested. Older snapshots or repeated imports lack linkage-preservation regression checks. | J; utility imports in pagination.test.js | 044–045,066–067,074–076 | OPEN |
| REV-FIND-0044 | Medium | Threshold helper tests omit promotion job and several time edge cases. Wrong job predicates/timestamp behavior could pass helper tests. | G; checkoutInactivity.test.js:8–39 | 007,029,049 | OPEN |
| REV-FIND-0045 | Medium | CI required checks and deploy gating not verified; runner excludes Backend/tests. Configured test runs do not establish mandatory premerge/predeploy verification. | B/M; run-tests.js:17–35 | 050,100,371 | OPEN |
| REV-FIND-0046 | Medium | No realistic full paired commerce fixtures or schema-version replay. Token conflicts, large IDs and order/cart variants lack realistic regression inputs. | L; inspected inline fixtures | 013–014,038–040,049 | OPEN |
| REV-FIND-0047 | Low | Prior execution reports 001–007 unavailable. Earlier diagnoses cannot be reliably reconstructed; do not rerun automatically. | A; report title/repository search | BACKLOG MAPPING REQUIRED | OPEN |

## Q. Final assessment

**PARTIAL — Test audit or documentation completed with important limitations.**

The test architecture and specific gaps are mapped; 44 selected Node entries and two direct Python source checks pass. A green result does not certify persisted purchase reconciliation. The repository documentation system is established and version-controlled locally. Reports 001–007 remain unavailable, pytest is missing, mandatory CI gates were not established, and production behavior was not tested. Remote publication is withheld pending verified suppression of automatic deployment: Task 010 expressly prohibits triggering deployments, and a branch push/PR can invoke the connected frontend integration. No hosting settings were changed to work around that restriction.

The authorized documentation-only local commit is the delivery reference; its hash is reported in the final response and can be read from git log for this path. No merge, deployment or application change occurred. A remote PR is not claimed. The next assigned task is **TASK 011 — Record Shopify API version used by backend**; it has not begun.

## R. Changes made and preservation

- Created README.md, audit-register.md, implementation-decisions.md, backlog.md and diagnostics/TASK-010.md.
- Imported diagnostics/TASK-008.md and TASK-009.md byte-for-byte from recovered prior reports; original PARTIAL verdicts preserved.
- Created validation/ and implementation/ directories without inventing empty task reports (Git does not track empty directories).
- All tracked changes are under docs/mvp-execution/. No application/test/schema/config/generated client changes; no DB/Shopify/infrastructure writes or deploy calls.
- Reviewed relative links, source references, report provenance and documentation diff before commit.

## Appendix 1 — Exact executed Node cases and assertion evidence

All source links pin application/test content to the inspected d410748 commit. Cases marked pass were executed in this task. Assertion summaries are literal snippets, not claims of database behavior.

### src/tests/intelligenceShopifyPagination.test.js

Production function: fetchConnection / nextConnectionCursor / verifyOrderReadScope / orderPayload / optional deadline. Type: pure/mock/injected unit or static contract as described above; no DB-backed integration/E2E. Result: pass.

- [pagination finishes only with an explicit terminal page](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceShopifyPagination.test.js#L6) — pass. Assertions: `assert.equal(nextConnectionCursor({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, null, 'orders'), null);`; `assert.equal(nextConnectionCursor({ nodes: [{ id: 1 }], pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } }, null, 'orders'), 'cursor-1');`
- [rejects malformed, cursorless, and stalled Shopify pages](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceShopifyPagination.test.js#L10) — pass. Assertions: `assert.throws(() => nextConnectionCursor(connection, 'same', 'orders'), /pagination_(invalid|stalled)/);`
- [multi-page Shopify sync preserves all fetched records in order](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceShopifyPagination.test.js#L20) — pass. Assertions: `assert.deepEqual(rows.map(row => row.id), ['a', 'b']);`; `assert.deepEqual(cursors, [null, 'next']);`
- [Shopify sync rejects cursor stall without silently truncating records](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceShopifyPagination.test.js#L32) — pass. Assertions: `await assert.rejects(fetchConnection({}, '', 'orders', fetchPage), /pagination_stalled/);`
- [order permission gate rejects missing and unverified read_orders](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceShopifyPagination.test.js#L38) — pass. Assertions: `await assert.rejects(`; `await assert.rejects(`; `assert.deepEqual(result, { readOrders: true, readAllOrders: false });`
- [order import prefers Shopify adjusted total over original total](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceShopifyPagination.test.js#L52) — pass. Assertions: `assert.equal(payload.total_price, 70);`; `assert.equal(payload.currency, 'NGN');`
- [Shopify sync refuses unbounded pagination rather than claiming partial success](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceShopifyPagination.test.js#L64) — pass. Assertions: `await assert.rejects(fetchConnection({}, '', 'orders', fetchPage), { code: 'SHOPIFY_PAGINATION_LIMIT_EXCEEDED' });`; `assert.equal(calls, 100);`
- [optional ML prediction timeout does not block Shopify checkout ingestion](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceShopifyPagination.test.js#L75) — pass. Assertions: `assert.ok(Date.now() - started < 1000, 'deadline should return promptly');`
- [optional ML prediction rejection is contained](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceShopifyPagination.test.js#L81) — pass. Assertions: `await assert.doesNotReject(evaluateCartWithDeadline(async () => {`

### src/tests/shopifySyncRecovery.test.js

Production function: storeSyncEligibility. Type: pure/mock/injected unit or static contract as described above; no DB-backed integration/E2E. Result: pass.

- [stale syncing store is selected after 20 minutes](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/shopifySyncRecovery.test.js#L19) — pass. Assertions: `assert.equal(STALE_SYNC_MS, 20 * 60 * 1000);`; `assert.equal(matches({ platform: 'shopify', status: 'syncing', updated_at: new Date(NOW - STALE_SYNC_MS) }, where), true);`
- [recent syncing store is excluded to avoid duplicate execution](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/shopifySyncRecovery.test.js#L25) — pass. Assertions: `assert.equal(matches({ platform: 'shopify', status: 'syncing', updated_at: new Date(NOW - STALE_SYNC_MS + 1) }, where), false);`
- [active store with old sync is eligible but fresh active store is not](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/shopifySyncRecovery.test.js#L30) — pass. Assertions: `assert.equal(matches({ platform: 'shopify', status: 'active', last_synced_at: new Date(NOW - 16 * 60 * 1000) }, where), true);`; `assert.equal(matches({ platform: 'shopify', status: 'active', last_synced_at: new Date(NOW - 2 * 60 * 1000) }, where), false);`
- [non-Shopify and disconnected stores are never retried](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/shopifySyncRecovery.test.js#L36) — pass. Assertions: `assert.equal(matches({ platform: 'woocommerce', status: 'syncing', updated_at: new Date(0) }, where), false);`; `assert.equal(matches({ platform: 'shopify', status: 'disconnected', updated_at: new Date(0) }, where), false);`

### src/tests/shopifyRefundTotals.test.js

Production function: shopifyNetOrderTotal. Type: pure/mock/injected unit or static contract as described above; no DB-backed integration/E2E. Result: pass.

- [Shopify full refund yields zero net revenue](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/shopifyRefundTotals.test.js#L11) — pass. Assertions: `assert.equal(shopifyNetOrderTotal(order([refund('100.00')])), 0);`
- [Shopify partial refunds reconcile without double subtraction](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/shopifyRefundTotals.test.js#L14) — pass. Assertions: `assert.equal(shopifyNetOrderTotal(order([refund('20.00'), refund('15.50')])), 64.5);`
- [failed or pending refunds do not reduce revenue](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/shopifyRefundTotals.test.js#L17) — pass. Assertions: `assert.equal(shopifyNetOrderTotal(order([refund('100.00', 'failure'), refund('10.00', 'pending')])), 100);`
- [malformed refund transactions fail closed](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/shopifyRefundTotals.test.js#L20) — pass. Assertions: `assert.equal(shopifyNetOrderTotal(order([{ id: 1 }])), null);`; `assert.equal(shopifyNetOrderTotal(order([refund('not-a-number')])), null);`
- [nonrefunded Shopify orders retain original total](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/shopifyRefundTotals.test.js#L24) — pass. Assertions: `assert.equal(shopifyNetOrderTotal(order([])), 100);`

### src/tests/intelligenceShopifyCoverageProducer.test.js

Production function: verifyShopifyOrderCoverage (injected DB/API). Type: pure/mock/injected unit or static contract as described above; no DB-backed integration/E2E. Result: pass.

- [certifies matching refund-adjusted source and local orders](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceShopifyCoverageProducer.test.js#L29) — pass. Assertions: `assert.equal(result.customer_lifetime_verified, false);`; `assert.equal(f.certificates, 1);`
- [fails closed on missing order, stale refund, unresolved webhook, and cancelled source](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceShopifyCoverageProducer.test.js#L37) — pass. Assertions: `await assert.rejects(verifyShopifyOrderCoverage(f.db, shop, {`; `assert.equal(f.certificates, 0);`
- [does not certify if Shopify granted scopes cannot be verified](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceShopifyCoverageProducer.test.js#L49) — pass. Assertions: `await assert.rejects(verifyShopifyOrderCoverage(f.db, shop, {`; `assert.equal(f.certificates, 0);`

### src/tests/shopifyInventoryObservation.test.js

Production function: observeShopifyInventory (injected client). Type: pure/mock/injected unit or static contract as described above; no DB-backed integration/E2E. Result: pass.

- [reads catalog only after Shopify product scope is verified](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/shopifyInventoryObservation.test.js#L13) — pass. Assertions: `assert.equal(pages, 1);`; `assert.equal(result.products[0].variants[0].availableForSale, false);`; `assert.equal(result.alertEligible, false);`; `assert.equal(result.catalogPaginationComplete, true);`
- [denied or unverified permissions fail closed](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/shopifyInventoryObservation.test.js#L25) — pass. Assertions: `await assert.rejects(() => observeShopifyInventory(store, {`
- [partial variant pagination cannot be mistaken for a complete observation](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/shopifyInventoryObservation.test.js#L33) — pass. Assertions: `await assert.rejects(() => observeShopifyInventory(store, {`
- [missing availability and duplicate product IDs fail closed](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/shopifyInventoryObservation.test.js#L39) — pass. Assertions: `await assert.rejects(() => observeShopifyInventory(store, {`; `await assert.rejects(() => observeShopifyInventory(store, {`

### src/tests/intelligenceOrderCoverage.test.js

Production function: certifyOrderCoverage / validateCoverageManifest (supplied DB). Type: pure/mock/injected unit or static contract as described above; no DB-backed integration/E2E. Result: pass.

- [coverage issuer rejects every missing historical proof](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceOrderCoverage.test.js#L17) — pass. Assertions: `assert.throws(() => validateCoverageManifest(invalid), /cannot be certified/);`; `assert.throws(() => validateCoverageManifest({ ...manifest(), customerLifetimeVerified: true }), /cannot be certified/);`; `assert.throws(() => validateCoverageManifest({ ...manifest(), source: 'generic_shopify_sync' }), /cannot be certified/);`
- [coverage issuer verifies tenant ownership before persisting](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceOrderCoverage.test.js#L26) — pass. Assertions: `await assert.rejects(certifyOrderCoverage(db, manifest()), /ownership/);`; `assert.equal(writes, 0);`
- [verified manifest records bounded coverage without lifetime certification](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceOrderCoverage.test.js#L34) — pass. Assertions: `assert.equal(recorded.create.customer_lifetime_verified, false);`; `assert.equal(recorded.where.store_id, manifest().storeId);`

### src/tests/mvpCheckoutCoverage.test.js

Production function: evaluateOrganizationFindings (supplied DB). Type: pure/mock/injected unit or static contract as described above; no DB-backed integration/E2E. Result: pass.

- [certified order coverage does not silently certify checkout funnel coverage](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/mvpCheckoutCoverage.test.js#L6) — pass. Assertions: `assert.equal(missing.storeId, storeId);`; `assert.ok(missing.missing_evidence.includes('complete_checkout_starts'));`; `assert.equal(result.findings.some(item => /checkout/i.test(item.type)), false);`

### src/services/__tests__/checkoutInactivity.test.js

Production function: lastCheckoutActivity / isCheckoutInactive / nextCheckoutStatus. Type: pure/mock/injected unit or static contract as described above; no DB-backed integration/E2E. Result: pass.

- [a checkout remains active before 15 minutes](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/__tests__/checkoutInactivity.test.js#L10) — pass. Assertions: `assert.equal(isCheckoutInactive(new Date(now.getTime() - 14 * 60 * 1000), now), false);`; `assert.equal(isCheckoutInactive(new Date(now.getTime() - ABANDONMENT_INACTIVITY_MS + 1), now), false);`
- [checkout becomes eligible at 15 minutes](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/__tests__/checkoutInactivity.test.js#L14) — pass. Assertions: `assert.equal(isCheckoutInactive(new Date(now.getTime() - ABANDONMENT_INACTIVITY_MS), now), true);`; `assert.equal(isCheckoutInactive(new Date(now.getTime() - 16 * 60 * 1000), now), true);`
- [new checkout activity resets the timer](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/__tests__/checkoutInactivity.test.js#L18) — pass. Assertions: `assert.equal(isCheckoutInactive(recent, now), false);`
- [synchronization respects the original Shopify updated timestamp](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/__tests__/checkoutInactivity.test.js#L22) — pass. Assertions: `assert.equal(lastCheckoutActivity({ updated_at: historical }, now).toISOString(), historical);`
- [new and active checkouts stay pending](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/__tests__/checkoutInactivity.test.js#L26) — pass. Assertions: `assert.equal(nextCheckoutStatus({}), 'pending');`; `assert.equal(nextCheckoutStatus({ existingStatus: 'abandoned' }), 'pending');`
- [completed checkouts remain recovered even after late webhook events](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/__tests__/checkoutInactivity.test.js#L30) — pass. Assertions: `assert.equal(nextCheckoutStatus({ completedAt: now.toISOString() }), 'recovered');`; `assert.equal(nextCheckoutStatus({ existingStatus: 'recovered' }), 'recovered');`
- [stale webhook events do not reset status](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/__tests__/checkoutInactivity.test.js#L34) — pass. Assertions: `assert.equal(nextCheckoutStatus({ existingStatus: 'abandoned', isStale: true }), 'abandoned');`
- [invalid timestamps do not qualify as abandoned](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/__tests__/checkoutInactivity.test.js#L37) — pass. Assertions: `assert.equal(isCheckoutInactive('not-a-date', now), false);`

### src/services/__tests__/shopifyWebhookService.test.js

Production function: reconcileShopifyWebhooks (module mocks). Type: pure/mock/injected unit or static contract as described above; no DB-backed integration/E2E. Result: pass.

- [verifyTopicRejectionDoesNotStopOtherTopics](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/__tests__/shopifyWebhookService.test.js#L94) — pass. Assertions: `assert.ok(thrown, 'reconciliation should report incomplete setup');`; `assert.strictEqual(thrown.code, 'SHOPIFY_WEBHOOK_RECONCILIATION_INCOMPLETE');`; `assert.deepStrictEqual(attempts, REQUIRED.map(([topic]) => topic), 'all nine Shopify topics must be attempted in order');`; `assert.ok(failure, 'ORDERS_CREATE failure should be included in the result');`; `assert.match(failure.errors[0].message, /not available for this app/);`; `assert.match(rows.get('setup-state:ORDERS_CREATE').last_error, /not available for this app/);`; `assert.strictEqual(rows.get('setup-state:ORDERS_CREATE').status, 'failed');`
- [verifyInitialSubscriptionListFailureIsLoggedAndPreserved](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/__tests__/shopifyWebhookService.test.js#L112) — pass. Assertions: `await assert.rejects(`; `assert.deepStrictEqual(attempts, [], 'topic creation must not begin when subscription listing fails');`; `assert.ok(diagnostic, 'initial listing failure must emit a dedicated diagnostic');`; `assert.strictEqual(diagnostic.fields.http_status, 403);`; `assert.strictEqual(diagnostic.fields.network_code, 'ERR_BAD_REQUEST');`; `assert.match(diagnostic.fields.shopify_errors[0].message, /Access denied/);`
- [verifyRetryCanRecoverAfterShopifyRejection](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/__tests__/shopifyWebhookService.test.js#L137) — pass. Assertions: `await assert.rejects(service.reconcileShopifyWebhooks(store), (error) => error.code === 'SHOPIFY_WEBHOOK_RECONCILIATION_INCOMPLETE');`; `assert.strictEqual(firstAttemptCount, REQUIRED.length);`; `assert.strictEqual(attempts.length, REQUIRED.length * 2);`; `assert.deepStrictEqual(result.failures, []);`; `assert.strictEqual(rows.get('setup-state:ORDERS_CREATE').status, 'succeeded');`; `assert.strictEqual(rows.has('setup-failure:ORDERS_CREATE'), false);`
- [verifyPersistenceFailureDoesNotBlockRemainingTopics](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/__tests__/shopifyWebhookService.test.js#L149) — pass. Assertions: `assert.ok(thrown, 'persistence failure should be surfaced as incomplete setup');`; `assert.deepStrictEqual(attempts, REQUIRED.map(([topic]) => topic), 'database status-write failure must not prevent later Shopify topic attempts');`; `assert.ok(thrown.webhookFailures.some((item) => item.topic === 'ORDERS_CREATE'));`

### src/controller/__tests__/shopify.callback.test.js

Production function: shopifyCallback / retryShopifySetup / getStores / claimDelivery (mock DB). Type: pure/mock/injected unit or static contract as described above; no DB-backed integration/E2E. Result: pass.

- [verifyCallbackSurvivesDeferredSetupFailure](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/controller/__tests__/shopify.callback.test.js#L130) — pass. Assertions: `assert.ok(syncStarted, 'initial setup should start after the token is persisted');`; `assert.ok(callback.response.redirectUrl, 'the merchant should be redirected despite deferred webhook failure');`; `assert.strictEqual(new URL(callback.response.redirectUrl).searchParams.get('shopify'), 'connected');`; `assert.strictEqual(new URL(callback.response.redirectUrl).searchParams.get('shop'), query.shop);`; `assert.strictEqual(tokenExchangeCalls, 1);`
- [verifyInvalidHmacAndStateAreRejected](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/controller/__tests__/shopify.callback.test.js#L150) — pass. Assertions: `assert.strictEqual(invalidHmac.response.statusCode, 400);`; `assert.strictEqual(tokenExchangeCalls, 1, 'invalid HMAC must be rejected before token exchange');`; `assert.strictEqual(invalidState.response.statusCode, 400);`; `assert.strictEqual(tokenExchangeCalls, 1, 'invalid OAuth state must be rejected before token exchange');`
- [verifyPersistenceFailureReportsStageWithoutSecrets](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/controller/__tests__/shopify.callback.test.js#L179) — pass. Assertions: `assert.strictEqual(redirect.searchParams.get('shopify'), 'error');`; `assert.strictEqual(redirect.searchParams.get('stage'), 'store_persistence');`; `assert.ok(redirect.searchParams.get('reference'));`; `assert.strictEqual(redirect.searchParams.has('code'), false);`
- [verifyAuthorizationDenialAndRetrySetup](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/controller/__tests__/shopify.callback.test.js#L201) — pass. Assertions: `assert.strictEqual(new URL(denied.response.redirectUrl).searchParams.get('shopify'), 'cancelled');`; `assert.deepStrictEqual(denied.response.clearedCookies.sort(), ['oauth_user', 'shopify_shop', 'shopify_state', 'shopify_user']);`; `assert.strictEqual(retryResponse.code, 202);`; `assert.strictEqual(retryResponse.payload.data.setup_status, 'in_progress');`
- [verifyPersistedStoreIsReturnedWithoutCredentials](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/controller/__tests__/shopify.callback.test.js#L228) — pass. Assertions: `assert.strictEqual(response.code, 200);`; `assert.strictEqual(store.shop_domain, 'revluma-test-store.myshopify.com');`; `assert.strictEqual(store.connection_status, 'connected');`; `assert.strictEqual(store.setup_status, 'complete');`; `assert.strictEqual(store.webhooks_registered, REQUIRED_SUBSCRIPTIONS.length);`; `assert.strictEqual(Object.hasOwn(store, 'access_token'), false);`
- [verifyHistoricalFailuresDoNotOverrideActiveWebhooks](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/controller/__tests__/shopify.callback.test.js#L262) — pass. Assertions: `assert.strictEqual(response.code, 200);`; `assert.strictEqual(store.setup_status, 'complete');`; `assert.strictEqual(store.webhooks_registered, REQUIRED_SUBSCRIPTIONS.length);`; `assert.ok(store.webhook_details.every((item) => item.status === 'registered' && item.error === null));`
- [verifyFailedWebhookDeliveryCanRetryOnce](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/controller/__tests__/shopify.callback.test.js#L289) — pass. Assertions: `assert.strictEqual(retry.status, 'received');`; `assert.strictEqual(duplicate, null, 'in-flight duplicate deliveries must remain idempotent');`

### src/controller/__tests__/integration.contract.test.js

Production function: Static app/controller/gateway/internal-route text. Type: pure/mock/injected unit or static contract as described above; no DB-backed integration/E2E. Result: pass.

- [Top-level assertion script](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/controller/__tests__/integration.contract.test.js#L1) — pass. Assertions: `assert.ok(app.indexOf("express.raw({ type: 'application/json', limit: '2mb' })") < app.indexOf('express.json('), 'raw webhooks must be mounted before global JSON parsing');`; `assert.ok(webhookController.includes('verifyShopifySignature'), 'commerce webhooks must verify Shopify signatures');`; `assert.ok(webhookController.includes('claimDelivery'), 'commerce webhooks must claim deliveries idempotently');`; `assert.ok(mlService.includes("path: '/api/alerts/check'"), 'alert calls must use the ML gateway');`; `assert.ok(!revController.includes("require('axios').post"), 'Rev controllers must not call Python directly');`; `assert.ok(internalRoute.includes("router.post('/store-sync'"), 'the protected internal store-sync route must be mounted');`; `assert.ok(internalController.includes('syncShopifyStore(store)'), 'the internal store-sync route must invoke the real Shopify sync');`

### src/tests/intelligenceFindingsAggregator.test.js

Production function: evaluateOrganizationFindings (supplied DB). Type: pure/mock/injected unit or static contract as described above; no DB-backed integration/E2E. Result: pass.

- [findings never query order history without verified completeness](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceFindingsAggregator.test.js#L22) — pass. Assertions: `assert.equal(db.orderReads, 0);`; `assert.equal(result.findings.length, 0);`; `assert.equal(result.diagnostics[0].status, 'order_history_completeness_unverified');`
- [failed webhook produces evidence-backed integration finding](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceFindingsAggregator.test.js#L29) — pass. Assertions: `assert.equal(result.findings[0].type, 'integration_failure');`; `assert.equal(result.findings[0].evidence.failed_webhook_registrations, 8);`; `assert.equal(db.orderReads, 0);`
- [certified period allows revenue detection but not returning-customer claims without lifetime history](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/tests/intelligenceFindingsAggregator.test.js#L37) — pass. Assertions: `assert.equal(args.where.organization_id, 'org-1');`; `assert.equal(args.where.store_id, 'store-1');`; `assert.equal(result.findings[0]?.type, 'revenue_change');`; `assert.equal(result.findings[0]?.evidence.delta_pct, -50);`; `assert.ok(result.diagnostics.some(item => item.status === 'customer_lifetime_history_unverified'));`; `assert.ok(result.diagnostics.some(item => item.status === 'checkout_funnel_coverage_unverified'));`

### src/services/operationalOverviewRepository.test.js

Production function: fetchTenantOperations (supplied DB). Type: pure/mock/injected unit or static contract as described above; no DB-backed integration/E2E. Result: pass.

- [Top-level assertion script](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/operationalOverviewRepository.test.js#L1) — pass. Assertions: `assert.equal(result.storeCount, 1);`; `assert.deepEqual(calls.find(c => c.name === 'stores').args.where, { organization_id: 'org-owned', status: { not: 'deleted' } });`; `assert.deepEqual(calls.find(c => c.name === name).args.where.store_id, { in: ['store-owned'] });`; `assert.equal(calls.find(c => c.name === 'alert_queue').args.where.organization_id, 'org-owned');`; `assert.deepEqual(calls.find(c => c.name === name).args.where.store_id, { in: [] });`; `assert.equal(calls.find(c => c.name === 'alert_queue').args.where.organization_id, 'org-empty');`

## Source links and dependencies

- [Backend/package.json](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/package.json)
- [Backend/scripts/run-tests.js](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/scripts/run-tests.js)
- [Backend/src/services/commerceWebhookService.js](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/commerceWebhookService.js)
- [Backend/src/services/checkoutInactivity.js](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/checkoutInactivity.js)
- [Backend/src/services/schedulerService.js](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/schedulerService.js)
- [Backend/src/services/shopifySync.js](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/services/shopifySync.js)
- [Backend/src/controller/commerceWebhookController.js](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/Backend/src/controller/commerceWebhookController.js)
- [.github/workflows/backend-tests.yml](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/.github/workflows/backend-tests.yml)
- [.github/workflows/backend-refresh-regression.yml](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/.github/workflows/backend-refresh-regression.yml)
- [.github/workflows/rev-python-tests.yml](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/.github/workflows/rev-python-tests.yml)
- [python/tests/test_business_state_cart_dedup.py](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/python/tests/test_business_state_cart_dedup.py)
- [python/tests/test_historical_ingestion.py](https://github.com/Revluma-Organization/Revluma/blob/d41074872561cd84edf47d7d2374dfc6df847f37/python/tests/test_historical_ingestion.py)
- Prior diagnoses: [TASK-008](TASK-008.md), [TASK-009](TASK-009.md).
- [Audit register](../audit-register.md), [decisions](../implementation-decisions.md), [approved backlog](../backlog.md).

## 2026-10-30 follow-up — Recovered reports and GitHub main publication

User explicitly requested publication to the live GitHub main repository and supplied the combined earlier reports. TASK-002–007 have been separated and registered with their original architecture-inspection PASS statuses; each still reports runtime limitations. The attachment does not contain a Task001 report, only references to its completion in progress summaries. No Task001 report was fabricated.

The earlier local-only delivery limitation is superseded by this instruction. Publish all documentation files to main with only docs/mvp-execution changes, verify the resulting GitHub tree/content, and report the actual commit in the completion response. Original test results and findings above remain unchanged; no new application testing or diagnosis was performed during this documentation import.

Updated audit outcome after verified publication: **PASS — Test architecture mapped and permanent engineering documentation established.** Product reconciliation coverage remains partial as documented. No missing tests or source/schema findings are marked resolved by publishing docs. REV-FIND-0047 remains under investigation for the missing Task001 report.
