# Task 227 implementation — frontend production wiring and release acceptance

## Delivered changes

Original Tasks **322–325** are delivered together on `arena/13bc77df-revluma`; no Task 228 work is included.

- **API/auth:** production-safe API URL validation; bounded fetch with caller cancellation versus timeout; safe error parsing; correlation IDs; single-flight refresh with refresh-token forwarding and generation checks; centralized 401 purge; deep-link-preserving expiry; explicit plain logout; storage-isolated tenant restoration; 404-only profile fallback.
- **Shared runtime:** selective one-retry QueryClient policy; tenant-keyed protected remounts; validated `command-center-v1` parser; cancellation/revision guards for Integrations, sync and Command Center.
- **Rev Intelligence:** validated store context, stale-response-safe bounded history/messages, legacy initial paths, correlation-aware SSE and truthful session expiry. Existing idempotency, evidence, adaptive answer and keyboard behavior is retained.
- **Integrations:** only real Shopify connection/read-only intelligence controls remain. Failed/malformed states do not become connected; reconnect/setup claims await saved server evidence.
- **Other controls:** notifications now distinguish loading/error/empty and confirm read mutations; Paystack URL parsing corrected.
- **Backend/edge:** request-ID middleware and `X-Request-ID` CORS allow/expose support; baseline Vercel security headers and one login rewrite. No schema migration, OAuth/RLS relaxation, provider write or autonomous action was added.
- **Quality:** explicit payload types replace lint-blocking `any`/empty interfaces; all 31 baseline lint errors are cleared without suppressing the rule set.

## Verification on the final local tree

| Check | Result |
|---|---|
| `npm test` in `Frontend/Dashboard` | **58 files, 1,385/1,385 tests PASS** |
| `Task227ProductionWiring.test.ts` | **161/161 new scenarios PASS** |
| `npx tsc --noEmit` | PASS |
| `npm run lint -- --quiet` | PASS; full lint retains 18 warnings, 0 errors |
| `npm run build` | PASS; 2,250 modules; existing large-chunk warning |
| `node --check Backend/src/app.js` | PASS |
| `git diff --check` | PASS |

New scenario categories: API config/contracts 20; auth 25; Integrations 15; Command Center 20; Rev 25; cross-workspace 15; failure/recovery 15; build/runtime 10; responsive/accessibility 16. Total **161**, exceeding the 160 minimum and every category minimum. Task 226's separate 160 tests are not counted.

Production bundle: main JS **1,097.77 kB / 320.03 kB gzip**, CSS **126.11 kB / 20.75 kB gzip**. The >500 kB chunk warning remains. Clean Dashboard install reports 11 moderate dependency advisories; neither issue is concealed or represented as resolved.

Decision: REV-DEC-0033. Delivery, CI, exact deployment and live public smoke results are recorded in the validation report after execution. Authenticated active-store and real-browser acceptance remain explicitly blocked without genuine evidence.
