# Task 199 — validation record

Date: 2026-11-07. Branch: `arena/7084d7dd-revluma`.

## Local regression evidence

- Focused Python order, investigation, evidence-contract and persisted-context selection: **69 passed**.
- Fresh full Python suite after the persisted-context allowlist correction: **1582 passed, 9 skipped**. Python `compileall` passed.
- `orderEnrichment.test.js`: **16/16 passed**, including independent nested success/failure pagination, cursor failures, duplicate prevention, tenant isolation and stale-row preservation.
- Focused existing Node money/refund/webhook selection: **72 passed, 1 environment failure**; the remaining process could not load an ungenerated Prisma Client. This is not a genuine full-suite pass.
- New source-lifecycle/historical-line acquisition test added to `shopifyNestedLineCompleteness.test.js`; genuine Prisma-backed execution is delegated to CI because local Prisma engine download is unavailable.
- Python `compileall`, all modified JavaScript syntax checks and `git diff --check` passed in the final local pre-merge gate.

## Production/database evidence

Not complete at the time of the implementation candidate. The additive migration has not yet been applied. A read-only production SQL probe confirmed that `order_items.variant_title` does not exist before this migration; this is expected and is not a successful validation of the new query.

Local unit tests do not validate PostgreSQL array adaptation, Prisma migration execution, live Shopify responses, authenticated service authorization or production tenant isolation. Those checks remain mandatory. No live order details or customer PII are copied into this record.
