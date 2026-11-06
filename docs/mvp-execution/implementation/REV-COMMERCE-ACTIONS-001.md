# REV-COMMERCE-ACTIONS-001 — Merchant-approved commerce vertical slice

Status: implemented for review; production verification and external authorization gates are recorded below.

## Deliberate boundary

The only supported mutation is `product_update_description`. There is no arbitrary GraphQL endpoint, generic resource action, automatic retry of an ambiguous mutation, or claim of universal commerce coverage. Product descriptions are read and written with Shopify's `descriptionHtml` field.

Collection reads are live and paginated. They are not persisted and therefore remain `implemented_unverified` in the capability registry until source-to-persistence/sync evidence exists.

The Sidekick document/tool contracts are an extension foundation only. They are **not deployable** until managed installation, token exchange, Shopify extension configuration, and deployment exist.

## Authenticated merchant endpoints

All routes require the normal Revluma JWT and active organization membership. Every mutation additionally requires `owner` or `admin`. Store and action lookups always include the authenticated organization ID.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/commerce/shopify/stores/:storeId/capabilities` | Registry × live installation scopes × sync-ledger capability report |
| GET | `/api/v1/commerce/shopify/stores/:storeId/collections?first=50&after=...` | One live collection page; `first` is 1–100 |
| GET | `/api/v1/commerce/sidekick/extension-foundation` | Honest non-deployable Sidekick contracts and blockers |
| GET | `/api/v1/commerce/actions` | Latest 50 actions for this organization |
| GET | `/api/v1/commerce/actions/:id` | One organization-scoped action |
| POST | `/api/v1/commerce/actions/preview` | Capture exact before/after and rollback state |
| POST | `/api/v1/commerce/actions/:id/confirm` | Revalidate and execute the exact confirmed preview |
| POST | `/api/v1/commerce/actions/:id/reconcile` | Reconcile an uncertain or stale provider outcome |
| POST | `/api/v1/commerce/actions/:id/rollback` | Restore the captured description only if the executed value is still current |

Preview body:

```json
{
  "action_type": "product_update_description",
  "store_id": "<store-uuid>",
  "product_id": "gid://shopify/Product/123",
  "description": "<p>Merchant-approved HTML</p>",
  "idempotency_key": "merchant-unique-request-0001"
}
```

Confirm and rollback bodies use the exact `confirmation_hash` returned by the preview/action response. It is a SHA-256 request binding, not a credential. Preview confirmation expires after ten minutes. Reusing an idempotency key with different content fails; replaying the same key returns the original action without another provider mutation.

## Failure and recovery semantics

- Preview requires live `read_products`; execution and rollback require live `write_products` from `currentAppInstallation.accessScopes`.
- `COMMERCE_ACTIONS_ENABLED` must be exactly `true` for every mutation. Missing or other values fail closed.
- Immediately before execution, Shopify's current `descriptionHtml` must equal the captured preview value.
- Immediately before rollback, it must equal the executed value. A later merchant edit is never overwritten.
- Shopify `userErrors` produce a definite `failed`/`rollback_failed` state.
- Transport errors, top-level GraphQL errors, missing products, or unverified mutation responses produce `execution_uncertain`/`rollback_uncertain`. Confirmation replay does not blindly retry these states.
- Reconciliation reads current provider state. It resolves only to the known before/after values and stops on any third value.
- `executing` and `rolling_back` rows can be reconciled only after five minutes without an update, providing crash recovery without racing an active request.
- State transitions use conditional updates inside database transactions, with organization-linked audit records. Provider calls occur outside database transactions.

Lifecycle states are constrained in PostgreSQL. Tokens, arbitrary queries, internal provider payloads, organization IDs, and rollback internals are not exposed by action serialization.

## Persistence

Migration `Backend/prisma/migrations/20261106210000_commerce_action_requests` creates the action table, tenant-scoped idempotency uniqueness, lifecycle checks, foreign keys, and operational indexes. Render's existing `prestart` runs `prisma migrate deploy`.

## Verification evidence

- Prisma schema parsed through Prisma's WASM DMMF parser: 77 models; `commerce_action_requests` has 20 fields.
- Focused tests cover strict validation, fixed GraphQL documents, correct `descriptionHtml` round trips, live scope gates, tenant isolation, idempotency, preview expiry/hash policy, concurrent edits, response verification, audit chains, rollback, uncertain outcomes, stale-crash reconciliation, collection pagination, merchant capabilities, route authorization, and Sidekick limitations.
- Sandbox `binaries.prisma.sh` access is blocked. Local generation used Prisma internals/WASM with native engine downloads disabled. The complete test command reached tests requiring a native query engine and could not complete locally; CI with normal Prisma engine access is required and must pass before merge.

## Production/external gates

1. Apply and verify the migration before serving action routes.
2. Deploy the Node service and verify its deployed SHA/readiness.
3. Keep `COMMERCE_ACTIONS_ENABLED` unset/false until migration, authorization, and production smoke checks are complete.
4. Merchant installations must explicitly grant `write_products`; recorded development scopes did not include it. Reauthorization is an external gate and must not be simulated.
5. Authenticated production API verification requires an authorized merchant session. Public health alone does not prove authenticated behavior.
6. Sidekick remains blocked on managed installation/token exchange and Shopify deployment. No Sidekick parity or universal-data claim is made.
