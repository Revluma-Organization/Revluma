'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextConnectionCursor, fetchConnection, verifyOrderReadScope, orderPayload, evaluateCartWithDeadline } = require('../services/shopifySync');

test('pagination finishes only with an explicit terminal page', () => {
  assert.equal(nextConnectionCursor({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, null, 'orders'), null);
  assert.equal(nextConnectionCursor({ nodes: [{ id: 1 }], pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } }, null, 'orders'), 'cursor-1');
});
test('rejects malformed, cursorless, and stalled Shopify pages', () => {
  for (const connection of [
    null, {}, { nodes: [], pageInfo: {} },
    { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } },
    { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'same' } },
  ]) {
    assert.throws(() => nextConnectionCursor(connection, 'same', 'orders'), /pagination_(invalid|stalled)/);
  }
});

test('multi-page Shopify sync preserves all fetched records in order', async () => {
  const cursors = [];
  const fetchPage = async (_store, _query, { after }) => {
    cursors.push(after);
    return { orders: after === null
      ? { nodes: [{ id: 'a' }], pageInfo: { hasNextPage: true, endCursor: 'next' } }
      : { nodes: [{ id: 'b' }], pageInfo: { hasNextPage: false, endCursor: 'next' } } };
  };
  const rows = await fetchConnection({}, '', 'orders', fetchPage);
  assert.deepEqual(rows.map(row => row.id), ['a', 'b']);
  assert.deepEqual(cursors, [null, 'next']);
});
test('Shopify sync rejects cursor stall without silently truncating records', async () => {
  const fetchPage = async () => ({ orders: { nodes: [{ id: 'a' }],
    pageInfo: { hasNextPage: true, endCursor: 'same' } } });
  await assert.rejects(fetchConnection({}, '', 'orders', fetchPage), /pagination_stalled/);
});

test('order permission gate rejects missing and unverified read_orders', async () => {
  await assert.rejects(
    verifyOrderReadScope({}, async () => ({ currentAppInstallation: { accessScopes: [{ handle: 'read_customers' }] } })),
    { code: 'SHOPIFY_READ_ORDERS_NOT_GRANTED' },
  );
  await assert.rejects(
    verifyOrderReadScope({}, async () => ({})),
    { code: 'SHOPIFY_SCOPES_UNVERIFIED' },
  );
  const result = await verifyOrderReadScope({}, async () => ({
    currentAppInstallation: { accessScopes: [{ handle: 'read_orders' }] },
  }));
  assert.deepEqual(result, { readOrders: true, readAllOrders: false });
});
test('order import prefers Shopify adjusted total over original total', () => {
  const payload = orderPayload({
    id: 'gid://shopify/Order/123', createdAt: '2026-10-01T00:00:00Z',
    currentTotalPriceSet: { shopMoney: { amount: '70.00', currencyCode: 'NGN' } },
    totalPriceSet: { shopMoney: { amount: '100.00', currencyCode: 'NGN' } },
    lineItems: { nodes: [] },
  });
  assert.equal(payload.total_price, 70);
  assert.equal(payload.currency, 'NGN');
});


test('Shopify sync refuses unbounded pagination rather than claiming partial success', async () => {
  let calls = 0;
  const fetchPage = async () => {
    calls += 1;
    return { orders: { nodes: [{ id: calls }], pageInfo: { hasNextPage: true, endCursor: String(calls) } } };
  };
  await assert.rejects(fetchConnection({}, '', 'orders', fetchPage), { code: 'SHOPIFY_PAGINATION_LIMIT_EXCEEDED' });
  assert.equal(calls, 100);
});


test('optional ML prediction timeout does not block Shopify checkout ingestion', async () => {
  const started = Date.now();
  await evaluateCartWithDeadline(() => new Promise(() => {}), 'store-test', 'cart-test', 15);
  assert.ok(Date.now() - started < 1000, 'deadline should return promptly');
});

test('optional ML prediction rejection is contained', async () => {
  await assert.doesNotReject(evaluateCartWithDeadline(async () => {
    throw Object.assign(new Error('prediction unavailable'), { code: 'PREDICTION_UNAVAILABLE' });
  }, 'store-test', 'cart-test', 100));
});

test('order import does not invent USD when Shopify omits currency', () => {
  const payload = orderPayload({
    id: 'gid://shopify/Order/124', createdAt: '2026-10-01T00:00:00Z',
    currentTotalPriceSet: { shopMoney: { amount: '12.34' } },
    lineItems: { nodes: [] },
  });
  assert.equal(payload.total_price, 12.34);
  assert.equal(payload.currency, null);
});
test('order import does not turn a missing money amount into zero', () => {
  const payload = orderPayload({
    id: 'gid://shopify/Order/125', createdAt: '2026-10-01T00:00:00Z',
    currentTotalPriceSet: null, totalPriceSet: null,
    lineItems: { nodes: [] },
  });
  assert.equal(payload.total_price, null);
  assert.equal(payload.currency, null);
});
