/**
 * Read-only live diagnostic of a Shopify installation's actual access.
 *
 * The OAuth callback records `granted_scopes` at install time, but the merchant
 * can change grants later, and recorded strings are not proof of current
 * permission. This diagnostic asks Shopify — through the store's authorized
 * installation — for the live answer: the current scope set and a first-row
 * probe of the products, orders, customers and abandoned-checkout collections.
 *
 * Hard boundaries (enforced by tests):
 *   * Never returns tokens, ciphertext, emails, names, ids or any customer data.
 *   * Output is an allow-listed projection; nothing from the GraphQL response
 *     is echoed back. Collection probes report only ok|empty|access_denied|error.
 *   * Read-only: no mutation is issued to Shopify or the database here.
 *   * Intended behind admin authentication with no-store caching.
 */
'use strict';

const { shopifyGraphql } = require('./shopifyGraphql');
const logger = require('../utils/logger');

const SCOPES_QUERY = 'query RevlumaDiagnosticScopes { currentAppInstallation { accessScopes { handle } } }';
const REQUIRED_SCOPES = ['read_products', 'read_orders', 'read_customers', 'read_inventory', 'read_checkouts'];

const PROBE_QUERIES = Object.freeze({
  products: 'query RevlumaProbeProducts { products(first: 1) { nodes { id } } }',
  orders: 'query RevlumaProbeOrders { orders(first: 1) { nodes { id } } }',
  customers: 'query RevlumaProbeCustomers { customers(first: 1) { nodes { id } } }',
  checkouts: 'query RevlumaProbeCheckouts { abandonedCheckouts(first: 1) { nodes { id } } }',
});

function grantedScopeSet(data) {
  const scopes = data?.currentAppInstallation?.accessScopes;
  if (!Array.isArray(scopes)) {
    throw Object.assign(new Error('Shopify did not return granted access scopes'), { code: 'SHOPIFY_SCOPES_UNVERIFIED' });
  }
  return new Set(scopes.map((item) => item?.handle).filter(Boolean));
}

function classifyProbeError(error) {
  const codes = (error?.shopifyErrors || []).flatMap((item) => item?.codes || []);
  if (codes.includes('ACCESS_DENIED') || codes.includes('ACCESS_RESTRICTED')) return 'access_denied';
  return `error:${error?.code || error?.name || 'probe_failed'}`;
}

function presentScopeFlag(scopes, name) {
  return scopes ? scopes.has(name) : null;
}

async function probeCollection(store, graphql, key) {
  try {
    const data = await graphql(store, PROBE_QUERIES[key]);
    const nodes = data?.[key]?.nodes;
    if (!Array.isArray(nodes)) return 'error:SHOPIFY_RESPONSE_MALFORMED';
    return nodes.length === 0 ? 'empty' : 'ok';
  } catch (error) {
    return classifyProbeError(error);
  }
}

/**
 * Build the sanitized diagnostic. `store` must include access_token for the
 * outbound call but that value never appears in the result.
 */
async function buildStoreAccessDiagnostic({ store, graphql = shopifyGraphql, now = new Date() } = {}) {
  let liveScopes = null;
  let scopeQueryOk = false;
  try {
    const data = await graphql(store, SCOPES_QUERY);
    liveScopes = grantedScopeSet(data);
    scopeQueryOk = true;
  } catch (error) {
    logger.warn('shopify_access_diagnostic_scopes_failed', {
      store_id: store?.id,
      error_code: error?.code || error?.name || 'scope_query_failed',
    });
  }
  const requiredMissing = liveScopes
    ? REQUIRED_SCOPES.filter((scope) => !liveScopes.has(scope))
    : null;

  const probes = {};
  for (const key of Object.keys(PROBE_QUERIES)) {
    probes[key] = await probeCollection(store, graphql, key);
  }

  const recorded = String(store?.granted_scopes || '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)
    .sort();

  return {
    store_id: store?.id || null,
    organization_id: store?.organization_id || null,
    platform: store?.platform || null,
    shop_domain: store?.shop_domain || null,
    store_status: store?.status || null,
    installed_at: store?.installed_at || null,
    last_synced_at: store?.last_synced_at || null,
    live_check_performed_at: now.toISOString(),
    oauth_recorded_granted_scopes: recorded,
    live_granted_scopes: liveScopes ? [...liveScopes].sort() : null,
    scope_query_ok: scopeQueryOk,
    required_scopes_missing_live: requiredMissing,
    read_products_live: presentScopeFlag(liveScopes, 'read_products'),
    read_orders_live: presentScopeFlag(liveScopes, 'read_orders'),
    read_all_orders_live: presentScopeFlag(liveScopes, 'read_all_orders'),
    read_customers_live: presentScopeFlag(liveScopes, 'read_customers'),
    read_inventory_live: presentScopeFlag(liveScopes, 'read_inventory'),
    read_checkouts_live: presentScopeFlag(liveScopes, 'read_checkouts'),
    probes,
    notes: [
      'Read-only diagnostic via the authorized installation; nothing is mutated.',
      'No tokens, customer data or message contents are returned.',
      'recorded scopes (oauth_recorded_*) reflect install time; live_granted_scopes is authoritative.',
      'an empty collection probe means access worked but the source returned no rows — it is not proof of permission.',
    ],
  };
}

module.exports = { buildStoreAccessDiagnostic, REQUIRED_SCOPES, grantedScopeSet };
