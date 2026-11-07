# Task 214 validation

Status: **local/focused evidence green; full CI, deployment and production acceptance pending**.

## Automated evidence

- `Backend/src/services/__tests__/task214IntegrationRecovery.test.js`: exactly 75 named scenarios, **75/75 passed**. Covers lifecycle precedence, delayed events, registration versus delivery, resource completion, safe diagnostics, OAuth/reconnect, idempotency, shared surfaces and tenant isolation.
- Focused callback/webhook/delivery/sync run: **12/12 passed** before the final OAuth lock-owner refinement.
- Final combined callback/webhook/delivery/sync/matrix run: **77/77 passed**.
- Integrations UI: **12/12 passed after the Task 213 rebase**; inherited Integration/Command Center checks **14/14 passed**; full Dashboard **38 files / 542 tests passed**, TypeScript and production build passed., including reconnect identity, duplicate-click prevention, failed-callback cache handling and partial resource diagnostics.
- Dashboard `npx tsc --noEmit`: **passed**.
- Inherited Task 213 canonical-state/API suite after rebase: **52/52 passed**.
- `git diff --check`: **passed**.
- Local full Backend and Prisma validation are blocked by unavailable Prisma engine downloads from `binaries.prisma.sh`; this is not treated as passing evidence. Real CI is authoritative.

## Active-store read-only baseline

Read-only production queries on 2026-11-07 found store `3ed79446-cb6d-4a1c-b174-9ec1ab91fe15` active with a stored token and `last_synced_at` 2026-11-07 22:28:53 UTC. Required resource rows report successful, fully paginated results: products 17/17, orders 4/4, abandoned checkouts 8/8 discovered/inserted. These are persistence facts, not current OAuth verification.

Registration rows show the older nine topics, historical active/succeeded duplicates and no current provider-verification evidence. Delivery evidence contains 197 processed rows, last received 2026-10-30 08:00:46 UTC and processed 08:01:15 UTC. Therefore current delivery/registration health is not certified and must remain unverified after migration until genuine reconciliation.

## Required acceptance after deployment

1. Apply migration and verify exact Node, Python and Dashboard revisions.
2. With an authorized active-store session, inspect diagnostics and initiate reconnect only for `revluma-test-store-v1.myshopify.com`.
3. Verify live scopes, all twelve provider registrations/callbacks, truthful initial-sync/resource evidence and shared Integrations/Command Center/Rev availability.
4. Exercise only non-destructive duplicate/retry checks. Do not uninstall/revoke the live integration.
5. Confirm no duplicate jobs, data deletion, checkpoint regression or cross-tenant effect.

No production-complete claim is made by this document.
