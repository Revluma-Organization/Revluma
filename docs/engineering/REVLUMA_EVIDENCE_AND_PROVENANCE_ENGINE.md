# Revluma evidence and provenance engine

Research 2026-11-05; implementation landed on this branch (e759dac, plus the
coverage producer from 39422b6). Modules: `python/src/intelligence/evidence.py`,
`revenue_evidence.py`, `seven_day_evidence.py`, `multi_period_evidence.py`,
`metric_registry.py`, `commerce_metrics.py`; JS certification:
`Backend/src/services/intelligenceShopifyCoverageProducer.js`.

## The four claim grades (enforced in code)

| Grade | Meaning | Admission rule (deterministic) |
|---|---|---|
| `verified_fact` | Source-recorded value, or a recomputation of it with an attested coverage pass | Requires source references (IDs + org/store) **and** either an attested source value or a coverage certification for the window; no projected values |
| `calculated_observation` | Deterministic computation over stored source fields | Requires metric definition key + version, currency, window, and the stored inputs; denominator ≥ 1 or disclosed zero-denominator handling |
| `hypothesis` | Plausible explanation, explicitly unproven | Must carry at least one falsifiable statement and cannot carry a `value`; may never be emitted as `verified_fact` |
| `unknown` | Evidence does not exist | May carry zero values; used instead of guessing |

`evidence.validate_claim_grades()` rejects: hypothesis-as-fact, unknown-with-value,
calculated_observation without registry definition match, and verified_fact
without source references. The LLM in Rev is a **consumer** of grades, never an
ugrader — a finding can only get *weaker* through the pipeline, never stronger.

## Metric registry (`rev-metrics-v1`)

`metric_registry.py` is the single authority on which metrics exist, what they
mean and whether this schema can compute them. Every definition carries:
formula, numerator/denominator, unit (currency|count|ratio), timezone (UTC),
window semantics (`[start, end)`), currency handling (per-currency only),
missing-data behavior (`None`, never zero), coverage requirements, and
`limitations`. Asking for an unavailable metric raises
`MetricNotComputableError` with the named missing inputs — the conversation
layer discloses the gap instead of inventing a number.

**Computable today:** order_count, gross_recorded_order_value,
net_recorded_order_value, refunded_order_value, refund_rate,
discount_recorded_value, average_order_value, repeat_purchase_rate,
abandoned_cart_count, abandoned_cart_value, cart_recovery_rate,
units_sold (via commerce_metrics line-item totals), revenue_by_period
(day/week/month buckets).

**Partial (computed with disclosed caveats):** inventory_availability (from
`products.stock_quantity`; no location split, no reservation semantics), plus
the registry's other flagged-partial metrics.

**Not computable today (inputs do not exist — never emit):** cancellation_rate,
conversion_rate, checkout_completion_rate (unconstrained `events.event_type`
vocabulary), contribution_margin, net_profit (no COGS), return_on_ad_spend (no
ad-spend source), inventory_value (no unit cost), customer_lifetime_value
(insufficient verified history + no cost basis).

## Commerce metrics computation (`commerce_metrics.py`)

- Decimal-only arithmetic, `ROUND_HALF_UP`, quantized for display; unparseable
  money fails loud (`MetricDataError`), it never coerces to zero.
- Half-open UTC windows `[start, end)`; `_currency_gate` restricts each
  computation to one currency (count of excluded foreign-currency rows is
  returned, never silently mixed).
- `summarize_orders` splits **gross** (sum of recorded `total`), **net recorded**
  (`total − refunded_total`), **refunded recorded**, **discounts recorded**,
  AOV, units; `repeat_purchase_rate` over customer windows;
  `cart_recovery_rate` from `abandoned_carts`; `revenue_by_period` buckets.
- Cross-currency: per-currency series only. No FX conversion is performed or
  implied.
- Zero-denominator: AOV/refund_rate/repeat_purchase_rate return `None` with the
  registry's missing-data semantics when denominators are zero.

## Orders coverage certification (JS)

`intelligenceShopifyCoverageProducer.verifyShopifyOrderCoverage(prisma, store)`:

1. Deletes any prior attestation for the store (a new sync invalidates it).
2. Fetches the last 14 days from Shopify orders GraphQL (paginated) and
   compares against stored `orders` by external ID with **exact decimal**
   equality (no float rounding); malformed money, duplicate local/source IDs,
   unsupported notation → reject.
3. Validates `ordered_at` source vs stored timestamps; refuses certification if
   a local ordering would exclude an otherwise-matching row from the revenue
   window.
4. On full pass, writes `intelligence_order_coverage`
   (`coverage_start/end`, `certified_at`, `source='shopify-admin-graphql'`,
   `purchase_at`-style linkage via `source_run_id`). On any mismatch → logs
   `shopify_order_coverage_unverified` with a reason code and writes nothing.

Certification attests a **window**, never lifetime completeness; refunds,
transactions, and payment capture are out of its scope and are disclosed as such.

## Evidence payload contract (what Rev assembles)

Every Rev answer that asserts a number must carry, inline or attached:

```text
organization_id, store_id, metric_key, metric_definition_version,
computed_at, window {start, end, timezone: "UTC", semantics: "[start, end)"},
currency, unit, value (Decimal string) OR limitation text,
source_refs [{table, external_id | id}], coverage {certified_at | none},
freshness {store_last_synced_at}, grade (one of the four), caveats []
```

Anything missing → the claim is downgraded, or converted to `unknown`.

## Zero-tolerance tests

- Hypothesis can never surface as verified_fact (grade-admission tests).
- `unknown` cannot carry a value.
- Unavailable metrics raise instead of returning 0/NaN.
- Mixed-currency rows excluded with an explicit count.
- Zero denominators → `None`, never a crash or an infinity.
- Decimal edge cases: 3-decimal differences rejected; trailing-zero equivalents
  accepted; large integers exact.
