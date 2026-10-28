const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMerchantContext } = require('../services/revMerchantContext');

test('context filters unverified and out-of-scope findings', async () => {
  const db = {
    stores: { findMany: async query => {
      assert.equal(query.where.organization_id, 'org-a');
      return [{ id: 'store-a', platform: 'shopify', status: 'active' }];
    }},
    intelligence_findings: { findMany: async query => {
      assert.equal(query.where.organization_id, 'org-a');
      return [
        { id: 'a', store_id: 'store-a', evidence: { verified: true } },
        { id: 'b', store_id: 'store-a', evidence: { verified: false } },
        { id: 'c', store_id: 'store-b', evidence: { verified: true } },
      ];
    }},
  };
  const context = await buildMerchantContext(db, 'org-a');
  assert.deepEqual(context.verified_findings.map(f => f.id), ['a']);
  assert.equal(context.stores.length, 1);
});

test('context rejects missing organization', async () => {
  await assert.rejects(buildMerchantContext({}, null), /organizationId/);
});
