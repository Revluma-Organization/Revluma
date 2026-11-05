# Commerce data engine task register

2026-11-05. Status describes this workspace, not deployment.

| ID | Priority | Task | Status / evidence |
|---|---|---|---|
| DE-001 | P0 | Fail closed on missing monetary amounts in Shopify coverage certification | In workspace; 5 focused tests previously passed with stubbed Prisma; CI, deploy, real Shopify comparison outstanding. |
| DE-002 | P0 | Reject incomplete nested Shopify order and checkout line item pages before persistence | Implemented locally with parent-specific child pagination, duplicate/cycle detection and updatedAt consistency checks. 26 focused tests passed with Prisma/Shopify stubs across related suites; API schema and live production validation, full CI, cross-tenant integration remain outstanding. |
| DE-003 | P0 | Audit webhook HMAC, duplicate delivery, ordering, privacy requests, cleanup and live registration | Audit in progress: generic customer handling matched privacy topics and shop/redact was ignored. Guard fails those topics rather than recording success; 3 signed-request tests pass. Full request/erasure workflow, registration, retention, retries and production verification remain unimplemented. |
| DE-004 | P0 | Audit existing forced write_discounts scope and safe reduction | Not started; no scope changes authorized by this task. |
| DE-005 | P1 | Verify live currentAppInstallation scopes, token, Shopify counts and Admin source parity | Blocked by absence of authorized direct Shopify/Render access in this environment; do not extract credentials. |
| DE-006 | P1 | Tenant-scoped domain coverage, checkpoints, stale/failure handling | Not started; schema, RLS and existing jobs audit prerequisite. |
| DE-007 | P1 | Canonical order, product, inventory, customer, refund, fulfillment relationships | Not started; per-domain permission and source reconciliation prerequisite. |
| DE-008 | P2 | Metrics, evidence, Rev retrieval, coverage interface and cross-merchant tests | Not started; depends on source completeness and domain authorization. |
| DE-009 | P3 | Discover and implement relevant additional interfaces | In progress: initial capability register only; exhaustive discovery incomplete. |
| DE-010 | P0 | Production certification | Blocked: real source parity, two genuine stores, deployments, logs and required acceptance tests unverified. |

### Further P0 financial coverage hardening

Coverage comparison must use exact decimal equality, not universally round to two decimal places. It now normalizes nonnegative decimal strings without floating-point rounding and rejects malformed numbers, unsupported scientific notation and duplicate local order identifiers before issuing a certificate. This is **a verification safeguard**, not a complete multi-currency metrics engine: existing ingestion still has two-decimal rounding and remains to be audited/fixed. Local mocked coverage tests include 3-decimal differences, equivalent trailing zeros, large integer differences and duplicate local IDs. Production evidence remains outstanding.
