'use strict';

const { prisma: defaultDb } = require('../configs/database');
const ledger = require('./syncDomainState');
const { REGISTRY } = require('./resourceRegistry');
const { universalRow, LEDGER_DOMAIN_BY_ID, STATUS } = require('./universalCoverage');
const shopify = require('./shopifyProductAction');
const { CommerceActionError } = require('./commerceActionPolicy');
const { actionsEnabled } = require('./commerceActionService');

async function organizationStore(db, storeId, organizationId) {
  const store = await db.stores.findFirst({ where: { id: storeId, organization_id: organizationId, platform: 'shopify', access_token: { not: null } } });
  if (!store) throw new CommerceActionError('SHOPIFY_STORE_NOT_FOUND', 'Connected Shopify store not found for this organization.', 404);
  return store;
}

async function getMerchantCoverage(storeId, organizationId, deps = {}) {
  const db = deps.db || defaultDb;
  const store = await organizationStore(db, storeId, organizationId);
  // Live installation grants, not stale OAuth metadata, decide what is available.
  const grantedScopes = await shopify.liveScopes(store, deps.graphql);
  const rows = await (deps.ledger || ledger).snapshot(store.id);
  const byDomain = Object.fromEntries(rows.map(row => [row.domain, row]));
  const resources = REGISTRY.map(entry => universalRow(entry, LEDGER_DOMAIN_BY_ID[entry.id] ? (byDomain[LEDGER_DOMAIN_BY_ID[entry.id]] || null) : null, grantedScopes));
  const counts = {};
  for (const row of resources) counts[row.status] = (counts[row.status] || 0) + 1;
  return {
    report: 'merchant_capability_v1',
    store: { id: store.id, shop_domain: store.shop_domain, status: store.status, last_synced_at: store.last_synced_at },
    scopes: { live_installation_scopes: grantedScopes, checked_at: new Date().toISOString() },
    certification: {
      total_registered_resources: resources.length,
      implemented: resources.filter(row => [STATUS.IMPLEMENTED_VERIFIED, STATUS.IMPLEMENTED_UNVERIFIED].includes(row.status)).length,
      production_verified_for_this_store_now: resources.filter(row => row.status === STATUS.IMPLEMENTED_VERIFIED).length,
      status_counts: counts,
    },
    actions: {
      enabled_by_environment: actionsEnabled(deps.env),
      supported: [{ action_type: 'product_update_description', preview_scope: 'read_products', execution_scope: 'write_products', preview_available: grantedScopes.includes('read_products'), execution_available: actionsEnabled(deps.env) && grantedScopes.includes('write_products'), safeguards: ['preview', 'explicit_confirmation', 'current_state_revalidation', 'audit', 'uncertainty_reconciliation', 'guarded_rollback'] }],
    },
    sidekick: { deployable: false, reason: 'Managed installation and token exchange are not implemented. The local tool contract is a foundation only.' },
    disclaimer: 'Coverage is limited to implemented connectors, live installation grants, approvals, plan availability, and observed sync evidence. This is not all-store-data coverage.',
    resources,
  };
}

async function getCollections(storeId, organizationId, query, deps = {}) {
  const db = deps.db || defaultDb;
  const first = query.first === undefined ? 50 : Number(query.first);
  if (!Number.isInteger(first) || first < 1 || first > 100) throw new CommerceActionError('INVALID_COLLECTION_PAGE_SIZE', 'first must be an integer from 1 to 100.', 400);
  const after = query.after == null || query.after === '' ? null : String(query.after);
  if (after && after.length > 2000) throw new CommerceActionError('INVALID_COLLECTION_CURSOR', 'Collection cursor is invalid.', 400);
  const store = await organizationStore(db, storeId, organizationId);
  await shopify.requireLiveScope(store, 'read_products', deps.graphql);
  const result = await shopify.listCollections(store, { first, after }, deps.graphql);
  return { ...result, coverage: { implementation: 'implemented_unverified', persisted: false, source: 'shopify_live' } };
}

module.exports = { getMerchantCoverage, getCollections, organizationStore };
