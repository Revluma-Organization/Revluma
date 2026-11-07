# TASK 203 — Evidence quality, currency and uncertainty states (implementation report)

Date: 2026-11-07. Branch: `arena/6257081e-revluma`. Baseline: `5196c67` (main,
includes Tasks 197–202). Consolidates original Tasks 207 (currency-safe
calculation), 208 (zero vs missing), 209 (incomplete-evidence fallback), 210
(freshness/staleness) and 211 (contradiction handling).

The governing rule: **a confident answer based on incomplete or contradictory
evidence is a product defect.** This task productionizes evidence-quality
judgement across Rev Intelligence by adding *one* unified, six-dimension
quality model on top of the Task 197 evidence contract — it does not
introduce a competing evidence or currency system.

## What was built

### 1. The unified six-dimension quality model

`python/src/intelligence/evidence_quality.py` (Python, keystone) and
`Backend/src/services/revEvidenceQuality.js` (Node mirror, byte-identical
output shapes). Quality is *derived* from fields the Task 197 contract
already carries (status, coverage, freshness, value, currency, unit,
classification). The six dimensions are represented **independently** and
must never be collapsed into one ambiguous status:

| Dimension | Values | Question it answers |
|---|---|---|
| A. availability | available, partially_available, unavailable, unauthorized, unsupported, not_synchronized, retrieval_failed | Can we use the source at all? |
| B. coverage | complete, partial, unknown, not_applicable | Is the queried population certified complete? |
| C. freshness | fresh, aging, stale, unknown, synchronizing, failed, never_synchronized | Is the evidence current enough? |
| D. value_state | observed_nonzero, verified_zero, null, missing, not_applicable, unknown | What is the actual value? |
| E. consistency | consistent, conflicting, unverified | Do the sources agree? |
| F. currency_integrity | single_verified_currency, compatible, explicitly_converted, mixed_not_comparable, unknown_currency, not_applicable | Are the amounts comparably currency-attributed? |

Plus a derived **sufficiency** verdict (`sufficient` / `partial` /
`insufficient` / `unavailable`) with explicit machine-readable `reasons`
(e.g. `stale_for_current_claim`, `partial_coverage`, `value_missing`,
`conflicting_evidence`, `mixed_currencies_not_comparable`).

Consequences the model permits (each asserted in tests):

- evidence can be **available but stale** (availability=available, freshness=stale);
- evidence can be **fresh but incomplete** (freshness=fresh, coverage=partial);
- evidence can be **complete but contradictory** (coverage=complete, consistency=conflicting);
- a collection can contain a **verified zero** while another source is
  **unavailable** (per-item quality is preserved in the rollup; the worst
  sufficiency wins, nothing is hidden);
- evidence can be **complete but not safely comparable** across currencies.

Key derivation rules (anti-defect invariants):

- `stale`/`contradictory` still map to availability=available — the *other*
  dimensions carry the degradation, so availability never silently
  over-reports.
- a value of zero over **incomplete** coverage is `value_state=unknown`,
  never `verified_zero` (a zero without a certified population is an
  unknown, not a fact).
- `missing` (source could not be queried — an availability problem) is
  distinguished from `null` (queried, field simply unpopulated).
- non-numeric units (record/reference) get `value_state=not_applicable` and
  `currency_integrity=not_applicable` — no fake numeric verdicts.

### 2. Deterministic capability helpers (the five consolidated tasks)

All money math is exact decimal (Python `Decimal` / Node BigInt-scaled
strings) — never binary float, never a fabricated number:

- **207 — currency-safe calculation.** `aggregate_currency()` buckets by
  ISO-4217 code (case-normalized) and only produces a `combined` total when
  *exactly one* verified currency is present; mixed input yields
  `combined=None, usable=False, mixed=True` with each original currency
  preserved (a USD+NGN set can never silently become one total). Unknown or
  invalid currency codes are quarantined (`unknown_currency_amounts`);
  non-numeric amounts (NaN/Inf/malformed) are quarantined separately
  (`malformed_amounts`) and make the total unreliable rather than
  silently-zero. `compare_currency()` compares across currencies **only**
  with an explicit, documented, positive-rate conversion covering the pair
  (rate convention: 1 `from_currency` = `rate` `to_currency`); otherwise it
  reports `comparable=False` and never invents a rate.
- **208 — zero vs missing.** `classify_zero_value()` returns one of eight
  states: `verified_zero` (amount zero over certified complete population),
  `no_match_verified_population` (count zero, complete, no records),
  `incomplete_coverage`, `unauthorized_or_unavailable`,
  `failed_or_incomplete_sync`, `null_field`, `missing_record`,
  `observed_nonzero` — each with a plain-language `explanation`.
  `safe_ratio()` and `safe_percent_change()` refuse zero/non-positive
  denominators and non-finite inputs (`ok=False`, `value=None`,
  reason-named); no NaN/Inf can escape.
- **209 — incomplete-evidence fallback.** `sufficiency()` decides how far
  the evidence supports a conclusion: unavailable sources are named
  (`source_unauthorized`, `source_not_synchronized`, ...), missing/unknown
  values with incomplete coverage are *insufficient* (not a partial answer),
  and everything else degrades to *partial* with the reasons kept visible.
  A fresh item with a real value still supports a (partially-flagged)
  conclusion — available evidence is used, unsupported conclusions are
  excluded.
- **210 — source-specific freshness.** `evaluate_freshness()` takes an
  explicit `policy_seconds` per source domain (mirrors the existing
  revenue/integration pattern: fresh ≤ policy, aging ≤ 2×policy, else
  stale) and separates *source freshness* from *reporting-period age*: a
  **current-state** claim is not supported by stale/failed/never/
  synchronizing evidence, while a **historical** claim *is* answerable from
  old evidence when the evidence's `as_of` is at/after the requested period
  start.
- **211 — contradictions.** `detect_contradictions()` flags a conflict only
  when items share metric, period (start+end), currency, unit, and
  store-scope and carry ≥2 distinct numeric values — differences in period,
  currency, unit or metric are **not** contradictions. Resolution is allowed
  only by defensible rules: (1) a documented `source_of_truth` authority, or
  (2) an unambiguous fresh-supersedes-stale recency ordering. Otherwise the
  conflict stays `unresolved` with `confidence_impact="reduce"`, all values
  preserved in numeric order, and **no averaged winner is ever invented**.

### 3. Wiring: quality metadata survives every service boundary

Quality is attached **at item creation**, so it is born with the item and
travels with it through every serialization boundary:

- Python: `evidence_item()` (the single constructor used by all
  intelligence modules — 50+ call sites) computes `item["quality"] =
  quality_of(item)` before schema validation. `EvidenceItem` is
  `extra="allow"`, so the block is backward-compatible: the Task 197
  contract tests pass unchanged.
- Node: `createEvidence()` in `revEvidenceContract.js` attaches the same
  block via the mirror `qualityOf()` (lazy require to avoid a circular
  import). The top-level Joi schema is `.unknown(true)`, so validation and
  the collection validator pass the block through unchanged.
- The block is stable across a JSON round-trip (asserted in the Node
  parity test: `qualityOf(JSON.parse(JSON.stringify(item)))` equals the
  attached block).

## Test evidence

All tests are real-logic, deterministic (fixed timestamps/fixtures), with no
mocked responses and no production data:

- `python/tests/test_rev_evidence_quality.py` — **51 tests** covering the
  Section 10 matrix: single/mixed/unknown/invalid/precision/rounding/malformed
  currency aggregation, cross-currency comparison (same pair both directions,
  undocumented rate, wrong pair, zero rate), all eight zero-vs-missing states,
  zero denominators, NaN/Inf guards, sufficiency for every availability
  state, fresh/aging/stale/never/failed/synchronizing + historical/current
  split + source-specific thresholds, all contradiction rules (including
  "different period/currency is not a conflict", "never averaged"),
  six-dimension independence, collection rollup preserving verified zeros,
  and tenant/store-scope integrity.
- `Backend/src/services/__tests__/revEvidenceQuality.test.js` — **11 tests**,
  including **byte-for-byte parity with Python**: the golden expected values
  are generated *from the Python module* by
  `python/scripts/gen_quality_golden.py` into
  `Backend/src/services/__tests__/revEvidenceQuality.golden.json` and the
  Node mirror is asserted deep-equal against them (qualityOf for 14 item
  shapes, aggregateCurrency, compareCurrency, classifyZeroValue,
  safeRatio/safePercentChange, evaluateFreshness, detectContradictions,
  qualityOfCollection). It also asserts the `createEvidence` wiring and
  boundary survival.
- No regressions: full Python suite **1720 passed / 10 skipped / 0 failed**;
  full Node suite **74 files passed / 0 real failures** (8 files cannot run
  in the sandbox because `prisma generate`'s engine download is blocked by
  the sandbox network allowlist — `@prisma/client did not initialize yet`;
  those files are unrelated to this change and run in CI). The pre-existing
  Task 197 contract tests (14 Python, 6 Node) and Task 201 integration
  evidence tests (45 Python, 17 Node) pass unchanged.

## Acceptance criteria (scenarios A–G)

| # | Criterion | Proof |
|---|---|---|
| A | Mixed currencies can't be silently combined | `test_mixed_currency_aggregation_is_rejected`, `test_cross_currency_comparison_rejected_without_conversion`, Node `aggregateCurrency`/`compareCurrency` parity; `combined` is `None` unless exactly one verified currency |
| B | Verified zero vs missing distinguished | eight-state `classify_zero_value` (5 tests) + `value_state` derivation (verified_zero vs null vs missing vs unknown, 4 tests) |
| C | Freshness per source + question | `evaluate_freshness` with explicit `policy_seconds`; current vs historical split; `test_source_specific_thresholds` (same age, different policy → different verdict) |
| D | Contradictions resolved only defensibly | source-of-truth + recency rules only; unresolved stays unresolved with `confidence_impact=reduce`; `test_unresolvable_conflict_never_averages`; period/currency/unit differences are not conflicts |
| E | Metadata survives boundaries | quality attached in `evidence_item()`/`createEvidence`; JSON round-trip stability asserted; schema `extra="allow"`/`.unknown(true)` backward compatibility asserted by unchanged Task 197 tests |
| F | Tests pass | 51 Python + 11 Node new tests, all passing; parity golden regenerated from Python |
| G | No regression | Python 1720/10/0; Node 74 passed, 0 real failures (8 sandbox-prisma-env) |

## Production verification (read-only)

Verified against the **active** test store
`revluma-test-store-v1.myshopify.com` (id
`3ed79446-cb6d-4a1c-b174-9ec1ab91fe15`) in Supabase project
`jblpgqmbgdlzitprudgt` via **read-only SELECTs only** (2026-11-07 ~10:53 UTC).
The retired `bys-user-store-923319-1ifggjsw.myshopify.com` was not used.

- **Store**: status `active`, 25 granted scopes (read_orders, read_customers,
  read_products, read_inventory, read_checkouts, read_content, read_shipping,
  ...), `last_synced_at` 2026-11-07 10:46:50Z — synchronizing live at check
  time.
- **Sync ledger** (`store_sync_domain_states`): 35 domains — **31 `ok`**
  (fully paginated, succeeded within minutes of the check) and **4 `failed`**
  (`analytics.reports`, `content.redirects`, `online-store.menus`,
  `shop.policies`; `SHOPIFY_GRAPHQL_ERROR`, never succeeded). The 4 failed
  domains are **outside the 22-resource integration-evidence catalog**, so
  they do not appear as evidence items; they are genuine, logged sync-quality
  gaps in the ledger itself.
- **Webhooks**: 27 registrations, but the last observed event is
  2026-10-30 (8 days old, outside the 7-day window). Per the Task 201 state
  machine this store's webhook item is `state="unknown"` → surfaced as
  **degraded** with the explicit note *"Webhooks are registered but no event
  was observed in the last seven days … A registered webhook does not prove
  events are flowing."* — uncertainty is reported, not silently converted
  into "healthy".
- **Order coverage**: `intelligence_order_coverage` has **0 certified rows**
  for this store, so the orders capability reports the explicit 60-day
  bounded window with its limitation note rather than claiming certified
  full history — a live instance of the Task 209 incomplete-evidence
  fallback.

No real production contradictions or incomplete-sync evidence states were
manufactured: the scenarios that do not naturally exist in the active store
(mixed-currency totals, conflicting source values, zero-over-incomplete) are
proven by the isolated deterministic tests above, which is the documented
limitation of live verification.

## Limitations (honest)

- The **Render/Python deployment identity** could not be re-established from
  this sandbox (no Render credentials or merchant token available), so the
  Python side of the service is verified by the full test suite and by the
  read-only production inputs above, not by a live authenticated end-to-end
  call. The Node side is deployed by Vercel on merge to `main`
  (`revluma.vercel.app`).
- 8 Node test files cannot execute inside this sandbox because the Prisma
  engine download is network-blocked (they fail with `@prisma/client did not
  initialize yet`, before any test code runs). They are unrelated to this
  change and are expected to run in CI.
- The four failed sync domains on the active test store are real but outside
  the evidence catalog, so this task's quality model is not exercised by
  *them* in production; the failed-domain state machine (Task 201) and the
  Task 203 quality derivation on failed freshness are each covered by
  dedicated tests instead.
- Parity golden: if the Python quality module changes, regenerate the golden
  with `python/scripts/gen_quality_golden.py` (it writes the Node fixture
  file) so the Node mirror is re-asserted.

## Files

- `python/src/intelligence/evidence_quality.py` (new) — unified model + helpers.
- `python/src/intelligence/evidence.py` (changed) — `evidence_item()` attaches `quality`.
- `python/tests/test_rev_evidence_quality.py` (new) — 51 tests.
- `python/scripts/gen_quality_golden.py` (new) — parity golden generator.
- `Backend/src/services/revEvidenceQuality.js` (new) — Node mirror.
- `Backend/src/services/revEvidenceContract.js` (changed) — `createEvidence` attaches `quality`.
- `Backend/src/services/__tests__/revEvidenceQuality.test.js` (new) — 11 tests incl. parity.
- `Backend/src/services/__tests__/revEvidenceQuality.golden.json` (new) — Python-generated parity golden.
