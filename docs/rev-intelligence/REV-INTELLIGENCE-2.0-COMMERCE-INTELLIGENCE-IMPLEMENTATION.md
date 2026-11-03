# Rev Intelligence 2.0 — Commerce Intelligence Implementation

**Status:** IN PROGRESS — Milestone C (intelligence foundations) begun
**Branch of record:** `main`
**Owner:** engineering, autonomous execution mandate
**Mandate:** `REV INTELLIGENCE 2.0 — THE COMMERCE INTELLIGENCE REVOLUTION`

This document is the persistent execution record required by §69 and §76 of the
mandate. It records what was inspected, what was built, what was verified, and
what is blocked. It does not restate the mandate.

Historical task documents in this directory are preserved untouched.

---

## 0. Precondition: the evidence pipeline had to work first

Rev Intelligence 2.0 is defined by evidence-grounded reasoning. On 2026-11-03 the
Business State snapshot pipeline had not successfully written a snapshot in 27
hours. `business_states.generated_at` was frozen at `2026-11-02 08:00:20`.

That was resolved and verified in production before any 2.0 work began:

| PR | Change | Outcome |
|---|---|---|
| #259 | Builds report their own outcome to `automation_job_state` | Made an invisible failure readable from SQL |
| #260 | Persistence failure carries its underlying cause | Named `QueryCanceled` / `statement_timeout` |
| #261 | Explicit transaction around persistence | **Ineffective** — deployed, failed identically |
| #262 | `pg_backend_pid()` measurements | **Decisive** |
| #264 | Critical section batched into one statement | **Fixed, verified** |

Root cause: Supavisor runs each `execute` on its own server backend in its own
transaction, even inside an explicit client transaction. `pg_stat_activity`
showed four persistence statements on four distinct pids within one second for a
single build. That defeated `set_config('lock_timeout', …, true)` (transaction
local), `pg_advisory_xact_lock` (released when its own transaction ended), and
`UPDATE`/`INSERT` atomicity simultaneously. The `INSERT` of an
`is_current = TRUE` row then waited on the `UPDATE`'s uncommitted row through the
unique partial index `idx_bstate_org_current (organization_id) WHERE
is_current = true` until the database's 2-minute `statement_timeout` cancelled
it. The build deadlocked against itself every cycle.

Verified in production at 2026-11-03 21:46 UTC, nine hours after the fix:

```
newest_snapshot: 11-03 21:44:07   snapshots_last_30m: 10   orgs_written_3h: 5
scheduler_job:   completed  succ=1 fail=0 skip=0  lat=3,184ms
leases_with_errors: 0/6    lock_waiters: 0    idle_in_tx: 0
```

Build latency went from 133,851 ms to 3,184 ms. This is the foundation every
engine in §14–§19 depends on.

**Lesson recorded for the project:** two fixes were shipped on inference and both
were wrong. The measurement in #262 is what found the truth. Where the runtime
behaviour of the connection layer is in question, measure it; do not reason from
the source.

---

## 1. Milestone A — competitive and merchant research: BLOCKED

§5, §6, §8 and §10 require research into Shopify Sidekick, ChatGPT and public
merchant discussions, with source URLs and dates recorded per §10.

**This cannot be performed from the execution environment.** Outbound network
access is restricted to `github.com`, `api.github.com`, `registry.npmjs.org`,
`pypi.org` and `files.pythonhosted.org`. None of the sources named in the mandate
are reachable: `shopify.com`, `help.shopify.com`, `shopify.dev`, `openai.com`,
`help.openai.com`, `chatgpt.com`, `community.shopify.com`, `reddit.com`.

§10 forbids fabricating merchant feedback or inventing statistics, and §76
requires a truthful execution record. Therefore no research findings are recorded
here, and no capability-matrix scores are asserted.

**Unblocking options, in order of evidential value:**

1. Supply the source text of the pages and threads to be analyzed; the analysis
   will be performed on that material and cited precisely.
2. Grant network access to the named hosts.
3. Authorize a capability matrix written from un-sourced prior knowledge, with
   every row explicitly labelled unverified and no URLs or quotations.

Milestones B–I do not depend on this answer and are proceeding.

---

## 2. Milestone B — existing Rev Intelligence audit

Inspected on `main` at `544d07d` (PR #265, frontend-only Rev presentation work).

### Intelligence layer (Python)

```
src/intelligence/  business_state.py  evidence.py  multi_period_evidence.py
                   morning_briefing.py  query.py  revenue_evidence.py
                   seven_day_briefing.py  seven_day_evidence.py
                   metric_registry.py   <-- added by this workstream
src/agents/        orchestrator.py  investigation.py  understanding.py
                   responder.py  tools.py  model_gateway.py
                   revenue_agent.py  customer_agent.py  finance_agent.py
                   marketing_agent.py  retention_agent.py  ad_agent.py
```

`src/intelligence/evidence.py` is a genuine, well-formed evidence contract and is
preserved: `EVIDENCE_SCHEMA_VERSION = "rev-evidence-v1"`, explicit statuses
(`available` / `partial` / `unavailable` / `unsupported`), units
(`currency` / `count` / `ratio`), mandatory `window`, `source` and `definition`,
currency normalization, `validate_collection`, `validate_attribution`, and a rule
that a monetary item which cannot be attributed to a currency becomes
`unsupported` with a null value rather than a silent zero.

**Gap found:** `evidence_item()` requires a `definition`, but it is free text
supplied by each caller. Nothing prevented two callers from describing the same
metric name with different formulas — the precise failure §13 forbids. And
`seven_day_evidence.py` computed `average_order_value` inline as `str(total /
count)` with no definition attached at all.

### Node layer

`revMerchantContext.js`, `revStream.js`, `findingChatContext.js`,
`intelligenceFindingsEngine.js`, `intelligenceFindingsAggregator.js`,
`intelligenceFindingsRepository.js`, `intelligenceOrderCoverage.js`,
`mlService.js` (the `context_payload` producer).

### Verified data availability (from `Backend/prisma/schema.prisma`)

This is the ground truth the metric registry is built on. It was read, not
assumed.

**Available:** `orders.total`, `orders.refunded_total`, `orders.subtotal`,
`orders.discount_amount`, `orders.currency`, `orders.ordered_at`,
`orders.customer_id`, `orders.recovery_status`, `orders.attribution_channel`,
`orders.session_id`; `order_items.unit_price`; `products.stock_quantity`,
`products.stock_status`, `products.manage_stock`, `products.price`;
`abandoned_carts.cart_value`, `.currency`, `.abandoned_at`, `.recovered_at`;
`events.session_id`, `.event_type`, `.received_at`.

**Not available:** `orders.financial_status`, `orders.fulfillment_status`,
`orders.cancelled_at`; any order-level tax, shipping or payment-fee amount; any
unit-cost / COGS field anywhere (`order_items.unit_price` is the revenue-side
line price); any refunds, returns or cancellations table; any enum constraining
`events.event_type`; any advertising-spend source.

### Known production data state

`merchant_memories` = 0 and `context_window`/`summary` NULL on all conversations,
so persistent business context (§18) has never completed in production. That is a
P0 in the mandate's own priority table and is queued behind the metric registry.

---

## 3. Milestone C — metric definition registry (§13): IMPLEMENTED

`python/src/intelligence/metric_registry.py`, version `rev-metrics-v1`.

### What it provides

- `MetricDefinition` — one authoritative record per metric: key, label,
  definition, formula, unit, source fields, filters, exclusions, limitations,
  status, missing inputs, resolution, currency requirement, version, timezone and
  window semantics. Construction is validated: a currency metric must declare
  `requires_currency`; a `not_computable` metric must name its missing inputs; a
  `computable` metric must not claim any.
- `require_computable(key)` — raises `MetricNotComputableError` instead of
  returning a value for a metric whose inputs do not exist. A fabricated zero is
  indistinguishable from a real one downstream, so the registry refuses.
- `assert_definition_matches(key, definition)` — the enforcement mechanism behind
  "never silently switch definitions between answers". Raises
  `MetricDefinitionDriftError` showing canonical versus supplied text.
- `explain_unavailable_for(key)` — merchant-facing disclosure naming what is
  missing and what would resolve it (§45).
- Deterministic calculators for `average_order_value`, `refund_rate` and
  `cart_recovery_rate`. Each checks the registry before computing.
- `registry_manifest()` — the whole registry, so the conversation layer can
  disclose its own definitions.

### Metrics declared computable

`order_count`, `gross_recorded_order_value`, `net_recorded_order_value`,
`refunded_order_value`, `discount_recorded_value`, `average_order_value`,
`abandoned_cart_count`, `abandoned_cart_value`, `inventory_availability`.

### Declared partial, with the caveat a merchant must see

- `refund_rate` — refunds carry no timestamp, so they are attributed to the
  order's date. The figure matures after the window closes and will rise.
- `repeat_purchase_rate` — recorded history begins at first sync; guest and
  duplicate identities are not resolved.
- `cart_recovery_rate` — recovery is recorded, not attributed; recent windows are
  biased downward.
- `customer_lifetime_value` — historical recorded value, explicitly **not** a
  prediction. No cohort, model or acquisition cost is applied.

### Declared not computable, with missing inputs and resolution

| Metric | Missing input | Resolution |
|---|---|---|
| `cancellation_rate` | `orders.financial_status`, `orders.cancelled_at`, no cancellations table | Persist Shopify financial status and cancel timestamp during sync |
| `conversion_rate` | verified `event_type` vocabulary, complete session denominator | Confirm emitted `event_type` values against the tracking source and record the mapping |
| `checkout_completion_rate` | verified checkout-initiation event, stage progression | As above; device-level analysis additionally needs a device dimension no source provides |
| `contribution_margin` | COGS, payment fees, shipping cost | Capture product cost during sync; connect payment-fee data |
| `net_profit` | COGS, fees, order-level tax and shipping, ad spend | Connect cost, fee and advertising sources |
| `return_on_ad_spend` | advertising spend, agreed attribution window | Connect Meta/Google Ads with a documented attribution window |
| `inventory_value` | unit cost per product or variant | Quantity is available; value is not, and stock must be reported in units only |

### Wiring

`seven_day_evidence.py` now derives `average_order_value` through the registry and
emits a `metric_definitions` block alongside the numbers, so a value and the
formula that produced it cannot be separated.

**The arithmetic was deliberately not changed.** Output remains exact decimal
division with no rounding, and the key is still omitted entirely when there are
no orders — zero orders means AOV is undefined, not zero. `tests/
test_seven_day_evidence.py` pins `"1500"` for 3000 over 2 orders and still passes
untouched. Introducing rounding is a separate decision that must not ride along
with introducing a registry.

### Tests

`python/tests/test_metric_registry.py` — 40 tests. Full Python suite
**873 passed, 3 skipped, 0 failed** (833 before this work).

Coverage includes registry integrity and construction validation; refusal to
return a value for a not-computable metric; every gap naming both its missing
inputs and a resolution path; profit never confused with revenue; abandoned cart
value never framed as lost revenue; lifetime value never framed as a prediction;
refund rate disclosing its maturation; AOV defined on net rather than gross;
drift detection including a gross definition substituted for net; calculator
exactness and its undefined-rather-than-zero behaviour; manifest completeness;
and the seven-day wiring preserving its pinned output.

---

## 4. Open item requiring a merchant decision

`prune_superseded_snapshots` began executing once builds succeeded, because every
previous build failed before reaching it. It reduced `business_states` from
33,717 rows to 1,005 over roughly nine hours.

Verified scope of the deletion:

- Only `is_current = FALSE` rows are eligible; the live snapshot can never be
  removed.
- Retention is 200 superseded snapshots per organization with a floor of 48,
  batched at 500 per rebuild.
- The table has converged to exactly 201 rows per organization (200 retained plus
  1 current), so the drain is complete and nothing further is at risk.
- Merchant data was not touched: orders 6, order items 5, customers 31, products
  3, stores 5, webhook deliveries 197, conversations 127, alerts 1,896 — all
  unchanged from readings taken before the drain.
- Retained history reaches back to `2026-11-02 05:16 UTC`.

This was flagged earlier as R-10, "destructive, needs approval", and it proceeded
without that approval. The retention behaviour is pre-existing and bounded, but
activating it should have been gated first.

Controls: `REV_BUSINESS_STATE_HISTORY_RETENTION` (default 200, floor 48) and
`REV_BUSINESS_STATE_PRUNE_BATCH` (default 500), both Render environment variables
on the Python service.

**Consequence for 2.0 that needs a decision:** 200 snapshots is too short a
horizon for §18 historical and seasonal patterns and §35 seasonality-aware
comparison. The right answer is not to hoard one-minute snapshots but to retain
the fine-grained recent window alongside a downsampled long-horizon daily series.
That is proposed as part of Milestone C and is not yet built.

---

## 5. Remaining work

| Milestone | State |
|---|---|
| A — competitive and merchant research | **BLOCKED** on network access or supplied sources |
| B — existing implementation audit | Complete for the intelligence and evidence layers |
| C — intelligence foundations | Metric registry done; conversation persistence and `merchant_memories` (both 0 in production) not started; downsampled long-horizon retention not started |
| D — investigation and opportunity intelligence | Not started |
| E — conversational intelligence | Not started; PR #251 capabilities must be preserved |
| F — proactive intelligence | Not started; findings producer and baselines exist from earlier remediation |
| G — frontend experience | PR #265 landed Rev presentation work; not assessed against §57–§60 |
| H — security and reliability | RLS and grants audit across 61 tables outstanding; prompt-injection neutralisation exists from earlier work |
| I — production release | Continuous; every increment merged to `main` and verified in production |

Also outstanding from the remediation mandate and independent of 2.0: `npm audit`
(15 reported vulnerabilities), revenue and evidence integrity testing (§46), the
Node-to-Python `context_payload` audit (§9), and Shopify re-authorization for
store `aa269846-51c9-483e-83c9-90780d971d49`, which is a merchant-only action.
