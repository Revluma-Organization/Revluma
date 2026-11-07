# Task 202 — finding/product evidence and deterministic temporal interpretation

Status: **IMPLEMENTATION CANDIDATE — LOCAL VERIFICATION COMPLETE; CI, DEPLOYMENT AND AUTHENTICATED PRODUCTION VERIFICATION PENDING**.

## Implemented behavior

### Finding evidence

`python/src/intelligence/finding_evidence.py` adds bounded, organization/store-authorized retrieval by direct UUID, latest finding, lifecycle or current findings. Each canonical `finding_evidence` item includes type, severity, title/description, lifecycle timestamps, current-validity state, allowlisted embedded evidence, recommendation context, source coverage-run lineage and up to 200 order records in the finding's measurement windows. Twenty-five findings are returned at most, with truncation disclosed.

Open/acknowledged findings with measurement windows older than 48 hours are `stale_unreverified`; resolved/dismissed findings are historical. Unverified evidence is not promoted to verified fact. No finding row or empty result proves the presence or absence of a current operational problem. Finding-chat context now carries the server-selected finding UUID so the actual Python tool retrieves the same authorized finding rather than relying on prose alone.

### Product, variant, inventory and order-line evidence

`python/src/intelligence/product_evidence.py` retrieves up to 25 authorized products by stable internal/Shopify identifier, exact product name or SKU. Ambiguous names return no arbitrary selection. Variants remain distinct from products. Inventory is joined through variant → inventory item → per-location level → location. Catalog status is not stock status, and absent/incomplete inventory never establishes stockout or unavailability.

Product evidence includes bounded historical non-cancelled order-line aggregates and only explicit product/finding JSON references. It does not infer demand, conversion, profit or causation. Separate historical order-line units/value evidence remains available when current product identity is incomplete. Product and inventory Rev tools share this retrieval path.

### Temporal and timezone semantics

The existing resolver now handles rolling previous/last/past N days (1–365), current/previous weeks, months, quarters and years, today/yesterday, since Monday/month start, explicit Q1–Q4/year, named months/years and explicit half-open local-date ranges. Reversed ranges and future periods are rejected; the current named calendar period ends at `now` and is marked partial.

Current day/week/month/quarter/year comparisons use the same elapsed local-calendar portion of the preceding unit and never overlap the current period. Complete calendar periods use the preceding calendar unit; rolling periods use the preceding equal-length window. DST boundaries use the merchant IANA zone. Node and Python expose `reporting_timezone_verified`; invalid, missing or conflicting persisted Shopify timezones produce explicit UTC fallback warnings. No browser/server timezone or LLM date arithmetic is used.

### Integration correction

Task 202 comparison tests exposed an existing order-evidence AOV mismatch: the evidence constructor rounds monetary values to two decimals while the measurement retained an unrounded decimal. Measurement now uses the same canonical `money()` conversion, so valid order comparisons no longer fail closed with a validation error.

## Files

- New canonical retrieval: `python/src/intelligence/finding_evidence.py`, `product_evidence.py`.
- Rev integration: `python/src/agents/tools.py`, `investigation.py`; `Backend/src/services/findingChatContext.js`, `revMerchantContext.js`.
- Financial measurement compatibility: `python/src/intelligence/order_evidence.py`.
- Tests: `python/tests/test_task_202_evidence.py`, `test_task_202_evidence_postgres.py`, updated investigation and merchant-context regressions.
- Records: this report, diagnostic, validation, audit register and REV-DEC-0013.

No schema migration, new dependency, merchant action or extra platform was introduced.

## Local verification

- Full Python suite: **1620 passed, 11 skipped** before the final disposable-PostgreSQL test was added; the added test is designed to skip without CI's database and execute against real PostgreSQL in CI.
- Focused Task 202/investigation/order tests: **43 selected tests** exercised, with one intermediate test-structure failure corrected (not a product failure).
- Backend full runner: **80 test files passed** using the explicitly local, uncommitted Prisma import shim. This is not real Prisma or production database evidence.
- `npx prisma generate` was attempted and blocked by unreachable `binaries.prisma.sh`; no local generation success is claimed.
- JavaScript syntax checks and `git diff --check` are required in the final pre-commit gate.

Local fixtures are synthetic and isolated. They do not certify deployed revisions, live tenant isolation, authenticated Rev behavior or the active Shopify store.
