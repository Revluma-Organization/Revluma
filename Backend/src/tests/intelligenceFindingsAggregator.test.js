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
    intelligence_order_coverage: { findFirst: async args => { assert.equal(args.where.organization_id, 'org-1'); return null; } },
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

test('certified period allows revenue detection but not returning-customer claims without lifetime history', async () => {
  const db = fakeDb();
  db.intelligence_order_coverage.findFirst = async args => {
    assert.equal(args.where.organization_id, 'org-1');
    assert.equal(args.where.store_id, 'store-1');
    return { source: 'shopify_full_cursor_sync', source_run_id: 'run-1', customer_lifetime_verified: false };
  };
  db.orders.findMany = async () => {
    const rows = [];
    for (let i = 0; i < 20; i++) {
      rows.push({ customer_id: `previous-${i}`, total: 100, currency: 'USD', ordered_at: new Date('2026-10-15T12:00:00Z') });
      rows.push({ customer_id: `current-${i}`, total: 50, currency: 'USD', ordered_at: new Date('2026-10-24T12:00:00Z') });
    }
    return rows;
  };
  db.orders.groupBy = async () => { throw new Error('Lifetime history must not be queried'); };
  const result = await evaluateOrganizationFindings(db, 'org-1', { now: '2026-10-27T11:00:00Z' });
  assert.equal(result.findings[0]?.type, 'revenue_change');
  assert.equal(result.findings[0]?.evidence.delta_pct, -50);
  assert.equal(result.diagnostics[0]?.status, 'customer_lifetime_history_unverified');
});
