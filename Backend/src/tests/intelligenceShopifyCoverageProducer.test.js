'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const { verifyShopifyOrderCoverage } = require('../services/intelligenceShopifyCoverageProducer');

const start = '2026-10-13T00:00:00.000Z';
const shop = { id: '22222222-2222-4222-8222-222222222222',
  organization_id: '11111111-1111-4111-8111-111111111111',
  platform: 'shopify', access_token: 'encrypted' };
const source = [{ id: 'gid://shopify/Order/1001', createdAt: '2026-10-20T12:00:00Z',
  cancelledAt: null, displayFinancialStatus: 'REFUNDED',
  currentTotalPriceSet: { shopMoney: { amount: '0.00', currencyCode: 'USD' } } }];
function fixture({ rows = [{ external_order_id: '1001', total: 0, currency: 'USD' }],
  orders = source, gaps = 0 } = {}) {
  let certificates = 0;
  const db = {
    orders: { findMany: async () => rows },
    webhook_deliveries: { count: async () => gaps },
    stores: { findFirst: async () => ({ id: shop.id }) },
    intelligence_order_coverage: { upsert: async args => { certificates++; return args.create; } },
  };
  const graphql = async () => ({ currentAppInstallation: { accessScopes: [{ handle: 'read_orders' }] } });
  const fetchPages = async (_store, query) => {
    assert.match(query, /created_at/);
    return orders;
  };
  return { db, graphql, fetchPages, get certificates() { return certificates; } };
}
test('certifies matching refund-adjusted source and local orders', async () => {
  const f = fixture();
  const result = await verifyShopifyOrderCoverage(f.db, shop, {
    now: new Date('2026-10-27T12:00:00Z'), graphql: f.graphql, fetchPages: f.fetchPages,
  });
  assert.equal(result.customer_lifetime_verified, false);
  assert.equal(f.certificates, 1);
});
test('fails closed on missing order, stale refund, unresolved webhook, and cancelled source', async () => {
  for (const opts of [
    { rows: [] }, { rows: [{ external_order_id: '1001', total: 100, currency: 'USD' }] },
    { gaps: 1 }, { orders: [{ ...source[0], cancelledAt: '2026-10-21T00:00:00Z' }] },
  ]) {
    const f = fixture(opts);
    await assert.rejects(verifyShopifyOrderCoverage(f.db, shop, {
      now: new Date('2026-10-27T12:00:00Z'), graphql: f.graphql, fetchPages: f.fetchPages,
    }), /verification incomplete/);
    assert.equal(f.certificates, 0);
  }
});
test('does not certify if Shopify granted scopes cannot be verified', async () => {
  const f = fixture();
  await assert.rejects(verifyShopifyOrderCoverage(f.db, shop, {
    now: new Date('2026-10-27T12:00:00Z'),
    graphql: async () => ({ currentAppInstallation: { accessScopes: [] } }),
    fetchPages: f.fetchPages,
  }), /read_orders/);
  assert.equal(f.certificates, 0);
});

test('uses exact decimal comparison for high-value Shopify coverage', async () => {
  const order = {
    id: 'gid://shopify/Order/1002', createdAt: '2026-10-20T12:00:00Z',
    cancelledAt: null, displayFinancialStatus: 'PAID',
    currentTotalPriceSet: { shopMoney: { amount: '90000000.13', currencyCode: 'USD' } },
  };
  const f = fixture({
    orders: [order],
    rows: [{ external_order_id: '1002', total: new Prisma.Decimal('90000000.13'), currency: 'USD' }],
  });
  await verifyShopifyOrderCoverage(f.db, shop, {
    now: new Date('2026-10-27T12:00:00Z'), graphql: f.graphql, fetchPages: f.fetchPages,
  });
  assert.equal(f.certificates, 1);
});

test('rejects source monetary precision unsupported by DECIMAL(10,2)', async () => {
  const order = {
    ...source[0],
    currentTotalPriceSet: { shopMoney: { amount: '1.234', currencyCode: 'USD' } },
  };
  const f = fixture({ orders: [order], rows: [] });
  await assert.rejects(verifyShopifyOrderCoverage(f.db, shop, {
    now: new Date('2026-10-27T12:00:00Z'), graphql: f.graphql, fetchPages: f.fetchPages,
  }), error => error.code === 'ORDER_COVERAGE_SOURCE_FINANCIALS_UNVERIFIED');
  assert.equal(f.certificates, 0);
});

test('rejects even a one-cent persisted/source amount mismatch', async () => {
  const order = {
    ...source[0],
    currentTotalPriceSet: { shopMoney: { amount: '1.23', currencyCode: 'USD' } },
  };
  const f = fixture({
    orders: [order],
    rows: [{ external_order_id: '1001', total: new Prisma.Decimal('1.24'), currency: 'USD' }],
  });
  await assert.rejects(verifyShopifyOrderCoverage(f.db, shop, {
    now: new Date('2026-10-27T12:00:00Z'), graphql: f.graphql, fetchPages: f.fetchPages,
  }), error => error.code === 'ORDER_COVERAGE_ORDER_TOTAL_MISMATCH');
  assert.equal(f.certificates, 0);
});

test('certifies cancellation exclusion only when Shopify and persisted order states agree', async () => {
  const cancelledOrder = {
    ...source[0],
    cancelledAt: '2026-10-21T00:00:00Z',
    currentTotalPriceSet: { shopMoney: { amount: '1.23', currencyCode: 'USD' } },
  };
  const matching = fixture({
    orders: [cancelledOrder],
    rows: [{
      external_order_id: '1001', total: new Prisma.Decimal('1.23'),
      currency: 'USD', recovery_status: 'cancelled',
    }],
  });
  await verifyShopifyOrderCoverage(matching.db, shop, {
    now: new Date('2026-10-27T12:00:00Z'), graphql: matching.graphql, fetchPages: matching.fetchPages,
  });
  assert.equal(matching.certificates, 1);

  const mismatch = fixture({
    orders: [cancelledOrder],
    rows: [{
      external_order_id: '1001', total: new Prisma.Decimal('1.23'),
      currency: 'USD', recovery_status: 'completed',
    }],
  });
  await assert.rejects(verifyShopifyOrderCoverage(mismatch.db, shop, {
    now: new Date('2026-10-27T12:00:00Z'), graphql: mismatch.graphql, fetchPages: mismatch.fetchPages,
  }), error => error.code === 'ORDER_COVERAGE_ORDER_STATUS_MISMATCH');
  assert.equal(mismatch.certificates, 0);
});

test('coverage money parser rejects values outside persisted DECIMAL(10,2) range', () => {
  assert.equal(asMoney({ shopMoney: { amount: '100000000.00' } }), null);
  assert.equal(asMoney({ shopMoney: { amount: '1.234' } }), null);
});
