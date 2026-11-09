# Task 227 diagnosis — frontend production wiring and release acceptance

## Scope and inspected baseline

User-assigned Task 227 consolidates original Tasks 322–325: frontend/API wiring; authentication lifecycle; Integrations, Command Center and Rev Intelligence coherence; production build/runtime/release acceptance. Branch `arena/13bc77df-revluma` starts at `c7279ffca080975010a9337f5ebd35e78827b439` (Task 226 evidence merge). Task 228 was not started.

Inspected: Dashboard routes and API/SSE clients; Zustand session persistence and profile restoration; refresh/logout/broadcast/protected-route flow; tenant-keyed remounts; TanStack Query; integration states and sync polling; Command Center requests; Rev store/history/conversation/stream ownership; notification controls; Checkout response parsing; Node CORS/routes; Python readiness; Vercel build/environment/headers; Dashboard and release workflows; Tasks 213–226 records.

## Production facts before changes

- Vercel production `dpl_6WC6bxsJjyCPYa7K4SMMyzbwCWs3` was READY/PROMOTED from `c7279ffca080975010a9337f5ebd35e78827b439`, with `revluma.vercel.app` assigned.
- Authorized Vercel environment inspection confirmed the frontend API target is `https://revluma-backend-vrsd.onrender.com/api/v1`; no credential value is reproduced here.
- `/health` was OK. `/ready` reported database/Python healthy, models `beta_ready`, Node `d9150d652da2`, Python `d9150d652da2d6370f34dea5416d1fd0e7e24b16`, version `0.6.0`. That backend predates the repository baseline.
- Unauthenticated `/api/v1/stores`, `/api/v1/rev/command-center` and `/api/v1/rev/conversations` returned `success:false`, `error:"Authentication required"`. This establishes the public authentication boundary, not empty merchant data or authenticated compatibility.
- Only `revluma-test-store-v1.myshopify.com` is authorized for acceptance. No retired-store or synthetic production record was used.

## Findings and resolutions

| ID | Finding | Resolution |
|---|---|---|
| T227-F01 | Production API URL silently fell back to localhost and accepted insecure/credential-bearing targets. | Require HTTPS non-local production URL, normalize `/api/v1`, reject credentials/query/fragments/schemes. |
| T227-F02 | Requests lacked bounded transport, correlation and distinct cancellation/timeout errors. | Add 30-second default bound, caller abort composition, `X-Request-ID`, response correlation and safe JSON errors. |
| T227-F03 | Session expiry could lose the original protected destination; logout and expiry shared ambiguous redirect behavior. | Preserve safe dashboard path/search for expiry; explicit logout goes to plain login; sanitize missing search. |
| T227-F04 | Concurrent/manual refresh needed forwarding and generation protection; obsolete responses could cross workspace state. | Forward stored refresh credential where supported, retain single-flight refresh, session-generation assertions and tenant-keyed protected remounts. |
| T227-F05 | Profile failure fallback was too broad and workspace switching could retain data. | Only 404 uses profile fallback; clear/abort tenant-scoped workspace state. |
| T227-F06 | Integration/sync polling and Command Center reads could accept stale or malformed data and continue indefinitely. | Revision/abort guards, bounded polling, selective one-retry policy and versioned Command Center parser. A supplied tenant must exactly match. |
| T227-F07 | Rev store/history/message/stream requests lacked consistent cancellation, revision and expiry handling. | Add request revisions, safe pagination and SSE correlation/session handling. Initial legacy routes remain compatible; appended pages are explicitly bounded. |
| T227-F08 | Integrations exposed non-MVP WooCommerce connection UI and overstated autonomous recovery. | Remove WooCommerce connection path; retain Shopify connection, diagnostics, setup/reconnect and read-only investigation only. |
| T227-F09 | Notifications could imply loading/read success before confirmation and permit duplicate mutation. | Add truthful load/error/empty states, confirmed mutation, duplicate-submit protection and keyboard controls. |
| T227-F10 | Checkout read Paystack `authorization_url` at the wrong envelope depth. | Read `res.data.data.authorization_url`. |
| T227-F11 | Request IDs were not accepted/exposed by Node CORS and frontend baseline headers were incomplete. | Add bounded request-ID middleware, CORS support and baseline Vercel security headers; remove duplicate login rewrite. |
| T227-F12 | Corrupt local persisted auth prevented a valid session-storage tenant hint from being read. | Isolate storage parse failures per store; discovered by new T227 auth scenario. |

## Acceptance limitations

No authenticated merchant session or real browser/screen-reader executable is available. Therefore this task cannot prove live active-store data, real provider failures, actual overflow/focus/contrast at every viewport, or complete production keyboard/screen-reader journeys. jsdom and computed token checks are not represented as those proofs. Deployment source/alias and public HTTP behavior require post-merge verification.
