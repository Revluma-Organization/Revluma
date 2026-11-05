'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
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
    orders: { findMany: async () => rows.map(row => ({ ordered_at: new Date(source[0].createdAt), recovery_status: null, ...row })) },
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

test('never certifies missing or malformed Shopify money as a zero-value order', async () => {
  for (const amount of [null, undefined, '', '   ', false, {}, 'not-money']) {
    const f = fixture({ orders: [{ ...source[0], currentTotalPriceSet: { shopMoney: { amount, currencyCode: 'USD' } } }] });
    await assert.rejects(verifyShopifyOrderCoverage(f.db, shop, {
      now: new Date('2026-10-27T12:00:00Z'), graphql: f.graphql, fetchPages: f.fetchPages,
    }), { code: 'ORDER_COVERAGE_SOURCE_FINANCIALS_UNVERIFIED' });
    assert.equal(f.certificates, 0);
  }
});

test('never certifies a missing or invalid local total as a zero-value order', async () => {
  for (const total of [null, undefined, '', '  ', 'not-money']) {
    const f = fixture({ rows: [{ external_order_id: '1001', total, currency: 'USD' }] });
    await assert.rejects(verifyShopifyOrderCoverage(f.db, shop, {
      now: new Date('2026-10-27T12:00:00Z'), graphql: f.graphql, fetchPages: f.fetchPages,
    }), { code: 'ORDER_COVERAGE_ORDER_TOTAL_MISMATCH' });
    assert.equal(f.certificates, 0);
  }
});

test('certifies exact decimals without imposing a two-decimal currency assumption', async () => {
  for (const [sourceValue, localValue, matches] of [
    ['10.123', '10.124', false], ['10.1200', '10.12', true], ['0.004', '0', false],
    ['10000000000000001', '10000000000000000', false], ['1e2', '100', false],
  ]) {
    const f = fixture({ orders: [{ ...source[0], currentTotalPriceSet: { shopMoney: { amount: sourceValue, currencyCode: 'USD' } } }],
      rows: [{ external_order_id: '1001', total: localValue, currency: 'USD' }] });
    const work = verifyShopifyOrderCoverage(f.db, shop, {
      now: new Date('2026-10-27T12:00:00Z'), graphql: f.graphql, fetchPages: f.fetchPages,
    });
    if (matches) await assert.doesNotReject(work);
    else await assert.rejects(work);
    assert.equal(f.certificates, matches ? 1 : 0);
  }
});

test('cannot certify a duplicate local order in place of a missing order', async () => {
  const second = { ...source[0], id: 'gid://shopify/Order/1002' };
  const f = fixture({ orders: [source[0], second], rows: [
    { external_order_id: '1001', total: 0, currency: 'USD' },
    { external_order_id: '1001', total: 0, currency: 'USD' },
  ] });
  await assert.rejects(verifyShopifyOrderCoverage(f.db, shop, {
    now: new Date('2026-10-27T12:00:00Z'), graphql: f.graphql, fetchPages: f.fetchPages,
  }), { code: 'ORDER_COVERAGE_ORDER_TOTAL_MISMATCH' });
  assert.equal(f.certificates, 0);
});


test('does not certify an order assigned to the wrong time or excluded locally', async () => {
  for (const overrides of [
    { ordered_at: new Date('2026-10-21T12:00:00Z') }, { ordered_at: null },
    { recovery_status: 'cancelled' }, { recovery_status: 'deleted' },
  ]) {
    const f = fixture({ rows: [{ external_order_id: '1001', total: 0, currency: 'USD', ...overrides }] });
    await assert.rejects(verifyShopifyOrderCoverage(f.db, shop, {
      now: new Date('2026-10-27T12:00:00Z'), graphql: f.graphql, fetchPages: f.fetchPages,
    }), { code: 'ORDER_COVERAGE_ORDER_TOTAL_MISMATCH' });
    assert.equal(f.certificates, 0);
  }
});
