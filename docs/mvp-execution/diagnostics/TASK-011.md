# REVLUMA — TASK 011 EXECUTION REPORT

## A. Task identification

- Task 011 of 406 — Record Shopify API version used by backend.
- Phase 1, Reliable Data Foundation; category 1A, Baseline and Architecture.
- Date: 2026-10-30, Africa/Lagos client context.
- Repository: Revluma-Organization/Revluma.
- Inspected branch/revision: main at `55d78f06aeb01303a0779073fd7e47b2f517d7e8`.
- Working branch: `docs/mvp-task-011`.
- Production backend: Render live deployment `dep-dbhqdso8v5cc7395g6i0`, commit `cfb41b7b468bfecd537d841d55c450ff21673342`.
- Alignment: Main and production commit differ, but their Backend content diff is empty. Conclusions about Backend source apply to the production-aligned code; runtime configuration is separately unverified.
- Local Node: v24.22.1. No Shopify SDK package is in Backend/package.json or package-lock.json. Axios lockfile version: 1.18.1.
- Mode: Read-only application inspection, official documentation lookup, one existing isolated regression script, documentation-only changes. No app/API/scopes/environment changes or manual deployment.

Source references below are paths relative to Backend unless stated otherwise, pinned by the inspected SHA. No production token, secret, database credential or unrelated environment value was retrieved.

## B. Previous evidence reviewed

Read the execution README, central audit register and decisions register. Relevant preserved reports: [002](TASK-002.md), [003](TASK-003.md), [004](TASK-004.md), [005](TASK-005.md), [006](TASK-006.md), [008](TASK-008.md), [010](TASK-010.md). Task001 report remains unavailable; the live deployment was independently reconfirmed instead of fabricated. The source code relevant to version selection and API construction was revalidated; prior handler/schema investigations were not repeated.

Task008 already correctly distinguishes the dynamic resolver from the unused exported constant and leaves production override unknown. This audit confirms that source claim and adds official lifecycle, deprecated-field and webhook-payload-version distinctions. Task010's green helper results are not treated as transport/version compatibility tests. No historical report was overwritten and no previous finding was marked resolved.

## C. Primary Shopify API version

**Primary source-resolved fallback today: 2026-10. Exact production-configured and Shopify-served version: UNABLE TO DETERMINE.**

`getShopifyApiVersion()` in `src/utils/shopify.js:3–28` executes for each GraphQL request:

1. Calculate the current UTC year and quarter-start month.
2. Use truthy `process.env.SHOPIFY_API_VERSION` instead of that calendar-derived value, then trim the selected string.
3. Require YYYY-(01|04|07|10), otherwise throw SHOPIFY_API_VERSION_INVALID.
4. Require version quarter between current quarter minus three and current quarter inclusive, otherwise throw SHOPIFY_API_VERSION_UNSUPPORTED.
5. Return the string.

`src/services/shopifyGraphql.js:20–34` calls that function and builds `https://{shop_domain}/admin/api/{apiVersion}/graphql.json`. There is no per-call version parameter; all discovered Shopify GraphQL consumers share that implementation. Authentication is the decrypted store token sent as X-Shopify-Access-Token. The audit did not decrypt a token or issue this request.

This is not an unconditional hardcoded production pin. Without an explicit override the request version advances with wall-clock quarters, without a source deploy. A truthy whitespace-only override becomes invalid rather than falling back. Malformed/future/stale overrides fail before the Axios call.

## D. Shopify SDK/client configuration

| Client/library | Package version | API configuration | Used by / evidence |
|---|---|---|---|
| Custom `shopifyGraphql` via Axios | axios 1.18.1 locked | Runtime helper above; 30-second timeout; redirects disabled | GraphQL consumers in E; shopifyGraphql.js:1–54 |
| OAuth Axios exchange | Same Axios dependency | Unversioned `/admin/oauth/access_token`; 10-second timeout | shopifyService.js:19–48 |
| Official Shopify SDK / shopify-api-node | NOT FOUND in Backend dependencies or initialization | N/A | package.json/package-lock and source import search |
| Exported API_VERSION | Not an SDK setting | env or literal 2026-10 at module load | shopifyGraphql.js:5,54; no consumer of that export found |

SDK compatibility/defaults therefore do not control the observed HTTP implementation. No package was installed, upgraded or generated.

## E. API version usage matrix

`V` means `getShopifyApiVersion()` at call time: current date fallback 2026-10, production override unknown. All versioned operations below use the same GraphQL Admin endpoint/client. Operation availability in documentation is not proof a merchant has permission or the live request succeeds.

| Component / operation | API type/version | Source | Verified status and limits |
|---|---|---|---|
| OAuth authorization URL | Unversioned `/admin/oauth/authorize` | utils/shopify.js:146–166 | VERIFIED source. Version is not an OAuth URL parameter. |
| OAuth code exchange | Unversioned `/admin/oauth/access_token` | shopifyService.js:35–48 | VERIFIED source; not versioned REST Admin resource access. |
| Callback config logging | No resource request; resolves V for log/config | shopifyController.js:163–170; utils/shopify.js:89–96 | Log is resolved config evidence only, not served-version proof. |
| Initial post-OAuth setup | V, GraphQL | shopifyController.js:319; shopifyService.js:149–161; shopifySync.js:321 onward | Shared sync path; no distinct shop metadata query found. |
| Granted scopes | V; currentAppInstallation.accessScopes.handle | shopifySync.js:154–156 | Shared client; not an unversioned access_scopes.json request. |
| Webhook subscription listing | V; webhookSubscriptions(first:250), id/topic/uri | shopifyWebhookService.js:17–27 | Shared client; request version does not determine webhook event schema. |
| Webhook subscription creation | V; webhookSubscriptionCreate | shopifyWebhookService.js:45–56 | Shared client; no per-topic version override. No registration invoked. |
| Orders historical retrieval | V; orders(first,after,CREATED_AT,reverse:true) | shopifySync.js:184–207 | Query/order fields mapped below; no separate single-order API lookup found. |
| Bounded order proof | V; orders with created_at interval | intelligenceShopifyCoverageProducer.js:17–38 | Shared fetchConnection/client, 14 full UTC days; no different version. |
| Checkout history subset | V; abandonedCheckouts | shopifySync.js:248–267 | Direct Admin GraphQL, not webhook-only; not complete checkout-start history. |
| Customer import | V; customers | shopifySync.js:71–84 | Deprecated fields still requested; see H. |
| Product/variant observation | V; products, nested variants | shopifyInventoryObservation.js:47–85 | Exported observation utility, only test callers found; not persisted initial product import. |
| Legacy recovery discount creation | V; discountCodeBasicCreate | recoveryActionService.js:232–269 | Additional source consumer; operation was not invoked/enabled by this audit. Does not authorize campaign scope. |
| Manual retry / scheduler rerun | V; same customer/order/checkout queries | shopifyController.js:129; schedulerService.js:736–779 | No independent client/version; scheduler can skip subscription reconciliation. |
| Live order/checkout webhook processing | Incoming event schema, not Admin fetch | commerceWebhookController.js:16–22; commerceWebhookService.js | No versioned external API call for exact cart matching; uses local Prisma lookups. |
| REST Admin resources / bulk operation importer | NOT FOUND | Whole Backend URL/client search | No active versioned REST resource endpoint or separate bulk client located. |

Order query fields: id, createdAt, cancelledAt, displayFinancialStatus, discountCodes, currentTotalPriceSet/totalPriceSet/subtotalPriceSet/totalDiscountsSet.shopMoney amount/currencyCode; customer id/email/firstName/lastName/phone; line item id/name/quantity/product.id/variant.id/originalUnitPriceSet. Root pagination is first 100/after via fetchConnection, max 100 pages; nested order lines first 250.

Checkout query: id/createdAt/updatedAt/completedAt/abandonedCheckoutUrl/totalPriceSet, customer fields above, lineItems(first:250) id/title/quantity/product/variant/originalUnitPriceSet. Customers query includes state and emailMarketingConsent/smsMarketingConsent marketingState/consentUpdatedAt. Products query includes id/title/status/totalInventory, variants(first:250) id/title/availableForSale/inventoryQuantity/inventoryPolicy and pageInfo. No new queries or pagination logic were introduced.

No separate updated-since incremental importer or backfill API version was found; periodic reruns reuse generic sync. Order-to-checkout matching does not call a version-specific checkout lookup API. Historical missing checkout IDs and persistence semantics remain the earlier findings (REV-FIND-0001, 0011, 0018, 0059), not newly diagnosed version mismatches.

## F. Hardcoded/reference classification

| Reference | Lines | Value | Classification / effect |
|---|---|---|---|
| utils/shopify.js getShopifyApiVersion | 3–28 | env or UTC quarter | ACTIVE resolver. No fixed literal release default here. |
| utils/shopify.js getShopifyOAuthConfig | 93 | helper call | ACTIVE resolved config passed to callback diagnostics. |
| services/shopifyGraphql.js | 5,54 | env or literal 2026-10 | LEGACY/UNUSED exported constant; not endpoint source. Current fallback coincides but will diverge after quarter advance if unpinned. |
| services/shopifyGraphql.js | 21,25 | helper; URL interpolation | ACTIVE single Admin resource request construction. |
| controller/shopifyController.js | 163,170,377 | api_version/configured_api_version fields | ACTIVE logs, not independent client override. |
| controller/__tests__/shopify.install.test.js | 19–22,90–95 | Current quarter; deliberate 2024-01 | TEST ONLY; valid-version equality and unsupported-version assertion. |
| controller/__tests__/shopify.callback.test.js | 9 | 2026-10 fallback | TEST ONLY fixture setting; does not prove transport uses it. |
| docs/BACKEND_SETUP.md | 48–49 | Current quarterly default | DOCUMENTATION; supported-window statement is an approximation of calendar validation. |

Other date strings found in test fixtures (createdAt, range boundaries, NOW) are ordinary timestamps, not Shopify API configuration. No alternative SHOPIFY_ADMIN_API_VERSION client, another hardcoded active resource endpoint, SDK ApiVersion enum or service-specific override was found. A developer could inject a custom graphql/fetchPage function into certain utilities for tests, but no production version override through those injection parameters was located.

## G. Environment configuration

| Environment | Version | Source / evidence | Verification |
|---|---|---|---|
| Development | Unknown override; otherwise 2026-10 today | Shared process.env resolver; no local .env file present in checkout | Source behavior verified, actual developer environment unknown. |
| Isolated install test | Test sets current UTC quarter | shopify.install.test.js:19–22 | Existing test executed successfully; no production env inherited. |
| Callback test fixture | Env or 2026-10 | shopify.callback.test.js:9 | Fixture inspected; this does not validate a live request. |
| Staging | Unknown; no separate staging version configuration found | Source/deployment config search | UNABLE TO DETERMINE whether a separate staging service uses an override. |
| Production request target | Unknown override; otherwise date-derived current quarter | Render live SHA plus shared source | Environment value not exposed by available read-only Render tools. |
| Production served response version | Unknown | No response header observation captured | Client does not inspect X-Shopify-API-Version. |
| App-configured webhook payload version | Unknown | No app version TOML/configuration record found; receiver ignores version header | Cannot infer from Admin subscription request version. |

Render log lookup filtered to API-version diagnostics was attempted read-only. It failed with **503: failed to query Loki; log retrieval currently unavailable**. This is a tooling/runtime evidence limitation, not proof Shopify is unavailable or the app uses a bad version. No env mutation, shell credential retrieval, live Shopify probe, setup retry or synchronization was used to compensate.

## H. Compatibility assessment

### Support lifecycle (official evidence, checked 2026-10-30)

Shopify lists **2026-10 as latest stable**, released 2026-10-01 and accessible until **2027-10-16 15:00 UTC**. 2027-01 is a release candidate, not a newer stable release. [Release notes](https://shopify.dev/changelog/release-notes/2026-10); [version schedule](https://shopify.dev/docs/api/usage/versioning).

This establishes support for the fallback, not a production env override. The helper's rolling four-quarter check is calendar arithmetic, not a provider support-date lookup: it can reject a still-accessible previous version during Shopify's post-quarter grace interval. Also, automatic quarter rollover uses UTC midnight rather than checking actual release availability. Those are boundary risks; no present-date outage was reproduced.

### Operation checks

| Operation/field family | Official reference | Assessment |
|---|---|---|
| orders, totals, financial status, customer/line connections | Order / orders references | Documented in 2026-10; no removed field identified in the inspected selection. Live schema/permissions and full query validation not exercised. |
| abandonedCheckouts and checkout lines | abandonedCheckouts / AbandonedCheckoutLineItem | Supported query includes abandoned and recovered subset; requires read_orders and applicable user permission. No inference of complete historical funnel coverage. |
| customers | Customer reference | email, phone, emailMarketingConsent and smsMarketingConsent are documented **deprecated**, still present. Customer.state is meaningful for Classic Customer Accounts, not a universal engagement status. |
| products/variants | Product / ProductVariant references | Selected ProductVariant.availableForSale, inventoryPolicy, inventoryQuantity and other observed fields documented. No removed-field defect established; permission/completeness limits remain. |
| webhookSubscriptionCreate and subscription URI | Mutation / WebhookSubscription references | Documented. **App-configured Webhooks API version governs event payloads, not the Admin version used to create each subscription.** |
| discountCodeBasicCreate and context input | Mutation / DiscountCodeBasicInput | Documented additional consumer; not executed. No permission/runtime success claim. |

The shared customer deprecations affect direct customer sync and nested customer selection in order/checkout queries. Deprecation is not removal and is not a confirmed current request failure. No complete schema-introspection/validation suite was available. Official versioned URLs sometimes redirect to latest; the reviewed latest pages explicitly displayed 2026-10. Direct Product/Customer versioned URLs initially failed retrieval; latest pages were then inspected. This audit does not claim review of every Shopify release-note change outside the actual selections.

`shopifyGraphql` returns only response.data.data and never compares Shopify's served-version header. The webhook receiver reads shop domain/topic/HMAC but not x-shopify-api-version. Thus matching Admin request versions across consumers does not establish incoming webhook schema parity. A changed webhook shape can affect available identifiers, but the existing missing-ID reconciliation problem is not proven caused by an API version mismatch.

## I. Existing test coverage and observed result

| Test file / case | Behavior actually asserted | Status |
|---|---|---|
| controller/__tests__/shopify.install.test.js, top-level assertion script | getShopifyApiVersion equals explicitly set current-quarter version; 2024-01 throws SHOPIFY_API_VERSION_UNSUPPORTED; also OAuth/HMAC/auth assertions | Executed: one runner entry PASS. Partial version coverage. |
| controller/__tests__/shopify.callback.test.js | Sets a fixture version and mocks Shopify setup | Fixture only; no request-URL/served-header assertion. Inspected, not rerun here. |
| services/__tests__/shopifyWebhookService.test.js | Replaces shared GraphQL client with mock | Does not validate URL/version construction. Inspected; Task010 results preserved. |
| tests/intelligenceShopifyPagination.test.js | Injected fetch client tests paging/scopes/financial normalization | Transport version bypassed; not version compatibility proof. |
| tests/shopifyInventoryObservation.test.js | Injected catalog API validates scope/payload completeness | No actual endpoint/API schema validation. |
| Direct shared transport/version test | NOT FOUND | Missing request URL/header checks, environment/fallback parity, malformed/future/grace-period/rollover cases and served version comparison. |

Exact command: `node --test src/controller/__tests__/shopify.install.test.js`, cwd Backend. Node24.22.1, isolated subprocess inherited only PATH/HOME/TMPDIR/LANG and supplied NODE_ENV=test plus dummy JWT/cookie/encryption values. No .env files; DB/Redis/Python/provider connection settings not inherited. No real token exchange: install builds a URL and the callback exercise exits on missing parameters. Existing test changes process-local fixture values only; no deployed env changes.

Observed exit 0, **1 runner entry passed, 0 failed/skipped/cancelled**, approximately 311 ms. This assertion script contains multiple assertions, not one end-to-end compatibility scenario. No packages, tests, fixtures, schema or client were changed; no full suite was rerun without need. CI source includes this src test via npm test, as mapped in Task010.

## J. Findings register

New IDs follow existing REV-FIND-0101. These are configuration/compatibility evidence gaps or conditional risks, not reproduced merchant incidents.

| ID | Classification / severity | Exact evidence at inspected SHA | Impact / future task | Status |
|---|---|---|---|---|
| REV-FIND-0102 | POTENTIAL DEFECT / Medium | utils/shopify.js:3–25 UTC quarter fallback and rolling-four-quarter guard; official release schedule | Unpinned environments can change request version automatically; calendar checks can differ from actual provider release/grace windows. BACKLOG MAPPING REQUIRED for explicit version-policy change; 100/349 can validate regressions/failure behavior within assigned scope. | OPEN |
| REV-FIND-0103 | VERIFIED unused reference / Low | services/shopifyGraphql.js:5,21,25,54; whole Backend import search finds no API_VERSION consumer | Fixed exported fallback and actual dynamic resolver can disagree after a quarter transition, misleading future callers/diagnostics. BACKLOG MAPPING REQUIRED; no cleanup authorized here. | OPEN |
| REV-FIND-0104 | IMPLEMENTED — NOT VERIFIED / Medium | shopifyGraphql.js:20–51 does not inspect response version; commerceWebhookController.js:16–22 ignores webhook version header; official subscription mutation note | Actual served Admin version and independently app-configured webhook payload version remain unobserved. 012–014,098,364/366 for corresponding evidence; any new observability implementation requires assigned scope. | OPEN |
| REV-FIND-0105 | VERIFIED deprecation / Medium | shopifySync.js:76–78,195,255; Customer docs deprecated list | Four legacy contact/consent fields are selected; future version changes need explicit compatibility review. Still available today; no current outage claimed. 066–067/080 for import/data availability checks; BACKLOG MAPPING REQUIRED for a dedicated migration. | OPEN |
| REV-FIND-0106 | VERIFIED test gap / Medium | shopify.install.test.js:19–22,90–95 tests config/old rejection; no shared URL/header/version compatibility test found | Transport/env/header drift is not caught by current version tests. 100 for current suite inventory; BACKLOG MAPPING REQUIRED for new version-specific regression implementation. | OPEN |

Existing findings reused, not duplicated: REV-FIND-0017 (logging/diagnostic limitations), REV-FIND-0038 (no persisted matching tests), REV-FIND-0043 (historical overlap coverage gap), REV-FIND-0001 and REV-FIND-0059 (historical order missing checkout identifiers), REV-FIND-0013 (catalog not initial persistent sync). None is marked resolved. This audit cannot attribute a missing identifier to version incompatibility without payload/runtime evidence.

## K. Future task dependencies

- Task012 should record live registered topics **and distinguish payload API version from Admin registration request version**, without assuming they match.
- Tasks013–014 should capture available test payload fields/version metadata safely and compare identifiers to existing diagnoses.
- Tasks066–067 should use the version/permission limits here when validating historical imports; do not infer full checkout history from abandonedCheckouts.
- Tasks080,098,100 and production-evidence tasks364/366 can consume the scoped data-availability/logging/test/baseline findings.
- No existing backlog item clearly authorizes changing the version-selection policy, removing the unused export, migrating deprecated Customer selections, or adding dedicated version/transport tests. These are **BACKLOG MAPPING REQUIRED**, not newly invented task IDs or implementation authorization.

## L. Limitations

Production SHOPIFY_API_VERSION, served response headers, app-configured webhook payload version and staging/developer overrides remain unknown. Read-only Render log retrieval failed with a 503; no live Shopify call or environment export was used. Schema/introspection/query execution with actual merchant permissions was not performed. Documented field availability/deprecation does not prove complete query success. No unsupported active REST resource or confirmed removed-field usage was found; absence of such evidence is not comprehensive compatibility certification. Client date and local wall clock are only inputs to understanding fallback behavior.

No SDK release upgrade, environment pin, client refactor, deprecated-field migration or production investigation outside this task was made. No historical engineering decision was invented: the decisions register remains unchanged. Prior Task001 report remains unavailable.

## M. Final status

**PARTIAL — API version configuration identified, but important usage or compatibility details remain unverified.**

All discovered Backend Shopify consumers and source version references are mapped. The source fallback is 2026-10 today, that release is documented supported/latest stable, and the existing version regression script passes. Production override/served version and webhook payload version were not verified, so this report cannot certify exact production runtime parity.

**Next: TASK 012 — Record registered Shopify webhook topics. Not started.**

## N. Changes made and delivery

Only `docs/mvp-execution/diagnostics/TASK-011.md` and `docs/mvp-execution/audit-register.md` created/updated. Prepared on working branch docs/mvp-task-011. The user's standing instruction is to save engineering records in GitHub main, not leave them local; documentation publication follows that authorization. No application/Frontend/Prisma/Python/SDK/env/scopes/Shopify/DB/infrastructure configuration changes or manual deployment action. A documentation commit is the delivery reference; its immutable hash is reported in the completion response and Git history. Connected Git integrations can react to repository publication; no platform build/deploy API, restart or registration/sync endpoint was invoked.

Checks before commit: documentation-only diff; relative paths and source references; stable IDs and backlog mappings; no credentials; unchanged application tree; exact observed test result. No new implementation PR or unrequested next task.

## Source evidence register

All repository links use the inspected 55d78f06 revision; Backend content is identical to deployed cfb41b7.

- [Backend/src/utils/shopify.js](https://github.com/Revluma-Organization/Revluma/blob/55d78f06aeb01303a0779073fd7e47b2f517d7e8/Backend/src/utils/shopify.js)
- [Backend/src/services/shopifyGraphql.js](https://github.com/Revluma-Organization/Revluma/blob/55d78f06aeb01303a0779073fd7e47b2f517d7e8/Backend/src/services/shopifyGraphql.js)
- [Backend/src/services/shopifyService.js](https://github.com/Revluma-Organization/Revluma/blob/55d78f06aeb01303a0779073fd7e47b2f517d7e8/Backend/src/services/shopifyService.js)
- [Backend/src/controller/shopifyController.js](https://github.com/Revluma-Organization/Revluma/blob/55d78f06aeb01303a0779073fd7e47b2f517d7e8/Backend/src/controller/shopifyController.js)
- [Backend/src/services/shopifyWebhookService.js](https://github.com/Revluma-Organization/Revluma/blob/55d78f06aeb01303a0779073fd7e47b2f517d7e8/Backend/src/services/shopifyWebhookService.js)
- [Backend/src/services/shopifySync.js](https://github.com/Revluma-Organization/Revluma/blob/55d78f06aeb01303a0779073fd7e47b2f517d7e8/Backend/src/services/shopifySync.js)
- [Backend/src/services/shopifyInventoryObservation.js](https://github.com/Revluma-Organization/Revluma/blob/55d78f06aeb01303a0779073fd7e47b2f517d7e8/Backend/src/services/shopifyInventoryObservation.js)
- [Backend/src/services/intelligenceShopifyCoverageProducer.js](https://github.com/Revluma-Organization/Revluma/blob/55d78f06aeb01303a0779073fd7e47b2f517d7e8/Backend/src/services/intelligenceShopifyCoverageProducer.js)
- [Backend/src/services/recoveryActionService.js](https://github.com/Revluma-Organization/Revluma/blob/55d78f06aeb01303a0779073fd7e47b2f517d7e8/Backend/src/services/recoveryActionService.js)
- [Backend/src/controller/commerceWebhookController.js](https://github.com/Revluma-Organization/Revluma/blob/55d78f06aeb01303a0779073fd7e47b2f517d7e8/Backend/src/controller/commerceWebhookController.js)
- [Backend/src/controller/__tests__/shopify.install.test.js](https://github.com/Revluma-Organization/Revluma/blob/55d78f06aeb01303a0779073fd7e47b2f517d7e8/Backend/src/controller/__tests__/shopify.install.test.js)
- [Backend/src/controller/__tests__/shopify.callback.test.js](https://github.com/Revluma-Organization/Revluma/blob/55d78f06aeb01303a0779073fd7e47b2f517d7e8/Backend/src/controller/__tests__/shopify.callback.test.js)
- [Backend/docs/BACKEND_SETUP.md](https://github.com/Revluma-Organization/Revluma/blob/55d78f06aeb01303a0779073fd7e47b2f517d7e8/Backend/docs/BACKEND_SETUP.md)
- [Backend/package.json](https://github.com/Revluma-Organization/Revluma/blob/55d78f06aeb01303a0779073fd7e47b2f517d7e8/Backend/package.json)
- [Backend/package-lock.json](https://github.com/Revluma-Organization/Revluma/blob/55d78f06aeb01303a0779073fd7e47b2f517d7e8/Backend/package-lock.json)

### Official Shopify references inspected

- [API version schedule, OAuth separation and served headers](https://shopify.dev/docs/api/usage/versioning)
- [2026-10 release notes](https://shopify.dev/changelog/release-notes/2026-10)
- [Order fields](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order)
- [orders query](https://shopify.dev/docs/api/admin-graphql/2026-10/queries/orders)
- [abandonedCheckouts](https://shopify.dev/docs/api/admin-graphql/2026-10/queries/abandonedCheckouts)
- [AbandonedCheckoutLineItem](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/AbandonedCheckoutLineItem)
- [Customer, latest page labeled 2026-10](https://shopify.dev/docs/api/admin-graphql/latest/objects/Customer)
- [Product, latest page labeled 2026-10](https://shopify.dev/docs/api/admin-graphql/latest/objects/Product)
- [ProductVariant](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ProductVariant)
- [Webhook subscription create and payload-version note](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/webhookSubscriptionCreate)
- [WebhookSubscription fields](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/WebhookSubscription)
- [discountCodeBasicCreate](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/discountCodeBasicCreate)
- [DiscountCodeBasicInput](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/DiscountCodeBasicInput)
