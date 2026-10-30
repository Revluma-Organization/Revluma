# REVLUMA — TASK 017: Exact Shopify checkout ID reconciliation validation

## A. Identification and baseline
Task 017/406; Phase 1, Workstream 1B; 2026-10-30. Inspected production application source baseline `main` at `8349de91cdaeff8b786ccc5f3ba0286c5b9f5a0b`; test branch `test/task-017-exact-checkout-id`; test PR #212. Production deployment SHA not independently rechecked in this task. No claim that the PR is deployed.

## B. Previous evidence
Reviewed `docs/mvp-execution/README.md`, `audit-register.md`, `implementation-decisions.md`; main-branch TASK-002, 003, 004, 005, 006, 009, 010; TASK-013 on `docs/task-014-order-payload-audit`; TASK-014 on that same branch; TASK-016 on `docs/task-016-completed-checkout-validation`. TASK-015 report unavailable at inspected refs; TASK-014 and TASK-016 reports not yet on main because their documentation PRs remain unmerged. This report is based on verified code and explicitly distinguished historical capture evidence.

## C. Actual identifier semantics
Task 014's authenticated test-store order field inventory observed **no top-level `checkout_id`** on the sampled `orders/create`/`orders/updated` deliveries. `cart_token` and `checkout_token` were observed as strings. Task 013's actual checkout field inventory observed checkout `token` and `cart_token` as strings; checkout top-level `id` and `checkout_id` were absent in observed field union. Thus an **authentic exact numeric checkout-ID pair has not been observed**. Do not treat token equality as exact numeric checkout-ID proof. Shopify API configured 2026-10; no REST-to-GraphQL ID conversion implemented or verified.

| Identifier | Source | Actual type / representation | Meaning | Evidence |
|---|---|---|---|---|
| `order.checkout_id` | `upsertOrder` lookup candidate | unobserved in sampled real order payloads; synthetic string/number tested | potential exact Shopify checkout ID | source line 213; TASK-014 field inventory |
| `order.cart_token` | real order delivery | string | cart token, not checkout ID | TASK-014 |
| `order.checkout_token` | real order delivery | string | checkout token, not numeric ID | TASK-014 |
| `checkout.id` / `checkout.checkout_id` | `upsertAbandonedCart` | unobserved in sampled checkout webhook fields | potential Shopify checkout ID | source line 276; TASK-013 |
| `checkout.token` | real checkout delivery | string | checkout token; **not stored** by current priority expression | TASK-013; source line 276 |
| `checkout.cart_token` | real checkout delivery | string | cart token; persisted if checkout_id/id absent | TASK-013; source line 276 |
| `abandoned_carts.external_cart_id` | Prisma | nullable String | one chosen external checkout/cart identifier | schema model abandoned_carts |
| `abandoned_carts.id` | Prisma | UUID | internal Revluma record key | schema |
| `orders.abandoned_cart_id` | Prisma | nullable UUID FK | existing persisted order-to-checkout link | schema |

## D. Database representation
`abandoned_carts.external_cart_id String?`; non-unique `@@index([store_id, external_cart_id])`. `orders.abandoned_cart_id String? @db.Uuid` links to `abandoned_carts.id`. Order unique key `(store_id,external_order_id)`; no unique constraint on checkout external ID. Same-store duplicates are structurally possible.

## E. Actual call path and matching implementation
Shopify webhook → `commerceWebhookController` → `commerceWebhookService.upsertOrder` → transaction creates/updates customer, order and items → forms `cartIdentifiers = [...new Set([payload.checkout_id,payload.cart_token,payload.checkout_token].filter(non-null/nonblank).map(String))]` → `tx.abandoned_carts.findFirst({where:{store_id:store.id,external_cart_id:{in:cartIdentifiers}},select:{id,session_id},orderBy:{updated_at:'desc'}})` → if not found, optional coupon-based sequence fallback → if cart found, sets cart `status:'recovered'` and order `abandoned_cart_id`, `session_id`, `recovery_status:'recovered'`. Checkout ingestion: `upsertAbandonedCart` stores `String(payload.checkout_id || payload.id || payload.cart_token || payload.checkout_token || '')`, not the checkout `token` field. This is a **multi-identifier candidate lookup**, not a distinct checkout-ID-only matching stage.

## F. Normalization
`String` conversion after JS JSON parsing; null/undefined/blank excluded from order lookup, empty external ID rejected on checkout upsert. Numeric values beyond `Number.MAX_SAFE_INTEGER` can lose precision **before** String conversion if JSON parsed into a JS Number. String-form large numeric identifiers preserve digits. No explicit REST↔GraphQL conversion. No checkout-ID-first precedence: `IN` candidates are sorted by checkout `updated_at`, not by identifier authority.

## G. Isolated environment
Test-only `Backend/src/tests/task017ExactCheckoutId.integration.js`, guarded to `TASK017_ISOLATED_DB=true` and localhost `task017` PostgreSQL database. CI workflow `.github/workflows/task017-exact-id.yml` uses temporary `pgvector/pgvector:pg16` container, Node 22, `npm ci`, `CREATE EXTENSION vector`, `prisma db push`, and synthetic merchants/checkouts/orders. No production DB connection, Shopify mutation, deployment, migration or backend logic change.

## H. Existing coverage
Task 016 real Prisma checkout completion matrix: 13/13 passed in run 40983610337, but it **does not validate order-to-checkout exact-ID matching**. Task 017 adds narrowly scoped tests. Existing broader backend workflows run on PR; results to be recorded below.

## I–J. Test execution and matrix
Command: `node src/tests/task017ExactCheckoutId.integration.js` (CI after isolated `prisma db push`). GitHub Actions **run 40983945493, job 123830380283** completed with expected **failure** on two real reconciliation defects. Isolated Prisma/PostgreSQL schema initialized successfully; 14 PASS, 2 FAIL, 1 NOT APPLICABLE. Existing backend tests and backend refresh regression passed on same PR head 31275176.

| Test | Scenario | Expected | Actual | Status |
|---|---|---|---|---|
| TC017-01 | Valid exact ID | Correct cart and FK | CI 40983945493 | PASS |
| TC017-02 | Incorrect ID | No match | CI 40983945493 | PASS |
| TC017-03 | Multiple checkouts | Correct selection | CI 40983945493 | PASS |
| TC017-04 | Same customer | Exact ID wins | CI 40983945493 | PASS |
| TC017-05 | Similar orders/different customers | Exact ID wins | CI 40983945493 | PASS |
| TC017-06 | Cross-merchant collision | Tenant isolation | CI 40983945493 | PASS |
| TC017-07 | Missing ID | No fabricated exact match | CI 40983945493 | PASS |
| TC017-08 | Null ID | No false match | CI 40983945493 | PASS |
| TC017-09 | Empty ID | No false match | CI 40983945493 | PASS |
| TC017-10 | Number/string | Same safe ID matches | CI 40983945493 | PASS |
| TC017-11 | Large numeric string | Exact digits retained | CI 40983945493 | PASS |
| TC017-12 | REST/GraphQL | Only verified conversion | No conversion implemented | NOT APPLICABLE |
| TC017-13 | Duplicate records | Reject ambiguity | **FAIL: selected one duplicate row; order FK set** | FAIL |
| TC017-14 | Repeated unique match | Deterministic | CI 40983945493 | PASS |
| TC017-15 | Existing FK | Correct relationship | CI 40983945493 | PASS |
| TC017-16 | Completion effect | Only linked cart recovered | CI 40983945493 | PASS |
| Extra TC017-17 | Conflicting checkout_id and cart_token | Checkout ID has precedence | **FAIL: selected newer unrelated cart-token checkout** | FAIL |

## K–M. Merchant isolation, persistence, completion
CI confirms merchant isolation (TC017-06), persisted FK (TC017-15) and checkout recovery (TC017-16). Source query explicitly scopes by `store_id` (positive). FK persistence already implemented, contrary to generic Task 024 placeholder. A matched checkout is set recovered; an unmatched order stays completed. No separate exact-ID match provenance is recorded. All are **source-verified only** until CI.

## N. Findings
| Finding ID | Severity | Classification | Evidence | Impact | Approved future task |
|---|---|---|---|---|---|
| REV-FIND-017-01 | HIGH | Confirmed source-code design defect, confirmed by CI | `findFirst` with `IN` and latest `updated_at` can select cart token match instead of different exact checkout ID | Wrong order-to-cart link and recovery | TASK 026 |
| REV-FIND-017-02 | HIGH | Confirmed defect (real isolated PostgreSQL) | No unique constraint on `(store_id,external_cart_id)`; `findFirst` silently picks a row | False attribution when duplicates exist | TASK 026 / 035 |
| REV-FIND-017-03 | MEDIUM | Missing real-payload verification | Neither actual order nor checkout field inventory contained numeric checkout ID | Real-world exact checkout ID matching cannot be established from sampled deliveries | TASK 028 / 049 |
| REV-FIND-017-04 | MEDIUM | Potential precision risk | JS Number→String for JSON numeric checkout IDs; no safe integer guard | Distinct large IDs may collapse | TASK 028; BACKLOG MAPPING REQUIRED for guard |
| REV-FIND-017-05 | MEDIUM | Existing mapping limitation | Checkout `token` not stored in `external_cart_id` selector | Some real checkout token references cannot match | TASK 018 |

Finding IDs are task-scoped until reconciled against central stable finding register; do not duplicate earlier findings.

## O–P. Dependencies and limitations
Tasks 018/019 separately test tokens; 020–023 fallbacks; 024/025 persistence and unresolved relationships; 026 conflicts; 028 identifiers; 029 completion precedence; 049 regression suite. No production real numeric checkout-ID pair observed. TC017-13 and TC017-17 are **confirmed failures in isolated real PostgreSQL tests**, not claims of an observed production incident. No actual order-side numeric checkout ID was observed in captured real Shopify deliveries. Test case TC017-11 uses a large **string** ID, so does not establish safety for unsafe JSON numeric IDs.

## Q. Current status
**FAIL — exact checkout ID reconciliation does not satisfy mandatory ambiguity rejection or authoritative-ID precedence.** 14 PASS, 2 FAIL, 1 NOT APPLICABLE in actual isolated Prisma/PostgreSQL CI run 40983945493. Production reliability is not certified. Do not change production matching logic in this validation task.

## R–S. Changes and version control
Test-only file and isolated CI workflow plus this report and audit-register update; PR #212, unmerged; no production code, schema, frontend, merchant database or Shopify changes.

## Final reproducible failure evidence

- **TC017-13:** fixture creates two `abandoned_carts` with identical `store_id` and `external_cart_id`, then calls the real `upsertOrder`. Expected `orders.abandoned_cart_id=null` (reject ambiguity); actual FK is a UUID of one of the duplicate rows. Source `findFirst` with latest `updated_at` chooses a candidate without uniqueness validation. **REV-FIND-017-02; TASK 026 / 035.**
- **TC017-17:** fixture creates checkout A matching `order.checkout_id` and a more recently updated checkout B matching `order.cart_token`. Expected A; actual FK B. This is an explicit wrong-checkout persisted relationship and recovered state in isolated database. **REV-FIND-017-01; TASK 026.**
- CI run `40983945493`, job `123830380283`; `TASK017_SUMMARY={\"passed\":14,\"failed\":2,\"notApplicable\":1}`. Reproduce by checking out PR #212 and running the workflow or `TASK017_ISOLATED_DB=true node src/tests/task017ExactCheckoutId.integration.js` after setting up disposable localhost PostgreSQL and Prisma schema. Expected CI exit code **1** preserves known failures; do not weaken assertions to make green.
- CI backend tests and backend refresh regression both passed on commit `31275176a2366a027a692776bed943bf4397dc19`.
