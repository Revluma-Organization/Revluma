# Task 214 diagnostic interpretation

- `connected`: stored authorization is present; this alone does not certify live provider health.
- `needs_attention`: authorization remains stored but registration, delivery or sync requires attention; do not describe it as disconnected.
- `reconnecting`: OAuth session exists, not recovered.
- `authorization_required` / `authorization_expired` / `authorization_revoked` / `invalid` / `missing_permissions`: authorization is unavailable or insufficient; reconnect or access review is required.
- `disconnected`: explicit merchant disconnect or verified ordered uninstall.
- `reconnect_failed`: OAuth failed; cached connected UI is invalid.

Registration `verified` requires a provider-observed subscription with the expected callback and verification timestamp. Delivery `no_evidence` is not failure and old processed rows are not current provider registration. Sync `queued` is not running or complete; `partial` is not complete. Required resource coverage is products, orders and abandoned checkouts. Optional gaps stay visible.

Provider throttling/outages remain retryable and do not revoke authorization. Authorization/permission errors may change lifecycle. Backend evidence failures return unavailable rather than healthy defaults. Delayed events older than the latest verified authorization cannot overwrite it.

Operators must not expose event metadata, tokens, provider payloads or raw errors to merchants. Production acceptance requires the exact deployed revision and an authenticated active-store check; public readiness and database rows alone are insufficient.
