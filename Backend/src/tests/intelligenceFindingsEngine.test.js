'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectIntegrationFailure, detectRevenueChange, detectOrderVolumeChange, detectReturningCustomerChange, prioritizeFindings } = require('../services/intelligenceFindingsEngine');
const scope = { organizationId: 'org-1', storeId: 'store-1' };
const period = {
  verified: true, complete: true, currency: 'USD',
  previousStart: '2026-10-01T00:00:00Z', previousEnd: '2026-10-08T00:00:00Z',
  currentStart: '2026-10-08T00:00:00Z', currentEnd: '2026-10-15T00:00:00Z',
  previousCount: 30, currentCount: 30,
};
test('integration failure uses real store status and scoped store ID', () => {
  const store = { id: 'store-1', status: 'connected', setup_status: 'failed', sync_status: 'pending' };
  const result = detectIntegrationFailure({ scope, store });
  assert.equal(result.type, 'integration_failure');
  assert.equal(result.evidence.setup_status, 'failed');
  assert.equal(detectIntegrationFailure({ scope, store: { ...store, id: 'other' } }), null);
  assert.equal(detectIntegrationFailure({ scope, store: { ...store, setup_status: 'succeeded' } }), null);
});
test('revenue change requires verified complete same-currency order windows', () => {
  const evidence = { ...period, previousRevenue: 1000, currentRevenue: 650 };
  assert.equal(detectRevenueChange({ scope, evidence }).evidence.delta_pct, -35);
  assert.equal(detectRevenueChange({ scope, evidence: { ...evidence, verified: false } }), null);
  assert.equal(detectRevenueChange({ scope, evidence: { ...evidence, currentCount: 2 } }), null);
  assert.equal(detectRevenueChange({ scope, evidence: { ...evidence, currentRevenue: 900 } }), null);
  assert.equal(detectRevenueChange({ scope, evidence: { ...evidence, currentEnd: '2026-10-14T00:00:00Z' } }), null);
  assert.equal(detectRevenueChange({ scope, evidence: { ...evidence, previousRevenue: 0 } }), null);
});
test('returning-customer finding uses percentage points and sufficient unique buyers', () => {
  const evidence = { ...period, previousCount: 40, currentCount: 40, previousReturning: 24, currentReturning: 12 };
  const result = detectReturningCustomerChange({ scope, evidence });
  assert.equal(result.evidence.change_percentage_points, -30);
  assert.equal(result.severity, 'high');
  assert.equal(result.action.route, '/dashboard');
  assert.match(result.action.measurement, /returning-buyer purchase share/);
  assert.equal(detectReturningCustomerChange({ scope, evidence: { ...evidence, currentReturning: 41 } }), null);
  assert.equal(detectReturningCustomerChange({ scope, evidence: { ...evidence, currentReturning: 23 } }), null);
});
test('findings have deterministic dedupe keys and severity ordering', () => {
  const integration = detectIntegrationFailure({ scope, store: { id: 'store-1', status: 'failed' } });
  const revenue = detectRevenueChange({ scope, evidence: { ...period, previousRevenue: 1000, currentRevenue: 1500 } });
  const ranked = prioritizeFindings([revenue, null, integration]);
  assert.equal(ranked[0].type, 'integration_failure');
  assert.equal(ranked.length, 2);
  assert.ok(revenue.dedupe_key.includes('revenue_change'));
});
test('order-volume findings require verified comparable complete periods', () => {
  const evidence = { ...period, previousCount: 40, currentCount: 20 };
  const result = detectOrderVolumeChange({ scope, evidence });
  assert.equal(result.type, 'order_volume_change');
  assert.equal(result.severity, 'high');
  assert.equal(result.evidence.delta_pct, -50);
  assert.equal(result.action.route, '/dashboard');
  assert.match(result.action.measurement, /completed-order counts/);
  assert.equal(detectOrderVolumeChange({ scope, evidence: { ...evidence, complete: false } }), null);
  assert.equal(detectOrderVolumeChange({ scope, evidence: { ...evidence, previousCount: 0 } }), null);
  assert.equal(detectOrderVolumeChange({ scope, evidence: { ...evidence, currentCount: 2 } }), null);
  assert.equal(detectOrderVolumeChange({ scope, evidence: { ...evidence, currentCount: 20.5 } }), null);
  assert.equal(detectOrderVolumeChange({ scope, evidence: { ...evidence, previousEnd: '2026-10-07T00:00:00Z' } }), null);
});
