'use strict';

// Universal Shopify resource capability registry (Admin GraphQL 2026-10).
// Source of truth for: coverage endpoint, certification, and the scope-to-
// resource matrix. Every entry distinguishes what Shopify exposes from what
// Revluma actually implements and has verified.
//
// Verification vocabulary:
//   NOT_IMPLEMENTED — never built
//   IMPLEMENTED_NOT_DEPLOYED — code merged; not running/verified live
//   IMPLEMENTED_PRODUCTION_VERIFIED — observed succeeding in production
// Status vocabulary for completeness: see rowStatus() in domainCatalog.js.

const REGISTRY_VERSION = '2026-11-06.v1';
// Live consent evidence (2026-11-06, read-only SQL on production v1):
// granted_scopes = read_orders, read_customers, read_products, read_analytics, read_checkouts,
// read_draft_orders, read_inventory, read_locations, read_marketing_events, read_price_rules,
// read_reports, read_shopify_payments_accounts/disputes/payouts, read_themes, read_content,
// read_fulfillments, read_assigned_fulfillment_orders, read_merchant_managed_fulfillment_orders,
// read_shipping, read_returns, read_payment_terms, read_customer_events, write_discounts.
// Consent recorded ≠ surface available (plan gates apply) ≠ implemented in this build.


// fields per entry: id, name, surface('graphql'|'rest'|'pixel'|'bulk'|'analytics'|'webhook'),
//   category, scopes[], approval('none'|'read_all_orders'|'protected_customer_data'|'plan'|'partner_app'|'write_pixels'),
//   planRestrictions, restrictions[], acquisition('implemented'|'not_implemented'|'implemented_unverified'),
//   verification('not_verified'|'live_read'|'not_applicable'), notes
const REGISTRY = Object.freeze([
  // ── 3.1 Store & account configuration ───────────────────────────────
  { id: 'shop.identity', queryRoots: ['shop'], name: 'Shop identity, plan, timezone, currency, address country', surface: 'graphql', category: 'store_configuration', scopes: [], approval: 'none', planRestrictions: [], restrictions: ['shop.email is the store owner contact, not customer PII'], acquisition: 'implemented_unverified', verification: 'live_read', notes: 'store_profiles + store_domains; PR #312; re-verify post-deploy' },
  { id: 'shop.policies', name: 'Store policies (privacy, refund, shipping)', surface: 'graphql', category: 'store_configuration', scopes: ['read_content'], approval: 'none', planRestrictions: [], restrictions: ['Policy API availability varies; legal-page resources are partial'], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'shop.shipping_configuration', notes: 'read_shipping recorded in v1 consented scopes 2026-11-06 — valid scope; surface not yet implemented', surface: 'graphql', category: 'store_configuration', scopes: [], approval: 'none', planRestrictions: [], restrictions: ['Delivery profiles & carriers', 'Apps cannot read all carrier credentials — rate data only, where exposed'], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'shop.taxes', name: 'Tax configuration & tax lines context', surface: 'graphql', category: 'store_configuration', scopes: ['read_products'], approval: 'none', planRestrictions: ['Avalara AvaTax / Shopify Tax visibility varies'], restrictions: ['Line-level tax presence exists on orders; shop-level tax settings are configuration'], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'shop.payment_configuration', name: 'Payment provider configuration visibility', surface: 'graphql', category: 'store_configuration', scopes: ['read_payment_settings'], approval: 'partner_app', planRestrictions: [], restrictions: ['Gateway settings metadata for payment apps only; card data never exposed'], acquisition: 'not_implemented', verification: 'not_verified' },
  // ── 3.2 Products & merchandising ────────────────────────────────────
  { id: 'products', queryRoots: ['products'], name: 'Products (title, type, vendor, status, tags, SEO, media)', surface: 'graphql', category: 'catalogue', scopes: ['read_products'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'implemented', verification: 'live_read', notes: 'PRODUCTION_VERIFIED 2026-11-06 on dev store (17/17 + ledger)' },
  { id: 'product.variants', queryRoots: ['products', 'node'], name: 'Variants (price, compare-at, SKU, barcode, weight, options, availability)', surface: 'graphql', category: 'catalogue', scopes: ['read_products'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'implemented', verification: 'live_read', notes: 'PRODUCTION_VERIFIED 2026-11-06 (26/26 + ledger)' },
  { id: 'product.options', name: 'Product options', surface: 'graphql', category: 'catalogue', scopes: ['read_products'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'implemented', verification: 'live_read', notes: 'Persisted inside products.dimensions JSON' },
  { id: 'product.media', name: 'Media (images, videos, 3D models)', surface: 'graphql', category: 'catalogue', scopes: ['read_products'], approval: 'none', planRestrictions: [], restrictions: ['Media CDN URLs are public but rotate/retention-bound'], acquisition: 'implemented', verification: 'live_read', notes: 'featured image URL in dimensions; full media enumeration not persisted' },
  { id: 'collections', name: 'Collections + smart-collection rules', surface: 'graphql', category: 'catalogue', scopes: ['read_products'], approval: 'none', planRestrictions: [], restrictions: ['Smart rules resolved server-side by Shopify; rule DSL available read-only'], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'product.publications', name: 'Publications & catalog availability', surface: 'graphql', category: 'catalogue', scopes: ['read_publications'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'inventory.items', queryRoots: ['inventoryItems'], name: 'Inventory items (SKU link, tracked, requiresShipping, cost)', surface: 'graphql', category: 'inventory', scopes: ['read_inventory'], approval: 'none', planRestrictions: [], restrictions: ['Inventory cost is merchant financial data — intentionally not persisted', 'Item→variant links inside inventoryItemManagement'], acquisition: 'implemented_unverified', notes: 'read_inventory recorded in v1 consented scopes 2026-11-06; deploy+sync pending', verification: 'not_verified' },
  { id: 'inventory.levels', queryRoots: ['inventoryItems', 'node'], name: 'Inventory levels per location (available/committed/incoming)', surface: 'graphql', category: 'inventory', scopes: ['read_inventory'], approval: 'none', planRestrictions: [], restrictions: ['quantities(names:) shape verified by fallback; history is not natively queryable — snapshots only'], acquisition: 'implemented_unverified', verification: 'not_verified', notes: 'Implemented this block; deploy+sync pending' },
  { id: 'inventory.locations', queryRoots: ['locations'], name: 'Inventory/fulfillment locations', surface: 'graphql', category: 'inventory', scopes: ['read_locations'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'implemented_unverified', verification: 'not_verified', notes: 'Implemented this block; deploy+sync pending' },
  { id: 'price-lists', name: 'B2B price lists', surface: 'graphql', category: 'b2b', scopes: ['read_price_lists'], approval: 'partner_or_b2b', planRestrictions: ['B2B catalogs need B2B-enabled stores'], restrictions: [], acquisition: 'not_implemented', verification: 'not_verified' },
  // ── 3.4 Customers ───────────────────────────────────────────────────
  { id: 'customers', queryRoots: ['customers'], name: 'Customer profiles (id, email, state, consent, tags)', surface: 'graphql', category: 'customers', scopes: ['read_customers'], approval: 'protected_customer_data', planRestrictions: [], restrictions: ['Full names/addresses = protected customer data (app-level approval)', 'Guest checkout identities are not customer records'], acquisition: 'implemented', verification: 'live_read', notes: 'Live: 12 customers ingested on dev store (name/phone/email only — minimal); protected-data approval status unverified' },
  { id: 'customer.addresses', name: 'Customer addresses', surface: 'graphql', category: 'customers', scopes: ['read_customers'], approval: 'protected_customer_data', planRestrictions: [], restrictions: ['Protected customer data approval required separately from OAuth scopes'], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'customer.metafields', name: 'Customer metafields', surface: 'graphql', category: 'customers', scopes: ['read_customers'], approval: 'protected_customer_data', planRestrictions: [], restrictions: [], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'companies', name: 'B2B companies, company locations, company contacts', surface: 'graphql', category: 'b2b', scopes: ['read_companies'], approval: 'b2b_plan', planRestrictions: ['Requires Shopify Plus / B2B plan'], restrictions: [], acquisition: 'not_implemented', verification: 'not_verified' },
  // ── 3.5 Orders ──────────────────────────────────────────────────────
  { id: 'orders', queryRoots: ['orders'], name: 'Orders (identity, totals, net/refund-aware finance)', surface: 'graphql', category: 'orders', scopes: ['read_orders'], approval: 'read_all_orders', planRestrictions: [], restrictions: ['Default window is 60 days; full history needs read_all_orders application'], acquisition: 'implemented', verification: 'live_read', notes: 'Live 14:02Z 4/4 orders ok; history depth = 60d until read_all_orders granted' },
  { id: 'order.line_items', name: 'Line items (product/variant refs, qty, price)', surface: 'graphql', category: 'orders', scopes: ['read_orders'], approval: 'none', planRestrictions: [], restrictions: ['duties/tax lines/discount allocations not yet mapped'], acquisition: 'implemented', verification: 'live_read' },
  { id: 'order.transactions', queryRoots: ['orders', 'node'], name: 'Payment transactions (kind, status, gateway, amount, parent, error code)', surface: 'graphql', category: 'orders', scopes: ['read_orders'], approval: 'none', planRestrictions: [], restrictions: ['Card data never exposed; declined prose truncated; gateway availability varies'], acquisition: 'implemented_unverified', verification: 'not_verified', notes: 'PR #312; pending deploy' },
  { id: 'order.refunds', queryRoots: ['orders', 'node'], name: 'Refunds + refund line items (+refund transactions as JSON)', surface: 'graphql', category: 'orders', scopes: ['read_orders'], approval: 'none', planRestrictions: [], restrictions: ['Restock value not persisted yet'], acquisition: 'implemented_unverified', verification: 'not_verified', notes: 'PR #312; pending deploy' },
  { id: 'order.returns', name: 'Returns & return line items', surface: 'graphql', category: 'orders', scopes: ['read_returns'], approval: 'none', planRestrictions: ['POS returns vs online returns surface differently'], restrictions: [], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'order.risk', name: 'Risk analysis / recommendations', surface: 'graphql', category: 'orders', scopes: ['read_orders'], approval: 'none', planRestrictions: [], restrictions: ['Field availability varies by plan and fraud provider integration'], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'order.fulfillments', queryRoots: ['orders', 'node'], name: 'Fulfillments (status, location, tracking, line items)', surface: 'graphql', category: 'orders', scopes: ['read_orders'], approval: 'none', planRestrictions: [], restrictions: ['FulfillmentOrder resources need read_merchant_managed_fulfillment_orders / third-party variants'], acquisition: 'implemented_unverified', verification: 'not_verified', notes: 'PR #312; pending deploy' },
  { id: 'order.fulfillment_orders', name: 'Fulfillment orders & inbound line items', surface: 'graphql', category: 'orders', scopes: ['read_merchant_managed_fulfillment_orders'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'abandoned-checkouts', name: 'Abandoned/checkouts (identity, totals, recovery)', surface: 'graphql', category: 'checkouts', scopes: ['read_checkouts'], approval: 'none', planRestrictions: [], restrictions: ['Checkout ≠ order; ≠ visitor denominator', 'Numeric checkout id is canonical; tokens are opaque'], acquisition: 'implemented', verification: 'live_read', queryRoots: ['abandonedCheckouts', 'node'], notes: 'Live 14:02Z 8/8 ok' },
  { id: 'checkout.token', name: 'Checkout tokens / cart identity', surface: 'graphql', category: 'checkouts', scopes: ['read_checkouts'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'implemented', verification: 'live_read', queryRoots: ['abandonedCheckouts'] },
  // ── 3.9 Discounts ───────────────────────────────────────────────────
  { id: 'discount-nodes', queryRoots: ['discountNodes'], name: 'Discount nodes & codes (read-only)', surface: 'graphql', category: 'discounts', scopes: ['read_discounts'], approval: 'none', planRestrictions: [], restrictions: ['write_discounts was deliberately de-forced (PR #310) — read-only by design'], acquisition: 'not_implemented', verification: 'not_verified' },
  // ── 3.11 Markets ────────────────────────────────────────────────────
  { id: 'markets', queryRoots: ['markets'], name: 'Markets (regions, currency, availability)', surface: 'graphql', category: 'markets', scopes: ['read_markets'], approval: 'none', planRestrictions: ['Markets Pro features need Plus'], restrictions: ['Contextual price content is per-variant per-market; heavy query surface'], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'contextual-pricing', name: 'Variant contextual pricing per market/country', surface: 'graphql', category: 'markets', scopes: ['read_markets'], approval: 'none', planRestrictions: ['Markets Pro for full price adjustment coverage'], restrictions: [], acquisition: 'not_implemented', verification: 'not_verified' },
  // ── 3.13 Content & storefront ───────────────────────────────────────
  { id: 'content.pages', queryRoots: ['pages'], name: 'Pages (content + SEO meta)', surface: 'graphql', category: 'content', scopes: ['read_content'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'content.blogs', queryRoots: ['blogs'], name: 'Blogs + articles', surface: 'graphql', category: 'content', scopes: ['read_content'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'content.redirects', queryRoots: ['urlRedirects'], name: 'URL redirects', surface: 'graphql', category: 'content', scopes: ['read_content'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'online-store.menus', name: 'Navigation menus', surface: 'graphql', category: 'content', scopes: ['read_content'], approval: 'none', planRestrictions: [], restrictions: ['Navigation menus not exposed to non-theme apps — serialization only via theme'], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'themes', queryRoots: ['themes'], name: 'Themes (installed, role)', surface: 'graphql', category: 'content', scopes: ['read_themes'], approval: 'none', planRestrictions: [], restrictions: ['Theme asset bodies are not merchant data; role/name only'], acquisition: 'not_implemented', verification: 'not_verified' },
  // ── 3.14 Metafields/metaobjects ─────────────────────────────────────
  { id: 'metafields.products', name: 'Product/variant metafields + definitions', surface: 'graphql', category: 'metafields', scopes: ['read_products'], approval: 'none', planRestrictions: [], restrictions: ['Structured JSON permitted as opaque JSON'], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'metafields.customers', name: 'Customer metafields', surface: 'graphql', category: 'metafields', scopes: ['read_customers'], approval: 'protected_customer_data', planRestrictions: [], restrictions: [], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'metafields.orders', name: 'Order metafields', surface: 'graphql', category: 'metafields', scopes: ['read_orders'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'metafields.shop', name: 'Shop metafields + metaobjects', surface: 'graphql', category: 'metafields', scopes: ['read_products'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'metaobjects', queryRoots: ['metaobjectDefinitions', 'metaobjects'], name: 'Metaobject definitions + entries', surface: 'graphql', category: 'metafields', scopes: ['read_metaobjects', 'read_metaobject_definitions'], approval: 'none', planRestrictions: [], restrictions: [], acquisition: 'not_implemented', verification: 'not_verified' },
  // ── Behavioural / Pixel ─────────────────────────────────────────────
  { id: 'web-pixels', name: 'Web Pixel extension + consented storefront events', surface: 'pixel', category: 'behavioural', scopes: ['write_pixels', 'read_customer_events'], approval: 'write_pixels', planRestrictions: [], restrictions: ['Requires deployed Web Pixel extension; read_customer_events alone collects nothing', 'Merchant consent honored; no cross-merchant events'], acquisition: 'not_implemented', verification: 'not_verified' },
  // ── Analytics ───────────────────────────────────────────────────────
  { id: 'analytics.reports', name: 'Shopify Analytics reports / ShopifyQL', surface: 'analytics', category: 'analytics', scopes: ['read_reports'], approval: 'plan', planRestrictions: ['ShopifyQL restricted to Plus/Advanced; analytics scope availability varies by plan'], restrictions: ['Never substitute raw order sums for unexported report metrics'], acquisition: 'not_implemented', verification: 'not_verified' },
  // ── Webhooks / bulk / primitives ────────────────────────────────────
  { id: 'bulk-operations', queryRoots: ['bulkOperations'], name: 'Bulk Operations (large stores/backfills)', surface: 'bulk', category: 'primitives', scopes: ['read_bulk_operations', 'read_products', 'read_orders'], approval: 'none', planRestrictions: [], restrictions: ['Bulk output is JSONL; private app limits apply; ordering guaranteed per operation'], acquisition: 'not_implemented', verification: 'not_verified' },
  { id: 'webhooks', name: 'Webhook subscriptions, deliveries, drift reconciliation', surface: 'webhook', category: 'primitives', scopes: [], approval: 'remote_mutation_gated', planRestrictions: [], restrictions: ['Remote subscription creation/change is approval-gated in this engineering phase'], acquisition: 'implemented', verification: 'live_read' },
]);

const IMPLEMENTED_IDS = REGISTRY.filter(r => r.acquisition === 'implemented').map(r => r.id);
const IMPLEMENTED_UNVERIFIED_IDS = REGISTRY.filter(r => r.acquisition === 'implemented_unverified').map(r => r.id);

function getResource(id) {
  return REGISTRY.find(r => r.id === id) || null;
}

function byCategory() {
  const map = new Map();
  for (const entry of REGISTRY) {
    if (!map.has(entry.category)) map.set(entry.category, []);
    map.get(entry.category).push(entry);
  }
  return Object.fromEntries(map);
}

module.exports = { REGISTRY, REGISTRY_VERSION, IMPLEMENTED_IDS, IMPLEMENTED_UNVERIFIED_IDS, getResource, byCategory };
