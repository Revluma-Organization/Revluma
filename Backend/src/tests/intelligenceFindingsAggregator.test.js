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
    return { source: 'shopify_verified_history_v1', source_run_id: 'run-1', customer_lifetime_verified: false };
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
  assert.ok(result.diagnostics.some(item => item.status === 'customer_lifetime_history_unverified'));
  assert.ok(result.diagnostics.some(item => item.status === 'checkout_funnel_coverage_unverified'));
});

test('revenue detection excludes cancelled orders and subtracts refunds', async () => {
  const db = fakeDb();
  db.intelligence_order_coverage.findFirst = async () => ({ source: 'shopify_verified_history_v1', source_run_id: 'run-1', customer_lifetime_verified: true });
  db.orders.findMany = async () => {
    const rows = [];
    for (let i = 0; i < 10; i++) {
      rows.push({ customer_id: `prev-${i}`, total: 200, currency: 'USD', ordered_at: new Date('2026-10-15T12:00:00Z') });
      rows.push({ customer_id: `curr-${i}`, total: 100, currency: 'USD', ordered_at: new Date('2026-10-24T12:00:00Z') });
    }
    // $9 000 cancelled current-period revenue that must NOT count.
    for (let i = 0; i < 3; i++) {
      rows.push({ customer_id: `cancelled-${i}`, total: 3000, currency: 'USD', ordered_at: new Date('2026-10-24T15:00:00Z'), recovery_status: 'cancelled', refunded_total: 0 });
    }
    // A $400 order fully refunded must count as 0 net, not 400 gross.
    rows.push({ customer_id: 'refunded-1', total: 400, currency: 'USD', ordered_at: new Date('2026-10-24T16:00:00Z'), recovery_status: 'paid', refunded_total: 400 });
    return rows;
  };
  db.orders.groupBy = async () => [];
  const result = await evaluateOrganizationFindings(db, 'org-1', { now: '2026-10-27T11:00:00Z', periodDays: 7 });
  const revenue = result.findings.find(f => f.type === 'revenue_change');
  assert.ok(revenue, 'revenue_change finding expected');
  // Current: 10 × 100 (net 1000) + 400-400 (0) = 1000. Previous: 10 × 200 = 2000.
  assert.equal(revenue.evidence.currentRevenue, 1000);
  assert.equal(revenue.evidence.previousRevenue, 2000);
  assert.equal(revenue.evidence.currentCount, 11);
});

test('refund detector aggregates successful transactions by refund date with complete refund sync', async () => {
  const db = fakeDb();
  db.intelligence_order_coverage.findFirst = async () => ({ source: 'shopify_verified_history_v1', source_run_id: 'run-1', customer_lifetime_verified: false });
  db.store_sync_domain_states = { findFirst: async args => {
    assert.equal(args.where.domain, 'refunds');
    assert.equal(args.where.pagination_complete, true);
    return { id: 'refund-sync-1', last_succeeded_at: new Date('2026-10-27T10:00:00Z') };
  } };
  db.order_transactions = { findMany: async () => [
    { external_id: 'r1', amount: 100, currency: 'USD', processed_at: new Date('2026-10-15T12:00:00Z') },
    { external_id: 'r2', amount: 100, currency: 'USD', processed_at: new Date('2026-10-16T12:00:00Z') },
    { external_id: 'r3', amount: 200, currency: 'USD', processed_at: new Date('2026-10-24T12:00:00Z') },
    { external_id: 'r4', amount: 200, currency: 'USD', processed_at: new Date('2026-10-25T12:00:00Z') },
  ] };
  const result = await evaluateOrganizationFindings(db, 'org-1', { now: '2026-10-27T11:00:00Z', periodDays: 7 });
  const refund = result.findings.find(f => f.type === 'refund_increase');
  assert.equal(refund.evidence.currentRefundTotal, 400);
  assert.equal(refund.evidence.previousRefundTotal, 200);
  assert.equal(refund.evidence.refund_sync_run_id, 'refund-sync-1');
  assert.equal(refund.evidence.coverage_run_id, 'run-1');
});

test('refund finding is withheld when refund synchronization is not certified complete', async () => {
  const db = fakeDb();
  db.intelligence_order_coverage.findFirst = async () => ({ source: 'shopify_verified_history_v1', source_run_id: 'run-1', customer_lifetime_verified: false });
  db.store_sync_domain_states = { findFirst: async () => null };
  db.order_transactions = { findMany: async () => { throw new Error('Transactions must not be queried without refund coverage'); } };
  const result = await evaluateOrganizationFindings(db, 'org-1', { now: '2026-10-27T11:00:00Z' });
  assert.equal(result.findings.some(f => f.type === 'refund_increase'), false);
  assert.ok(result.diagnostics.some(item => item.status === 'refund_history_completeness_unverified'));
});
