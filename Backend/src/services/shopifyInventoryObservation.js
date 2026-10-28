'use strict';

// Read-only Shopify catalog observation. Not a certified inventory snapshot:
// publication, selling plans, markets and location-specific availability can
// prevent purchase even when an inventory quantity is positive.
const { shopifyGraphql } = require('./shopifyGraphql');
const { fetchConnection } = require('./shopifySync');

function validateCatalogScopes(data) {
  const scopes = data?.currentAppInstallation?.accessScopes;
  if (!Array.isArray(scopes)) {
    throw Object.assign(new Error('Shopify product permissions could not be verified'), { code: 'SHOPIFY_PRODUCT_SCOPES_UNVERIFIED' });
  }
  if (!scopes.some(item => item?.handle === 'read_products')) {
    throw Object.assign(new Error('Shopify read_products permission is required'), { code: 'SHOPIFY_READ_PRODUCTS_NOT_GRANTED' });
  }
}

function mapProduct(node, observedAt) {
  if (!node || typeof node.id !== 'string' || !['ACTIVE', 'ARCHIVED', 'DRAFT'].includes(node.status) ||
      !node.variants || !Array.isArray(node.variants.nodes) ||
      node.variants.pageInfo?.hasNextPage !== false) {
    throw Object.assign(new Error('Shopify product observation is incomplete'), { code: 'SHOPIFY_PRODUCT_OBSERVATION_INCOMPLETE' });
  }
  return {
    productId: node.id,
    title: String(node.title || ''),
    status: node.status,
    totalInventory: Number.isInteger(node.totalInventory) ? node.totalInventory : null,
    observedAt,
    variants: node.variants.nodes.map(variant => {
      if (!variant || typeof variant.id !== 'string' || typeof variant.availableForSale !== 'boolean' ||
          typeof variant.inventoryPolicy !== 'string') {
        throw Object.assign(new Error('Shopify variant observation is incomplete'), { code: 'SHOPIFY_VARIANT_OBSERVATION_INCOMPLETE' });
      }
      return {
        variantId: variant.id,
        title: String(variant.title || ''),
        availableForSale: variant.availableForSale,
        inventoryPolicy: variant.inventoryPolicy,
        inventoryQuantity: Number.isInteger(variant.inventoryQuantity) ? variant.inventoryQuantity : null,
      };
    }),
  };
}

async function observeShopifyInventory(store, { graphql = shopifyGraphql, fetchPages = fetchConnection, now = new Date() } = {}) {
  if (store?.platform !== 'shopify' || !store?.access_token) {
    throw Object.assign(new Error('Authorized Shopify store required'), { code: 'SHOPIFY_INVENTORY_STORE_UNAUTHORIZED' });
  }
  const permissions = await graphql(store, 'query RevlumaCatalogScopes { currentAppInstallation { accessScopes { handle } } }');
  validateCatalogScopes(permissions);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid observation time');
  const query = `query RevlumaInventoryObservation($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      nodes {
        id title status totalInventory
        variants(first: 250) {
          nodes { id title availableForSale inventoryQuantity inventoryPolicy }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const nodes = await fetchPages(store, query, 'products', graphql);
  const observedAt = now.toISOString();
  const products = nodes.map(node => mapProduct(node, observedAt));
  if (new Set(products.map(item => item.productId)).size !== products.length) {
    throw Object.assign(new Error('Duplicate product in Shopify catalog response'), { code: 'SHOPIFY_PRODUCT_OBSERVATION_DUPLICATE' });
  }
  return {
    storeId: store.id,
    observedAt,
    source: 'shopify_admin_graphql',
    scopeVerified: true,
    catalogPaginationComplete: true,
    variantPaginationComplete: true,
    products,
    // A single read does not prove historic transitions or merchant-visible
    // stockouts. Do not generate product availability findings from this.
    alertEligible: false,
  };
}
module.exports = { validateCatalogScopes, mapProduct, observeShopifyInventory };
