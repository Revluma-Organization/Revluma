'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const adapter = require('../services/shopifyProductAction');

const store = { shop_domain: 'merchant.myshopify.com', access_token: 'encrypted' };
const id = 'gid://shopify/Product/123';

test('live scope checks use currentAppInstallation and fail closed', async () => {
  const calls = [];
  const graphql = async (_store, query, variables) => { calls.push({ query, variables }); return { currentAppInstallation: { accessScopes: [{ handle: 'read_products' }] } }; };
  assert.deepEqual(await adapter.liveScopes(store, graphql), ['read_products']);
  await assert.rejects(adapter.requireLiveScope(store, 'write_products', graphql), error => error.code === 'REQUIRED_SCOPE_NOT_GRANTED');
  assert.equal(calls[0].query, adapter.SCOPES_QUERY);
  assert.equal(calls[0].query.includes('currentAppInstallation'), true);
  await assert.rejects(adapter.liveScopes(store, async () => ({})), error => error.code === 'SHOPIFY_SCOPE_CHECK_UNAVAILABLE');
});

test('product reads require exact GID and a string description', async () => {
  const product = { id, title: 'Product', descriptionHtml: '<p>Before</p>' };
  assert.deepEqual(await adapter.readProduct(store, id, async () => ({ product })), { id, title: 'Product', description: '<p>Before</p>' });
  await assert.rejects(adapter.readProduct(store, id, async () => ({ product: { ...product, id: 'gid://shopify/Product/999' } })), error => error.code === 'PRODUCT_NOT_READABLE');
  await assert.rejects(adapter.readProduct(store, id, async () => ({ product: null })), error => error.code === 'PRODUCT_NOT_READABLE');
});

test('direct description updates reject before invoking any GraphQL transport', async () => {
  let calls = 0;
  await assert.rejects(adapter.updateProductDescription(store, id, '<p>After</p>', async () => { calls++; }), error => error.code === 'COMMERCE_ACTIONS_DISABLED');
  assert.equal(calls, 0);
});

test('collections reader paginates and maps smart rules without persistence claims', async () => {
  const result = await adapter.listCollections(store, { first: 2, after: 'cursor' }, async (_store, query, variables) => {
    assert.equal(query, adapter.COLLECTIONS_QUERY);
    assert.deepEqual(variables, { first: 2, after: 'cursor' });
    return { collections: {
      pageInfo: { hasNextPage: true, endCursor: 'next' },
      nodes: [{ id: 'gid://shopify/Collection/1', title: 'Summer', handle: 'summer', description: 'Seasonal', sortOrder: 'MANUAL', productsCount: { count: 4 }, ruleSet: { appliedDisjunctively: true, rules: [{ column: 'TAG', relation: 'EQUALS', condition: 'summer' }] }, updatedAt: '2026-11-06T00:00:00Z' }],
    } };
  });
  assert.equal(result.collections[0].product_count, 4);
  assert.equal(result.collections[0].smart_rules.applied_disjunctively, true);
  assert.deepEqual(result.page_info, { has_next_page: true, end_cursor: 'next' });
  await assert.rejects(adapter.listCollections(store, {}, async () => ({})), error => error.code === 'COLLECTIONS_READ_INVALID');
});
