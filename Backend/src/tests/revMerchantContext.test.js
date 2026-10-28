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
        { id: 'a', store_id: 'store-a', evidence: { verified: true, currentCount: 7, customer_email: 'private@example.com' } },
        { id: 'b', store_id: 'store-a', evidence: { verified: false } },
        { id: 'c', store_id: 'store-b', evidence: { verified: true } },
      ];
    }},
  };
  const context = await buildMerchantContext(db, 'org-a');
  assert.equal(context.verified_findings.length, 1);
  assert.ok(context.verified_findings[0].startsWith('finding | a |'));
  assert.equal(context.stores.length, 1);
  assert.match(context.verified_findings[0], /currentCount/);
  assert.doesNotMatch(JSON.stringify(context), /private@example.com/);
  assert.ok(Buffer.byteLength(JSON.stringify({ merchant_context: context })) < 16 * 1024);
});

test('context rejects missing organization', async () => {
  await assert.rejects(buildMerchantContext({}, null), /organizationId/);
});

test('context remains below gateway limit with maximum selected records', async () => {
  const id = 'a'.repeat(36);
  const db = {
    stores: { findMany: async () => Array.from({ length: 20 }, () => ({
      id, platform: 'shopify', status: 'active', last_synced_at: null,
    })) },
    intelligence_findings: { findMany: async () => Array.from({ length: 10 }, (_, i) => ({
      id: String(i), store_id: id, type: 'revenue_change', severity: 'high',
      evidence: { verified: true, currentCount: 100, previousCount: 50 },
    })) },
  };
  const context = await buildMerchantContext(db, 'org-a');
  assert.equal(context.stores.length, 8);
  assert.equal(context.verified_findings.length, 5);
  assert.ok(Buffer.byteLength(JSON.stringify({ merchant_context: context })) < 16 * 1024);
  assert.equal(typeof context.verified_findings[0], 'string');
});
