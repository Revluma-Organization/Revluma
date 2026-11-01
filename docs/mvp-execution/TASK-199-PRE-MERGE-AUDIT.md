# Task 199 — pre-merge audit (Rev Intelligence release candidate)

Task 199 is *"Verify order evidence retrieval"* in `audit-register.md` / `backlog.md`. This
document is the pre-merge audit gate attached to that task: every defect previously reported
against this workstream is re-inspected in the current worktree, with the evidence found and a
status that is honest about what could and could not be run locally.

Status vocabulary: **FIXED** (code + regression test observed passing), **NOT REPRODUCIBLE**
(inspected the stated target; defect is not present in this revision), **PARTIAL** (code and/or
unit coverage exists, but the end-to-end path needs a live database, service or store),
**OPEN** (no fix), **BLOCKED** (needs an environment we do not have).

| # | Reported defect | Re-inspection | Status |
| --- | --- | --- | --- |
| 1 | Refund reconciliation | `shopifyNetOrderTotal` reconciles success-only `refund` transactions against `total_price` and returns `null` for malformed refund evidence. Shopify GraphQL sync uses the already refund-adjusted `currentTotalPriceSet` and passes `refunds: []`, so refunds are not subtracted twice. The pure helper now lives in `Backend/src/services/shopifyOrderFinancials.js`, so `Backend/src/tests/shopifyRefundTotals.test.js` runs **5/5 locally** instead of failing on a Prisma import. | **FIXED (unit-verified)** |
| 2 | Cancelled-order resurrection | `resolveOrderRecoveryStatus` treats cancellation as terminal and prefers a tombstone over a delayed create. Migration `20261101120000_rev_financial_integrity` adds `order_cancellation_tombstones(store_id, external_order_id, …)`. Precedence is asserted in `financialIntegrity.test.js` (6/6). The webhook ordering path itself needs Postgres. | **PARTIAL** |
| 3 | Dead second `if (!row)` in `verifyConversationOwnership` | Re-read `Backend/src/controller/revController.js` (function near line 43): one query, one `if (!row)` → 404, then an org comparison → 403. No unreachable second guard remains. | **NOT REPRODUCIBLE** |
| 4 | Duplicate `abandoned_carts.findMany` mock key in `dashboardEvidence.contract.test.js` | No file named `dashboardEvidence.contract.test.js` exists: `find . -name "*dashboardEvidence*"`, `git ls-files`, and `git log --all -- '*dashboardEvidence*'` are all empty. The closest test, `operationalOverviewRepository.test.js`, mocks `abandoned_carts.groupBy` once and has no duplicate keys. | **NOT REPRODUCIBLE** |
| 5 | Inconsistent specialist status contracts | `python/src/agents/base_agent.py` defines `SPECIALIST_STATUSES = ('success','partial','no_data','error')` and `normalize_specialist_status()`: unknown/missing → `error` (fail closed), `success` without facts *or* signals → `partial`. `to_dict()` emits `status` (normalized), `status_raw` and `status_contract`. Asserted in `python/tests/test_rev_investigation.py::test_specialist_status_contract_is_enforced`. | **FIXED (unit-verified)** |
| 6 | Import-time DB engine from an empty `DATABASE_URL` | `python/src/config/database.py` builds the engine lazily and raises `DatabaseNotConfigured` on first use when no URL is set. New `python/tests/test_database_engine_laziness.py` proves import does not construct an engine and that use fails closed (3/3). | **FIXED (unit-verified)** |
| 7 | Missing numeric/currency validation on order/cart amounts | `financialIntegrity.parseAmount/requireAmount/requireCurrency` gate every ingested total, subtotal, discount, cart value and currency. Failures surface typed codes: `ORDER_CURRENCY_UNVERIFIED`, `ORDER_SUBTOTAL_UNVERIFIED`, `ORDER_DISCOUNT_UNVERIFIED`, `ORDER_FINANCIAL_TOTAL_UNVERIFIED`, `CART_VALUE_UNVERIFIED`, `CART_CURRENCY_UNVERIFIED`. | **FIXED (unit-verified)** |
| 8 | Customer LTV evidence gaps | `customers.ltv_currency` / `ltv_mixed_currency` are persisted by the webhook LTV recompute. `verifiedCustomerLifetimeValue()` returns `value: null` unless a single ISO currency is verified; churn and offer feature payloads now send `customer_ltv: null`, `customer_ltv_currency`, `customer_ltv_mixed_currency`, `customer_ltv_verified` instead of `Number(ltv || 0)`. Python `_customer_ltv()` refuses mixed/currency-less LTV, and `escalate_to_human` requires a verified currency. Business-state customer context returns `ltv: null` (not `0`) for mixed/unlabelled rows. | **FIXED (unit-verified)** |
| 9 | Mixed-currency handling | `totalsByCurrency` and `computeCustomerLifetimeValue` never sum across codes (mixed → `ltv: null`, `mixed_currency: true`); evidence grouping is per currency; LTV totals are refused in `agents/tools.py`. Node and Python tests both assert the mixed case. | **FIXED (unit-verified)** |
| 10 | Evidence-to-metric attribution gaps | Period-comparison facts previously carried `evidence_ids: []`. Changes now carry `current_evidence_id` / `previous_evidence_id`, comparison facts cite both, and previous-period items travel in `evidence.comparison_items` (bounded to 60 by the Node gateway). New `validate_attribution()` rejects facts with no evidence, unknown evidence ids, currency facts without a currency, and hypotheses marked verified; it runs inside the investigation and feeds `evidence.validation`. Covered by 5 new tests in `python/tests/test_rev_evidence_contract.py`. | **FIXED (unit-verified)** |
| 11 | Unreviewed diff / untracked files | 21 tracked files modified and 19 untracked paths, all source, migration or test files; no build output, dependency tree or dataset is staged (`Frontend/Dashboard/dist` is git-ignored). Inventory recorded in the release-candidate report, §16. | **FIXED (inventory reviewed)** |
| 12 | Python 3.11.9 | Local interpreter is 3.11.2, so 3.11.9 could not be established here. `.github/workflows/rev-python-tests.yml` is now pinned to `python-version: '3.11.9'`; the dashboard workflow runs the full Vitest suite rather than two files. | **PARTIAL (CI pin added, CI not run)** |
| 13 | Live staging verification | No staging environment, staging database or connected Shopify test store was available. No deployment, migration or merchant-flow action was performed. | **BLOCKED** |

## Locally executed evidence (2026-11-01)

```
python (3.11.2, placeholder DATABASE_URL): 612 passed, 3 skipped
node src/services/__tests__/revStream.test.js               3/3
node src/services/__tests__/financialIntegrity.test.js      6/6
node src/services/__tests__/revInvestigation.contract.test.js 7/7
node src/services/__tests__/revUpstreamStream.test.js       7/7
node src/tests/shopifyRefundTotals.test.js                  5/5
Frontend/Dashboard: npx vitest run → 19 files, 120 tests passed
Frontend/Dashboard: npx vite build → succeeded
```

Not executed locally, and therefore not claimed: whole-suite `Backend npm test` (Prisma Client
cannot be installed in this sandbox), any live database query, any Shopify webhook, any staging
or production deployment, and any browser-driven end-to-end streaming session.

## Remaining risk

- Refund reconciliation and cancellation tombstones are unit-proven but their webhook ordering
  behaviour (delayed create, out-of-order refund) is only proven by inspection.
- Attribution validation is proven on synthetic evidence; real tool output must still pass it
  in a live investigation, which is what the streaming endpoint will exercise in staging.
