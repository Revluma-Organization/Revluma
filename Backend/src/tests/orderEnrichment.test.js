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
  const state = { orders: [], transactions: [], refunds: [], fulfillments: [], domainRows: new Map(), parentMissing: false, failFulfillmentWrite: false };
  return {
    state,
    orders: {
      updateMany: async ({ where, data }) => { state.orders.push({ where, data }); return { count: 1 }; },
      findFirst: async ({ where }) => state.parentMissing ? null : ({ id: `order-${where.external_order_id}`, store_id: where.store_id }),
    },
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
      upsert: async ({ where, create, update }) => {
        if (state.failFulfillmentWrite) throw Object.assign(new Error('fulfillment write failed'), { code: 'P2037' });
        const key = row => `${row.store_id}|${row.external_id}`;
        const existing = state.fulfillments.find(row => key(row) === key(create));
        if (existing) Object.assign(existing, update);
        else state.fulfillments.push(create);
      },
      findMany: async ({ where }) => state.fulfillments.filter(row => row.store_id === where.store_id && (!where.external_id?.in || where.external_id.in.includes(row.external_id))),
      deleteMany: async ({ where }) => {
        const keep = where.external_id?.notIn || [];
        const before = state.fulfillments.length;
        state.fulfillments = state.fulfillments.filter(row => row.store_id !== where.store_id || row.external_order_id !== where.external_order_id || keep.includes(row.external_id));
        return { count: before - state.fulfillments.length };
      },
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

function fulfillment(id, status = 'SUCCESS') {
  return {
    id: `gid://shopify/Fulfillment/${id}`, status,
    createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-02T10:00:00Z',
    location: { name: 'Shop location' },
    trackingInfo: [{ number: 'TRACK-1', url: 'https://tracking.example/1', company: 'Example Carrier' }],
  };
}

function standardGraphql(fulfillmentHandler) {
  return async (store, query, variables) => {
    if (query.includes('RevlumaOrderOverview')) return { node: { id: variables.id } };
    if (query.includes('RevlumaOrderTransactions')) return { node: { id: variables.id, transactions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } };
    if (query.includes('RevlumaOrderRefunds')) return { node: { id: variables.id, refunds: [] } };
    if (query.includes('RevlumaOrderFulfillments')) return fulfillmentHandler(store, query, variables);
    throw new Error('unexpected query');
  };
}

test('fulfillment mapping persists tracking and supported fields without unsupported selections', async () => {
  const prisma = prismaStub();
  let fulfillmentQuery = '';
  const graphql = standardGraphql(async (_store, query) => {
    fulfillmentQuery = query;
    return { node: { id: GID, fulfillments: { nodes: [fulfillment(88)], pageInfo: { hasNextPage: false, endCursor: null } } } };
  });
  const { enrichOrder } = loadEnrichment(graphql, prisma);
  const summary = await enrichOrder(STORE, GID, prisma, {});
  assert.equal(summary.fulfillments, 1);
  assert.equal(prisma.state.fulfillments[0].tracking_company, 'Example Carrier');
  assert.deepEqual(prisma.state.fulfillments[0].line_items, [], 'fulfillment-order allocations are not fabricated');
  assert.doesNotMatch(fulfillmentQuery, /lineItems|trackingCompany/);
  assert.match(fulfillmentQuery, /trackingInfo \{ number url company \}/);
});

test('fulfillment pagination follows every page and repeated sync updates without duplicates', async () => {
  const prisma = prismaStub();
  const graphql = standardGraphql(async (_store, _query, variables) => {
    if (!variables.after) return { node: { id: GID, fulfillments: { nodes: [fulfillment(88)], pageInfo: { hasNextPage: true, endCursor: 'next-fulfillment' } } } };
    assert.equal(variables.after, 'next-fulfillment');
    return { node: { id: GID, fulfillments: { nodes: [{ ...fulfillment(89), status: 'CANCELLED' }], pageInfo: { hasNextPage: false, endCursor: null } } } };
  });
  const { enrichOrder } = loadEnrichment(graphql, prisma);
  await enrichOrder(STORE, GID, prisma, {});
  await enrichOrder(STORE, GID, prisma, {});
  assert.equal(prisma.state.fulfillments.length, 2);
  const ledger = prisma.state.domainRows.get(`${STORE.id}|fulfillments`);
  assert.equal(ledger.records_discovered, 2);
  assert.equal(ledger.records_inserted, 0);
  assert.equal(ledger.records_updated, 2);
  assert.equal(ledger.pages_completed, 2);
  assert.equal(ledger.pagination_complete, true);
});

test('empty fulfillment source is a successful zero-record acquisition', async () => {
  const prisma = prismaStub();
  const graphql = standardGraphql(async () => ({ node: { id: GID, fulfillments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }));
  const { enrichOrder } = loadEnrichment(graphql, prisma);
  const summary = await enrichOrder(STORE, GID, prisma, {});
  assert.equal(summary.fulfillments, 0);
  const ledger = prisma.state.domainRows.get(`${STORE.id}|fulfillments`);
  assert.equal(ledger.status, 'ok');
  assert.equal(ledger.records_discovered, 0);
  assert.equal(ledger.pages_completed, 1);
});

test('missing tenant-scoped parent order fails fulfillment persistence', async () => {
  const prisma = prismaStub();
  prisma.state.parentMissing = true;
  let called = false;
  const graphql = standardGraphql(async () => { called = true; return { node: { fulfillments: { nodes: [fulfillment(1)] } } }; });
  const { enrichOrder } = loadEnrichment(graphql, prisma);
  const summary = await enrichOrder(STORE, GID, prisma, {});
  assert.equal(summary.fulfillments, 'failed');
  assert.equal(called, false, 'acquisition does not proceed when relationship cannot be persisted safely');
  assert.equal(prisma.state.fulfillments.length, 0);
});

test('Shopify and database fulfillment failures propagate to a failed ledger', async () => {
  const apiPrisma = prismaStub();
  const apiError = Object.assign(new Error('Shopify unavailable'), { code: 'SHOPIFY_GRAPHQL_HTTP_ERROR' });
  const { enrichOrder: apiEnrich } = loadEnrichment(standardGraphql(async () => { throw apiError; }), apiPrisma);
  const apiSummary = await apiEnrich(STORE, GID, apiPrisma, {});
  assert.equal(apiSummary.fulfillments, 'failed');
  assert.equal(apiPrisma.state.domainRows.get(`${STORE.id}|fulfillments`).status, 'failed');

  const dbPrisma = prismaStub();
  dbPrisma.state.failFulfillmentWrite = true;
  const { enrichOrder: dbEnrich } = loadEnrichment(standardGraphql(async () => ({ node: { fulfillments: { nodes: [fulfillment(1)] } } })), dbPrisma);
  const dbSummary = await dbEnrich(STORE, GID, dbPrisma, {});
  assert.equal(dbSummary.fulfillments, 'failed');
  assert.equal(dbPrisma.state.domainRows.get(`${STORE.id}|fulfillments`).error_code, 'P2037');
});

test('missing or repeated fulfillment cursors fail without stale deletion', async () => {
  for (const mode of ['missing', 'repeated']) {
    const prisma = prismaStub();
    prisma.state.fulfillments.push({ store_id: STORE.id, external_order_id: '7001', external_id: 'keep' });
    const graphql = standardGraphql(async (_store, _query, variables) => ({
      node: { fulfillments: { nodes: [], pageInfo: {
        hasNextPage: true,
        endCursor: mode === 'missing' ? null : (variables.after || 'same-cursor'),
      } } },
    }));
    const { enrichOrder } = loadEnrichment(graphql, prisma);
    const summary = await enrichOrder(STORE, GID, prisma, {});
    assert.equal(summary.fulfillments, 'failed');
    assert.equal(prisma.state.fulfillments[0].external_id, 'keep');
    assert.equal(prisma.state.domainRows.get(`${STORE.id}|fulfillments`).pagination_complete, false);
  }
});

test('fulfillment pagination ceiling cannot be reported as success', async () => {
  const prisma = prismaStub();
  const graphql = standardGraphql(async (_store, _query, variables) => ({
    node: { fulfillments: { nodes: [], pageInfo: { hasNextPage: true, endCursor: `cursor-${variables.after || 0}` } } },
  }));
  const { enrichOrder } = loadEnrichment(graphql, prisma);
  const summary = await enrichOrder(STORE, GID, prisma, {});
  assert.equal(summary.fulfillments, 'failed');
  const ledger = prisma.state.domainRows.get(`${STORE.id}|fulfillments`);
  assert.equal(ledger.status, 'failed');
  assert.equal(ledger.pagination_complete, false);
});

test('batch ledger aggregates all orders instead of overwriting earlier fulfillments', async () => {
  const prisma = prismaStub();
  const graphql = standardGraphql(async (_store, _query, variables) => ({
    node: { fulfillments: {
      nodes: variables.id === GID ? [fulfillment(88)] : [],
      pageInfo: { hasNextPage: false, endCursor: null },
    } },
  }));
  const { enrichOrders } = loadEnrichment(graphql, prisma);
  await enrichOrders(STORE, [{ id: GID }, { id: 'gid://shopify/Order/7002' }], prisma);
  const ledger = prisma.state.domainRows.get(`${STORE.id}|fulfillments`);
  assert.equal(ledger.status, 'ok');
  assert.equal(ledger.records_discovered, 1);
  assert.equal(ledger.records_inserted, 1);
  assert.equal(ledger.pages_completed, 2);
  assert.equal(prisma.state.fulfillments.length, 1);
});

test('batch partial acquisition failure is failed, not a successful zero/partial run', async () => {
  const prisma = prismaStub();
  const graphql = standardGraphql(async (_store, _query, variables) => {
    if (variables.id === GID) return { node: { fulfillments: { nodes: [fulfillment(88)], pageInfo: { hasNextPage: false, endCursor: null } } } };
    throw Object.assign(new Error('source failed'), { code: 'SHOPIFY_GRAPHQL_HTTP_ERROR' });
  });
  const { enrichOrders } = loadEnrichment(graphql, prisma);
  await enrichOrders(STORE, [{ id: GID }, { id: 'gid://shopify/Order/7002' }], prisma);
  const ledger = prisma.state.domainRows.get(`${STORE.id}|fulfillments`);
  assert.equal(ledger.status, 'failed');
  assert.equal(ledger.pagination_complete, false);
  assert.equal(ledger.records_discovered, 1);
});

test('fulfillment rows with the same external ID remain isolated by store', async () => {
  const prisma = prismaStub();
  const other = { id: '22222222-2222-2222-2222-222222222222' };
  const graphql = standardGraphql(async () => ({ node: { fulfillments: { nodes: [fulfillment(88)] } } }));
  const { enrichOrder } = loadEnrichment(graphql, prisma);
  await enrichOrder(STORE, GID, prisma, {});
  await enrichOrder(other, GID, prisma, {});
  assert.equal(prisma.state.fulfillments.length, 2);
  assert.deepEqual(new Set(prisma.state.fulfillments.map(row => row.store_id)), new Set([STORE.id, other.id]));
});
