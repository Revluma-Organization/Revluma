# REVLUMA — Commerce Data Access & Revenue-Leak Detection Capability Audit

**Date:** 2026-11-06 · **Scope:** repository (`Revluma-Organization/Revluma`), production state (read-only), pasted audit re-verified claim by claim · **Mode:** read-only verification + minimum honest code fixes (this PR).

**Status update (2026-11-06, PR follow-through):** PR #310 merged the F-001/F-002/F-003/F-011 product-sync and
findings fixes. A follow-through block landed in the same branch as `docs/mvp-execution/implementation/TASK-033`:
per-domain sync ledger (`store_sync_domain_states`), normalized variant persistence (`product_variants`, migrations
`20261106133000` / `…133001`), variant-price normalizer fix (scalar-decimal GraphQL money coerced to null),
admin per-domain coverage endpoint, and read-only dedup/financial reconciliation preview tools.
**None of this is deployed until Render picks up main; nothing in that block is PRODUCTION_VERIFIED yet.**
Original findings below preserved verbatim.

This document answers one question: **if a merchant connected their store today, how much of their
business could Revluma actually see, understand and investigate — and what revenue leaks would it
still miss?** Every claim from the investigation source below is re-verified here against the
repository and the live database; nothing is taken on faith.

**Verdict (unchanged from the investigation): NO-GO for the full revenue-leak promise today.**
But three of the four claim families I could test are now fixed in code (this PR), and every
remaining gap is enumerated with its dependency.

---

## 1. Evidence boundaries (what this audit did and did not do)

| Evidence class | Used? | Notes |
|---|---|---|
| Repository code inspection | ✅ | All queries, mappers, controllers, tests read directly |
| Live DB read-only SQL | ✅ | Stores/scopes, orders (v1), carts (dupes), events, RLS/policy counts (67/25) |
| Render service logs | ❌ | Not accessible from this environment; the "undefinedField" log claim is **code-consistent and unrefuted**, not independently re-verified |
| Direct Shopify Admin API | ❌ | No operator credentials permitted here; store-side object counts (e.g. "17 products") **UNVERIFIED** — but the code proves the sync could not have persisted a product page |
| HTTP `/ready` (production) | ✅ | `node_build=55639425b3f5` pre-#308; scheduler completed 12:09Z `failed=0` |
| Pixel/behavioural production evidence | ❌ | Zero storefront events verifiable (see F-005) |

---

## 2. Claim-by-claim verdict table (re-verified 2026-11-06)

| ID | Pasted finding | Verdict this audit | Evidence |
|----|----------------|--------------------|----------|
| F-001 | ProductVariant `weight` field invalid; query fails on Admin API 2026-10 | **CONFIRMED — FIXED in this PR** | `VARIANT_FIELDS` requested `weight { value unit }` on the variant node (lines 32-35). Correct path: `inventoryItem { measurement { weight { value unit } } }`. Fixed + fixtures migrated + regression pin (query contains no bare variant-level `weight`). Production-log specifics not independently re-verified |
| F-002 | Product sync failure blocks customer/order/checkout sync | **CONFIRMED — FIXED in this PR** | `shopifySync.js`: any non-access-denied product error was `throw`-rethrown, aborting later stages. Now: logged loudly (`shopify_product_sync_failed` with counters) and the pipeline continues; result carries `products: { status:'failed', error_type }`; completion log carries `products_sync_failed` |
| F-003 | Cancelled/refunded orders counted as revenue | **CONFIRMED — FIXED in this PR** | `intelligenceFindingsAggregator.js` selected all orders in window (no `recovery_status`, no `refunded_total`); revenue summed raw `total`. Now: cancelled/canceled/voided/deleted excluded; `net = total − refunded_total`; returning-customer sets use the same live set. **Stored rows stay stale** (see F-003b). Note: the **Python metric layer was already correct** (`EXCLUDED_ORDER_STATUSES`, NET deduction) — only the Node aggregator deviated |
| F-003b | (new) Stored cancelled orders retain stale totals | **CONFIRMED (stored data)** | v1: `18973892706493` `cancelled` total `1025.00` (fully refunded); `18973808001213` `cancelled` `0.00`. `cancelOrder` sets `recovery_status` only; it does not zero/re-derive financials. **NOT re-derived by this PR** — a bulk financial reconciliation is a data write → approval-gated |
| F-004 | Abandoned-cart duplicate identities; non-unique `(store_id, external_cart_id)` | **CONFIRMED (code + live data)** | Schema: `@@index([store_id, external_cart_id])` (non-unique). Live read-only SQL: **5 duplicate identity groups** across `abandoned_carts`. Remediation (dedup migration + unique constraint + GID/numeric normalisation) = **schema/data change → approval-gated, NOT executed** |
| F-005 | Zero pixel events for the test store; no Web Pixel extension | **CONFIRMED** | Repo search: no Web Pixel app extension exists; spec references an SDK as future work. Live read-only SQL: `events` table total = **5** rows across everything; **0 events in the last 7 days**. `write_pixels` absent from recorded grants |
| F-006 | No automated mobile/checkout testing | **CONFIRMED** (no such code in repo) | Also: Jetpack-style browser testing does not exist; MVP register's "mobile checkout evidence NOT STARTED" stands |
| F-007 | No persisted inventory/levels/locations model | **CONFIRMED** | `shopifyInventoryObservation.js` returns an ephemeral observation with `alertEligible:false`; test-only callers; no `inventory_levels`/locations tables |
| F-008 | No payment transactions / gateways / refunds ingested | **CONFIRMED** | Order sync query requests **no** `transactions`, `paymentGatewayNames`, `refund` objects or fulfillment/return records — grep returns nothing |
| F-009 | No variant table; no contextual pricing | **CONFIRMED** | `products` model only; variant expansion bounded to 2000/product for mapping; no `contextualPricing` query anywhere. Merging F-001's fix restores per-run variant visibility, **not** a durable variant model |
| F-010 | `read_all_orders` and `write_pixels` missing | **CONFIRMED** | Recorded v1 grant (24 scopes, SQL): `read_orders … read_customer_events … write_discounts` — **no `read_all_orders`, no `write_pixels`** |
| F-011 | `write_discounts` forced for read-only MVP | **CONFIRMED — FIXED in this PR** | `buildInstallUrl` always appended `write_discounts`. Now opt-in via `SHOPIFY_SCOPES` only. Revocery-path discount creation remains policy-kill-switch guarded, untouched (advisor product must not get new power silently) |
| F-012 | PRODUCTS_* webhooks never registered | **CONFIRMED** (read-only; unchanged since #306-era audit) | PRODUCTS_CREATE/UPDATE/DELETE: zero rows; 27 duplicate (store,topic) groups; see register item 3 — action requires approval |
| F-013 | No domain/trust/storefront inspection | **CONFIRMED** | No crawler, no screenshot/performance/SEO/accessibility checks, no `shop_domain`-vs-`.myshopify.com` trust signal anywhere in code |
| F-014 | No competitor pricing / ads integrations | **CONFIRMED** | Nothing in repo; Shopify cannot supply these; external sources required |
| F-015 | Findings engine = 4 categories | **CONFIRMED** | `detectIntegrationFailure`, `detectRevenueChange`, `detectOrderVolumeChange`, `detectReturningCustomerChange` — exactly four |
| F-016 | No per-domain sync health/completeness | **PARTIALLY MITIGATED (this PR)** | Products stage now fails loud with counters + result diagnostics; **no persisted per-domain checkpoint model yet** (needs schema change — approval-gated) |
| F-017 | RLS everywhere but 42 tables unpoliced | **CONFIRMED** | Live read-only SQL: **67 public tables; 67 RLS-enabled; 25 policy rows total** (products/order_items/webhook_*/intelligence_findings unpoliced). No direct anon/authenticated grants found; boundary is app-role scoping |
| F-018 | Conflicting domain pair across orgs | **CONFIRMED** (untouched this operation) | `6340092e…` vs `009e5c86…` (`revluma-test-store.myshopify.com`) — writes to neither attempted; ambiguity stays fail-closed (`WEBHOOK_STORE_AMBIGUOUS`) |
| F-019 | Pixel payload validation weak | **DIRECTIONALLY CONFIRMED** (not exhaustively reviewed) | Envelope HMAC path reviewed earlier; per-payload size/consent filters not comprehensively enforced. **Not fixed here** |
| F-020 | Python pool exhaustion 12:09–12:44Z | **UNVERIFIED** (no log access) | Worth a founder check in Render logs; if recurring, it blocks any larger ingestion engine |

**Net:** 12 of 20 confirmed in code; 4 confirmed/fixable in this PR (F-001, F-002, F-003, F-011);
2 new findings added (F-003b). None refuted. Nothing was "fixed" on paper — every fix is code +
test, nothing remote or destructive.

---

## 3. What changed in this PR (verifiable)

| Change | File | Verification |
|--------|------|--------------|
| P0 GraphQL schema fix (`ProductVariant.weight` → `inventoryItem.measurement.weight`, both inline and pagination queries) | `Backend/src/services/productSync.js` | `shopifyProductSync.test.js` **9/9**, `shopifyProductSync.reconciliation.test.js` **7/7**; new pin asserts the query never again requests variant-level `weight` |
| P0 Pipeline decoupling: product-stage failure no longer aborts customer/order/checkout syncs; result exposes `products.status/error_type`; loud `shopify_product_sync_failed` with counters | `Backend/src/services/shopifySync.js` | `node --check` OK; suites green; no behaviour change on success path |
| P0 Findings-aggregator financial semantics: exclude cancelled/voided/deleted orders; revenue = Σ(total − refunded_total); returning-customer filter uses the same live set | `Backend/src/services/intelligenceFindingsAggregator.js` | `intelligenceFindingsAggregator.test.js` **4/4** (incl. new pin: cancelled excluded, refund deducted) |
| P1 Scope hygiene: `write_discounts` no longer forced at OAuth; opt-in via `SHOPIFY_SCOPES` | `Backend/src/utils/shopify.js` | grep: no `write_discounts` outside the explanatory comment; install URL now requests exactly read_orders/read_customers/read_products (+ env list) |
| Test fixtures updated to nested weight shape | `Backend/src/tests/shopifyProductSync*.js` | suites green |

**Explicitly NOT done (by design):** no dedup of cart identities or unique migration (**P1 schema
change, approval-gated**); no zeroing of stale stored cancelled orders (data write — aggregate logic
fixed instead; bulk row reconciliation recommended as a gated one-off); no webhook registration or
store renames; no rekey apply; conflicted-domain pair untouched; remote Shopify untouched; no
protected-data or pixel deployment.

---

## 4. What Revluma can and cannot see today, by investigation domain

Legend: **✅ verified-in-prod · 🟡 implemented, partial/unverified · ❌ missing · 🔒 externally
restricted · ⬛ not accessible via Shopify**

| Domain | Status | Reality today |
|--------|--------|----------------|
| Orders (recent 60d, net/refund aware) | 🟡 | Query exists; refunds net-deducted at ingest; no `read_all_orders` ⇒ **lifetime value claims impossible**; payment transactions/gateways **not ingested** |
| Customers | 🟡 | Basic profile + consent flags ingested; order-history linkage exists; protected-data approval **unknown** for prod |
| Products (catalogue) | 🟡→❌ until #308 deploys | Sync was fatally broken (F-001) ⇒ 0 rows vs source; fix landed in this PR; variants not persisted per-row |
| Inventory / locations | ❌ | Ephemeral observation utility only; no persisted levels/movements/locations |
| Webhooks (12 required topics) | 🟡 | Verified handlers (HMAC/claim/ack); PRODUCTS_* never registered; 0 deliveries/7d; in-flight recovery now live (P3 hardening) |
| Financial correctness | 🟡→✅ in Python, ✅ fixed in Node findings | Python metrics already excluded cancelled + net refunds; Node aggregator fixed this PR |
|  abandoned carts | 🟡 | Ingested; identity duplication live (5 groups); never use raw cart totals as truth |
| Storefront experience (mobile/desktop, perf, broken pages, checkout journey) | ❌ | **Zero** — no crawler, browser or Web Pixel exists |
| Pixel behavioural telemetry | ❌ | 0 real events anywhere; `write_pixels` not granted; consent/payload pipeline not built |
| Domain/trust friction (`.myshopify.com`, redirects, SSL) | ❌ | Not implemented at all |
| Regional/contextual pricing | ❌ | `contextualPricing` never queried; no markets model (JS-side) |
| Competitor positioning | ⬛/❌ | Not a Shopify-accessible domain; needs external data (merchant-authorised crawls/licensing) |
| Marketing & ad spend / CAC / ROAS | 🔒/❌ | `read_marketing_events` recorded, no ingestion; ad platforms need merchant-authorised integrations |
| Search/SEO/indexing | 🔒/❌ | `read_reports` can support some Shopify-native reports; off-platform SEO needs Search Console or crawl |
| Refunds/transactions/fulfillment/returns | 🟡 | Totals captured; bodies/events/line-items/gateways **missing** |
| Reviews/reputation | ❌ | Requires merchant-authorised integration |
| Technical SEO & errors | ❌ | Not implemented |
| Identity: per-org store domains | ❌/⚠️ | Conflicting pair unresolved; ambiguity fails closed (safe, but ingestion for those records is impaired) |
| Multi-currency aggregation | ✅ (correctly refused) | Metrics refuse to sum across currencies — honest |
| Findings/intelligence breadth | 🟡 | 4 detectors only; store-specific leak detectors missing entirely |
| Rev conversation (P6) | 🟡 | Deterministic layer + 11-scenario fixtures certified; live session unexecuted |

**Scorecard (honest, current):** permission coverage 🟡 24/… recorded (read_all_orders,
write_pixels absent); ingestion coverage ≈ catalogue-failed/other-moderate; **leak-detector
coverage ≈ 4 of >30 required categories**; storefront/pixel coverage 0%; external-data coverage 0%.

---

## 5. Roadmap to a real revenue-leak engine (ordered, dependency-aware)

### Phase 0 — Correctness blockers (this PR closed all code-level items we could safely fix)
1. ~~Product GraphQL schema~~ ✅ this PR · 2. ~~pipeline decoupling~~ ✅ · 3. ~~findings aggregator cancelled/refund semantics~~ ✅ · 4. ~~write_discounts~~ ✅ · 5. **Bulk reconciliation of stale cancelled-order rows** (one-off, report → apply; **approval required**) · 6. **Abandoned-cart identity normalisation + unique constraint + dedup** (migration; **approval required**) · 7. Per-domain sync checkpoints model (migration; **approval required**) · 8. Re-deploy + verify product sync end-to-end against v1 (post-merge probe; cheap).

### Phase 1 — Complete commerce ingestion (build, code-only until schema gates)
Full variant + inventory models (`commerce_locations`, `product_variants`, `inventory_items`, `inventory_levels`, `inventory_observations`); markets + `contextualPricing`; refunds/transactions/fulfillments/returns queries; domains/metadata (`primaryDomain`, `shopifyDomain`, HTTPS); draft orders; price rules; ShopifyQL eligibility check. Requires: migrations (Phase 0.7) + scope `read_all_orders` decision.

### Phase 2 — Behavioural acquisition (pixel + browser testing)
Web Pixel app extension; consent-aware events; session/anon identity; `write_pixels` OAuth ask; first-party JS SDK (contract exists as spec); mobile+desktop checkout regression harness (Playwright); screenshot/error capture per test; join pixel sessions → orders for funnel proof. This is what detects "mobile checkout broken" in fact.

### Phase 3 — External intelligence (permissioned integrations)
Competitor discovery/matching (merchant-authorised or licensed data) — the $70-vs-$50 comparison is impossible without it; GA/Ads/Meta/TikTok/Search Console integrations with per-merchant consent; reviews/reputation. Every external answer must carry source URL, fetch time, confidence, and be labelled inference vs observation.

### Phase 4 — Certification
Live `shopifyAccessDiagnostic` per store post-install; protected-customer-data approval; `read_all_orders` approval; two-merchant RLS/isolation exercise; large-catalog sync budget test (Bulk Operations if >5k objects); failure-injection drills; **two-store production acceptance** before any GA claim of "Revluma finds revenue leaks".

### Standing rule for the reasoning engine
It may only reason over **verified** data (observations, computed-from-verified metrics). Missing
domains must surface as explicit "unknown/insufficient evidence" answers — never as confident
prose. The certification gate documented in `REV-LIVE-ACCEPTANCE-RUNBOOK.md` is the entry bar.

---

## 6. Bottom line

The product vision is technically achievable and honestly scoped as **maximum verified coverage of
every accessible, authorised source — with a precise, merchant-visible accounting of what is not
accessible**. It is not achievable as "100% of everything in Shopify" — Shopify exposes finite
surfaces, some gated by approval, some unavailable cross-domain entirely (competitors, ads).

Revluma today: **a correct financial core** (now including cancelled/refunds in both layers),
**a broken catalogue pipeline** (fixed in this PR), **no storefront/pixel layer**, **no external
layer**, **no leak detectors**. The foundation work — not the reasoning engine — is the job now.

**Do not tell any merchant "Revluma sees everything" until Phases 0–3 are complete and Phase 4 is
executed against two live stores.** Claims to that standard are falsifiable in 30 seconds by any
data-savvy merchant, and this document exists so we never make them.

---

## 7. Approval-gated and external items referenced here (never executed)

Cart dedup migration; unique `(store_id, external_cart_id)`; stale-cancelled-row reconciliation;
per-domain sync checkpoint schema; `read_all_orders` application; protected-customer-data approval;
Web Pixel deployment (`write_pixels`); v1 re-consent (its granted scopes include `write_discounts`
which we no longer request — reinstall would change the merchant's authorization surface);
conflicting-domain pair actions; rekey apply; webhook remediation (products topics, duplicates);
R-10 cleanup; live P6 acceptance. Each is enumerated in MASTER-COMPLETION-CHECKLIST.md and stands
exactly as written.
