# Shopify Sidekick — technical benchmark

Research date: **2026-11-05**. Sources are official Shopify documentation and help
articles; every link below was fetched on that date. Sidekick is Shopify's own
AI assistant, shipped inside the Shopify admin. This document benchmarks what it
is publicly documented to do, what is unknown, and how Revluma's commerce data
engine is positioned relative to it. It is not a legal or feature-parity
contract: Shopify changes Sidekick without notice and does not publish its
internals.

## Sources

| # | Source | URL |
|---|---|---|
| S1 | Sidekick overview (help Center) | https://help.shopify.com/en/manual/ai-powered-tools/sidekick |
| S2 | Sidekick help and guidance | https://help.shopify.com/en/manual/ai-powered-tools/sidekick/help-and-guidance |
| S3 | Sidekick for app developers (developer docs) | https://shopify.dev/docs/apps/build/sidekick |
| S4 | Access scopes | https://shopify.dev/docs/api/usage/access-scopes |
| S5 | ShopifyQL / analytics | https://shopify.dev/docs/api/shopifyql |
| S6 | Admin GraphQL API reference | https://shopify.dev/docs/api/admin-graphql/latest |
| S7 | Bulk operations queries | https://shopify.dev/docs/api/usage/bulk-operations/queries |
| S8 | Privacy law compliance | https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance |

## What Sidekick is documented to do

From S1 and S2 (2026-11-05):

- **Conversational commerce assistant in the Shopify admin.** Sidekick answers
  questions about the merchant's store and performs multi-step background tasks
  on the merchant's behalf.
- **Pulse / proactive monitoring.** Sidekick can surface proactive signals and
  reports inside the admin rather than waiting for a question.
- **Skills and memory.** Sidekick maintains merchant-scoped skills and memory
  across conversations (preference and context recall). Memory semantics,
  retention windows and scoping are not publicly specified in detail.
- **Analytics generation.** Sidekick can generate analytics answers and ShopifyQL
  for the merchant's data, render report charts, and summarize Shopify Payments
  data (payouts, chargeback rate). It cannot release payment reserves.
- **Inbox and content assistance.** Summarizes Shopify Inbox conversations,
  fills forms, drafts content; merchant reviews and applies changes.
- **Review-before-apply.** Actions that change the store are presented for
  merchant review before they take effect; Sidekick does not silently mutate the
  store.

## What is documented only for apps (developer surface)

From S3 (2026-11-05):

- **Sidekick extensions** let apps expose capabilities inside Sidekick. Two
  extension surfaces are documented:
  - **App Data extensions** — expose read-only structured data the merchant can
    ask Sidekick about.
  - **App Actions extensions** — let Sidekick offer an action; the merchant
    confirms before anything runs. Actions still flow through the app, not
    around it.
- **Launch API.** `shopify.sidekick.launch()` can hand the merchant from an app
  into Sidekick with a prefilled intent; `isEnabled()` gates the path. The
  Launch API does not change store state by itself.
- **Eligibility and listing.** Up to 20 integrations per user/store; all
  developers could build Sidekick extensions as of 2026-06-17 (18 launch
  partners at that milestone); `extensions_summary` is required in
  `shopify.app.toml`; App Data/Actions carry an `extensions_summary` so the
  merchant sees what data and actions an app contributes.

## What is explicitly not public (treated as UNKNOWN, not absent)

- Model architecture, training data, grounding/retrieval internals, prompting
  strategy, and evaluation methodology.
- How Sidekick's answers are audited for accuracy, or what its evidence
  provenance looks like internally.
- The full set of data sources Sidekick reads inside the admin (storefront,
  payments, admin activity, app data contributed via extensions) and their
  freshness/consistency semantics.
- Rate limits, quotas and degradation behavior for Sidekick itself.
- Memory scope, retention and deletion semantics (see S1/S2 for merchant-facing
  controls only).
- Precise financial definitions: which orders count as "sales", tax/shipping/
  discount treatment, timezone and currency handling, and reconciliation against
  payouts. None of these are stated publicly.

Any claim that Sidekick "does X" beyond the public docs above is unverified and
must not enter product positioning.

## Sidekick vs a third-party app's data access

| Dimension | Sidekick (in admin) | Shopify Admin API (app token) |
|---|---|---|
| Authenticated as | Merchant session inside admin | Installed app with OAuth scopes (S4) |
| Scope model | Implicit (whatever the admin shows the merchant) | Explicit per-scope grants; `read_orders` = last 60 days by default; `read_all_orders` requires Shopify approval (protected); `read_customers` protected data rules apply |
| Write actions | Merchant-reviewed, in admin | Only with write scopes (Revluma has none for commerce) |
| Extensibility | App Data / App Actions extensions (S3) | Full Admin GraphQL/REST + webhooks |
| Analytics | ShopifyQL generation (S2/S5); availability of `shopifyqlQuery` to apps is documented but plan/eligibility gated | Same API surface; not assumed for Revluma |
| Provenance | Not publicly specified | Specified per-field by API version (S6); app must build its own evidence layer |

## Implications for Revluma

1. **Revluma cannot reproduce Sidekick's admin-session privileges.** It sees
   exactly what its OAuth scopes and Shopify's app-data/approval rules allow —
   no more. The coverage audit (docs/research/REVLUMA_SHOPIFY_DATA_COVERAGE_AUDIT.md)
   is the authority on what Revluma actually has.
2. **Revluma's differentiation is evidence and determinism, not breadth.**
   Sidekick is a generalist in the admin; Revluma's commerce engine binds every
   claim to a metric definition, a currency, a window and source references
   (docs/engineering/REVLUMA_EVIDENCE_AND_PROVENANCE_ENGINE.md).
3. **Sidekick App Data/Actions are a future integration point**, not a current
   capability of Revluma. No Sidekick extension work is claimed or delivered in
   this release.
4. **Memory is not the same as evidence.** Sidekick memory (S1) is a
   conversational store; Revluma keeps merchant memory strictly separate from
   verified facts, with source-wins-over-memory rules
   (docs/engineering/REVLUMA_COMMERCE_DATA_INTELLIGENCE_ARCHITECTURE.md §Context layers).

## Verification status

Public documentation: verified 2026-11-05. Sidekick runtime behavior: not
verified — no admin session was inspected. Comparisons in this document that
depend on Sidekick internals are labeled UNKNOWN and must stay that way until
Shopify documents them or a merchant shares observations from a real store.
