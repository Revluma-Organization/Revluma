# Commerce data engine — acceptance tests

Research 2026-11-05; state 2026-11-06. "Pass" below means executed and passing in
the environment indicated. Nothing in this document substitutes for CI or for
live-store verification; where a check has not run, it says **NOT RUN**.

## Backend (Node `node:test`, run individually or via `npm test` / CI)

| Suite | What it proves | Result |
|---|---|---|
| `src/tests/shopifyNestedLineCompleteness.test.js` | Nested `lineItems` pages require terminal metadata, valid/unique IDs, match parent cursor; malformed/truncated/absent child pages reject with `SHOPIFY_LINE_ITEMS_INCOMPLETE` **before any write**; subsequent pages fetched with parent identity + cursor | NOT RUN locally — prisma binary download blocked in this sandbox (environmental; identical on main). Runs in CI (`backend-tests.yml` after `npm ci` generates the client). CI result pending on the release PR |
| `src/tests/intelligenceShopifyPagination.test.js` | Root fetchConnection rejects cursor cycles >1 page and caps pagination | NOT RUN locally — same prisma/load-time issue. CI gate |
| `src/tests/intelligenceShopifyCoverageProducer.test.js` | Decimal-exact window compare; malformed money/duplicate IDs/excluded timestamps rejected; full pass mints `intelligence_order_coverage`; failure leaves none | NOT RUN locally — same. CI gate |
| `src/tests/shopifyWebhookDeliverySafety.test.js` | Only `processed` ⇒ duplicate 200; in-flight ⇒ `WEBHOOK_DELIVERY_PENDING` (non-2xx); `failed` reclaimed for retry; store/topic identity mismatch rejected | PASS locally (2026-11-06) |
| `src/services/__tests__/shopifyWebhookService.test.js` | Reconciliation builds exactly the 12 required topics (orders×4, customers×2, checkouts×2, products×3, app/uninstalled); create/delete semantics | PASS locally (2026-11-06) |
| `src/tests/shopifyProductSync.test.js` | Decimal-string price preservation; nested variant pagination fail-closed; mid-pagination change rejected; stalled-cursor guard; webhook refetch/delete/malformed handling | PASS locally (2026-11-06, 8/8) |
| `src/tests/shopifyPrivacyWebhookWorkflow.test.js` | data_request export artifact; redact erases identifiers scoped to store; shop/redact deletes store data in one transaction; idempotent redelivery; failure marks delivery retryable; audit log counts-only | PASS locally (2026-11-06) |
| `src/controller/__tests__/shopify.callback.test.js` | OAuth callback path incl. scope handling and setup-retry behavior | PASS locally (2026-11-06) |

Local run command (mocked prisma/network; no Shopify or DB access):

```
JWT_SECRET=... COOKIE_SECRET=... SHOPIFY_TOKEN_ENCRYPTION_KEY=<64hex> SENDGRID_API_KEY=SG.test \
node <test-file>
```

Full suite locally: tests that import `configs/database` fail at module load
here because `npm ci` postinstall (`prisma generate`) cannot reach
`binaries.prisma.sh`; this affects main identically. **CI is the merge gate.**

## Python (`pytest`, `/home/user/Revluma/python`)

| Suite | What it proves | Result |
|---|---|---|
| `tests/test_commerce_metrics.py` | Decimal arithmetic; currency gate excludes foreign rows (counted); missing data ⇒ `None`; zero denominators ⇒ `None`; unparseable money raises; units sold; revenue buckets; per-currency separation | PASS locally (104 passed combined, 2026-11-06) |
| `tests/test_metric_registry.py` | One definition per metric; not_computable metrics raise `MetricNotComputableError`; definition drift detection; claim-grade admission (hypothesis ≠ fact) | PASS locally |
| `tests/test_multi_period_evidence.py` | Multi-period evidence assembly | PASS locally |
| `tests/test_seven_day_evidence.py`, `tests/test_rev_revenue_evidence.py`, `tests/test_rev_evidence_contract.py` | Rev evidence paths produce contract-compliant payloads | PASS locally |
| Remaining python tests (api, models, routing, …) | — | NOT EXECUTED in this venv (missing fastapi/mlflow/pandas/httpx/anyio); pre-existing condition, unrelated to this branch |

## Cross-cutting / E2E (require live access)

| Acceptance | Status |
|---|---|
| Live `currentAppInstallation.accessScopes` vs stored `granted_scopes` | NOT RUN — no credentialed access |
| Source-vs-store count parity (orders/products/customers) on test store | NOT RUN — no credentialed access |
| Post-merge deploy → live `product_sync` stage logs on test store | PENDING merge |
| Live webhook end-to-end (Shopify → `/webhooks/commerce/shopify/:topic`) | NOT RUN — no credentialed access (197 historical `processed` deliveries exist) |
| Two independent merchant org isolation E2E | NOT RUN — second merchant unavailable |
| Privacy request redelivery drill against live store | NOT RUN — test fixtures only |

## Rules enforced by these tests

1. No commerce write without HMAC verification + store identity match.
2. No persistence of possibly-truncated nested data — ever.
3. No certification without exact-decimal window parity and clean timestamps.
4. No acknowledgment of a privacy topic before the workflow commits.
5. No fabricated metrics: registry gates availability; missing inputs disclose.
6. Only `processed` webhook deliveries are duplicates; anything else retries.
