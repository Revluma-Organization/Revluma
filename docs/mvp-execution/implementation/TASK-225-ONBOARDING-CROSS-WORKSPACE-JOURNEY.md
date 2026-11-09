# Task 225 — Onboarding and cross-workspace journey

## Scope and original mapping

| Original | Requirement | Implementation | Validation |
|---|---|---|---|
| 312 | First-time onboarding | `GET /api/v1/stores/journey`, `rev-merchant-journey-v1`, derived from Task 213 canonical integration states; shared setup/status card on Integrations; explicit multi-store selection | T225-001–060, 136–165, responsive R320–R1920 |
| 313 | Shopify authorization return | Existing signed, tenant-bound OAuth cookies, HMAC/state/shop checks, Redis replay guard, safe configured-origin redirect retained; no callback token forwarding | T225-061–100 plus existing callback/recovery tests |
| 314 | First briefing entry | Required-domain readiness and certified-history distinction; partial/capability-limited entry permitted; Command Center remains authoritative for actual evidence and no-finding states | T225-003–015, 029–041, 137–149 and existing Command Center suites |
| 315 | Finding to Rev | Existing exact finding route and server-side ownership/evidence resolution retained; Command Center links now carry bounded return context; no unrelated fallback | T225-101–135 plus finding-resolution tests |
| 316 | Return to Command Center | Rev return control, refresh-safe `return_to`, local-route allowlist, selected-finding restoration only when still present | T225-101–135 and existing navigation suites |

## Canonical journey contract

`Backend/src/services/merchantJourney.js` is a pure, read-only projection of
`rev-integration-state-v1`; it does not introduce browser completion flags or a
second persisted integration state. `unauthenticated` remains the existing
route/auth boundary. The other twelve states are selected with fixed precedence:
authorization failure, installation pending, active sync, total sync failure,
authorized-without-sync, contradictory recovery, partial readiness, incomplete
certified history, capability limits, first briefing, and returning merchant.

Products, orders and abandoned checkouts are required for `briefing_ready`.
Partial data can safely enter the workspace, where the existing Command Center
shows evidence limitations. Incomplete certified history is not a healthy-business
claim. A callback alone never produces readiness. Refresh reconstructs the state
from backend records; `Cache-Control: no-store` prevents merchant-context caching.
Store selection is an optional UUID constrained by active organization membership;
unknown/foreign IDs receive 404. Multiple memberships still require the existing
explicit organization context.

## Authorization, readiness, and privacy

No OAuth security check was weakened. HMAC, state, shop, user and organization
validation precede token exchange; replay state is atomically consumed; callbacks
return only non-secret status/shop/error-reference parameters. OAuth authorization,
webhook recovery, synchronization and briefing readiness remain separate.
No Shopify write action was added. The journey response excludes credentials and
uses existing organization membership and RLS-backed retrieval paths.

## Navigation contract

`workspaceNavigation.ts` accepts only `/dashboard/overview` returns. It strips
OAuth codes, states, HMACs, tokens, arbitrary parameters and external destinations.
Rev routes preserve the opaque finding reference for server validation; Command
Center selected-finding restoration accepts only UUID-shaped identifiers and only
scrolls when the current briefing still contains that finding. Conversation IDs
remain in Rev's existing server-authorized routes and are not copied into returns.
Independent new chats retain their existing no-finding behavior.

## UX and accessibility

The setup card uses the established light workspace, responsive wrapping,
`min-w-0`, 44px controls, labelled store selection, polite status announcements,
alert semantics for failures, and reduced-motion-safe refresh behavior. Ready
merchants do not receive a duplicate welcome briefing. All twelve requested widths
have structural/layout tests; these jsdom checks are not pixel-level production
browser evidence.

## Files

- Backend: `services/merchantJourney.js`, `controller/storeController.js`, `route/storeRoute.js`.
- Dashboard: `components/MerchantJourneyStatus.tsx`, `lib/workspaceNavigation.ts`,
  Integrations/Command Center/Rev navigation wiring.
- Tests: `services/__tests__/task225MerchantJourney.test.js`,
  `MerchantJourneyStatus.test.tsx`, `workspaceNavigation.test.ts` and updated
  navigation/Integrations regression fixtures.

No migration is required. Task 224 and Task 226 are outside this implementation.
