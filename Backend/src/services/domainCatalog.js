'use strict';

// Canonical capability catalog for every data domain Revluma targets.
// Shared by the admin coverage endpoint, documentation, and certification.
//
// Every entry carries:
//   required_scopes  — Shopify OAuth scope(s) the Admin API requires
//   additional_approval — approval beyond plain OAuth, if any
//   implementation    — honest acquisition status (NOT inferred from scopes)
//   restrictions      — platform limits that no implementation can bypass

const DOMAIN_CAPABILITIES = Object.freeze([
  { domain: 'store_domains', label: 'Store identity, plan, timezone, currency & domains', required_scopes: [], implementation: 'implemented', additional_approval: null, restrictions: ['shop.email is the store-owner email; not customer PII'] },
  { domain: 'products', label: 'Products (catalogue, options, images, SEO, status)', required_scopes: ['read_products'], implementation: 'implemented', additional_approval: null, restrictions: [] },
  { domain: 'variants', label: 'Product variants (price, SKU, inventory item link)', required_scopes: ['read_products'], implementation: 'implemented', additional_approval: null, restrictions: [] },
  { domain: 'inventory', label: 'Inventory items, levels, states & locations', required_scopes: ['read_inventory', 'read_locations'], implementation: 'not_implemented', additional_approval: null, restrictions: ['Shopify does not expose inventory movement history natively — only current levels'] },
  { domain: 'locations', label: 'Inventory/fulfillment locations', required_scopes: ['read_locations'], implementation: 'not_implemented', additional_approval: null, restrictions: [] },
  { domain: 'markets', label: 'Markets & contextual pricing', required_scopes: ['read_markets'], implementation: 'not_implemented', additional_approval: null, restrictions: ['contextualPricing requires the market context; unavailable below certain plan/permission combinations'] },
  { domain: 'customers', label: 'Customer profiles & marketing consent', required_scopes: ['read_customers'], implementation: 'implemented', additional_approval: 'protected_customer_data', restrictions: ['Protected customer data approval required: addresses, full names', 'Guest checkout identities are not Shopify customer records'] },
  { domain: 'customer_journeys', label: 'Order attribution & customer journey summary', required_scopes: ['read_orders'], implementation: 'not_implemented', additional_approval: null, restrictions: ['customerJourneySummary coverage varies by plan and channel'] },
  { domain: 'orders', label: 'Orders, line items, totals, currency', required_scopes: ['read_orders'], implementation: 'implemented', additional_approval: null, restrictions: ['read_all_orders additionally required for history beyond 60 days'] },
  { domain: 'transactions', label: 'Payment transactions (kind/status/gateway/amount)', required_scopes: ['read_orders'], implementation: 'implemented', additional_approval: null, restrictions: ['Raw card data is never exposed; declined-payment error prose is not persisted (only structured codes); authorization field availability varies by gateway'] },
  { domain: 'refunds', label: 'Refund records, refund line items, refund transactions', required_scopes: ['read_orders'], implementation: 'implemented', additional_approval: null, restrictions: [] },
  { domain: 'fulfillments', label: 'Fulfillments, status, tracking, locations', required_scopes: ['read_orders'], implementation: 'implemented', additional_approval: null, restrictions: ['Fulfillment orders & returns need separate read scopes (read_merchant_managed_fulfillment_orders); not yet implemented'] },
  { domain: 'abandoned_checkouts', label: 'Abandoned checkouts (identity, line items, recovery)', required_scopes: ['read_checkouts'], implementation: 'implemented', additional_approval: null, restrictions: ['Checkouts ≠ all visitor sessions; not an abandonment denominator', 'Cart tokens are opaque; numeric checkout ids are canonical'] },
  { domain: 'analytics', label: 'ShopifyQL / Shopify analytics', required_scopes: ['read_analytics', 'read_reports'], implementation: 'not_implemented', additional_approval: 'plan_dependent', restrictions: ['ShopifyQL is unavailable to most non-Plus subscriptions', 'analytics scope grants no data for free trials; verify per merchant'] },
  { domain: 'discounts', label: 'Discount nodes, automatic discounts & order applications', required_scopes: ['read_discounts'], implementation: 'not_implemented', additional_approval: null, restrictions: [] },
  { domain: 'webhooks', label: 'Webhook subscriptions & drift (engineering-verified, not a data domain)', required_scopes: [], implementation: 'implemented', additional_approval: null, restrictions: ['Remote subscription creation/change remains approval-gated'] },
  { domain: 'pixel_events', label: 'Storefront behavioural events (Web Pixel)', required_scopes: ['write_pixels', 'read_customer_events'], implementation: 'not_implemented', additional_approval: 'write_pixels + merchant consent', restrictions: ['Requires a deployed Web Pixel app extension; read_customer_events alone collects nothing'] },
]);

const IMPLEMENTED_DOMAINS = DOMAIN_CAPABILITIES.filter(d => d.implementation === 'implemented').map(d => d.domain);

function byDomain(domain) {
  return DOMAIN_CAPABILITIES.find(d => d.domain === domain) || null;
}

// Pure derivation used by the controller and certification tooling.
// A scope (or an attempted sync) is never proof of completeness — only an
// ok ledger row with pagination_complete=true yields COMPLETE.
function rowStatus(capability, row) {
  if (!capability) return 'UNSUPPORTED_BY_SHOPIFY';
  if (capability.implementation !== 'implemented') {
    return capability.additional_approval ? 'APPROVAL_REQUIRED' : 'NOT_IMPLEMENTED';
  }
  if (!row) return 'NOT_YET_SYNCED';
  if (row.status === 'running') return 'SYNCING';
  if (row.status === 'failed') return 'FAILED';
  if (row.status === 'degraded') return 'DEGRADED';
  if (row.status === 'ok') return row.pagination_complete ? 'COMPLETE' : 'INCOMPLETE';
  return 'NOT_YET_SYNCED';
}

module.exports = { DOMAIN_CAPABILITIES, IMPLEMENTED_DOMAINS, byDomain, rowStatus };
