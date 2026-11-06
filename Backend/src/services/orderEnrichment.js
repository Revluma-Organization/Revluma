'use strict';

// Order-event enrichment ingestion (Admin GraphQL 2026-10).
//
// Captures everything the proven base order query deliberately does not carry:
//   - order business scalars (presentment currency, fulfillment status,
//     processed/closed timestamps, source, test designation, tax/shipping/
//     duties/total-received amounts, tags)
//   - payment transactions per order (kind/status/gateway/amount/parent/error)
//   - refund records with refund line items and refund transactions (JSON)
//   - fulfillments with status, location, tracking and line items
//
// Design rules:
//   - The base revenue-ingestion path is untouched: enrichment is a separate,
//     optional pass invoked AFTER orders persist. A failure here never unwinds
//     order persistence, never advances or regresses stores.last_synced_at and
//     never blocks abandoned-checkout sync.
//   - Each enrichment domain is independently retryable and independently
//     ledgered (transactions / refunds / fulfillments / orders scalars).
//   - GraphQL shape drift (connection vs legacy list) is absorbed by a
//     connection-first, list-fallback strategy per field family, cached per
//     process. Nothing is silently assumed.
//   - Transactions captured via Order.transactions are the single authoritative
//     transaction set. Refund-scoped transaction copies are persisted inside
//     order_refunds.transactions ONLY (never double-written to
//     order_transactions).
//   - Raw card data, CVV, or any prohibited credential field is never
//     requested, logged or persisted.

const { prisma } = require('../configs/database');
const logger = require('../utils/logger');
const {
  beginAttempt,
  recordSuccess,
  recordFailure,
  recordDegraded,
} = require('./syncDomainState');
const { shopifyGraphql } = require('./shopifyGraphql');

const MAX_TRANSACTION_PAGES = 10; // 500 transactions per order is beyond any real order
const TXS_PER_PAGE = 100;

function externalId(gid) {
  return String(gid || '').split('/').pop();
}

function moneyDecimal(value) {
  let amount = value;
  if (value != null && typeof value === 'object') amount = value.amount;
  if (amount === null || amount === undefined || amount === '') return null;
  const text = String(amount).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return text;
}

function connectionNodes(field) {
  if (!field) return null;
  if (Array.isArray(field)) return { nodes: field, connection: false, complete: true, end: null };
  if (Array.isArray(field.nodes)) {
    return { nodes: field.nodes, connection: true, complete: !field.pageInfo?.hasNextPage, end: field.pageInfo?.endCursor || null };
  }
  return null;
}

const SCALARS_QUERY = `query RevlumaOrderOverview($id: ID!) {
  node(id: $id) {
    ... on Order {
      id
      presentmentCurrencyCode
      displayFulfillmentStatus
      processedAt closedAt sourceName test tags
      totalTaxSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      totalDutiesSet { shopMoney { amount currencyCode } }
      totalReceivedSet { shopMoney { amount currencyCode } }
    }
  }
}`;

const TXN_CONNECTION_QUERY = `query RevlumaOrderTransactions($id: ID!, $first: Int!, $after: String) {
  node(id: $id) {
    ... on Order {
      id
      transactions(first: $first, after: $after) {
        nodes {
          id kind status gateway
          amountSet { shopMoney { amount currencyCode } }
          parentTransaction { id }
          processedAt errorCode createdAt
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const TXN_LIST_QUERY = `query RevlumaOrderTransactionsLegacy($id: ID!) {
  node(id: $id) {
    ... on Order {
      id
      transactions {
        id kind status gateway
        amountSet { shopMoney { amount currencyCode } }
        parentTransaction { id }
        processedAt errorCode createdAt
      }
    }
  }
}`;

const REFUNDS_QUERY = `query RevlumaOrderRefunds($id: ID!) {
  node(id: $id) {
    ... on Order {
      id
      refunds {
        id note createdAt
        totalRefundedSet { shopMoney { amount currencyCode } }
        refundLineItems(first: 250) { nodes { quantity subtotalSet { shopMoney { amount currencyCode } } restockType lineItem { id } } }
        transactions(first: 100) { nodes { id kind status amountSet { shopMoney { amount currencyCode } } processedAt } }
      }
    }
  }
}`;

const FUL_CONNECTION_QUERY = `query RevlumaOrderFulfillments($id: ID!, $first: Int!, $after: String) {
  node(id: $id) {
    ... on Order {
      id
      fulfillments(first: $first, after: $after) {
        nodes {
          id status createdAt updatedAt
          location { name }
          trackingInfo { number url company }
                  }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const FUL_LIST_QUERY = `query RevlumaOrderFulfillmentsLegacy($id: ID!) {
  node(id: $id) {
    ... on Order {
      id
      fulfillments {
        id status createdAt updatedAt
        location { name }
        trackingInfo { number url company }
              }
    }
  }
}`;

function mapScalarRow(order) {
  const tax = moneyDecimal(order.totalTaxSet?.shopMoney);
  const shipping = moneyDecimal(order.totalShippingPriceSet?.shopMoney);
  const duties = moneyDecimal(order.totalDutiesSet?.shopMoney);
  const received = moneyDecimal(order.totalReceivedSet?.shopMoney);
  return {
    presentment_currency: order.presentmentCurrencyCode || null,
    display_fulfillment_status: order.displayFulfillmentStatus || null,
    processed_at: order.processedAt && !Number.isNaN(new Date(order.processedAt).getTime()) ? new Date(order.processedAt) : null,
    closed_at: order.closedAt && !Number.isNaN(new Date(order.closedAt).getTime()) ? new Date(order.closedAt) : null,
    source_name: order.sourceName ? String(order.sourceName).slice(0, 96) : null,
    test_flag: typeof order.test === 'boolean' ? order.test : null,
    tax_amount: tax === null ? null : Number(tax),
    shipping_amount: shipping === null ? null : Number(shipping),
    duties_amount: duties === null ? null : Number(duties),
    total_received: received === null ? null : Number(received),
    tags: Array.isArray(order.tags) ? order.tags.map(String).slice(0, 100) : [],
  };
}

function mapTransactionRow(storeId, externalOrderId, txn) {
  if (!txn || !txn.id) return null;
  const kind = String(txn.kind || 'UNKNOWN').toUpperCase().slice(0, 64);
  const status = String(txn.status || 'UNKNOWN').toUpperCase().slice(0, 32);
  return {
    store_id: storeId,
    external_order_id: String(externalOrderId),
    external_id: externalId(txn.id),
    kind,
    status,
    gateway: txn.gateway ? String(txn.gateway).slice(0, 255) : null,
    amount: moneyDecimal(txn.amountSet?.shopMoney),
    currency: txn.amountSet?.shopMoney?.currencyCode || null,
    parent_transaction_id: txn.parentTransaction?.id ? externalId(txn.parentTransaction.id) : null,
    processed_at: txn.processedAt && !Number.isNaN(new Date(txn.processedAt).getTime()) ? new Date(txn.processedAt) : null,
    error_code: txn.errorCode ? String(txn.errorCode).slice(0, 64) : null,
    // Full provider decline/error prose is deliberately not persisted: it can quote
    // payment-instrument details. Only the structured code is stored.
    error_message: null,
    created_at: txn.createdAt && !Number.isNaN(new Date(txn.createdAt).getTime()) ? new Date(txn.createdAt) : null,
    synced_at: new Date(),
  };
}

function mapRefundLineItem(item) {
  return {
    line_item_id: item.lineItem?.id ? externalId(item.lineItem.id) : null,
    quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null,
    amount: moneyDecimal(item.subtotalSet?.shopMoney),
    currency: item.subtotalSet?.shopMoney?.currencyCode || null,
    restock_type: item.restockType || null,
  };
}

function mapRefundRow(storeId, externalOrderId, refund) {
  if (!refund || !refund.id) return null;
  const lineItems = Array.isArray(refund.refundLineItems?.nodes)
    ? refund.refundLineItems.nodes.map(mapRefundLineItem)
    : [];
  const rawTxns = Array.isArray(refund.transactions)
    ? refund.transactions
    : (Array.isArray(refund.transactions?.nodes) ? refund.transactions.nodes : []);
  const transactions = rawTxns.map(txn => ({
      id: externalId(txn.id),
      kind: txn.kind || null,
      status: txn.status || null,
      amount: moneyDecimal(txn.amountSet?.shopMoney),
      currency: txn.amountSet?.shopMoney?.currencyCode || null,
      processed_at: txn.processedAt || null,
    }));
  return {
    store_id: storeId,
    external_order_id: String(externalOrderId),
    external_id: externalId(refund.id),
    note: refund.note ? String(refund.note) : null,
    refund_amount: moneyDecimal(refund.totalRefundedSet?.shopMoney),
    refund_currency: refund.totalRefundedSet?.shopMoney?.currencyCode || null,
    refunded_shipping: null, // queried only when the version exposes it reliably; see notes
    created_at: refund.createdAt && !Number.isNaN(new Date(refund.createdAt).getTime()) ? new Date(refund.createdAt) : null,
    refund_line_items: lineItems,
    transactions,
    synced_at: new Date(),
  };
}

function mapFulfillmentRow(storeId, externalOrderId, ful) {
  if (!ful || !ful.id) return null;
  const trackingInfo = Array.isArray(ful.trackingInfo)
    ? ful.trackingInfo.map(t => ({ number: t?.number || null, url: t?.url || null, company: t?.company || null })).slice(0, 20)
    : [];
  const lineItems = Array.isArray(ful.lineItems?.nodes)
    ? ful.lineItems.nodes.map(item => ({ id: externalId(item.id), quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null })).slice(0, 250)
    : [];
  return {
    store_id: storeId,
    external_order_id: String(externalOrderId),
    external_id: externalId(ful.id),
    status: ful.status ? String(ful.status).slice(0, 32) : null,
    location_name: ful.location?.name ? String(ful.location.name).slice(0, 255) : null,
    tracking_company: trackingInfo.length ? (trackingInfo[0].company ? String(trackingInfo[0].company).slice(0, 255) : null) : null,
    tracking_info: trackingInfo,
    line_items: lineItems,
    created_at: ful.createdAt && !Number.isNaN(new Date(ful.createdAt).getTime()) ? new Date(ful.createdAt) : null,
    updated_at: ful.updatedAt && !Number.isNaN(new Date(ful.updatedAt).getTime()) ? new Date(ful.updatedAt) : null,
    synced_at: new Date(),
  };
}

async function fetchFamily(store, id, cfg, cache = {}) {
  const { kind, connectionQuery, listQuery, extractField, first = TXS_PER_PAGE } = cfg;
  const shape = cache[kind]?.shape || 'connection';
  const shapes = shape === 'connection' ? ['connection', 'list'] : ['list', 'connection'];
  const attempt = async (useShape) => {
    if (useShape === 'connection') {
      const nodes = [];
      let pages = 0;
      let cursor = null;
      do {
        if (++pages > MAX_TRANSACTION_PAGES) return { nodes, complete: false };
        const data = await shopifyGraphql(store, connectionQuery, { id, first, after: cursor });
        const parsed = connectionNodes(data?.node?.[extractField]);
        if (!parsed) return null; // shape mismatch -> caller tries the other
        nodes.push(...parsed.nodes);
        // Follow cursor ONLY when the source says another page exists.
        cursor = parsed.connection && !parsed.complete ? parsed.end : null;
        if (!parsed.connection) return { nodes, complete: true };
      } while (cursor);
      return { nodes, complete: true };
    }
    const data = await shopifyGraphql(store, listQuery, { id });
    const field = data?.node?.[extractField];
    if (!Array.isArray(field)) return null;
    return { nodes: field, complete: true };
  };

  const errors = [];
  for (const useShape of shapes) {
    try {
      const result = await attempt(useShape);
      if (result) { cache[kind] = { shape: useShape }; return result; }
      errors.push(new Error(`${kind}: response shape unresolvable for shape=${useShape}`));
    } catch (error) {
      errors.push(error);
    }
  }
  const accessDenied = errors.some(error =>
    error?.code === 'SHOPIFY_GRAPHQL_ERROR' &&
    Array.isArray(error.shopifyErrors) &&
    error.shopifyErrors.some(item => Array.isArray(item.codes) && item.codes.includes('ACCESS_DENIED')));
  const failure = errors[errors.length - 1] || new Error(`${kind}: acquisition failed`);
  failure.accessDenied = accessDenied;
  throw failure;
}

async function upsertRows(db, table, rows, { storeId, externalOrderId }, reconcile = true) {
  for (const row of rows) {
    const { store_id, external_id, ...fields } = row;
    await db[table].upsert({
      where: { store_id_external_id: { store_id, external_id } },
      create: row,
      update: { ...fields, synced_at: new Date() },
    });
  }
  if (reconcile) {
    const keep = rows.map(r => r.external_id);
    await db[table].deleteMany({
      where: { store_id: storeId, external_order_id: externalOrderId, external_id: { notIn: keep.length ? keep : ['__none__'] } },
    });
  }
}

async function enrichOrder(store, orderGid, db = prisma, shapeCache = {}) {
  const internal = { orderGid, externalOrderId: externalId(orderGid) };
  const summary = { scalars: 'skipped', transactions: 'skipped', refunds: 'skipped', fulfillments: 'skipped' };

  // E1 order scalars — never fatal beyond its own domain.
  try {
    const data = await shopifyGraphql(store, SCALARS_QUERY, { id: orderGid });
    const node = data?.node;
    if (node && node.id) {
      const row = mapScalarRow(node);
      await db.orders.updateMany({ where: { store_id: store.id, external_order_id: internal.externalOrderId }, data: row });
      summary.scalars = 'ok';
    } else {
      summary.scalars = 'failed';
    }
  } catch (error) {
    summary.scalars = 'failed';
    logger.warn('order_enrichment_scalars_failed', { store_id: store.id, external_order_id: internal.externalOrderId, error_type: error?.code || error?.name });
  }

  // Shared per-order transaction family fetch (used for E2 reconciliation).
  // E2 transactions
  try {
    await beginAttempt(store.id, 'transactions');
    const fetched = await fetchFamily(store, orderGid, {
      kind: 'transactions',
      connectionQuery: TXN_CONNECTION_QUERY,
      listQuery: TXN_LIST_QUERY,
      extractField: 'transactions',
      first: TXS_PER_PAGE,
    }, shapeCache);
    const rows = fetched.nodes.map(txn => mapTransactionRow(store.id, internal.externalOrderId, txn)).filter(Boolean);
    await upsertRows(db, 'order_transactions', rows, { storeId: store.id, externalOrderId: internal.externalOrderId }, fetched.complete);
    await recordSuccess(store.id, 'transactions', { discovered: rows.length, inserted: rows.length, paginationComplete: fetched.complete, pagesCompleted: null });
    summary.transactions = rows.length;
  } catch (error) {
    if (error?.accessDenied) {
      await recordDegraded(store.id, 'transactions', 'SHOPIFY_ORDER_TRANSACTIONS_ACCESS_DENIED');
      summary.transactions = 'degraded';
    } else {
      await recordFailure(store.id, 'transactions', error);
      summary.transactions = 'failed';
    }
    logger.warn('order_enrichment_transactions_failed', { store_id: store.id, external_order_id: internal.externalOrderId, error_type: error?.code || error?.name });
  }

  // E3 refunds
  try {
    await beginAttempt(store.id, 'refunds');
    const data = await shopifyGraphql(store, REFUNDS_QUERY, { id: orderGid });
    const refunds = data?.node?.refunds;
    if (Array.isArray(refunds)) {
      const rows = refunds.map(r => mapRefundRow(store.id, internal.externalOrderId, r)).filter(Boolean);
      await upsertRows(db, 'order_refunds', rows, { storeId: store.id, externalOrderId: internal.externalOrderId }, true);
      await recordSuccess(store.id, 'refunds', { discovered: rows.length, inserted: rows.length, paginationComplete: true });
      summary.refunds = rows.length;
    } else {
      await recordDegraded(store.id, 'refunds', 'SHOPIFY_REFUNDS_UNRESOLVABLE');
      summary.refunds = 'degraded';
    }
  } catch (error) {
    await recordFailure(store.id, 'refunds', error);
    summary.refunds = 'failed';
    logger.warn('order_enrichment_refunds_failed', { store_id: store.id, external_order_id: internal.externalOrderId, error_type: error?.code || error?.name });
  }

  // E4 fulfillments
  try {
    await beginAttempt(store.id, 'fulfillments');
    const fetched = await fetchFamily(store, orderGid, {
      kind: 'fulfillments',
      connectionQuery: FUL_CONNECTION_QUERY,
      listQuery: FUL_LIST_QUERY,
      extractField: 'fulfillments',
      first: 100,
    }, shapeCache);
    const rows = fetched.nodes.map(f => mapFulfillmentRow(store.id, internal.externalOrderId, f)).filter(Boolean);
    await upsertRows(db, 'order_fulfillments', rows, { storeId: store.id, externalOrderId: internal.externalOrderId }, fetched.complete);
    await recordSuccess(store.id, 'fulfillments', { discovered: rows.length, inserted: rows.length, paginationComplete: fetched.complete, pagesCompleted: null });
    summary.fulfillments = rows.length;
  } catch (error) {
    if (error?.accessDenied) {
      await recordDegraded(store.id, 'fulfillments', 'SHOPIFY_ORDER_FULFILLMENTS_ACCESS_DENIED');
      summary.fulfillments = 'degraded';
    } else {
      await recordFailure(store.id, 'fulfillments', error);
      summary.fulfillments = 'failed';
    }
    logger.warn('order_enrichment_fulfillments_failed', { store_id: store.id, external_order_id: internal.externalOrderId, error_type: error?.code || error?.name });
  }

  return summary;
}

async function enrichOrders(store, orderNodes, db = prisma) {
  const gid = n => n?.id || null;
  const shapeCache = {};
  const totals = { orders: 0, ok: 0 };
  for (const node of orderNodes) {
    const id = gid(node);
    if (!id) continue;
    totals.orders += 1;
    try {
      await enrichOrder(store, id, db, shapeCache);
      totals.ok += 1;
    } catch (error) {
      // Defensive: any unexpected throw remains logged, never fatal to the sync.
      logger.warn('order_enrichment_failed', { store_id: store.id, error_type: error?.code || error?.name });
    }
  }
  return totals;
}

module.exports = {
  enrichOrder,
  enrichOrders,
  extractTransactionRows: (storeId, externalOrderId, txns) => (txns || []).map(t => mapTransactionRow(storeId, externalOrderId, t)).filter(Boolean),
  extractRefundRows: (storeId, externalOrderId, refunds) => (refunds || []).map(r => mapRefundRow(storeId, externalOrderId, r)).filter(Boolean),
  extractFulfillmentRows: (storeId, externalOrderId, fuls) => (fuls || []).map(f => mapFulfillmentRow(storeId, externalOrderId, f)).filter(Boolean),
  mapScalarRow,
  externalId,
  _internal: { connectionNodes, moneyDecimal },
};
