const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMerchantContext, certifiedFinding } = require('../services/revMerchantContext');
const { TRUSTED_SOURCE } = require('../services/intelligenceOrderCoverage');
const financialEvidence = () => ({ verified: true, complete: true, coverage_source: TRUSTED_SOURCE,
  coverage_run_id: 'sync-123', currency: 'USD', previousStart: '2026-10-01T00:00:00.000Z',
  previousEnd: '2026-10-08T00:00:00.000Z', currentStart: '2026-10-08T00:00:00.000Z',
  currentEnd: '2026-10-15T00:00:00.000Z', currentCount: 7, previousCount: 10,
  currentRevenue: 200, previousRevenue: 300 });

test('context filters unverified and out-of-scope findings', async () => {
  const db = {
    stores: { findMany: async query => {
      assert.equal(query.where.organization_id, 'org-a');
      return [{ id: 'store-a', platform: 'shopify', status: 'active' }];
    }},
    intelligence_findings: { findMany: async query => {
      assert.equal(query.where.organization_id, 'org-a');
      return [
        { id: 'a', type: 'revenue_change', store_id: 'store-a', evidence: { ...financialEvidence(), customer_email: 'private@example.com' } },
        { id: 'b', type: 'revenue_change', store_id: 'store-a', evidence: { verified: false } },
        { id: 'c', type: 'revenue_change', store_id: 'store-b', evidence: financialEvidence() },
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
      evidence: { ...financialEvidence(), currentCount: 100, previousCount: 50 },
    })) },
  };
  const context = await buildMerchantContext(db, 'org-a');
  assert.equal(context.stores.length, 8);
  assert.equal(context.verified_findings.length, 5);
  assert.ok(Buffer.byteLength(JSON.stringify({ merchant_context: context })) < 16 * 1024);
  assert.equal(typeof context.verified_findings[0], 'string');
});

test('financial findings fail closed without certified coverage and valid windows', () => {
  const base = { type: 'revenue_change', store_id: 'store-a', evidence: financialEvidence() };
  assert.equal(certifiedFinding(base), true);
  for (const patch of [
    { verified: false }, { complete: false }, { coverage_source: 'untrusted' },
    { coverage_run_id: '' }, { currentEnd: '2026-10-16T00:00:00.000Z' },
    { previousStart: 'invalid' }, { currentRevenue: Number.NaN }, { currency: 'US' },
  ]) assert.equal(certifiedFinding({ ...base, evidence: { ...base.evidence, ...patch } }), false);
  assert.equal(certifiedFinding({ ...base, type: 'unknown_financial_finding' }), false);
});

test('integration-health evidence remains available without financial coverage', () => {
  const finding = { type: 'integration_failure', store_id: 'store-a',
    evidence: { verified: true, source: 'stores', storeId: 'store-a' } };
  assert.equal(certifiedFinding(finding), true);
  assert.equal(certifiedFinding({ ...finding, evidence: { ...finding.evidence, storeId: 'store-b' } }), false);
});
