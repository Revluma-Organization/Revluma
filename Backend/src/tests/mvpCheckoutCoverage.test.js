'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateOrganizationFindings } = require('../services/intelligenceFindingsAggregator');

test('certified order coverage does not silently certify checkout funnel coverage', async () => {
  const storeId = '11111111-1111-4111-8111-111111111111';
  const orgId = '22222222-2222-4222-8222-222222222222';
  const prisma = {
    stores: { findMany: async () => [{ id: storeId, status: 'active', last_synced_at: new Date('2026-10-27T12:00:00Z'), platform: 'shopify' }] },
    webhook_registrations: { count: async () => 0 },
    intelligence_order_coverage: { findFirst: async () => ({ source: 'shopify_verified_history_v1', source_run_id: 'coverage-123', customer_lifetime_verified: false }) },
    orders: { findMany: async () => [] },
  };
  const result = await evaluateOrganizationFindings(prisma, orgId, { now: new Date('2026-10-28T12:00:00Z') });
  const missing = result.diagnostics.find(item => item.status === 'checkout_funnel_coverage_unverified');
  assert.equal(missing.storeId, storeId);
  assert.ok(missing.missing_evidence.includes('complete_checkout_starts'));
  assert.equal(result.findings.some(item => /checkout/i.test(item.type)), false);
});
