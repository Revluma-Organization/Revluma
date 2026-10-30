# REVLUMA — TASK 021: Reject matches based only on email

## A. Task Identification
Task 021 of 406, Phase 1 Reliable Data Foundation, Workstream 1B Checkout/Order Integrity. 2026-10-30. Repository `Revluma-Organization/Revluma`; branch `test/task-021-email-only-rejection`, main-based, base commit `8349de91cdaeff8b786ccc5f3ba0286c5b9f5a0b` from PR #215. Inspected service blob `0a042e3f61aee62cbca84e05938e606036394f50`, Prisma schema blob `61b1754fa05dde437a262a6d9fc9cbbe7b8bbbd7`. Production SHA alignment **UNVERIFIED**. Shopify API 2026-10 per previous engineering evidence, not independently verified against Shopify. Node 22; Prisma version requires exact package lock verification; disposable pgvector PostgreSQL 16.

## B. Previous Evidence Reviewed
Reviewed main `docs/mvp-execution/README.md`, `audit-register.md`, `implementation-decisions.md`, `backlog.md`; Task 020 report and tests on separate unmerged PR #215. Main register still says Task 020 NOT STARTED because branch unmerged; **do not rewrite historical rows**. Previous Task 020 isolated PostgreSQL 22/22 PASS; task-specific new evidence must not be inferred from it. Earlier TASK-003/004/005/006/009/010/013/014/015/016/017/018/019 report paths **not fully independently reviewed**; their contents must not be invented. Raw correlated Shopify email payloads not available in inspected files; previous reports refer to sanitized Shopify evidence, but presence counts unavailable.

## C. Shopify Email Field Semantics
| Email Field | Payload Source | Meaning | Observed? | Backend Usage | Evidence |
|---|---|---|---|---|---|
| `customer.email` | order/checkout/customer | Customer account contact address | synthetic fixtures only in Task 021; real payload presence UNVERIFIED | First preference in `customerData` | `commerceWebhookService.js` |
| `email` | order/checkout | Top-level order/checkout contact address | synthetic fixtures; real payload presence UNVERIFIED | Fallback in `customerData` only when customer object exists for checkout | service |
| `contact_email` | order | Shopify contact address candidate | UNVERIFIED | Not read by `customerData` | source |
| `billing_address.email` | order | Billing address candidate | UNVERIFIED | Not read | source |
| `shipping_address.email` | order | Shipping address candidate | UNVERIFIED | Not read | source |
Source semantics do not prove equivalence. In checkout path, absent `payload.customer` means no customer upsert even if `payload.email` exists. In order path, customer row always upserted and fallback email is `<externalId>@redacted.invalid` if absent.

## D. Email Availability
| Payload Type | Field | Actual Shopify Presence | Nullability | Evidence |
|---|---|---|---|---|
| Checkout created | `email`, `customer.email` | n/N UNKNOWN — real paired samples unavailable | Can be missing/null in synthetic fixtures | source, fixtures |
| Checkout updated | `email`, `customer.email` | n/N UNKNOWN | UNKNOWN real payloads | source |
| Order created | `email`, `customer.email` | n/N UNKNOWN | Can be missing/null in fixtures | source, fixtures |
| Order updated | `email`, `customer.email` | n/N UNKNOWN | UNKNOWN real payloads | source |
No fabricated sample counts. Never record real customer email.

## E. Database Representation
Prisma `customers.email String` required, `@@index([email])` nonunique; `@@unique([store_id,external_id])` but no unique email. `abandoned_carts` has no email column, optional `customer_id`, `store_id`, `external_cart_id` indexed nonunique. `orders` has no email column, required `customer_id`, `store_id`, nullable `abandoned_cart_id`, `recovery_status`; order identity unique `(store_id,external_order_id)`. Multiple checkouts/customers can share an email; across merchants too. Checkout email can be updated through linked customer upsert; order email persists on customer record, not original order snapshot. This limits later email provenance; not itself a checkout matching defect.

## F. Email Extraction and Normalization
`customerData(provider,payload)`: `customer.email || payload.email || \`${externalId}@redacted.invalid\``; no trimming, lowercasing, Unicode, domain, plus-address or Gmail dot normalization in inspected service. Whitespace-only truthy email may be stored verbatim. Order customer `externalId=String(customer.id || payload.customer_id || \`order:${payload.id}\`)`; checkout customer upsert only if `payload.customer` truthy. Source email precedence: customer account email before top-level contact email. No email data passed into `abandoned_carts.findFirst` match query. Real Shopify field presence unknown.

## G. Existing Email Matching Logic
Actual `processCommerceWebhook` routes `checkouts/*` to `upsertAbandonedCart` and `orders/*` to `upsertOrder`. Order `upsertOrder` upserts customer by `(store_id,external_id)`, persists order by `(store_id,external_order_id)`, then builds `cartIdentifiers=[checkout_id,cart_token,checkout_token]`, queries `abandoned_carts.findFirst({where:{store_id,external_cart_id:{in:cartIdentifiers}},orderBy:{updated_at:'desc'}})`. If no cart and a discount code exists, a scoped `sequence_sends.metadata.discount_code` fallback may select a cart. On cart match only, cart becomes `recovered`, order gets `abandoned_cart_id`, `session_id`, `recovery_status='recovered'`. Without match, order remains `recovery_status='completed'`, `abandoned_cart_id=null` on initial insertion. **EMAIL-BASED MATCHING NOT IMPLEMENTED** in inspected reconciliation service. Existing verified FK on repeat order is not cleared by a no-match retry. Known coupon fallback ambiguity is outside Task 021.

## H. Matching Evidence Classification
Email used for `customers.email` persistence/profile context (DIAGNOSTIC/CONTACT DATA), not CANDIDATE DISCOVERY nor VERIFIED MATCH DECISION in inspected `upsertOrder`. Email does not cause STATE MUTATION or RECOVERY REVENUE ATTRIBUTION in this path. Checkout ID/cart token/checkout token = match candidates; coupon sequence metadata = fallback candidate with known independent risk. Downstream email search/display and UI analytics not independently audited.

## I. Email-Only Test Isolation
All cases except TC021-23/24/25 omit `checkout_id`, `checkout_token`, `cart_token` on order; synthetic checkout `id` values intentionally differ from order IDs. Customer Shopify IDs deliberately differ except guest/null cases; no coupon/discount code. For checkout payload, top-level email is supplied alongside customer object where needed; note `customer.email` precedence in backend. TC021-23/24 deliberately include exact checkout identifier/token pointing to different email checkout; these prove email does not override stronger match. TC021-25 creates verified FK first, retries same order with different email and no ID. Email equality itself is not used as a match by current service.

## J. Test Environment
GitHub Actions isolated `pgvector/pgvector:pg16`, localhost `task021` DB, `TASK021_ISOLATED_DB=true` guard, Node 22, `npm ci`, vector extension, Prisma db push; no live Shopify, production DB, production webhooks, migration, deployment, or real customer PII. Synthetic `example.invalid` emails, and synthetic `gmail.com` variants for requested provider-style alias case. Cleanup test stores/org/user. CI must execute before PASS.

## K. Existing Test Coverage
Task 020 tests on separate PR #215 validate customer identity-only rejection but not email-specific variations. Task 021 adds 29 dedicated real Prisma scenarios; full repository test search and production path coverage not established.

## L. Test Execution
Command `node src/tests/task021EmailOnly.integration.js` after `npm ci`, `CREATE EXTENSION vector`, `npx prisma db push --skip-generate --accept-data-loss`. **PENDING** GitHub Actions CI evidence.

## M. Email-Only Rejection Matrix
| Test ID | Scenario | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|
| TC021-01 | Same email no identifiers | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-02 | Multiple checkouts one email | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-03 | Single checkout same email | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-04 | Previously abandoned | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-05 | Multiple abandoned | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-06 | Mixed checkout states | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-07 | Guest checkout | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-08 | Shared email different customers | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-09 | Different emails | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-10 | Missing email | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-11 | Null emails | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-12 | Empty emails | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-13 | Whitespace-only emails | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-14 | Case variation | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-15 | Plus-address variation | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-16 | Gmail-style dot variation | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-17 | Email changed | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-18 | Customer-account vs checkout email | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-19 | Same email and product | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-20 | Same email and amount | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-21 | Same email and time | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-22 | Cross-merchant collision | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-23 | Conflicting checkout ID | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-24 | Conflicting checkout token | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-25 | Existing verified relationship | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-26 | Repeated email-only attempts | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-27 | Checkout lifecycle | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-28 | Revenue attribution | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |
| TC021-29 | Unresolved relationship | No email-only checkout relationship/state/recovery attribution; TC021-23/24 allow stronger exact-ID match | Pending | isolated CI | NOT RUN |

## N. Merchant Isolation
`customers` upsert by store/external ID; checkout lookup by store/external_cart_id. TC021-22 specifically checks same email across two merchants without cross-store state mutation.

## O. Checkout Lifecycle Safety
Only selected cart updated to `recovered`; absent authoritative ID or coupon, no selected cart, so email-only cannot mutate checkout in inspected path. Test scenarios cover abandoned, mixed, guest, repeated processing and previously recovered states. `completed` is an order recovery_status value, not a persisted checkout status.

## P. Revenue Attribution Safety
Order total persists as commerce revenue; `recovery_status='completed'` is not recovered revenue. A cart relationship and `recovery_status='recovered'` are only set on selected cart. TC021-28 asserts persisted fields, not Command Center aggregate recalculation; full downstream metrics unverified.

## Q. Unresolved Relationship Handling
Order stored with `abandoned_cart_id=null`; no specific unresolved reason, candidate evidence or retry queue established in inspected path. Task 025 owns implementation.

## R. Findings
No confirmed email-only false match in inspected code. Preserve prior identifier conflict findings without reusing IDs incorrectly. `REV-FIND-021-01` (LOW, missing verification): Real Shopify correlated email samples and downstream UI metric verification unavailable; route Task 049 for integration regression or BACKLOG MAPPING REQUIRED for production payload capture. This is missing verification, **not a confirmed production defect**. Nonunique email is expected, not a defect.

## S. Future Implementation Dependencies
Task 022 amount/time negative checks, Task 023 coupon fallback, Task 025 unresolved tracking, Task 026 identifier conflicts, Task 049 regression. No other tasks started.

## T. Limitations
Actual Shopify email field frequency and nullability unknown; production revision alignment unknown; source audit focused on `commerceWebhookService.js`; synthetic integration tests cannot certify every webhook entrypoint, downstream metrics or real Shopify data.

## U. Final Status
**IN PROGRESS** until 29 test cases executed and verified in isolated CI.

## V. Changes Made
Test-only `Backend/src/tests/task021EmailOnly.integration.js`, workflow `.github/workflows/task021-email-only.yml`, report and central register. No production changes.

## W. Version Control
Branch `test/task-021-email-only-rejection`; PR and CI run to append. No merge/deploy.
