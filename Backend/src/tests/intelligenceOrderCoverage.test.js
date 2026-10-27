'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TRUSTED_SOURCE, validateCoverageManifest, certifyOrderCoverage } = require('../services/intelligenceOrderCoverage');
const manifest = () => ({
  source: TRUSTED_SOURCE,
  organizationId: '11111111-1111-4111-8111-111111111111',
  storeId: '22222222-2222-4222-8222-222222222222',
  runId: 'verified-run-20261027',
  start: new Date('2026-09-01T00:00:00Z'),
  end: new Date('2026-10-01T00:00:00Z'),
  paginationComplete: true, orderReadScopeVerified: true,
  historicalAccessVerified: true, refundsAndCancellationsReconciled: true,
  persistedOrdersVerified: true, noKnownIngestionGaps: true,
  customerLifetimeVerified: false,
});
test('coverage issuer rejects every missing historical proof', () => {
  for (const key of ['paginationComplete', 'orderReadScopeVerified', 'historicalAccessVerified',
    'refundsAndCancellationsReconciled', 'persistedOrdersVerified', 'noKnownIngestionGaps']) {
    const invalid = { ...manifest(), [key]: false };
    assert.throws(() => validateCoverageManifest(invalid), /cannot be certified/);
  }
  assert.throws(() => validateCoverageManifest({ ...manifest(), customerLifetimeVerified: true }), /cannot be certified/);
  assert.throws(() => validateCoverageManifest({ ...manifest(), source: 'generic_shopify_sync' }), /cannot be certified/);
});
test('coverage issuer verifies tenant ownership before persisting', async () => {
  let writes = 0;
  const db = { stores: { findFirst: async () => null }, intelligence_order_coverage: {
    upsert: async () => { writes++; },
  } };
  await assert.rejects(certifyOrderCoverage(db, manifest()), /ownership/);
  assert.equal(writes, 0);
});
test('verified manifest records bounded coverage without lifetime certification', async () => {
  let recorded;
  const db = { stores: { findFirst: async () => ({ id: manifest().storeId }) },
    intelligence_order_coverage: { upsert: async args => { recorded = args; return args.create; } } };
  await certifyOrderCoverage(db, manifest());
  assert.equal(recorded.create.customer_lifetime_verified, false);
  assert.equal(recorded.where.store_id, manifest().storeId);
});
