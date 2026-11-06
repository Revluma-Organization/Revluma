# Sidekick vs Revluma — data engine comparison

Research date: **2026-11-05**; production observations **2026-11-06**. See
docs/research/SHOPIFY_SIDEKICK_TECHNICAL_BENCHMARK.md for sources and the full
list of Sidekick internals that remain unknown. This comparison covers the
**data engine** question only: what data can each see, and what can each do
with it.

## Verdict in one line

Sidekick is a broad, admin-session assistant whose capabilities are
documented at a feature level with no published evidence model; Revluma's
commerce data engine is a narrow, scope-bound, deterministic pipeline whose
claims are tied to explicit metric definitions and source references —
and which today covers far fewer domains, verified far more strictly.

## Dimension-by-dimension

| Dimension | Shopify Sidekick | Revluma commerce engine (this release) |
|---|---|---|
| Data access | In-admin session; sees what the admin shows the merchant (storefront, orders, payments summary, app data contributed via extensions) | Exactly the installed app's OAuth scopes; current grant = 24 read scopes + `write_discounts` (unused); **no `read_all_orders`** (60-day order window) |
| Evidence model | Not publicly documented | Structured evidence: org/store, source field, period, ISO currency, Decimal value, metric definition (`rev-metrics-v1`), calc version, freshness, completeness; four claim grades enforced in code (`python/src/intelligence/evidence.py`) |
| Determinism | Unknown; responses are LLM-generated | Metrics computed in Decimal with `ROUND_HALF_UP`; unavailable metrics raise `MetricNotComputableError` instead of returning approximations; LLM never upgrades a hypothesis to a fact |
| Financial definitions | Not published | Explicit and conservative: gross/net recorded order value, refunded recorded value, discount recorded value, AOV, refund rate, repeat purchase rate, cart recovery rate, units sold. **Not computable today:** profit, margin, ROAS, inventory value, CLV (no cost data, no ad-spend source) — declared `not_computable` in the registry with named missing inputs |
| Freshness | Unknown | `last_synced_at` + per-domain sync state recorded; coverage certification only after nested-page completeness checks; stale data surfaces as a limitation on answers |
| Deletion semantics | Merchant asks; admin UI applies | Mandatory privacy webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) recorded durably, redacted idempotently, tenant-scoped (d5f8e0a); `products/delete` webhooks tombstone scoped product rows (626fb51) |
| Memory | Merchant-scoped skills/memory in admin (S1) | Merchant memory strictly separate from verified facts; source wins over memory; minimal PII; correctable/expiring (architecture doc §Context layers) |
| Write capability | Merchant-reviewed actions in admin | **None for commerce.** Read-only MVP; no write scope is exercised anywhere in this release |
| Integration path | Sidekick App Data / App Actions extensions (≤20/user/store; `extensions_summary` required) | Standard OAuth + Admin GraphQL (2026-10) + webhooks; no Sidekick extension shipped yet |
| Verification | Merchant trusts Shopify | Per-domain capability register with statuses; live observations recorded; gaps stated, not papered over |
| Multi-store / org | Store-scoped in admin | Org→Store scoping everywhere; every query tenant-filtered; webhook claims verify store identity before any write |

## Where Sidekick is stronger (today, honestly)

- **Breadth of raw data** inside the admin, including Shopify Payments summaries
  Sidekick can show without any app approval, and painless NL→ShopifyQL report
  generation for merchants who have it enabled.
- **Zero-setup experience** for the merchant; no OAuth, no backfill, no sync
  lag — the data is already there.
- **Workflow actions** (form filling, report building, content drafts) that
  Revluma deliberately does not attempt.

## Where Revluma is stronger (or aims to be)

- **Auditability.** Every Revluma answer decomposes into verified_fact /
  calculated_observation / hypothesis / unknown; an auditor can recompute any
  number from the stored source fields with the registry definition.
- **Tenant isolation as an invariant.** Two independent organizations can run on
  the same database with no cross-visibility — tested at the webhook/redaction
  layer and enforced by `store_id`/`organization_id` scoping plus revoked API
  roles.
- **Honest gaps.** Unavailable metrics are named as unavailable. Sidekick has
  no documented equivalent refusal behavior.
- **Reconciliation depth for the domains implemented** — exact decimal
  comparison of source windows vs stored orders, nested-page fail-closed
  completeness, delivery-level webhook deduplication with `WEBHOOK_DELIVERY_PENDING`
  backpressure.

## Where neither can go (today)

- Pre-install order history beyond 60 days without Shopify approval
  (`read_all_orders`).
- Merchant staff/billing/account data — not exposed to apps, not shown to
  Sidekick for other merchants.
- Other apps' private data.
- True profit/CLV/ROAS without cost and ad-spend sources neither party has.

## What would change this comparison

1. Shopify approval of `read_all_orders` and protected customer data (external).
2. `shopifyqlQuery` eligibility verification for this app (would add query breadth).
3. Sidekick App Data/Actions extension work (would put Revluma's evidence inside
   Sidekick — the two are complements, not rivals).
4. Reconciliation against Shopify Payments payouts (payout ingestion is not
   implemented; the scopes are present in the OAuth record but eligibility and
   approval are unverified).
