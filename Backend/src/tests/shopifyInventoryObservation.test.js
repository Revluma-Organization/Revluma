'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { observeShopifyInventory } = require('../services/shopifyInventoryObservation');

const store = { id: 'store-1', platform: 'shopify', access_token: 'encrypted' };
const valid = {
  id: 'gid://shopify/Product/1', title: 'Sample', status: 'ACTIVE', totalInventory: 0,
  variants: { nodes: [{ id: 'gid://shopify/ProductVariant/1', title: 'Default', availableForSale: false,
    inventoryQuantity: 0, inventoryPolicy: 'DENY' }], pageInfo: { hasNextPage: false, endCursor: null } },
};
const fetchPages = async () => [valid];
test('reads catalog only after Shopify product scope is verified', async () => {
  let pages = 0;
  const result = await observeShopifyInventory(store, {
    graphql: async () => ({ currentAppInstallation: { accessScopes: [{ handle: 'read_products' }] } }),
    fetchPages: async () => { pages++; return [valid]; },
    now: new Date('2026-10-28T12:00:00Z'),
  });
  assert.equal(pages, 1);
  assert.equal(result.products[0].variants[0].availableForSale, false);
  assert.equal(result.alertEligible, false);
  assert.equal(result.catalogPaginationComplete, true);
});
test('denied or unverified permissions fail closed', async () => {
  for (const scopes of [[], null]) {
    await assert.rejects(() => observeShopifyInventory(store, {
      graphql: async () => ({ currentAppInstallation: { accessScopes: scopes } }),
      fetchPages: async () => { throw Error('must not fetch'); },
    }), /permission|permissions/i);
  }
});
test('partial variant pagination cannot be mistaken for a complete observation', async () => {
  await assert.rejects(() => observeShopifyInventory(store, {
    graphql: async () => ({ currentAppInstallation: { accessScopes: [{ handle: 'read_products' }] } }),
    fetchPages: async () => [{ ...valid, variants: { ...valid.variants, pageInfo: { hasNextPage: true } } }],
  }), error => error.code === 'SHOPIFY_PRODUCT_OBSERVATION_INCOMPLETE');
});
test('missing availability and duplicate product IDs fail closed', async () => {
  const graphql = async () => ({ currentAppInstallation: { accessScopes: [{ handle: 'read_products' }] } });
  await assert.rejects(() => observeShopifyInventory(store, {
    graphql, fetchPages: async () => [{ ...valid, variants: { ...valid.variants, nodes: [{ id: 'variant-1', inventoryPolicy: 'DENY' }] } }],
  }), error => error.code === 'SHOPIFY_VARIANT_OBSERVATION_INCOMPLETE');
  await assert.rejects(() => observeShopifyInventory(store, {
    graphql, fetchPages: async () => [valid, valid],
  }), error => error.code === 'SHOPIFY_PRODUCT_OBSERVATION_DUPLICATE');
});
