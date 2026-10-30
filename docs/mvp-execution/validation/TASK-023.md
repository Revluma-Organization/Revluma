# REVLUMA — TASK 023: Review coupon-based fallback for false matches

## A. Task Identification
Task 023/406, CRITICAL; Phase 1 Reliable Data Foundation; Workstream 1B Checkout/Order Integrity. 2026-10-30. Branch `test/task-023-coupon-fallback-safety`; inspected `main` source service blob `0a042e3f61aee62cbca84e05938e606036394f50` (previous baseline commit `8349de91cdaeff8b786ccc5f3ba0286c5b9f5a0b`, current main HEAD not independently established). Production backend SHA **NOT VERIFIED**. Shopify API 2026-10 from prior records, not live reverified. Node 22, Prisma ^6.19.3, PostgreSQL 16.

## B. Previous Evidence Reviewed
Reviewed approved `docs/mvp-execution/backlog.md`, `README.md`, `audit-register.md`, `implementation-decisions.md`, main service and Prisma schema, TASK-013 field inventory, TASK-022 report and isolated test workflow. Prior Tasks 017/018 reported identifier ambiguities REV-FIND-017-01/02; no fixes implied. Task 022 34/34 PASS on synthetic weak amount/time. TASK-014 report remains on earlier unmerged PR #207; direct authenticated order field inventory **NOT RETRIEVED** for this execution. Other historical reports 003–011, 015–021 not exhaustively reread; **REVIEW INCOMPLETE**. Main register lists prior Tasks 017–022 NOT STARTED because separate PRs unmerged; do not rewrite those historical rows.

## C. Shopify Discount Field Semantics
| Source JSON path | Data type | Meaning / distinction | Observed authenticated field? | Backend use |
|---|---|---|---|---|
| Checkout `discount_codes` | Array | Discount code entries, nested structure/value not retained | YES, field name/type in TASK-013 15-event inventory | NOT read or persisted by `upsertAbandonedCart` |
| Checkout `total_discounts` | Scalar | Monetary discount, not code | YES field name; value/type not retained | NOT used |
| Checkout `line_items[].applied_discounts` | Nested | Item-level discounts | YES nested field name; values unknown | NOT used |
| Checkout `applied_discount`, `discount_code` | Unknown | Discovery hints | NOT OBSERVED in captured union | NOT used |
| Order `discount_codes[0].code` | First array element's `code` | Customer-entered code, when provided | Authentic field presence not revalidated | Primary `couponCode` extraction |
| Order `coupon_lines[0].code` | First array element's `code` | WooCommerce compatibility path | Not Shopify-verified | Fallback extraction |
| Order `total_discounts` | Numeric scalar | Monetary discount | Not revalidated | `discount_amount` and `discount_pct` |
| Order `discount_applications`, `discount_allocations`, `current_total_discounts` | Variable | Applications/allocations/adjustments not equivalent to codes | Not revalidated | Not read for checkout identity |
| Order `discount_codes[1+]` | Array entries | Additional codes | Not revalidated | Ignored for coupon matching; `coupon_used` reflects nonempty array |
Authenticated checkout capture includes `discount_codes` **array** but no values; exact nested types, nullable semantics, discount combinations and equivalence to order codes cannot be asserted. No invented sample counts or authentic discount-code values.

## D. Discount Type Classification
Customer-entered code: recognized synthetically through `discount_codes[0].code` in order handler; checkout payload has observed `discount_codes` array. Automatic, percentage, fixed, free shipping, product-level, order-level, multiple-combined, single-use, customer-restricted: **actual Shopify semantics NOT VERIFIED**. Synthetic automatic and shipping application fixtures can verify absence of code extraction but not Shopify discount configuration behavior. Code assumes only first order code for matching.

## E. Discount Availability
| Source | Field | Observed presence | Nullable | Evidence |
|---|---|---|---|---|
| Checkout create/update | `discount_codes` | Field appears in authenticated 15-event union; per-topic n/N unavailable | unknown | TASK-013 sanitized capture |
| Order create/update | `discount_codes` | NOT VERIFIED in this execution | unknown | TASK-014 unmerged report not retrieved |
| Historical sync | Discount fields | NOT VERIFIED | unknown | no authenticated sample inspected |
No real coupon values, Shopify single-use configuration or per-event counts available.

## F. Database Representation
`abandoned_carts`: `external_cart_id String?`, `cart_value Decimal(10,2)`, `currency String?`, `status String?`, `recovered_at DateTime?`, `orders[]`; **no checkout coupon-code or discount-application fields**. Index `[store_id,external_cart_id]` nonunique. `orders`: `coupon_used Boolean?`, `coupon_code String?`, `discount_amount Decimal(10,2)?`, `discount_pct Float?`, `abandoned_cart_id UUID?` FK, `recovery_status String?`; no multiple-code storage. `sequence_sends`: `store_id UUID`, `metadata Json?`, `sent_at DateTime?`, `sequence_id UUID`; index `[store_id,sent_at]`, no unique constraint on JSON `discount_code` or `abandoned_cart_id`. `sequences` links store. Multiple sequence sends can reference different carts with same discount code.

## G. Discount Extraction and Normalization
Order webhook → `processCommerceWebhook` → `upsertOrder` → `payload.discount_codes?.[0]?.code || payload.coupon_lines?.[0]?.code || null` (first code only; no trim, lowercasing, type validation) → `orders.coupon_code`, `coupon_used=Boolean(discount_codes?.length || coupon_lines?.length)`, `discount_amount=Number(total_discounts)` → `sequence_sends.metadata.discount_code` JSON exact equality lookup. Checkout webhook → `upsertAbandonedCart` persists no coupon data. On order updates, coupon metadata overwritten by latest payload.

## H. Existing Coupon-Based Matching Logic
**COUPON-BASED FALLBACK IMPLEMENTED.** In `Backend/src/services/commerceWebhookService.js`, `upsertOrder`: after order upsert and identifier search `abandoned_carts.findFirst({where:{store_id,external_cart_id:{in:cartIdentifiers}},orderBy:{updated_at:'desc'}})`, if no cart and `couponCode` truthy, run `sequence_sends.findFirst({where:{store_id,metadata:{path:['discount_code'],equals:couponCode}},orderBy:{sent_at:'desc'},select:{metadata:true}})`; read `metadata.abandoned_cart_id`; look up `abandoned_carts.findFirst({where:{id:cartId,store_id}})`. **No identity corroboration, no uniqueness verification, no Shopify coupon semantics verification.** If found, update checkout `status:'recovered',recovered_at:orderDate`, update order `abandoned_cart_id,session_id,recovery_status:'recovered'`. This code path may accept coupon equality as a verified relationship.

## I. Matching Priority
1. Order `checkout_id`, `cart_token`, `checkout_token` candidate union, one `findFirst` by most recently updated matching cart; known identifier ambiguity separate Tasks 017/026.
2. Only if no identifier-qualified cart: order first coupon code → most recent `sequence_sends` metadata exact JSON string → metadata checkout UUID → same-store cart.
3. If cart found: FK + checkout recovered + order recovered.
4. If no cart: order `recovery_status:'completed'`, FK null on new order; existing FK behavior on updates depends on prior state.
No email, customer, amount or time matching in this path. `sent_at` ranking is not identity evidence.

## J. Candidate Discovery Versus Verified Matching
Coupon is used for **CANDIDATE DISCOVERY → CANDIDATE RANKING (latest send) → VERIFIED MATCH DECISION → STATE MUTATION → REVENUE ATTRIBUTION**. A sequence send's metadata is not proof of purchase from its cart. Same-store check prevents cross-store cart lookup but does not validate code uniqueness, order/customer relationship, redemption provenance or checkout identity. Coupon usage is not proof of a Revluma-originated recovery campaign, particularly in locked read-only MVP.

## K. Coupon-Only Test Isolation
Tests synthesize order `discount_codes:[{code:...}]` with no `checkout_id`, `checkout_token`, `cart_token`, and checkout IDs distinct from order IDs. Create real `sequence_sends` rows with `metadata:{discount_code,abandoned_cart_id}`, same-store sequence, synthetic code, and no production logic mocks. Cases 28–30 deliberately supply authoritative identifier pointing to Checkout A while coupon metadata points to Checkout B. Cases 31 tests existing FK; 27 cross-store. No real Shopify mutations.

## L. Test Environment
GitHub Actions disposable pgvector PostgreSQL 16, Node 22, `npm ci`, `CREATE EXTENSION vector`, `npx prisma db push --skip-generate --accept-data-loss`, `node src/tests/task023CouponFallback.integration.js`, `TASK023_ISOLATED_DB=true`, database URL restricted to localhost `task023`. Test-created users, organization, two stores, carts, orders, sequences and sends; cleanup via store cascading deletion. No production DB or Shopify connections.

## M. Existing Test Coverage
TASK-022 isolated tests explicitly omitted discount codes; no coupon-only negative validation there. Task 023 adds 35 narrowly scoped real Prisma/PostgreSQL cases. Repository-wide test inventory not exhaustively searched.

## N. Test Execution
Executed GitHub Actions run 40986852655, job 123839768564: 14 PASS, 21 FAIL, 35 total, on isolated PostgreSQL 16.15. Earlier run 40986739375 had cross-case synthetic coupon collisions, corrected by namespacing test coupon codes. CI exit code 1 correctly preserves application safety failures.

## O. Coupon-Based Fallback Test Matrix
| Test ID | Scenario | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|
| TC023-01 | Identical coupon | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-02 | Multiple checkouts | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-03 | Single checkout | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-04 | Multiple orders | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-05 | Different coupon | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Assertions passed | CI 40986852655 | PASS |
| TC023-06 | Case differences | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Assertions passed | CI 40986852655 | PASS |
| TC023-07 | Partial similarity | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Assertions passed | CI 40986852655 | PASS |
| TC023-08 | Missing coupon | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Assertions passed | CI 40986852655 | PASS |
| TC023-09 | Null coupon | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Assertions passed | CI 40986852655 | PASS |
| TC023-10 | Empty coupon | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Assertions passed | CI 40986852655 | PASS |
| TC023-11 | Whitespace coupon | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-12 | Multiple coupons | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-13 | Same coupon different amounts | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-14 | Different coupons equal discount | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Assertions passed | CI 40986852655 | PASS |
| TC023-15 | Automatic discounts | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Assertions passed | CI 40986852655 | PASS |
| TC023-16 | Free shipping | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Assertions passed | CI 40986852655 | PASS |
| TC023-17 | Coupon added later | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-18 | Coupon removed | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Assertions passed | CI 40986852655 | PASS |
| TC023-19 | Coupon replaced | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-20 | Single-use coupon | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-21 | Customer-restricted coupon | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-22 | Coupon and email | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-23 | Coupon and customer ID | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-24 | Coupon and amount | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-25 | Coupon and time | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-26 | Coupon email amount time | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-27 | Cross merchant | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Assertions passed | CI 40986852655 | PASS |
| TC023-28 | Conflicting checkout ID | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Assertions passed | CI 40986852655 | PASS |
| TC023-29 | Conflicting checkout token | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Assertions passed | CI 40986852655 | PASS |
| TC023-30 | Conflicting cart token | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Assertions passed | CI 40986852655 | PASS |
| TC023-31 | Existing verified FK | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-32 | Repeated processing | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-33 | Checkout lifecycle | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-34 | Revenue attribution | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |
| TC023-35 | Unresolved FK | No coupon-only verified FK/recovery; stronger identifier precedence when provided | Unexpected checkout FK observed | CI 40986852655 | FAIL |

## P. Merchant Isolation
Coupon lookup filters `sequence_sends.store_id`; cart lookup filters both UUID and `store_id`. TC023-27 checks cross-store shared coupon. Cross-organization isolation not separately tested.

## Q. Checkout Lifecycle Safety
On coupon-only match, code sets cart `status:'recovered'` and `recovered_at=orderDate` regardless of prior status. No independent proof checkout completed. This can remove checkout from abandoned status even if unrelated; TC023-33 checks persisted state. No frontend aggregate verification.

## R. Revenue Attribution Safety
Coupon-only match sets order `recovery_status:'recovered'` and FK, potentially creating unsupported recovered-revenue classifications. `attribution_channel` and `attribution_sequence_id` are not set by this code; do not equate recovery_status with proven campaign causality. Dashboard and Rev Intelligence aggregation not executed; downstream impact potential, not directly observed.

## S. Unresolved Relationship Handling
New order with no identifier and no coupon send remains FK null, `recovery_status:'completed'`; no structured unresolved reason, candidate set, retry or explicit diagnostic log in this handler. Coupon match instead silently resolves with unsupported evidence. Future Task 025 owns unresolved tracking.

## T. Findings
- **REV-FIND-023-01 (CRITICAL; source-confirmed, integration confirmation pending):** Coupon-only sequence send metadata can establish order FK and recovered checkout/order without authoritative checkout identity. Merchant impact false recovered checkouts and misleading revenue; map Tasks 026/046/047/049, and BACKLOG MAPPING REQUIRED for removal of unsafe coupon fallback if not covered.
- **REV-FIND-023-02 (HIGH; source-confirmed):** Multiple sends with same coupon ranked by `sent_at DESC` and `findFirst` without uniqueness or ambiguity rejection. False selection possible; Task 026/027/049.
- **REV-FIND-023-03 (MEDIUM; source-confirmed):** Checkout coupon fields are not persisted, order stores only first code, and no direct checkout coupon comparison; evidence provenance incomplete; Task 028/049.
- **REV-FIND-023-04 (LOW; missing verification):** Real authenticated order coupon payload values and Shopify discount type semantics not independently captured/reviewed; Task 049 or BACKLOG MAPPING REQUIRED.
Previous REV-FIND-017-01/02 identifier ambiguity remains separate; do not duplicate or resolve.

## U. Future Implementation Dependencies
Task 024 verified FK persistence, 025 unresolved, 026 conflicting matches, 027 duplicate claims, 028 source identifiers, 029/030 completion precedence, 046 attribution labeling, 047 completed/recovered semantics, 049 regression. **No future task started**.

## V. Limitations
Synthetic coupon metadata reflects the existing Prisma schema, not observed live `sequence_sends` traffic. Real Shopify checkout/order coupon values, single-use/customer-restricted discount semantics, historical sync coverage, actual production SHA, full existing tests and downstream dashboard calculations not verified. No claim of real merchant impact occurrence.

## W. Final Status
**FAIL — VERIFIED**. 35 executed, 14 PASS, 21 FAIL. Unsafe coupon-only FK association confirmed. Merchant isolation and stronger-ID precedence passed in tested cases.

## X. Changes Made
Test-only `Backend/src/tests/task023CouponFallback.integration.js`; isolated CI workflow `.github/workflows/task023-coupon-fallback.yml`; this report and central audit register. No production code, schema, migrations, frontend, Shopify discount or infra changes.

## Y. Version Control
Branch `test/task-023-coupon-fallback-safety`; PR #218 OPEN, UNMERGED. CI 40986852655, job 123839768564. No deployment.

## Final test evidence

CI run 40986852655, job 123839768564, tested commit 7272ef4fd59e77c9cadbeb298449dce28d0c1ccf. Command: `node src/tests/task023CouponFallback.integration.js` with opt-in localhost disposable PostgreSQL and Prisma. Results: 14 PASS / 21 FAIL / 35 total.

FAIL: TC023-01, 02, 03, 04, 11, 12, 13, 17, 19, 20, 21, 22, 23, 24, 25, 26, 31, 32, 33, 34, 35. PASS: TC023-05, 06, 07, 08, 09, 10, 14, 15, 16, 18, 27, 28, 29, 30.

Failed tests show expected null checkout FK but actual non-null UUID. TC023-31 expected an existing verified FK to Checkout A, but a coupon-only replay reassigned the order to Checkout B. For TC023-33 through 35 the FK assertion fails before later status assertions run; source inspection independently shows checkout/order recovered status mutations. Tests with synthetic single-use and customer-restricted labels do not verify real Shopify restriction semantics.

**REV-FIND-023-05 — HIGH, integration-confirmed:** An existing verified checkout relationship can be overwritten by a later coupon-only order replay (TC023-31). Map Tasks 024, 026, 049. No production fixes, schema changes, Shopify mutations, merge or deployment.
