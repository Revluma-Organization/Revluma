# REVLUMA — TASK 019: Independent cart-token matching validation

## A. Identification and baseline
Task 019 of 406, Phase 1 Reliable Data Foundation, Workstream 1B Checkout/Order Integrity, 2026-10-30. Branch `test/task-019-cart-token-validation` based on `main`; inspected source `Backend/src/services/commerceWebhookService.js` blob `0a042e3f61aee62cbca84e05938e606036394f50`, Prisma schema blob `61b1754fa05dde437a262a6d9fc9cbbe7b8bbbd7`. Main commit and production deployed SHA not independently reverified; do not equate branch with production. Shopify API version 2026-10 per prior records. CI Node 22; Prisma ^6.19.3; pgvector PostgreSQL 16.

## B. Prior evidence reviewed and provenance
Task 013 checkout sanitized field capture and Task 014 order sanitized field capture (separate documentation branch `docs/task-014-order-payload-audit`), Task 017 exact-ID and Task 018 checkout-token reports (separate unmerged branches). Reviewed `docs/mvp-execution/README.md`, `audit-register.md`, `implementation-decisions.md` and current production application source. Earlier Task 017 fixes are on an unmerged branch, not on this main-based validation branch. Earlier reports 001–016 are not all merged into main; availability and current deployment alignment cannot be assumed. Task 018 isolated CI confirmed 16 PASS / 4 FAIL including duplicate-token and order-before-checkout issues. No assertion that all historical reports have been independently re-executed.

## C. Shopify cart-token semantics
Cart token is cart identity evidence, **not** a checkout ID or checkout token. Exact equality is necessary but alone does not guarantee a unique checkout when more than one checkout record shares a token. Source field `cart_token` (snake case) observed in sanitized real Shopify checkout and order field inventories in Tasks 013–014, both typed string. Raw values were not retained; equality across correlated real checkout/order pairs, lifecycle stability, null rate, and exact counts per webhook topic remain **UNVERIFIED**. No Shopify documentation semantics independently fetched in this task; do not claim authoritative Shopify guarantees about uniqueness or reuse.

## D. Cart-token availability
| Payload | Field | Evidence | Presence count | Nullability |
|---|---|---|---|---|
| CHECKOUTS_CREATE | cart_token | OBSERVED — SANITIZED CAPTURE (Task 013, aggregated) | unavailable | unverified |
| CHECKOUTS_UPDATE | cart_token | OBSERVED — SANITIZED CAPTURE (Task 013, aggregated) | unavailable | unverified |
| ORDERS_CREATE | cart_token | OBSERVED — SANITIZED CAPTURE (Task 014, aggregated) | unavailable | unverified |
| ORDERS_UPDATED | cart_token | OBSERVED — SANITIZED CAPTURE (Task 014, aggregated) | unavailable | unverified |
Per-topic counts are **not** established by aggregated field inventories. Entries mean field seen in topic-group captures, not independently verified on every event.

## E. Database representation
`abandoned_carts.external_cart_id String?` nullable with non-unique composite `@@index([store_id,external_cart_id])`. One external ID slot, not a dedicated `cart_token` field; duplicate token values can exist per store. `orders.abandoned_cart_id String? @db.Uuid` optional relationship to `abandoned_carts.id`; no independently persisted `orders.cart_token` column. Merchant store FK scope present. No schema changes.

## F. Cart-token preservation
Checkout `upsertAbandonedCart`: `String(payload.checkout_id || payload.id || payload.cart_token || payload.checkout_token || '')` chooses one external identifier; `cart_token` is preserved as a string **only when checkout_id and id are absent**. No case folding, trimming, decoding or prefix matching in the selected token; empty rejected. Order `upsertOrder`: `payload.cart_token` converted to String for transient candidate lookup; **not independently persisted** for later order-first reconciliation. Blank/whitespace-only excluded from lookup; nonblank leading/trailing spaces retained. No per-source identifier provenance recorded.

## G. Existing matching implementation
Shopify order webhook → commerce webhook controller → `upsertOrder` → Prisma transaction → candidates `[payload.checkout_id,payload.cart_token,payload.checkout_token]` filtered for non-null/nonblank → `tx.abandoned_carts.findFirst({where:{store_id:store.id,external_cart_id:{in:cartIdentifiers}},orderBy:{updated_at:'desc'}})` → if found update cart to recovered and persist order `abandoned_cart_id`. Candidate comparison is exact database string equality, not substring/case-insensitive search. **No distinct cart-token-only matcher, no candidate uniqueness assessment, and no conflict rejection.** Coupon sequence fallback executes only if identifier candidates find no cart and a coupon is present; excluded from tests.

## H. Independent test isolation
Synthetic checkout fixtures use `cart_token` only (no checkout ID or checkout token). Order fixtures use `cart_token` only (no `checkout_id` or `checkout_token`), except conflict scenarios TC019-15/16, which intentionally introduce a conflicting identifier. No discount code, sequence send, email, time proximity, amount or customer fallback. Successful unique matches therefore necessarily come from cart-token lookup. Tenant scoping explicitly tested with identical tokens across two stores.

## I. Safe environment
Test-only `Backend/src/tests/task019CartToken.integration.js`, guard `TASK019_ISOLATED_DB=true` and localhost database `task019`. CI `.github/workflows/task019-cart-token.yml` starts disposable pgvector PostgreSQL 16; creates synthetic users, organization, stores, orders and carts; removes synthetic records. No production DB, live Shopify, webhook replay, synchronization, production logic, schema, migrations, infrastructure, frontend or deployment changes.

## J. Existing coverage
Task 017 test-only exact-ID suite and Task 018 checkout-token suite on unmerged branches. No existing independent cart-token-only 20-scenario Prisma suite confirmed on main before this task. Broader backend tests execute via repository PR CI, results separately recorded. This suite adds required cart-token-specific assertions without weakening existing tests.

## K. Test execution
Workflow commands: `npm ci`; `CREATE EXTENSION vector`; `npx prisma db push --skip-generate --accept-data-loss` against disposable localhost `task019`; `node src/tests/task019CartToken.integration.js`. **Executed:** GitHub Actions run 40985086411, job 123834121860, head 1b568d58c95e76209094c03bc6de4c15732ff605. Disposable pgvector/PostgreSQL schema setup and actual Prisma tests completed. **15 PASS, 5 FAIL, 20 total**. Process intentionally exited 1 due to asserted reconciliation defects; full JSON in job logs. The script exits nonzero on any failure by design.

## L. Test matrix
| Test ID | Scenario | Expected | Actual | Status |
|---|---|---|---|---|
| TC019-01 | Unique token | Match correct cart | CI 40985086411 | PASS |
| TC019-02 | No stronger identifiers | Match by cart token | CI 40985086411 | PASS |
| TC019-03 | Incorrect token | No match | CI 40985086411 | PASS |
| TC019-04 | Multiple distinct tokens | Correct checkout only | CI 40985086411 | PASS |
| TC019-05 | Duplicate token | Reject ambiguous association | FAIL: duplicate token selected one cart; CI 40985086411 | FAIL |
| TC019-06 | Same customer ambiguous token | Reject ambiguity | FAIL: shared customer duplicate token arbitrarily matched; CI 40985086411 | FAIL |
| TC019-07 | Similar orders | Token-specific correct match | CI 40985086411 | PASS |
| TC019-08 | Cross-merchant collision | Own-store only | CI 40985086411 | PASS |
| TC019-09 | Missing token | No fabricated match | CI 40985086411 | PASS |
| TC019-10 | Null token | No match | CI 40985086411 | PASS |
| TC019-11 | Empty token | No match | CI 40985086411 | PASS |
| TC019-12 | Whitespace-only | No match | CI 40985086411 | PASS |
| TC019-13 | Case sensitivity | Exact case only | CI 40985086411 | PASS |
| TC019-14 | Prefix collision | Exact equality only | CI 40985086411 | PASS |
| TC019-15 | Conflicting checkout ID | No silent relationship | FAIL: conflicting checkout ID silently linked; CI 40985086411 | FAIL |
| TC019-16 | Conflicting checkout token | No silent relationship | FAIL: conflicting checkout token silently linked; CI 40985086411 | FAIL |
| TC019-17 | Repeated token match | Deterministic | CI 40985086411 | PASS |
| TC019-18 | Order before checkout | Reconcile when later checkout arrives | FAIL: order-first relationship remained null after checkout arrived; CI 40985086411 | FAIL |
| TC019-19 | Existing FK persistence | Correct FK | CI 40985086411 | PASS |
| TC019-20 | Checkout completion | Only matched checkout recovered | CI 40985086411 | PASS |

## M–Q. Merchant isolation, ambiguity, conflict, persistence, completion
Source scopes lookup to `store_id`. Duplicate checkout external IDs are allowed by schema and latest-updated `findFirst` selects one without ambiguity detection (inherited REV-FIND-017-02). When checkout ID, checkout token, and cart token refer to different records, candidate selection is latest-updated rather than evidence-strength or conflict rejection (inherited REV-FIND-017-01). On match, order FK is persisted and cart set recovered. Late checkout does not automatically revisit already-stored orders in inspected path (inherited REV-FIND-018-02). Executed against real disposable PostgreSQL: merchant isolation TC019-08, persistence TC019-19 and completion TC019-20 PASS; duplicate ambiguity TC019-05/06, conflicts TC019-15/16 and order-first TC019-18 FAIL.

## R. Findings and mapping
| Finding ID | Severity | Classification | Evidence | Impact | Future task |
|---|---|---|---|---|---|
| REV-FIND-017-02 | HIGH | Inherited confirmed defect | Task 017/018 isolated DB; current source `findFirst`, non-unique index | Arbitrary order/cart attribution | 026 / 035 (035 mapping requires approved backlog verification) |
| REV-FIND-017-01 | HIGH | Inherited confirmed defect | Task 017/018 isolated DB; current source latest-updated `IN` | Conflicting identifiers select wrong checkout | 026 |
| REV-FIND-018-02 | MEDIUM | Inherited confirmed limitation | Task 018 isolated DB; no persisted order token | Order-first unresolved | 025 / 028 |
| REV-FIND-019-01 | MEDIUM | Source-confirmed persistence limitation | Single `external_cart_id` chosen before `cart_token`; order cart token transient | Cart-token evidence can be lost | 028 |
| REV-FIND-019-02 | MEDIUM | Missing real-payload verification | Sanitized captures lack correlated token pairs/counts | Production match reliability unknown | 028 / 049 |

Do not create duplicate finding IDs for inherited defects. No new cart-token matching algorithm authorized.

## S. Dependencies
Approved tasks 020–023 test unrelated fallbacks; 024/025 persistence/unresolved links; 026 conflicting identifiers; 027 multi-order claims; 028 source identifier preservation; 029/030 completion; 049 regression. No fixes implemented here.

## T. Limitations
No verified production revision SHA, no raw Shopify token values, no per-topic sample counts, no official Shopify cart-token semantic guarantee, no production checkout/order correlation. Isolated synthetic tests cannot certify live Shopify behavior.

## U–W. Status, changes, version control
**FAIL — VERIFIED**. Independent cart-token path isolated and exercised in real Prisma/PostgreSQL. 15 PASS / 5 FAIL. CI run 40985086411; job 123834121860. This is an isolated test failure verdict, not proof of a production incident. Only test script, CI workflow, this report and audit register. Branch `test/task-019-cart-token-validation`; PR pending; no merge or deployment.

## Reproducible failure evidence — isolated PostgreSQL

All failures reproduced by `node src/tests/task019CartToken.integration.js` in CI job `123834121860` with `TASK019_ISOLATED_DB=true`, `DATABASE_URL` pointing at disposable localhost `task019` PostgreSQL. Full `TASK019_RESULTS` output retained in job logs; summary `{"passed":15,"failed":5,"total":20}`. Assertions intentionally remain failing.

| Test | Fixture and actual DB result | Expected | Stable finding | Future task |
|---|---|---|---|---|
| TC019-05 | Two same-store checkout rows share `cart_token`; order FK became one arbitrary cart UUID | Null FK, no cart recovered | REV-FIND-017-02 | 026; uniqueness follow-up mapping required |
| TC019-06 | Two same-store rows share cart token and customer; order FK became one arbitrary UUID | Null FK, no customer fallback | REV-FIND-017-02 | 026 |
| TC019-15 | Checkout A matches order `checkout_id`, B matches `cart_token`; FK became a UUID rather than rejecting conflict | Null FK, both carts unchanged | REV-FIND-017-01 | 026 |
| TC019-16 | Checkout A matches order `checkout_token`, B matches `cart_token`; FK became a UUID rather than rejecting conflict | Null FK, both carts unchanged | REV-FIND-017-01 | 026 |
| TC019-18 | Order inserted before checkout, FK null; after checkout inserted, reloaded order FK remained null | Relationship established on later availability if supported | REV-FIND-018-02 | 025 / 028 |

**Evidence boundaries:** These results prove actual behavior of current main-based code on a synthetic isolated database. Real Shopify cart-token pairing and semantics across actual order/checkout deliveries remain unverified. Existing backend regression CI must be checked separately; test-only PR #214 remains unmerged and undeployed. No production code, schema, Shopify or production DB changes.
