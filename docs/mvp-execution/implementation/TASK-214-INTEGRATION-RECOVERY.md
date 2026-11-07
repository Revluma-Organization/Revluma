# Task 214 — Integration lifecycle, diagnostics and recovery

Status: **implemented on branch; CI and production acceptance pending**.

## Scope

Consolidates original Tasks 257–261. Task 215 is not included. The active acceptance store is `revluma-test-store-v1.myshopify.com`; no live uninstall or revocation is used.

## Canonical contract

`integrationLifecycle.js` defines persisted states, stable safe reasons, retry/reconnect eligibility, provider-error classification and observed-at precedence. `integrationLifecycleStore.js` persists append-only tenant-scoped events and compare-and-set installation versions. Authorization, registration, delivery and synchronization are independent evidence classes; an access-token row, registration row, successful redirect or queued job is not current health.

The merchant API returns safe codes/explanations and evidence timestamps only. Tokens, credentials, raw payloads, internal URLs, stack traces and provider response bodies are excluded. Database evidence failures propagate instead of becoming synthetic “no evidence” states.

## Reconnect and disconnect

Reconnect requires an authenticated organization member, an existing tenant-owned installation and exact normalized shop identity. A per-store single-use OAuth session lock prevents duplicate submissions. Shopify callback HMAC, state cookie, state/session replay, user/organization/shop identity and live `currentAppInstallation.accessScopes` are verified before lifecycle success. Only the owning OAuth attempt releases its lock. Disconnect and uninstall clear credentials without deleting merchant data.

Redirect, token exchange, webhook registration and sync queueing are separate outcomes. Webhook setup failure leaves authorization intact with `needs_attention`; sync owns queued/running/partial/completed outcomes. Failed OAuth callbacks never restore cached connected UI.

## Webhook and sync evidence

The existing twelve required subscriptions and `store_sync_domain_states` remain authoritative ledgers. Provider-listed IDs and callback-URL verification are required before registration counts as verified. Legacy database rows are not backfilled as healthy. Delivery records separately expose received/processed/failed/pending/duplicate/retry evidence and processing latency.

Initial sync has a durable job ID, attempts, timestamps and safe error code. Products, orders and abandoned checkouts are required; each must succeed with complete pagination before initial sync completes. Optional resources remain visible and may degrade without blocking required completion. Existing job IDs are returned when a worker is already active. Recovery preserves data and valid checkpoints. Success writes reject jobs whose installation has disconnected or lost authorization.

## Shared surfaces

`/api/v1/stores` is the shared safe projection; `/api/v1/stores/shopify/diagnostics` provides tenant-scoped details. Integrations, Command Center aggregation and Rev integration evidence consume the same lifecycle distinctions. Resource coverage uses persisted outcomes and counts, not estimated percentages. Partial/unavailable capability remains explicit.

## Schema and safety

Migration `20261107230000_task214_integration_recovery` adds lifecycle fields, delivery outcome fields and append-only lifecycle events with tenant-scoped service-role RLS. Existing installation tokens are not backfilled as verified authorization. No destructive recovery action or merchant write operation is introduced. Prisma schema validation is a required Backend CI step.
