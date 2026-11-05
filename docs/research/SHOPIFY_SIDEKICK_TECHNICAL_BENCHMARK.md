# Shopify Sidekick technical benchmark — initial research

Research date: 2026-11-05. **IN PROGRESS, not a complete reverse engineering or certification.** Examined public documentation and Revluma's GraphQL default `2026-10`; actual deployed environment version is unverified. Shopify private implementations, model, internal access paths and retrieval strategy are not disclosed in these sources.

## Confirmed public capabilities and boundaries

| Capability | Public evidence | Not established |
|---|---|---|
| Store questions | Shopify says Sidekick answers using store sales, products and customers; supports reports and ShopifyQL query generation and visualizations. [Guidance](https://help.shopify.com/en/manual/ai-powered-tools/sidekick/help-and-guidance) | Which storage, API or inference pathway supports a particular answer; completeness or accuracy of every result. |
| Financial | Same guidance documents sales comparisons, channel sales, product costs/profits/returns/discounts, and Shopify Payments payout/chargeback answers under staff permissions. It lists payout and reserve limitations. | The identical fields being available to a third-party app, or profit definitions and source consistency for any specific answer. |
| Context selection | [Getting started](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick/set-up) documents current page, files, resource mentions and Target mode; [guidance](https://help.shopify.com/en/manual/ai-powered-tools/sidekick/help-and-guidance) gives inventory mention example. | That every page's complete state is ingested or becomes verified data. |
| Third-party apps | [Extensions](https://shopify.dev/docs/apps/build/sidekick) execute in a Shopify sandbox with the app's APIs; an extension returns data to Sidekick. Guidance describes merchant approval. | Automatic access to arbitrary app data or another app's data without integration and permission. |
| Memory | [Memory](https://help.shopify.com/en/manual/ai-powered-tools/sidekick/memory) describes explicit and implicit preferences, prior conversations (about 3 months), recent admin activity (about 12 hours), opt-out before first message, correction, and deletion. Theme-editor chats are excluded. | Internal memory schema, exact user/store isolation boundary, and whether all preferences affect all recommendations. |
| Skills | [Skills](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick/skills) are reusable saved prompts, up to 25; shareable for another merchant to review. | A hidden autonomous agent or verified evidence source. |
| Proactive | [Pulse](https://help.shopify.com/en/manual/ai-powered-tools/sidekick/pulse) surfaces recommendation cards with eligibility constraints; merchant reviews changes. | Detection algorithms, measured precision or freshness. |
| Control | [Setup](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/sidekick/set-up) says no live store changes without approval. | A reason for Revluma to implement write actions: Revluma MVP remains read-only. |

Sidekick's natural-language report examples show observable behavior, not a guarantee of causality or proof of private tool selection. A live Sidekick/Admin demonstration and per-domain capability study are outstanding.

## Implications for Revluma

Use explicitly scoped resources and small verified evidence sets; offer merchant-controlled contextual memory distinct from current facts; build evidence-linked recommendations and visible limitations. Sidekick has write-related experiences, but none should be reproduced as an autonomous Shopify mutation in Revluma. ShopifyQL support is not proof that Revluma currently has the necessary access, query, data or approval.

## Sources for the data-access audit

- [Access scope management](https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes): declaration is not grant; order history ordinarily 60 days, `read_all_orders` extends with required approval; protected-data restrictions can cause partial GraphQL data/errors; write scope can imply read.
- [GraphQL Admin API](https://shopify.dev/docs/api/admin-graphql/latest): cost-based rate limits, GraphQL errors can occur with HTTP 200.
- [Webhooks](https://shopify.dev/docs/apps/build/webhooks): delivery is not guaranteed, reconcile periodically.
- [Verify deliveries](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries): HTTPS HMAC on raw payload and delivery deduplication.
