'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validatedRows, persistInventoryObservation } = require('../services/shopifyInventoryHistory');

const store = { id: '11111111-1111-4111-8111-111111111111', organization_id: '22222222-2222-4222-8222-222222222222' };
const observation = {
  storeId: store.id, observedAt: '2026-10-28T12:00:00.000Z',
  source: 'shopify_admin_graphql', scopeVerified: true,
  catalogPaginationComplete: true, variantPaginationComplete: true,
  products: [{ productId: 'gid://shopify/Product/1', title: 'Product', status: 'ACTIVE',
    variants: [{ variantId: 'gid://shopify/ProductVariant/1', title: 'Default',
      availableForSale: false, inventoryQuantity: 0, inventoryPolicy: 'DENY' }] }],
};
test('rejects unverified observations before touching database', async () => {
  for (const patch of [{ scopeVerified: false }, { catalogPaginationComplete: false }, { variantPaginationComplete: false }]) {
    await assert.rejects(() => persistInventoryObservation({}, store, { ...observation, ...patch }), /Incomplete inventory observation/);
  }
});
test('rejects duplicate variant IDs', () => {
  const repeated = { ...observation, products: [{ ...observation.products[0], variants: [
    observation.products[0].variants[0], observation.products[0].variants[0],
  ] }] };
  assert.throws(() => validatedRows(store, repeated), /Invalid or duplicate/);
});
test('persists run and variant rows in one transaction after ownership verification', async () => {
  let committed = false;
  let createdRun, createdRows;
  const tx = {
    stores: { findFirst: async () => ({ id: store.id }) },
    shopify_inventory_observation_runs: { create: async ({ data }) => { createdRun = data; } },
    shopify_inventory_observations: { createMany: async ({ data }) => { createdRows = data; } },
  };
  const prisma = { $transaction: async fn => { const result = await fn(tx); committed = true; return result; } };
  const result = await persistInventoryObservation(prisma, store, observation);
  assert.equal(committed, true);
  assert.equal(result.variantCount, 1);
  assert.equal(createdRun.id, result.runId);
  assert.equal(createdRows[0].observation_id, result.runId);
  assert.equal(createdRows[0].organization_id, store.organization_id);
});
test('rejects mismatched tenant before writing observation run', async () => {
  let wrote = false;
  const tx = {
    stores: { findFirst: async () => null },
    shopify_inventory_observation_runs: { create: async () => { wrote = true; } },
  };
  await assert.rejects(() => persistInventoryObservation({ $transaction: fn => fn(tx) }, store, observation), /ownership invalid/);
  assert.equal(wrote, false);
});
