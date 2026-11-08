'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchBusinessHealthBundle, computeReportingPeriod } = require('./businessHealthRepository');

const NOW = new Date('2026-11-07T12:00:00.000Z');
const DAY = 86400000;

const OWNED = {
  id: 'store-owned', organization_id: 'org-owned', platform: 'shopify', shop_domain: 'x.myshopify.com',
  status: 'active', granted_scopes: 'read_orders,read_products,read_inventory,read_locations,read_customers,read_legal_policies,read_online_store_navigation',
  last_synced_at: new Date('2026-11-07T11:00:00Z'), installed_at: new Date('2026-11-01T00:00:00Z'),
  updated_at: new Date('2026-11-07T11:00:00Z'), integration_state: 'connected', integration_reason_code: 'ALL_VERIFIED',
};
// All canonical sync domains fresh-succeeded + fully paginated (-> connected).
const DOMAINS = ['store_domains', 'products', 'variants', 'orders', 'refunds', 'inventory', 'webhooks', 'locations', 'transactions', 'fulfillments', 'customers', 'abandoned_checkouts'];
function domainRow(domain) {
  return { store_id: 'store-owned', domain, status: 'succeeded', last_succeeded_at: new Date('2026-11-07T11:00:00Z'), last_attempted_at: new Date('2026-11-07T11:00:00Z'), retry_count: 0, records_discovered: 5, records_inserted: 5, records_updated: 0, pages_completed: 1, pagination_complete: true, error_code: null };
}

function makePrisma(over = {}) {
  const calls = [];
  const rec = (name, fn) => async (args) => { calls.push({ name, args }); return fn ? fn(args) : []; };
  const prisma = {
    stores: {
      findFirst: rec('stores.findFirst', (a) => (a.where.organization_id === 'org-owned' && a.where.id === 'store-owned') ? OWNED : null),
      findMany: rec('stores.findMany', (a) => (a.where.organization_id === 'org-owned') ? [OWNED] : []),
    },
    store_profiles: { findFirst: rec('store_profiles.findFirst', () => ({ iana_timezone: 'America/New_York', currency_code: 'USD' })) },
    orders: { aggregate: rec('orders.aggregate', () => ({ _sum: { total: 100, refunded_total: 10, discount_amount: 5, subtotal: 95 }, _count: { _all: 4 } })) },
    abandoned_carts: { aggregate: rec('abandoned_carts.aggregate', () => ({ _count: { _all: 2 }, _sum: { cart_value: 100 } })) },
    products: { groupBy: rec('products.groupBy', () => [{ stock_status: 'instock', _count: { _all: 10 } }, { stock_status: 'outofstock', _count: { _all: 2 } }]) },
    inventory_levels: { aggregate: rec('inventory_levels.aggregate', () => ({ _max: { synced_at: new Date('2026-11-07T11:00:00Z') } })) },
    store_sync_domain_states: { findMany: rec('store_sync_domain_states.findMany', () => DOMAINS.map(domainRow)) },
    webhook_registrations: { findMany: rec('webhook_registrations.findMany', () => []) },
    webhook_deliveries: { findMany: rec('webhook_deliveries.findMany', () => []) },
    intelligence_order_coverage: { findMany: rec('intelligence_order_coverage.findMany', () => []) },
    ...over,
  };
  return { prisma, calls };
}

test('tenant isolation: store not in org -> null (no existence leak)', async () => {
  const { prisma } = makePrisma();
  const bundle = await fetchBusinessHealthBundle(prisma, 'org-other', 'store-owned', NOW);
  assert.equal(bundle, null);
});

test('cross-tenant store id -> null', async () => {
  const { prisma } = makePrisma();
  const bundle = await fetchBusinessHealthBundle(prisma, 'org-owned', 'store-other-tenant', NOW);
  assert.equal(bundle, null);
});

test('bundle: store + reporting period (timezone from profile, rolling windows)', async () => {
  const { prisma } = makePrisma();
  const bundle = await fetchBusinessHealthBundle(prisma, 'org-owned', 'store-owned', NOW);
  assert.equal(bundle.store.id, 'store-owned');
  assert.equal(bundle.store.iana_timezone, 'America/New_York');
  assert.equal(bundle.store.currency_code, 'USD');
  const rp = bundle.reportingPeriod;
  assert.equal(rp.timezone, 'America/New_York');
  assert.equal(rp.period_basis, 'rolling_7d_utc');
  assert.ok(new Date(rp.current.end) - new Date(rp.current.start) === 7 * DAY);
  assert.ok(new Date(rp.comparison.end) - new Date(rp.comparison.start) === 7 * DAY);
  assert.equal(new Date(rp.comparison.end).toISOString(), new Date(rp.current.start).toISOString());
});

test('orders aggregate scoped to store_id + ordered_at window (not created_at)', async () => {
  const { prisma, calls } = makePrisma();
  await fetchBusinessHealthBundle(prisma, 'org-owned', 'store-owned', NOW);
  const aggCalls = calls.filter((c) => c.name === 'orders.aggregate');
  assert.ok(aggCalls.length >= 2); // current + comparison
  for (const call of aggCalls) {
    assert.equal(call.args.where.store_id, 'store-owned');
    assert.ok(call.args.where.ordered_at, 'windowed on ordered_at');
    assert.equal(call.args.where.customer_id, undefined);
  }
});

test('revenue net from orders.total (authoritative net); gross = net + refunds', async () => {
  const { prisma } = makePrisma();
  const bundle = await fetchBusinessHealthBundle(prisma, 'org-owned', 'store-owned', NOW);
  const cur = bundle.revenue.current;
  assert.equal(cur.net, 100);
  assert.equal(cur.refunds, 10);
  assert.equal(cur.gross, 110); // 100 + 10
  assert.equal(cur.order_count, 4);
});

test('product snapshot: in-stock / out-of-stock / total', async () => {
  const { prisma } = makePrisma();
  const bundle = await fetchBusinessHealthBundle(prisma, 'org-owned', 'store-owned', NOW);
  const snap = bundle.productAvailability.snapshot;
  assert.equal(snap.available_count, 10);
  assert.equal(snap.out_of_stock_count, 2);
  assert.equal(snap.total_products, 12);
  assert.equal(snap.snapshot_only, true);
});

test('Command Center reuses its already-evaluated canonical integration state', async () => {
  const { prisma } = makePrisma();
  const canonical = { contract_version: 'rev-integration-state-v1', overall_status: 'connected' };
  const bundle = await fetchBusinessHealthBundle(prisma, 'org-owned', 'store-owned', NOW, canonical);
  assert.equal(bundle.integration, canonical);
});

test('integration state is the canonical contract (composed, not re-derived)', async () => {
  const { prisma } = makePrisma();
  const bundle = await fetchBusinessHealthBundle(prisma, 'org-owned', 'store-owned', NOW);
  assert.ok(bundle.integration, 'integration state present');
  assert.equal(bundle.integration.contract_version, 'rev-integration-state-v1');
  assert.equal(typeof bundle.integration.overall_status, 'string');
});

// ── Graceful partial responses (scenario I) ────────────────────────────────
test('partial failure: orders.aggregate throws -> revenue null, product still fetched', async () => {
  const { prisma: p2 } = makePrisma();
  p2.orders.aggregate = async () => { throw new Error('db down'); };
  const bundle = await fetchBusinessHealthBundle(p2, 'org-owned', 'store-owned', NOW);
  assert.equal(bundle.revenue, null);
  assert.equal(bundle.orders, null);
  assert.ok(bundle.productAvailability, 'product indicator unaffected by order failure');
  assert.ok(bundle.checkouts, 'checkouts unaffected by order failure');
});

test('partial failure: products.groupBy throws -> product null, revenue still fetched', async () => {
  const { prisma: p } = makePrisma();
  p.products.groupBy = async () => { throw new Error('db down'); };
  const bundle = await fetchBusinessHealthBundle(p, 'org-owned', 'store-owned', NOW);
  assert.equal(bundle.productAvailability, null);
  assert.ok(bundle.revenue, 'revenue unaffected by product failure');
});

test('requires an organization id', async () => {
  const { prisma } = makePrisma();
  await assert.rejects(() => fetchBusinessHealthBundle(prisma, null, 'store-owned', NOW), /organization/);
});

test('computeReportingPeriod: no profile -> UTC', () => {
  const rp = computeReportingPeriod(null, NOW);
  assert.equal(rp.timezone, 'UTC');
});
