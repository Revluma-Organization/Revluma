'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Stub the transport and persistence at module boundaries; no Shopify or DB
// operations are permitted in this test. The production sync paths remain real.
let response = {};
let writes = 0;
let queries = [];
let nested = null;
let orderPayloads = [];
const graphqlPath = require.resolve('../services/shopifyGraphql');
const commercePath = require.resolve('../services/commerceWebhookService');
require.cache[graphqlPath] = { id: graphqlPath, filename: graphqlPath, loaded: true, exports: {
  shopifyGraphql: async (_store, query) => {
    queries.push(query);
    if (query.includes('RevlumaNestedLines')) return nested;
    if (query.includes('RevlumaGrantedScopes')) return { currentAppInstallation: { accessScopes: [{ handle: 'read_orders' }] } };
    return response;
  },
} };
require.cache[commercePath] = { id: commercePath, filename: commercePath, loaded: true, exports: {
  upsertOrder: async (_store, _provider, payload) => { writes++; orderPayloads.push(payload); }, cancelOrder: async () => { writes++; },
  upsertAbandonedCart: async () => { writes++; return null; },
} };
const { syncOrders, syncAbandonedCheckouts, completeLineItems } = require('../services/shopifySync');
const terminal = nodes => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
const store = { id: 'test-store' };

test('nested pages require terminal metadata, valid IDs and no duplicates', async () => {
  await assert.doesNotReject(completeLineItems(store, [{ lineItems: terminal([]) }], 'Order'));
  for (const lineItems of [undefined, {}, { nodes: [] }, { nodes: [], pageInfo: { hasNextPage: true } },
    { nodes: null, pageInfo: { hasNextPage: false } },
    terminal([{ id: 'same' }, { id: 'same' }]), terminal([{}])]) {
    await assert.rejects(completeLineItems(store, [{ lineItems }], 'Order'), { code: 'SHOPIFY_LINE_ITEMS_INCOMPLETE' });
  }
});

for (const [name, sync, key] of [['orders', syncOrders, 'orders'], ['checkouts', syncAbandonedCheckouts, 'abandonedCheckouts']]) {
  test(`${name} fails closed before persistence for a malformed child page`, async () => {
    writes = 0; queries = [];
    response = { [key]: terminal([
      { lineItems: terminal([]) },
      { lineItems: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'more' } } },
    ]) };
    await assert.rejects(sync(store), { code: 'SHOPIFY_LINE_ITEMS_INCOMPLETE' });
    assert.equal(writes, 0);
    assert.match(queries.find(query => query.includes('lineItems(first: 250)')), /pageInfo\s*\{\s*hasNextPage\s+endCursor\s*\}/);
  });
  test(`${name} does not persist when child pageInfo is absent`, async () => {
    writes = 0;
    response = { [key]: terminal([{ lineItems: { nodes: [] } }]) };
    await assert.rejects(sync(store), { code: 'SHOPIFY_LINE_ITEMS_INCOMPLETE' });
    assert.equal(writes, 0);
  });
}

for (const type of ['Order', 'AbandonedCheckout']) {
  test(`${type} fetches subsequent pages with parent identity and cursor`, async () => {
    const record = { id: 'gid://shopify/' + type + '/1', updatedAt: '2026-10-01T00:00:00Z',
      lineItems: { nodes: [{ id: 'a' }], pageInfo: { hasNextPage: true, endCursor: 'next' } } };
    let calls = 0;
    await completeLineItems(store, [record], type, async (_store, query, variables) => {
      calls++;
      assert.match(query, new RegExp('on ' + type));
      assert.deepEqual(variables, { id: record.id, first: 250, after: 'next' });
      return { node: { id: record.id, updatedAt: record.updatedAt, lineItems: terminal([{ id: 'b' }]) } };
    });
    assert.equal(calls, 1);
    assert.deepEqual(record.lineItems.nodes.map(item => item.id), ['a', 'b']);
  });
}

test('nested pages reject changed parent, duplicate IDs, malformed response and cursor cycles', async () => {
  for (const kind of ['changed', 'duplicate', 'missing', 'cycle', 'error']) {
    const record = { id: 'gid://shopify/Order/1', updatedAt: '2026-10-01T00:00:00Z',
      lineItems: { nodes: [{ id: 'a' }], pageInfo: { hasNextPage: true, endCursor: 'next' } } };
    await assert.rejects(completeLineItems(store, [record], 'Order', async () => {
      if (kind === 'error') throw new Error('transport failed');
      if (kind === 'missing') return { node: null };
      return { node: { id: record.id, updatedAt: kind === 'changed' ? '2026-10-02T00:00:00Z' : record.updatedAt,
        lineItems: kind === 'cycle' ? { nodes: [{ id: 'b' }], pageInfo: { hasNextPage: true, endCursor: 'next' } }
          : terminal([{ id: kind === 'duplicate' ? 'a' : 'b' }]) } };
    }));
  }
});

test('terminal order and checkout child pages permit normal ingestion', async () => {
  writes = 0;
  response = { orders: terminal([{ id: 'gid://shopify/Order/1', lineItems: terminal([]) }]) };
  assert.equal(await syncOrders(store), 1);
  assert.equal(writes, 1);
  writes = 0;
  response = { abandonedCheckouts: terminal([{ id: 'gid://shopify/AbandonedCheckout/1', lineItems: terminal([]) }]) };
  assert.equal(await syncAbandonedCheckouts(store), 1);
  assert.equal(writes, 1);
});


test('order sync persists both initial and subsequent line items', async () => {
  writes = 0; orderPayloads = [];
  const id = 'gid://shopify/Order/12';
  const updatedAt = '2026-10-01T00:00:00Z';
  const item = id => ({ id, name: id, quantity: 1, originalUnitPriceSet: { shopMoney: { amount: '1', currencyCode: 'USD' } } });
  response = { orders: terminal([{ id, updatedAt, lineItems: { nodes: [item('first')], pageInfo: { hasNextPage: true, endCursor: 'next' } } }]) };
  nested = { node: { id, updatedAt, lineItems: terminal([item('second')]) } };
  assert.equal(await syncOrders(store), 1);
  assert.equal(writes, 1);
  assert.deepEqual(orderPayloads[0].line_items.map(row => row.id), ['first', 'second']);
});

test('order sync makes no writes if the parent changes during child pagination', async () => {
  writes = 0;
  const id = 'gid://shopify/Order/12';
  response = { orders: terminal([{ id, updatedAt: '2026-10-01T00:00:00Z', lineItems: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'next' } } }]) };
  nested = { node: { id, updatedAt: '2026-10-02T00:00:00Z', lineItems: terminal([]) } };
  await assert.rejects(syncOrders(store), { code: 'SHOPIFY_LINE_ITEMS_INCOMPLETE' });
  assert.equal(writes, 0);
});
