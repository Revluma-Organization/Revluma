# TASK 208 — Validation record

## Local evidence

- `python/tests/test_task_208_specialists.py` — **40 passed**. Covers the requested 10 revenue, 10 retention, 10 operational and 10 orchestration scenarios using actual specialist execution/calculations and canonical runtime paths.
- Full Python suite — **1,910 passed, 11 skipped**, rerun after zero-denominator and failure-rollup hardening; targeted post-audit run **126 passed**.
- Full Backend suite — **87 test files passed**, including the new independent specialist contract tests.
- Dashboard production build — **passed**, 2,881 modules. Existing large-chunk and npm audit warnings remain; no forced dependency upgrade was applied.
- Python compile, Node syntax and `git diff --check` — passed.

## Provenance and safety findings resolved during validation

- Comparison composition initially dropped revenue comparison items; restored them while adding retention items.
- Previous-period retention evidence needed the same explicit period label as the existing claim guardrail; added without changing evidence identity.
- Retention vocabulary was added to deterministic business routing so repeat-purchase trend questions do not degrade to generic chat.
- Zero ordering-customer denominators now produce unavailable rates, not 0%.
- Split fulfillment requires complete fulfillment sync evidence; specialist success requires nonempty results, and specialist exceptions block complete-success rollup.

## Not established locally

Mocks and synthetic fixtures do not establish live Shopify authorization, customer history, inventory or fulfillment coverage. Real PostgreSQL/Prisma CI, deployed revisions and authenticated JSON/SSE production conversations remain separate acceptance evidence. The active store is `revluma-test-store-v1.myshopify.com`; no retired store is used.
