# Task 202 — finding/product evidence and deterministic temporal interpretation

Status: **MERGED AND CI-VERIFIED; PRODUCTION VERIFICATION INCOMPLETE — BACKEND/PYTHON REVISION AND AUTHENTICATED REV ACCEPTANCE OUTSTANDING**.

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
- Records: this report, diagnostic, validation, audit register and REV-DEC-0014.

No schema migration, new dependency, merchant action or extra platform was introduced.

## Local verification

- Full Python suite: **1620 passed, 11 skipped** before the final disposable-PostgreSQL test was added; the added test is designed to skip without CI's database and execute against real PostgreSQL in CI.
- Focused Task 202/investigation/order tests: **43 selected tests** exercised, with one intermediate test-structure failure corrected (not a product failure).
- Backend full runner: **80 test files passed** using the explicitly local, uncommitted Prisma import shim. This is not real Prisma or production database evidence.
- `npx prisma generate` was attempted and blocked by unreachable `binaries.prisma.sh`; no local generation success is claimed.
- JavaScript syntax checks and `git diff --check` are required in the final pre-commit gate.

After merging current `main` (Task 201) into this branch and preserving integration-health planning alongside the new finding/product paths, the combined local suites passed: **1677 Python tests, 11 skipped** and **81 Backend test files**. These remain local results.

Local fixtures are synthetic and isolated. They do not certify deployed revisions, live tenant isolation, authenticated Rev behavior or the active Shopify store.

## Merge, CI and production evidence — 2026-11-07

PR #342 merged as `6f37978f620ab55814f3bf319a27296a72c8df99` after every check on source `04b091651301c07921793b343c0e49b3ed0948bb` passed: `python-regressions` (run 42366587763), Prisma bootstrap/financial/security regressions and dashboard build (run 42366587822), Backend suites (runs 42366587819 and 42366587756), and Vercel preview comments. Real disposable PostgreSQL exposed and required explicit UUID casts and driver-compatible product array binding; the final test executes direct finding/order and product/variant probes and cross-tenant assertions successfully. Vercel deployment `dpl_GuP1yWh2N8re7rEXkbf57sUTmYxc` is READY/PROMOTED at the merge SHA with `revluma.vercel.app` aliased.

Read-only production Supabase checks found the authorized active store `revluma-test-store-v1.myshopify.com` with `America/New_York` and USD. A canonical-shape product/variant/inventory query returned four distinct Gift Card variants with their own inventory item IDs and Shop location quantity records. Products and variants ledgers were `ok`/fully paginated (17 products, 26 variants), and locations was complete. No `inventory_items` or `inventory_levels` domain-ledger rows were returned, so inventory coverage must remain partial despite level rows existing; this is intentional fail-closed behavior. The store currently has zero finding rows, so latest/direct finding and stale/historical behavior cannot be demonstrated on production without creating data, which was not done.

Backend `/ready` responded ready with database/Python readiness but `node_build=ade43ca96a71`; that commit is not a descendant of the Task 202 merge and therefore does not establish the Task 202 backend revision. Python readiness does not expose a source SHA. No Render deployment control or authenticated merchant session/internal service credential was available or requested. Thus actual Task 202 Node/Python deployment identity and authenticated Rev finding/product/temporal request-path checks remain unverified. Vercel, SQL shape/data checks and local/CI tests are not substitutes for those criteria.
