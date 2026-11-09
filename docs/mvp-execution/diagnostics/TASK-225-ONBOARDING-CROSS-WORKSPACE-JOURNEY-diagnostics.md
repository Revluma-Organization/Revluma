# Task 225 diagnostics

## Baseline

Branch `arena/88b8098a-revluma` began at merged main `62cdc7c`. Original audit
rows 312–316 were NOT STARTED. The repository already contained Tasks 213–223
integration/sync, Command Center, finding, conversation and submission contracts;
Task 224 evidence was not present and was not assumed complete. Public production
access showed the Revluma site and authenticated routing, not merchant onboarding.
The documented active store is `revluma-test-store-v1.myshopify.com`; the retired
`bys-user-store-923319-1ifggjsw.myshopify.com` was not used.

## Findings

1. Integration state and sync progress were authoritative, but no single backend
   projection selected onboarding versus first-briefing entry. A frontend-only
   flag would have been inconsistent across refreshes and store switching.
2. OAuth already enforced tenant-bound state/HMAC/replay protections. Replacing it
   would create unnecessary security risk; validation therefore pins those paths.
3. Finding routes and backend finding authorization existed, but Rev had no
   discoverable Command Center return control and Command Center links did not
   preserve a refresh-safe return route.
4. Ready Command Center content must not be hidden behind a generic welcome screen.
   The journey card is therefore on Integrations and only supplies the safe next
   destination; Command Center itself remains the operational orientation point.
5. The first full Dashboard regression run exposed request/alert interference and
   route assertion failures. The extra Command Center journey request was removed,
   Integrations mocks were made route-specific, and navigation assertions now
   include intentional return context without dropping the finding ID.
6. Local Backend full execution remains constrained by Prisma engine download
   egress (`binaries.prisma.sh`). Focused pure/service/controller suites run where
   their generated-client dependencies permit; CI remains the migration/full-suite
   authority.

## External acceptance boundary

No authenticated production merchant browser/session is available. Consequently
real Shopify consent/cancellation, callback return, live sync transitions, actual
first briefing, real finding investigation, return/refresh and screen-reader/
pixel-level responsive acceptance are not established by fixtures or public page
retrieval. Exact deployed backend/frontend revisions and those journeys must be
recorded after deployment. No production mock data or OAuth/session bypass was
created.
