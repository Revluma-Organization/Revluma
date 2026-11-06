'use strict';
/**
 * Webhook store resolution (tenant boundary).
 *
 * The shared Shopify app secret proves a delivery came from Shopify, but the
 * shop domain in the header decides WHICH merchant's rows it lands in. When
 * two organizations hold stores with the same (platform, shop_domain), the
 * domain cannot identify the tenant; persisting into an arbitrary match would
 * blend two merchants' commerce data. Resolution must fail closed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const state = { rows: [] };
const seenQueries = [];
const db = require.resolve('../configs/database');
require.cache[db] = {
  id: db,
  filename: db,
  loaded: true,
  exports: {
    prisma: {
      stores: {
        findMany: async (query) => {
          seenQueries.push(query);
          const where = query?.where || {};
          const candidates = where.shop_domain?.in || [where.shop_domain];
          return state.rows.filter((row) =>
            row.platform === where.platform &&
            candidates.includes(row.shop_domain) &&
            row.status !== 'deleted');
        },
      },
    },
  },
};

const { findStore } = require('../services/commerceWebhookService');

test('a single matching store resolves', async () => {
  state.rows = [{ id: 'store-a', platform: 'shopify', shop_domain: 'a.myshopify.com', status: 'active', organization_id: 'org-1' }];
  seenQueries.length = 0;
  const store = await findStore('shopify', 'A.myshopify.com ');
  assert.equal(store.id, 'store-a');
  assert.equal(seenQueries[0].where.status.not, 'deleted');
  assert.deepEqual(seenQueries[0].where.shop_domain.in, ['a.myshopify.com', 'https://a.myshopify.com']);
});

test('no matching store resolves to null', async () => {
  state.rows = [];
  seenQueries.length = 0;
  assert.equal(await findStore('shopify', 'missing.myshopify.com'), null);
});

test('the domain cannot select between two organizations (cross-merchant collision)', async () => {
  state.rows = [
    { id: 'store-org-1', platform: 'shopify', shop_domain: 'revluma-test-store.myshopify.com', status: 'active', organization_id: 'org-1' },
    { id: 'store-org-2', platform: 'shopify', shop_domain: 'revluma-test-store.myshopify.com', status: 'active', organization_id: 'org-2' },
  ];
  await assert.rejects(
    findStore('shopify', 'revluma-test-store.myshopify.com'),
    (error) => error.code === 'WEBHOOK_STORE_AMBIGUOUS');
});

test('one active match plus a deleted duplicate still resolves (deleted rows are excluded)', async () => {
  state.rows = [
    { id: 'store-live', platform: 'shopify', shop_domain: 'dup.myshopify.com', status: 'active', organization_id: 'org-1' },
    { id: 'store-gone', platform: 'shopify', shop_domain: 'dup.myshopify.com', status: 'deleted', organization_id: 'org-2' },
  ];
  const store = await findStore('shopify', 'dup.myshopify.com');
  assert.equal(store.id, 'store-live');
});

test('protocol-prefixed stored domain resolves from a scheme-stripped provider header (woocommerce)', async () => {
  state.rows = [{ id: 'store-woo', platform: 'woocommerce', shop_domain: 'https://revluma.local', status: 'active', organization_id: 'org-woo' }];
  const store = await findStore('woocommerce', 'revluma.local');
  assert.equal(store.id, 'store-woo');
});

test('scheme-prefixed header resolves the bare stored domain', async () => {
  state.rows = [{ id: 'store-woo-2', platform: 'woocommerce', shop_domain: 'shop.local', status: 'active', organization_id: 'org-woo-2' }];
  const store = await findStore('woocommerce', 'https://shop.local');
  assert.equal(store.id, 'store-woo-2');
});
test('cross-scheme variants of the same domain in two organizations fail closed', async () => {
  state.rows = [
    { id: 'store-a', platform: 'shopify', shop_domain: 'revluma-test-store.myshopify.com', status: 'active', organization_id: 'org-1' },
    { id: 'store-b', platform: 'shopify', shop_domain: 'https://revluma-test-store.myshopify.com', status: 'active', organization_id: 'org-2' },
  ];
  await assert.rejects(
    findStore('shopify', 'revluma-test-store.myshopify.com'),
    (error) => error.code === 'WEBHOOK_STORE_AMBIGUOUS');
});
