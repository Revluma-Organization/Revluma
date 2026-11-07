# TASK 198 — Verify revenue evidence retrieval (implementation report)

Date: 2026-11-07. Branch: `arena/6e7dba55-revluma`. Baseline: `91ca7d184269f62b5511095c45e6417fc6f3e8eb` (main).

TASK 198 is *"Verify revenue evidence retrieval"* in `backlog.md`. This report records
what the revenue evidence pipeline now does, the currency/period/timezone invariants it
enforces, where each rule is implemented, and the evidence that it holds. It also records
what could and could not be verified in this environment.

## Scope implemented

1. **Currency-safe revenue metrics** (`python/src/intelligence/financial_metrics.py`,
   `revenue_evidence.py`). Revenue evidence is retrieved per verified ISO currency from
   the certified orders snapshot. Incompatible currencies are **never summed into one
   scalar**; rows without a verified currency code are excluded and reported, never
   coerced into a default. The locked zero contract holds: a currency zero with complete
   coverage is `available` + `"0.00"`; a count zero with complete coverage is
   `verified_zero`; incomplete coverage is demoted to `PARTIAL` and the builder never
   crashes. Refunds are attributed to the refund date; captured money is success-only
   SALE/CAPTURE by `processed_at`.

2. **Merchant-timezone reporting periods** (`python/src/agents/investigation.py`).
   `resolve_store_context` reads the store settings and `store_profiles.iana_timezone`
   (priority: settings > profile > UTC; conflicting stores fall back to UTC with an
   explicit warning). `resolve_reporting_period` resolves "today", "yesterday",
   "this/last week" (ISO calendar weeks), "this/last month" and explicit date ranges on
   the merchant's local calendar with DST-safe, half-open `[start, end)` windows.
   Comparison windows are the previous calendar unit (or the equal-length immediately
   preceding period for rolling/partial windows). An unresolvable timezone name is
   normalised to UTC and never leaks into evidence period labels.

3. **Year-over-year** (`revenue_evidence.py`). Opt-in; the prior-year window is the same
   local-calendar dates shifted back one year (DST-safe). If certified order coverage
   does not contain the prior-year window the result is `insufficient_history` — it is
   never compared against unverified history.

4. **Business-state scalars are currency-honest** (`python/src/intelligence/
   business_state.py`). `DAILY_REVENUE_SQL` groups by currency; a single-currency
   organization keeps the scalar revenue metrics plus `revenue_currency`; a
   multi-currency organization gets no scalar (explicit warning, `computation_status`
   partial). The currency is persisted in state metadata (no migration).

5. **No assumed currency anywhere it is displayed** (`agents/revenue_agent.py`,
   `intelligence/morning_briefing.py`). Hardcoded USD/`$` labels were removed; amounts
   carry their real currency when known and are unlabelled (never mislabelled) when not.

6. **Node gateway parity** (`Backend/src/services/revEvidenceService.js`,
   `revMerchantContext.js`, `controller/revController.js`).
   - `GET /evidence?resource_id=revenue` returns a computed revenue evidence item built
     from the certified orders snapshot, per verified currency, with the same fail-closed
     states (not_synchronized / partial / unauthorized / contradictory / multi-currency
     refusal). Snapshot resources are unchanged.
   - `?start=&end=&timezone=` are accepted only for the computed revenue resource and
     validated as a half-open period with a real IANA timezone; for any other resource
     they are rejected (400), not silently ignored.
   - The merchant context now carries `reporting_timezone`,
     `reporting_timezone_source` and `configured_currencies`, resolved with the same
     priority and conflict rules as the Python layer.

## Invariants asserted by tests

- Monetary values are decimal strings with exactly two places and a matching
  `measurement`; a currency `available` zero requires complete coverage.
- Comparison and year-over-year windows keep equal length (calendar units) and are the
  ones actually queried.
- Period boundaries are merchant-local midnights/week-starts; a week straddling the US
  DST transition of 2026-11-01 resolves to `04:00Z` then `05:00Z`, not 7×24h.
- Multiple currencies never produce a summed figure (Python business-state, Python
  revenue evidence, Node revenue resource all refuse).
- Read-only boundary, prompt-injection and failure-routing regressions remain green.

## Test evidence (this environment)

- Python focus suite (revenue evidence, investigation, business state, evidence
  contract, eleven scenarios, context payload, merchant voice, failure routing,
  postgres-gated file): **121 passed, 2 skipped** (the skips are the disposable-
  PostgreSQL integration tests, which run only in CI where `TASK198_DATABASE_URL` is
  supplied).
- Full Python suite: **1595 passed, 9 skipped** (4 further tests deselected locally
  because they require a live `DATABASE_URL`; they run in CI).
- Node full backend suite: **79 test files passed** (`npm test`), including the new
  revenue-resource and reporting-timezone tests (17 in `revEvidenceService.test.js`,
  11 in `revMerchantContext.test.js`).

## Not verified here (honest limits)

- The disposable-PostgreSQL integration test (`tests/test_revenue_evidence_postgres.py`)
  was not executed locally (no PostgreSQL in this sandbox); it is wired into
  `.github/workflows/rev-python-tests.yml`, which provisions `postgres:16` and sets
  `TASK198_DATABASE_URL`. CI is the verification surface for the real-database path.
- No production deployment, migration or live-store run was performed in this task;
  live acceptance remains the human runbook (`docs/production-recovery/
  REV-LIVE-ACCEPTANCE-RUNBOOK.md`).

## Behaviour changes to note

- "this week"/"last week" now mean ISO calendar weeks in the merchant timezone (previously
  a rolling 7×24h window), and comparison windows are calendar units — see
  `implementation-decisions.md` (REV-DEC-0012).
- Multi-currency organizations lose the scalar revenue fields in business state by
  design; they are replaced by the per-currency revenue evidence.
