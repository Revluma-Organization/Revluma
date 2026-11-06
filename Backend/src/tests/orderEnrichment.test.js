'use strict';
/**
 * Order-event enrichment: shape-fallback acquisition, row mapping, tenant
 * isolation, and per-domain independence. Shopify boundary is stubbed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const GRAPHQL_PATH = require.resolve('../services/shopifyGraphql');
const DB_PATH = require.resolve('../configs/database');

const STORE = { id: '11111111-1111-1111-1111-111111111111' };

function loadEnrichment(graphqlImpl, prisma) {
  require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: { prisma } };
  require.cache[GRAPHQL_PATH] = { id: GRAPHQL_PATH, filename: GRAPHQL_PATH, loaded: true, exports: { shopifyGraphql: graphqlImpl } };
  for (const key of Object.keys(require.cache)) {
    if (key.includes('orderEnrichment') || key.includes('syncDomainState')) delete require.cache[key];
  }
  return require('../services/orderEnrichment');
}

function prismaStub() {
  const state = { orders: [], transactions: [], refunds: [], fulfillments: [], domainRows: new Map() };
  return {
    state,
    orders: { updateMany: async ({ where, data }) => { state.orders.push({ where, data }); return { count: 1 }; } },
    order_transactions: {
      upsert: async ({ where, create }) => {
        const existing = state.transactions.find(r => r.store_id === where.store_id_external_id.store_id && r.external_id === where.store_id_external_id.external_id);
        if (existing) Object.assign(existing, create); else state.transactions.push(create);
      },
      deleteMany: async ({ where }) => {
        const keep = where.external_id?.notIn ?? [];
        const before = state.transactions.length;
        state.transactions = state.transactions.filter(r => !(r.store_id === where.store_id && r.external_order_id === where.external_order_id && !keep.includes(r.external_id)));
        return { count: before - state.transactions.length };
      },
    },
    order_refunds: {
      upsert: async ({ create }) => { state.refunds.push(create); },
      deleteMany: async () => ({ count: 0 }),
    },
    order_fulfillments: {
      upsert: async ({ create }) => { state.fulfillments.push(create); },
      deleteMany: async () => ({ count: 0 }),
    },
    store_sync_domain_states: {
      upsert: async ({ where, create, update }) => {
        const k = `${where.store_id_domain?.store_id || create.store_id}|${where.store_id_domain?.domain || create.domain}`;
        state.domainRows.set(k, { ...(state.domainRows.get(k) || {}), ...create, ...update });
      },
      findUnique: async () => null,
      findMany: async () => [...state.domainRows.values()],
    },
  };
}

const GID = 'gid://shopify/Order/7001';

test('scalar mapper: dates validated, presentment currency captured, tags sanitized', () => {
  const { _internal } = loadEnrichment(async () => ({}), prismaStub());
  void _internal;
  const { mapScalarRow } = require('../services/orderEnrichment');
  const row = mapScalarRow({
    id: GID,
    presentmentCurrencyCode: 'EUR', displayFulfillmentStatus: 'FULFILLED',
    processedAt: '2026-10-30T10:00:00Z', closedAt: 'not-a-date', sourceName: 'web', test: true,
    tags: ['vip', 7, null],
    totalTaxSet: { shopMoney: { amount: '3.25', currencyCode: 'EUR' } },
    totalShippingPriceSet: { shopMoney: { amount: '5.50', currencyCode: 'EUR' } },
    totalDutiesSet: { shopMoney: { amount: '1.10', currencyCode: 'EUR' } },
    totalReceivedSet: { shopMoney: { amount: '21.99', currencyCode: 'EUR' } },
  });
  assert.equal(row.presentment_currency, 'EUR');
  assert.equal(row.display_fulfillment_status, 'FULFILLED');
  assert.equal(row.processed_at.toISOString(), '2026-10-30T10:00:00.000Z');
  assert.equal(row.closed_at, null, 'invalid timestamps are dropped, never persisted');
  assert.equal(row.source_name, 'web');
  assert.equal(row.test_flag, true);
  assert.deepEqual(row.tags, ['vip', '7', 'null']);
  assert.equal(Number(row.tax_amount), 3.25);
});

test('transactions persist from connection shape and reconcile vanished rows', async () => {
  const prisma = prismaStub();
  const graphql = async (store, query, vars) => {
    if (query.includes('RevlumaOrderTransactions')) {
      return { node: { id: GID, transactions: { nodes: [
        { id: 'gid://shopify/OrderTransaction/1', kind: 'sale', status: 'SUCCESS', gateway: 'Shopify Payments', amountSet: { shopMoney: { amount: '21.99', currencyCode: 'USD' } }, parentTransaction: null, processedAt: '2026-10-30T10:00:00Z', createdAt: '2026-10-30T10:00:00Z' },
      ], pageInfo: { hasNextPage: false, endCursor: 'x' } } } };
    }
    if (query.includes('RevlumaOrderOverview')) return { node: { id: GID } };
    if (query.includes('RevlumaOrderRefunds')) return { node: { id: GID, refunds: [] } };
    if (query.includes('RevlumaOrderFulfillments')) return { node: { id: GID, fulfillments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: 'x' } } } };
    throw new Error('unexpected query');
  };
  const { enrichOrder } = loadEnrichment(graphql, prisma);
  prisma.state.transactions.push({ store_id: STORE.id, external_order_id: '7001', external_id: '9999', kind: 'SALE', status: 'SUCCESS', synced_at: new Date() });
  await enrichOrder(STORE, GID, prisma, {});
  const ids = prisma.state.transactions.map(t => t.external_id);
  assert.deepEqual(ids, ['1'], 'connector shape persisted 1 row and vanished 9999 was reconciled away');
  assert.equal(prisma.state.transactions[0].currency, 'USD');
  assert.equal(prisma.state.orders.length, 1);
});

test('transactions fall back to legacy list shape when connection shape errors', async () => {
  const prisma = prismaStub();
  const seen = [];
  const graphql = async (store, query) => {
    if (query.includes('RevlumaOrderTransactionsLegacy')) {
      seen.push('list');
      return { node: { id: GID, transactions: [
        { id: 'gid://shopify/OrderTransaction/7', kind: 'CAPTURE', status: 'SUCCESS', gateway: 'Cash on Delivery (COD)', amountSet: { shopMoney: { amount: '50.00', currencyCode: 'NGN' } }, createdAt: '2026-10-30T11:00:00Z' },
      ] } };
    }
    if (query.includes('RevlumaOrderTransactions')) {
      seen.push('connection');
      throw Object.assign(new Error('Field transactions requires arguments'), { code: 'SHOPIFY_GRAPHQL_ERROR' });
    }
    if (query.includes('RevlumaOrderOverview')) return { node: { id: GID } };
    if (query.includes('RevlumaOrderRefunds')) return { node: { id: GID, refunds: [] } };
    if (query.includes('RevlumaOrderFulfillments')) return { node: { id: GID, fulfillments: [] } };
    throw new Error('unexpected query');
  };
  const { enrichOrder } = loadEnrichment(graphql, prisma);
  await enrichOrder(STORE, GID, prisma, {});
  assert.deepEqual(seen, ['connection', 'list'], 'connection attempted first, list fallback used');
  assert.deepEqual(prisma.state.transactions.map(t => t.external_id), ['7']);
  assert.equal(prisma.state.transactions[0].kind, 'CAPTURE');
});

test('enrichment failure in one domain never fabricates rows in another', async () => {
  const prisma = prismaStub();
  const graphql = async (store, query) => {
    if (query.includes('RevlumaOrderTransactions')) throw new Error('transactions exploded');
    if (query.includes('RevlumaOrderOverview')) return { node: { id: GID } };
    if (query.includes('RevlumaOrderRefunds')) return { node: { id: GID, refunds: [
      { id: 'gid://shopify/Refund/55', note: 'changed mind', createdAt: '2026-10-31T09:00:00Z', totalRefundedSet: { shopMoney: { amount: '12.50', currencyCode: 'USD' } }, refundLineItems: { nodes: [{ quantity: 1, subtotalSet: { shopMoney: { amount: '12.50', currencyCode: 'USD' } }, restockType: 'RETURN', lineItem: { id: 'gid://shopify/LineItem/77' } }] }, transactions: [{ id: 'gid://shopify/OrderTransaction/8', kind: 'REFUND', status: 'SUCCESS', amountSet: { shopMoney: { amount: '12.50', currencyCode: 'USD' } }, processedAt: '2026-10-31T09:00:00Z' }] },
    ] } };
    if (query.includes('RevlumaOrderFulfillmentsLegacy')) throw new Error('fulfillments exploded');
    if (query.includes('RevlumaOrderFulfillments')) throw new Error('fulfillments exploded');
    throw new Error('unexpected query');
  };
  const { enrichOrder } = loadEnrichment(graphql, prisma);
  const summary = await enrichOrder(STORE, GID, prisma, {});
  assert.equal(summary.transactions, 'failed');
  assert.equal(summary.fulfillments, 'failed');
  assert.equal(summary.refunds, 1, 'refund domain unaffected by transaction failure');
  assert.equal(prisma.state.refunds[0].refund_amount, '12.50');
  assert.deepEqual(prisma.state.refunds[0].transactions, [{ id: '8', kind: 'REFUND', status: 'SUCCESS', amount: '12.50', currency: 'USD', processed_at: '2026-10-31T09:00:00Z' }]);
});
