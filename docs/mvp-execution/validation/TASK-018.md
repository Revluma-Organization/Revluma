# REVLUMA — TASK 018: Independent checkout token matching

## A. Identification
Task 018/406; Phase 1 / Workstream 1B. Date 2026-10-30. Inspected branch `main` (source service baseline `Backend/src/services/commerceWebhookService.js`, blob `0a042e3f61aee62cbca84e05938e606036394f50`). This task branch `test/task-018-checkout-token-validation` is based on `main`, **not** the pending Task 017 fix branch. Production deployed commit not independently verified. Shopify API version 2026-10 per earlier task records. CI Node 22, Prisma 6.19.3, PostgreSQL pgvector/pg16.

## B. Previous evidence reviewed
Read `docs/mvp-execution/README.md`, `audit-register.md`, `implementation-decisions.md`; Task 013 checkout capture report, Task 014 order capture report on `docs/task-014-order-payload-audit`, Task 017 report on `test/task-017-exact-checkout-id`. Task 016 prior real Prisma checkout test was 13/13 PASS. Earlier Tasks 002–010 available in main; Task 001 unavailable; Task 015 separate docs PR #209; Tasks 014/016/017 reports remain on their respective unmerged branches. No claim that all earlier reports were independently reread. **Important:** Task 013 initially reported missing actual checkout body; later appended sanitized field capture showing `token` and `cart_token`. Task 014 similarly appended actual order field capture. Treat later appended capture evidence as the current historical record.

## C–D. Token semantics and availability
| Field | Source | Evidence class | Type / meaning | Consumer |
|---|---|---|---|---|
| `token` | checkout created/updated | OBSERVED — SANITIZED CAPTURE, Task 013 | string; Shopify checkout token | **Not read by** `upsertAbandonedCart` |
| `cart_token` | checkout created/updated | OBSERVED — SANITIZED CAPTURE, Task 013 | string; cart token, **not** checkout token | chosen as `external_cart_id` if `checkout_id`/`id` absent |
| `checkout_token` | order created/updated | OBSERVED — SANITIZED CAPTURE, Task 014 | string; order's checkout token reference | `upsertOrder` candidate |
| `cart_token` | order created/updated | OBSERVED — SANITIZED CAPTURE, Task 014 | string; cart token | `upsertOrder` candidate, before checkout token |
| `checkout_id` | order captured samples | NOT OBSERVED in captured samples | unknown | lookup candidate if present |
| `checkout_token` | checkout captured samples | NOT OBSERVED in captured samples | unknown | checkout ingestion fallback only |

Task 013/014 captured field names/types, **not the original sensitive token values or an independently verified equal order/checkout token pair**. Presence per individual delivery and exact counts cannot be reconstructed from the available summaries. Checkout `token` and order `checkout_token` likely refer to the same resource concept, but actual pair equality is **not verified from captured production values**. Cart tokens are separate and must not be equated.

## E. Database representation
`abandoned_carts.external_cart_id String?`, `@@index([store_id,external_cart_id])` non-unique, `id` UUID. No dedicated checkout-token column; `orders` does not persist `checkout_token` as its own column; it stores nullable `abandoned_cart_id` UUID FK when matched. No token uniqueness constraint. No migrations in this task.

## F–G. Token preservation and matching
Webhook controller calls `upsertAbandonedCart` or `upsertOrder`. Checkout ingestion computes `String(payload.checkout_id || payload.id || payload.cart_token || payload.checkout_token || '')`, **omitting checkout `payload.token`**; stores only this one value as `external_cart_id`. Order reconciliation collects `payload.checkout_id`, `payload.cart_token`, `payload.checkout_token`, drops null/blank, converts to strings, and queries `abandoned_carts` scoped to `store_id`. On baseline `main`, `findFirst` over `IN` candidates chooses latest `updated_at`; duplicate ambiguity and conflicting identifier precedence defects documented in Task 017. A token-only order fixture (`checkout_id` and `cart_token` omitted) forces any successful lookup to come from `order.checkout_token`. This proves the **lookup candidate** works, but not preservation of checkout's authoritative `token` field. Comparison is exact database string equality; no lowercasing, substring or prefix matching. Whitespace-only order token excluded. No token-specific verified provenance or independent conflict resolution.

## H–I. Isolation and environment
Added guarded test-only `Backend/src/tests/task018CheckoutToken.integration.js` and `.github/workflows/task018-checkout-token.yml`. Synthetic merchant records, ephemeral PostgreSQL 16 pgvector container, localhost `task018` database guard and `TASK018_ISOLATED_DB=true`. No production DB writes, Shopify mutations, deployment, schema changes or production algorithm changes. Checkout ID and cart token omitted from positive order fixtures; no coupon code or sequence metadata; no reliance on email, amount, timestamps or customer identity.

## J–L. Coverage, commands and required test matrix
Run via CI: `npm ci`, `psql -c 'CREATE EXTENSION IF NOT EXISTS vector;'`, `npx prisma db push --skip-generate --accept-data-loss`, `node src/tests/task018CheckoutToken.integration.js`. Existing Task 017 exact-ID tests do not isolate checkout token. New tests use actual `upsertOrder`/`upsertAbandonedCart` and Prisma persistence, not mocked matching logic. CI run result will be appended after execution.

| Test ID | Scenario | Expected | Actual | Status |
|---|---|---|---|---|
| TC018-01 | exact checkout token | correct match | CI pending | NOT RUN |
| TC018-02 | ID missing | token match | CI pending | NOT RUN |
| TC018-03 | wrong token | no match | CI pending | NOT RUN |
| TC018-04 | multiple checkouts | unique token | CI pending | NOT RUN |
| TC018-05 | same customer | unique token | CI pending | NOT RUN |
| TC018-06 | similar totals | token wins | CI pending | NOT RUN |
| TC018-07 | merchant collision | own store only | CI pending | NOT RUN |
| TC018-08 | missing token | no match | CI pending | NOT RUN |
| TC018-09 | null token | no match | CI pending | NOT RUN |
| TC018-10 | empty token | no match | CI pending | NOT RUN |
| TC018-11 | whitespace token | no match | CI pending | NOT RUN |
| TC018-12 | case sensitivity | exact case | CI pending | NOT RUN |
| TC018-13 | partial token | exact only | CI pending | NOT RUN |
| TC018-14 | duplicate token | reject ambiguity | CI pending | NOT RUN |
| TC018-15 | conflicting ID and token | reject conflicting evidence | CI pending | NOT RUN |
| TC018-16 | repeated token | deterministic | CI pending | NOT RUN |
| TC018-17 | order before checkout | later relationship if supported | CI pending | NOT RUN |
| TC018-18 | persisted FK | correct FK | CI pending | NOT RUN |
| TC018-19 | completion effect | only matched checkout recovered | CI pending | NOT RUN |
| TC018-REAL | checkout `token` differs from `cart_token` | checkout token preserved and matched | CI pending | NOT RUN |

## M–P. Merchant isolation, conflict, persistence, completion
Store scoping exists in query. Existing `orders.abandoned_cart_id` persists a relationship if matched; matched cart set `recovered`. Baseline Task 017 found incorrect relationship selection when ID/token conflict and arbitrary duplicate selection. No proof of automatic order-first reconciliation. Isolated tests will provide executed evidence.

## Q. Findings
- **REV-FIND-018-01 (HIGH; source-confirmed):** checkout `payload.token` is omitted from persistence priority; `order.checkout_token` may not match persisted cart token when values differ. Potentially missed recovery linkage. Dependency Task 028 (preserve identifiers); Task 018 cannot change code.
- **REV-FIND-018-02 (MEDIUM; source-confirmed):** order checkout token not persisted independently for later matching. Dependency Task 025 / 028.
- **REV-FIND-017-01 / 017-02 (HIGH; inherited):** conflicting candidate precedence and duplicate ambiguity on main baseline. Do not duplicate as new findings; Task 026 / 035. Task 017 has an **unmerged** remediation branch; current production status not verified.
- **REV-FIND-018-03 (MEDIUM; evidence gap):** no redacted correlated real order/checkout token pair available for semantic identity verification. Task 028 / 049.

## R–S. Dependencies and limitations
Task 019 cart tokens, 024/025 persisted/unresolved relationships, 026 conflicts, 028 identifier preservation, 029 completion precedence, 049 regression tests. Do not implement here. Real payload values and production correlation not accessible in source reports; no claim of production end-to-end verification. Scope is token-specific validation only.

## T–V. Final status, changes, version control
**IN PROGRESS pending isolated CI results**. Test-only script, CI workflow, this report, audit register. Branch `test/task-018-checkout-token-validation`, PR pending; unmerged and undeployed. No production application logic changed.
