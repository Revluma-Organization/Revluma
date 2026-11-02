# REVLUMA — TASK 022: Reject matches based only on amount or time

## A. Task Identification
Task 022 of 406; Phase 1 Reliable Data Foundation; Workstream 1B Checkout/Order Integrity; 2026-10-30. Repository `Revluma-Organization/Revluma`; branch `test/task-022-amount-time-rejection`; source baseline main `8349de91cdaeff8b786ccc5f3ba0286c5b9f5a0b`. Source service blob `0a042e3f61aee62cbca84e05938e606036394f50`; Prisma schema from main; Node 22, Prisma package constraint `^6.19.3`, isolated PostgreSQL 16. **Production revision alignment NOT VERIFIED**. Shopify API 2026-10 from prior project evidence; not independently verified in live Shopify.

## B. Previous Evidence Reviewed
Reviewed main `README.md`, `audit-register.md`, `implementation-decisions.md`, `backlog.md`, `diagnostics/TASK-013.md`; Task 021 report, workflow, tests on unmerged PR #216. Task 021 isolated 29/29 PASS, but that is not evidence of Task 022. Main audit register still marks Tasks 017–021 NOT STARTED because their reports remain on separate unmerged branches; preserve historical rows. Main `diagnostics/TASK-014.md` unavailable; prior report on PR #207 not retrieved in this execution. Reports Tasks 003–010, 015–020 not fully reread; **REVIEW INCOMPLETE**; do not invent their contents. Task 013 explicitly says real checkout payload bodies NOT retrieved, so Shopify monetary and time field presence cannot be certified.

## C. Shopify Monetary Field Semantics
| Field | Source / JSON type | Meaning / Currency | Backend Usage | Real Shopify evidence |
|---|---|---|---|---|
| checkout `total_price` | payload scalar, fixture string | Checkout total in payload currency; tax/shipping inclusion cannot be verified from real captured body | `Number(payload.total_price ?? payload.total ?? 0)` to cart_value | NOT VERIFIED; TASK-013 no authenticated body |
| checkout `currency` | payload string | Checkout currency | `payload.currency || 'USD'` | NOT VERIFIED |
| checkout `subtotal_price`, `total_discounts`, `total_tax`, `total_shipping_price` | discovery candidates | Subtotal, discounts, taxes, shipping (semantics require authenticated payload) | Not used by checkout reconciliation | NOT VERIFIED |
| order `total_price` | payload scalar, fixture string | Original gross order total | `shopifyNetOrderTotal` numeric conversion; refund subtraction | NOT VERIFIED; TASK-014 body not read |
| order `current_total_price` | candidate | Post-adjustment order total | Not used by `shopifyNetOrderTotal` | NOT VERIFIED |
| order `subtotal_price` | payload scalar | Subtotal | `Number(payload.subtotal_price ?? payload.subtotal ?? total)` | NOT VERIFIED |
| order `total_discounts` | payload scalar | Discounts | `Number(...)`, discount percentage | NOT VERIFIED |
| order `refunds[].transactions[].amount` | payload scalar | Successful refund transactions | Subtracted from gross; other statuses ignored | NOT VERIFIED |
| order `currency` | payload string | Order currency | `payload.currency || 'USD'` | NOT VERIFIED |
| order `total_tax`, `total_shipping_price_set`, `presentment_currency` | candidates | Tax/shipping/presentment | Not used in checkout identity query | NOT VERIFIED |
Field semantics are source-level mappings, **not independently authenticated Shopify schema guarantees**. Checkout subtotal and order total are not assumed equivalent. Checkout amounts can change before purchase; not matched by total.

## D. Monetary Representation
Prisma `abandoned_carts.cart_value Decimal @db.Decimal(10,2)`; `orders.total Decimal @db.Decimal(10,2)`, `orders.subtotal`, `orders.discount_amount` same; `currency String?` on both. Application casts checkout `total_price` to JS `Number` before Prisma Decimal persistence; order `shopifyNetOrderTotal` casts `Number(payload.total_price)`, sums successful refund transactions as Numbers, rounds net to two decimals only if refunds exist. Order discounts computed as Numbers; fallback USD when currency absent. Currency conversions are not performed. Potential JS binary precision is an independent monetary-calculation concern, **not an observed identity false match**. Amount is not compared with any checkout amount for reconciliation. Synthetic cross-currency fixture is not a verified FX rate.

## E. Shopify Timestamp Semantics
| Source | Handler transformation | Database destination | Identity comparison |
|---|---|---|---|
| Checkout `created_at` | `new Date(payload.created_at || Date.now())` | `abandoned_at` on creation | None |
| Checkout `updated_at` / inactivity activity | `lastCheckoutActivity(payload)` | `abandoned_carts.updated_at` | No proximity comparison |
| Checkout `completed_at` | `new Date(payload.completed_at)` when present | `recovered_at`; influences status | Not used to match order |
| Order `created_at` | `new Date(payload.created_at || payload.date_created || Date.now())` | `orders.ordered_at` | None |
| Order `processed_at`, `updated_at`, `closed_at`, `cancelled_at` | Not used in `upsertOrder` matching | Not persisted as separate order matching timestamps | None |
Real Shopify presence, precision, timezone and nullability UNKNOWN from authenticated bodies. Source ISO offsets parsed by JS Date to UTC instant, persisted as PostgreSQL timestamptz(6). Date fallback uses current server clock if source missing. Checkout inactivity threshold is separate from order identity.

## F. Timestamp Normalization
`new Date()` parses ISO offsets and milliseconds; Prisma stores `@db.Timestamptz(6)`. No matching-window, nearest-time, absolute-difference, truncation or minute rounding in `upsertOrder`. The `orderBy: {updated_at:'desc'}` is applied **only after matching a supplied checkout identifier** and is a known ambiguity concern (REV-FIND-017-01/02), not evidence of timestamp-only matching. A 15-minute inactivity threshold governs abandonment eligibility, not purchase identity.

## G. Existing Amount-Based Matching Logic
`upsertOrder` computes order total and discount metadata; `upsertAbandonedCart` persists cart_value. Neither amount is passed to checkout lookup. No equality/tolerance/range/currency comparison appears in inspected reconciliation query. **AMOUNT-ONLY MATCHING ABSENT in inspected service**.

## H. Existing Time-Based Matching Logic
`upsertOrder` persists `ordered_at` and uses it as `recovered_at` **after** an identified checkout is selected. Checkout lookup filters `store_id` and `external_cart_id IN cartIdentifiers`; it orders candidates by updated_at descending. No `ordered_at` vs `abandoned_at` or checkout `updated_at` comparison. **TIME-ONLY MATCHING ABSENT**.

## I. Combined Fallback Behavior
No combined amount+time, amount+customer+time or amount+email+time matching exists in inspected order handler. A separate coupon-code lookup via `sequence_sends.metadata.discount_code` can select a cart even without checkout IDs; this is NOT an amount/time fallback, is not exercised here, and is reserved for Task 023.

## J. Matching Evidence Classification
`checkout_id`, `cart_token`, `checkout_token` are identifier candidates; their `IN` union and most-recent selection can be ambiguous, previously reported as REV-FIND-017-01/02. `store_id` scopes both identifier and coupon fallback. Amount/currency and timestamps are persisted commerce/operational context, **not candidate discovery, verification or ranking by amount/time**. `updated_at` sorts identifier-qualified candidates only. Existing verified order FK remains if a repeated order arrives without a matching identifier.

## K. Test Isolation
TC022-01–26 and TC022-30–34 omit `checkout_id`, `checkout_token`, `cart_token` and coupon/discount_codes on orders; checkout `id` values differ from order IDs; different customers/emails except explicit combined-signal cases. TC022-27/28 deliberately provide a matching authoritative ID/token for Checkout A, while Checkout B has closer monetary/temporal evidence; TC022-29 first establishes verified FK then retries without identity evidence. No production matching strategy disabled or mocked. All cases assert persisted FK, recovery_status and checkout state. This isolates weak signals rather than merely testing stronger-ID success.

## L. Test Environment
GitHub Actions `pgvector/pgvector:pg16` service, local disposable `task022` PostgreSQL, Node 22, `TASK022_ISOLATED_DB=true` and URL localhost/DB-name guard. `npm ci`, `CREATE EXTENSION vector`, `npx prisma db push --skip-generate --accept-data-loss`, `node src/tests/task022AmountTime.integration.js`. Test user, org and stores created with UUIDs, deleted after test; synthetic amounts, times, emails. No Shopify, production DB, deployment or production code changes.

## M. Existing Test Coverage
Task 021 test suite covered same email/amount and same email/time cases, but not comprehensive amount/time combinations. Task 022 adds 34 isolated integration scenarios. Complete repository test inventory not independently established.

## N. Test Execution
**EXECUTED — PASS**. GitHub Actions run 40986341784, job 123838147525, tested commit b7819fc5e49e9c66659ef8cceb1a4c51557aefa0. `TASK022_SUMMARY={"passed":34,"failed":0,"total":34}`. All TC022-01 through TC022-34 individually PASS. Disposable PostgreSQL 16.15; npm ci, vector extension, Prisma db push and execution succeeded. Earlier runs 40986160892 and 40986250347 failed from test-only JavaScript runner syntax/duplicate-footer mistakes; corrected on branch before successful run, not production defects.

## O. Amount/Time Rejection Matrix
| Test ID | Scenario | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|
| TC022-01 | Exact amount equality | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-02 | Multiple identical totals | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-03 | Single matching total | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-04 | Similar unequal amounts | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-05 | Floating-point precision | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-06 | Different currencies same numeric | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-07 | Synthetic FX equivalent | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-08 | Discount-adjusted totals | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-09 | Shipping/tax differences | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-10 | Refund/order edit | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-11 | Identical timestamps | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-12 | One second | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-13 | One minute | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-14 | Five minutes | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-15 | Fifteen minutes | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-16 | Multiple nearby checkouts | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-17 | Checkout after order | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-18 | Receipt-time proximity | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-19 | Historical sync ingestion | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-20 | Timezone offsets | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-21 | Timestamp precision | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-22 | Exact amount and time | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-23 | Amount and close time | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-24 | Multiple identical candidates | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-25 | Amount/time and customer | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-26 | Amount/time and email | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-27 | Conflicting checkout ID | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-28 | Conflicting checkout token | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-29 | Existing verified FK | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-30 | Cross-merchant collision | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-31 | Repeated reconciliation | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-32 | Abandoned checkout lifecycle | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-33 | Recovered revenue attribution | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |
| TC022-34 | Unresolved FK | No unsupported match, mutation, or recovery; authoritative ID/token cases preserve correct match | Persisted state assertions passed | GitHub Actions run 40986341784, job 123838147525 | PASS |

## P. Merchant Isolation
Both stores share one test organization but distinct store IDs; TC022-30 verifies same amount/time across stores does not associate the other store's checkout. The actual identifier query and coupon fallback both filter store_id. Cross-organization isolation not separately tested.

## Q. Checkout Lifecycle Safety
Without identifier/coupon candidate, `upsertOrder` never executes checkout `status:'recovered'` mutation; tests assert unchanged status/recovered_at. `upsertAbandonedCart` may independently update checkout status from `completed_at` or inactivity; that is not an amount/time match. TC022-32 explicitly checks abandoned checkout preservation. Full dashboard count computation not independently exercised.

## R. Revenue Attribution Safety
No weak-signal cart match implies no `abandoned_cart_id` and no `recovery_status:'recovered'`; order commerce total remains persisted as `completed`. TC022-33 checks persisted recovery classification. Command Center/Rev Intelligence aggregate/recommendation paths not executed; do not infer full UI metrics verification.

## S. Unresolved Relationship Handling
No match leaves newly inserted order `abandoned_cart_id=null`, `recovery_status='completed'`; no structured unresolved reason, candidate list or retry queue in inspected function. Task 025 owns implementation; do not implement here.

## T. Findings
No amount/time-only false matching defect confirmed by static source. Previously known identifier collision defects **REV-FIND-017-01** and **REV-FIND-017-02** remain OPEN and are not relabeled or fixed. `REV-FIND-022-01` (LOW, missing verification): real authenticated checkout/order monetary and timestamp payload semantics and downstream aggregate effects not independently available; future Task 049 or BACKLOG MAPPING REQUIRED for live payload capture. This is **not** a confirmed production defect.

## U. Future Implementation Dependencies
Task 023 coupon fallback, Task 025 unresolved tracking, Task 026 identifier conflicts, Task 049 regression. No other tasks started.

## V. Limitations
Production revision alignment unverified; authenticated Shopify payload body fields and actual nullability unknown; order/checkout amount semantics not independently confirmed against live Shopify; full repository-wide search and downstream metrics not executed. No test validates external currency FX rate or full refund business logic; synthetic inputs verify **identity rejection only**.

## W. Final Status
**PASS — ALREADY IMPLEMENTED — VERIFIED IN ISOLATED PRISMA/POSTGRESQL TESTS**. 34/34 PASS, zero behavioral failures; amount/time-only matching absent in inspected service. This does not certify live Shopify payloads, deployed production SHA, or downstream Command Center/Rev Intelligence metric aggregation.

## X. Changes Made
Test-only `Backend/src/tests/task022AmountTime.integration.js`, workflow `.github/workflows/task022-amount-time.yml`, report and audit register. No production code, schema, migration, frontend or infra changes.

## Y. Version Control
Branch `test/task-022-amount-time-rejection`; PR #217 OPEN, UNMERGED; final CI run 40986341784, job 123838147525. No merge/deploy.

## Dated completion evidence — 2026-10-30
- `Backend/src/tests/task022AmountTime.integration.js` contains 34 isolated, actual Prisma-backed tests. Exact test command `node src/tests/task022AmountTime.integration.js`; CI Node 22, PostgreSQL 16.15 with vector extension, schema pushed to disposable localhost DB.
- GitHub Actions run `40986341784`, job `123838147525`, commit `b7819fc5e49e9c66659ef8cceb1a4c51557aefa0`: 34 PASS, 0 FAIL, 0 skipped; individual test status printed for TC022-01 through TC022-34.
- Earlier runs `40986160892` and `40986250347` failed at JavaScript parsing (first tests appended outside async runner, then duplicate footer); corrected in test-only branch commits `cd733cdb` and `b7819fc5`. Those are test harness defects, not application failures; retained for traceability.
- TC022-27/28 confirm that **one** authoritative ID/token matches Checkout A despite Checkout B having closer amount/time; this does not establish general conflict precedence across multiple contradictory authoritative identifiers (Task 026).
- No amount/time false relationship, checkout recovery, cross-store linkage, or recovered classification was observed in these 34 synthetic persisted scenarios. REV-FIND-022-01 remains OPEN as missing live payload and downstream aggregate evidence, not a confirmed production defect.
- Production code, frontend, schema, migrations, production database, Shopify, infra and deployment untouched. PR #217 not merged.
