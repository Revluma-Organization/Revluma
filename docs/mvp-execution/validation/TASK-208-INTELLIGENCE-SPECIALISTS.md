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

## Merge, CI and deployment evidence

- PR #351 merged as `55b25cfd58a64a41ac173e55e8a64d2b00ca98f8`. All four PR workflows and both main-branch test workflows passed on their exact commits, including real PostgreSQL/Prisma financial/security regressions.
- Vercel `dpl_5eCxvSK1BKx5VM7rv8inzDYaceEZ` is READY/PROMOTED on `55b25cf`, aliases assigned without error; the production sign-in page is reachable.
- Render remained healthy but continued reporting Node/Python build `8b5477c` through the last probe at approximately 15:04 UTC. Task 208 backend deployment identity is therefore not established.
- Read-only production checks on active store `revluma-test-store-v1.myshopify.com` confirmed active status, last sync at 15:02:33 UTC, 5 orders, 4 associated customers, 1 fulfillment row, and complete successful order/fulfillment/refund/transaction/product/inventory sync domains. No lifetime-order certification exists, so lifetime cohort/first-time claims must remain unavailable.

## Not established

Mocks and synthetic fixtures do not establish live Shopify authorization, customer history, inventory or fulfillment coverage. Direct read-only production aggregates do not prove the authenticated Node/Python execution path. No merchant authentication/session is available, so authenticated JSON/SSE production conversations and live specialist-result validation remain outstanding. The retired store was not used.
