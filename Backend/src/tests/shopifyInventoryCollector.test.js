'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectShopifyInventory } = require('../services/shopifyInventoryCollector');
const store = { id: 'store-1', organization_id: 'org-1', platform: 'shopify' };
test('collector persists verified observation and never emits an alert', async () => {
  let called = 0;
  const observation = { storeId: store.id, source: 'shopify_admin_graphql' };
  const result = await collectShopifyInventory({}, store, {
    observe: async input => { assert.equal(input, store); called++; return observation; },
    persist: async (_db, input, observed) => {
      assert.equal(input, store); assert.equal(observed, observation); called++;
      return { runId: 'run-1', variantCount: 2 };
    },
  });
  assert.equal(called, 2);
  assert.equal(result.variantCount, 2);
  assert.equal(result.alertEligible, false);
});
test('failed observation never persists partial inventory', async () => {
  let persisted = false;
  await assert.rejects(() => collectShopifyInventory({}, store, {
    observe: async () => { throw Error('Shopify pagination incomplete'); },
    persist: async () => { persisted = true; },
  }), /pagination incomplete/);
  assert.equal(persisted, false);
});
test('unauthorized store never invokes Shopify', async () => {
  await assert.rejects(() => collectShopifyInventory({}, { ...store, organization_id: null }, {
    observe: async () => { throw Error('should not execute'); },
  }), /organization required/);
});
