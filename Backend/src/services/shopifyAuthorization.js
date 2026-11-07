'use strict';

const defaultGraphql = (...args) => require('./shopifyGraphql').shopifyGraphql(...args);
const { classifyShopifyError } = require('./integrationLifecycle');

const REQUIRED_BASELINE_SCOPES = Object.freeze(['read_orders', 'read_products', 'read_inventory', 'read_checkouts']);

function scopes(value) {
  return new Set(String(value || '').split(',').map(item => item.trim()).filter(Boolean));
}

function missingRequiredScopes(granted, required = REQUIRED_BASELINE_SCOPES) {
  const set = granted instanceof Set ? granted : scopes(granted);
  return required.filter(scope => !set.has(scope) && !set.has(`write_${scope.slice(5)}`));
}

async function verifyShopifyAuthorization(store, graphql = defaultGraphql) {
  try {
    const data = await graphql(store, 'query RevlumaReconnectAuthorization { currentAppInstallation { accessScopes { handle } } }');
    const rows = data?.currentAppInstallation?.accessScopes;
    if (!Array.isArray(rows) || rows.some(row => typeof row?.handle !== 'string')) {
      const error = new Error('Shopify authorization response was invalid');
      error.code = 'SHOPIFY_SCOPES_UNVERIFIED';
      throw error;
    }
    const granted = new Set(rows.map(row => row.handle));
    const missing = missingRequiredScopes(granted);
    if (missing.length) {
      const error = new Error('Required Shopify permissions are missing');
      error.code = 'SHOPIFY_REQUIRED_SCOPES_MISSING';
      error.missingScopes = missing;
      throw error;
    }
    return { verified: true, grantedScopes: [...granted].sort(), verifiedAt: new Date() };
  } catch (error) {
    return { verified: false, reasonCode: classifyShopifyError(error), errorCode: error.code || 'SHOPIFY_AUTHORIZATION_UNVERIFIED', missingScopes: error.missingScopes || [] };
  }
}

module.exports = { REQUIRED_BASELINE_SCOPES, missingRequiredScopes, verifyShopifyAuthorization };
