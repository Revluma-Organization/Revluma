'use strict';

// Fixtures shaped like the production store observed on 2026-11-21 (ledger
// and granted scopes read from Supabase); timestamps are parameterised.

const PRODUCTION_SCOPES = 'read_orders,read_customers,read_products,read_analytics,read_checkouts,read_draft_orders,read_inventory,read_locations,read_marketing_events,read_price_rules,read_reports,read_shopify_payments_accounts,read_shopify_payments_disputes,read_shopify_payments_payouts,read_themes,read_content,read_fulfillments,read_assigned_fulfillment_orders,read_merchant_managed_fulfillment_orders,read_shipping,read_returns,read_payment_terms,read_customer_events,write_discounts';

const SYNCED_AT = '2026-11-21T00:38:00Z';
const OK_DOMAINS = ['abandoned_checkouts', 'bulk-operations', 'collections', 'content.blogs', 'content.pages', 'customer.addresses', 'customer.metafields', 'customers', 'discount-nodes', 'draft-orders', 'fulfillments', 'inventory', 'locations', 'marketing-events', 'metafields.customers', 'metafields.orders', 'metafields.products', 'metafields.shop', 'order.fulfillment_orders', 'order.returns', 'order.risk', 'orders', 'product.media', 'products', 'refunds', 'shop.shipping_configuration', 'shop.taxes', 'store_domains', 'themes', 'transactions', 'variants'];

function productionRows(syncedAt = SYNCED_AT) {
  const rows = OK_DOMAINS.map(domain => ({ domain, status: 'ok', coverage_state: 'complete', failure_class: 'none', last_succeeded_at: syncedAt }));
  for (const domain of ['analytics.reports', 'content.redirects', 'online-store.menus', 'shop.policies']) {
    rows.push({ domain, status: 'failed', coverage_state: 'retrieval_failure', failure_class: 'unknown', retry_count: 1 });
  }
  return rows;
}

function productionStore(extra = {}) {
  return { id: '3ed79446-cb6d-4a1c-b174-9ec1ab91fe15', status: 'active', access_token: 'enc', granted_scopes: PRODUCTION_SCOPES, integration_state: 'unknown', initial_sync_status: 'initial_completed_with_limitations', last_synced_at: SYNCED_AT, ...extra };
}


module.exports = { PRODUCTION_SCOPES, SYNCED_AT, OK_DOMAINS, productionRows, productionStore };
