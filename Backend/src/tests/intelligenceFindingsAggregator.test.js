'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateOrganizationFindings } = require('../services/intelligenceFindingsAggregator');
const store = { id: 'store-1', status: 'connected', last_synced_at: new Date('2026-10-27T10:00:00Z'), platform: 'shopify', shop_domain: 'shop.example' };
function fakeDb(registrationFailures = 0) {
  let orderReads = 0;
  return {
    stores: { findMany: async args => {
      assert.equal(args.where.organization_id, 'org-1');
      return [store];
    } },
    webhook_registrations: { count: async args => {
      assert.equal(args.where.store_id, 'store-1');
      return registrationFailures;
    } },
    orders: { findMany: async () => { orderReads++; return []; }, groupBy: async () => [] },
    get orderReads() { return orderReads; },
  };
}
test('findings never query order history without verified completeness', async () => {
  const db = fakeDb();
  const result = await evaluateOrganizationFindings(db, 'org-1', { now: '2026-10-27T11:00:00Z' });
  assert.equal(db.orderReads, 0);
  assert.equal(result.findings.length, 0);
  assert.equal(result.diagnostics[0].status, 'order_history_completeness_unverified');
});
test('failed webhook produces evidence-backed integration finding', async () => {
  const db = fakeDb(8);
  const result = await evaluateOrganizationFindings(db, 'org-1', { now: '2026-10-27T11:00:00Z' });
  assert.equal(result.findings[0].type, 'integration_failure');
  assert.equal(result.findings[0].evidence.failed_webhook_registrations, 8);
  assert.equal(db.orderReads, 0);
});
