'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewInventoryChanges } = require('../services/shopifyInventoryReview');
const run = (id, at) => ({
  id, observed_at: new Date(at), product_count: 1, variant_count: 1,
});
const runs = [run('run-2', '2026-10-28T10:00:00Z'), run('run-1', '2026-10-27T10:00:00Z')];
const rows = runs.map((run, i) => ({
  observation_id: run.id, product_external_id: 'p1', variant_external_id: 'v1',
  product_title: 'Example', product_status: 'ACTIVE', available_for_sale: i !== 0,
  inventory_quantity: i === 0 ? 0 : 5, inventory_policy: 'DENY',
}));
test('review isolates organization and compares verified history without alerts', async () => {
  const db = {
    stores: { findFirst: async ({ where }) => {
      assert.equal(where.organization_id, 'org-1');
      return { id: 'store-1' };
    } },
    shopify_inventory_observation_runs: { findMany: async ({ where }) => {
      assert.equal(where.organization_id, 'org-1');
      return runs;
    } },
    shopify_inventory_observations: { findMany: async ({ where }) => {
      assert.equal(where.organization_id, 'org-1');
      return rows;
    } },
  };
  const result = await reviewInventoryChanges(db, 'org-1', 'store-1');
  assert.equal(result.status, 'verified_observation_comparison');
  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0].currentAvailable, false);
  assert.equal(result.merchantAlertEligible, false);
});
test('review rejects store from another tenant', async () => {
  const db = { stores: { findFirst: async () => null } };
  await assert.rejects(() => reviewInventoryChanges(db, 'org-1', 'store-2'), /not found for organization/);
});
test('review rejects truncated persisted variant rows', async () => {
  const db = {
    stores: { findFirst: async () => ({ id: 'store-1' }) },
    shopify_inventory_observation_runs: { findMany: async () => runs },
    shopify_inventory_observations: { findMany: async () => rows.slice(0, 1) },
  };
  const result = await reviewInventoryChanges(db, 'org-1', 'store-1');
  assert.equal(result.status, 'incomplete_history');
  assert.equal(result.transitions.length, 0);
});
