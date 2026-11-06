'use strict';

// Order-event enrichment ingestion (Admin GraphQL 2026-10).
//
// Captures everything the proven base order query deliberately does not carry:
//   - order business scalars (presentment currency, fulfillment status,
//     processed/closed timestamps, source, test designation, tax/shipping/
//     duties/total-received amounts, tags)
//   - payment transactions per order (kind/status/gateway/amount/parent/error)
//   - refund records with refund line items and refund transactions (JSON)
//   - fulfillments with status, location and tracking (line-item allocations
//     require fulfillment-order APIs and are deliberately not claimed)
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
  if (Array.isArray(field.nodes) && typeof field.pageInfo?.hasNextPage === 'boolean') {
    return { nodes: field.nodes, connection: true, complete: !field.pageInfo.hasNextPage, end: field.pageInfo?.endCursor || null };
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
      const seenCursors = new Set();
      do {
        if (++pages > MAX_TRANSACTION_PAGES) {
          const error = new Error(`${kind}: pagination ceiling reached`);
          error.code = 'SHOPIFY_ORDER_ENRICHMENT_PAGE_CEILING';
          error.pages_completed = pages - 1;
          error.discovered = nodes.length;
          error.noFallback = true;
          throw error;
        }
        let data;
        try {
          data = await shopifyGraphql(store, connectionQuery, { id, first, after: cursor });
        } catch (error) {
          error.pages_completed = pages - 1;
          error.discovered = nodes.length;
          throw error;
        }
        const parsed = connectionNodes(data?.node?.[extractField]);
        if (!parsed) return null; // shape mismatch -> caller tries the other
        nodes.push(...parsed.nodes);
        if (!parsed.connection) return { nodes, complete: true, pagesCompleted: pages };
        if (parsed.complete) return { nodes, complete: true, pagesCompleted: pages };
        if (!parsed.end) {
          const error = new Error(`${kind}: next-page cursor missing`);
          error.code = 'SHOPIFY_ORDER_ENRICHMENT_CURSOR_INVALID';
          error.pages_completed = pages;
          error.discovered = nodes.length;
          error.noFallback = true;
          throw error;
        }
        if (seenCursors.has(parsed.end)) {
          const error = new Error(`${kind}: repeated next-page cursor`);
          error.code = 'SHOPIFY_ORDER_ENRICHMENT_CURSOR_REPEATED';
          error.pages_completed = pages;
          error.discovered = nodes.length;
          error.noFallback = true;
          throw error;
        }
        seenCursors.add(parsed.end);
        cursor = parsed.end;
      } while (cursor);
      return { nodes, complete: true, pagesCompleted: pages };
    }
    const data = await shopifyGraphql(store, listQuery, { id });
    const field = data?.node?.[extractField];
    if (!Array.isArray(field)) return null;
    return { nodes: field, complete: true, pagesCompleted: 1 };
  };

  const errors = [];
  for (const useShape of shapes) {
    try {
      const result = await attempt(useShape);
      if (result) { cache[kind] = { shape: useShape }; return result; }
      errors.push(new Error(`${kind}: response shape unresolvable for shape=${useShape}`));
    } catch (error) {
      if (error?.noFallback) throw error;
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
  const existing = rows.length && typeof db[table].findMany === 'function'
    ? await db[table].findMany({
      where: { store_id: storeId, external_id: { in: rows.map(row => row.external_id) } },
      select: { external_id: true },
    })
    : [];
  const existingIds = new Set(existing.map(row => row.external_id));
  for (const row of rows) {
    const { store_id, external_id, ...fields } = row;
    await db[table].upsert({
      where: { store_id_external_id: { store_id, external_id } },
      create: row,
      update: { ...fields, synced_at: new Date() },
    });
  }
  let deleted = 0;
  if (reconcile) {
    const keep = rows.map(r => r.external_id);
    const result = await db[table].deleteMany({
      where: { store_id: storeId, external_order_id: externalOrderId, external_id: { notIn: keep.length ? keep : ['__none__'] } },
    });
    deleted = result.count;
  }
  const inserted = rows.filter(row => !existingIds.has(row.external_id)).length;
  return { inserted, updated: rows.length - inserted, deleted };
}

function attachReport(summary, domain, report) {
  if (!Object.prototype.hasOwnProperty.call(summary, '_reports')) {
    Object.defineProperty(summary, '_reports', { value: {}, enumerable: false });
  }
  summary._reports[domain] = report;
}

async function enrichOrder(store, orderGid, db = prisma, shapeCache = {}, options = {}) {
  const manageLedger = options.manageLedger !== false;
  const internal = { orderGid, externalOrderId: externalId(orderGid) };
  const summary = { scalars: 'skipped', transactions: 'skipped', refunds: 'skipped', fulfillments: 'skipped' };
  const begin = domain => manageLedger ? beginAttempt(store.id, domain, db) : Promise.resolve(true);
  const success = (domain, report) => manageLedger ? recordSuccess(store.id, domain, report, db) : Promise.resolve(true);
  const failure = (domain, error, report = {}) => manageLedger
    ? recordFailure(store.id, domain, error, report, db)
    : Promise.resolve(true);
  const degraded = (domain, code, report = {}) => manageLedger
    ? recordDegraded(store.id, domain, code, report, db)
    : Promise.resolve(true);

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

  // E2 transactions
  try {
    await begin('transactions');
    const fetched = await fetchFamily(store, orderGid, {
      kind: 'transactions', connectionQuery: TXN_CONNECTION_QUERY, listQuery: TXN_LIST_QUERY,
      extractField: 'transactions', first: TXS_PER_PAGE,
    }, shapeCache);
    const rows = fetched.nodes.map(txn => mapTransactionRow(store.id, internal.externalOrderId, txn)).filter(Boolean);
    const writes = await upsertRows(db, 'order_transactions', rows, { storeId: store.id, externalOrderId: internal.externalOrderId }, fetched.complete);
    const report = { discovered: rows.length, ...writes, paginationComplete: fetched.complete, pagesCompleted: fetched.pagesCompleted };
    await success('transactions', report);
    attachReport(summary, 'transactions', { ...report, status: 'ok' });
    summary.transactions = rows.length;
  } catch (error) {
    const report = { discovered: error.discovered, pagesCompleted: error.pages_completed };
    if (error?.accessDenied) {
      await degraded('transactions', 'SHOPIFY_ORDER_TRANSACTIONS_ACCESS_DENIED', report);
      attachReport(summary, 'transactions', { ...report, status: 'degraded', errorCode: 'SHOPIFY_ORDER_TRANSACTIONS_ACCESS_DENIED' });
      summary.transactions = 'degraded';
    } else {
      await failure('transactions', error, report);
      attachReport(summary, 'transactions', { ...report, status: 'failed', errorCode: error?.code || error?.name });
      summary.transactions = 'failed';
    }
    logger.warn('order_enrichment_transactions_failed', { store_id: store.id, external_order_id: internal.externalOrderId, error_type: error?.code || error?.name });
  }

  // E3 refunds
  try {
    await begin('refunds');
    const data = await shopifyGraphql(store, REFUNDS_QUERY, { id: orderGid });
    const refunds = data?.node?.refunds;
    if (!Array.isArray(refunds)) {
      const error = new Error('Shopify refunds response shape is unresolvable');
      error.code = 'SHOPIFY_REFUNDS_UNRESOLVABLE';
      error.accessDenied = false;
      throw error;
    }
    const rows = refunds.map(r => mapRefundRow(store.id, internal.externalOrderId, r)).filter(Boolean);
    const writes = await upsertRows(db, 'order_refunds', rows, { storeId: store.id, externalOrderId: internal.externalOrderId }, true);
    const report = { discovered: rows.length, ...writes, paginationComplete: true, pagesCompleted: 1 };
    await success('refunds', report);
    attachReport(summary, 'refunds', { ...report, status: 'ok' });
    summary.refunds = rows.length;
  } catch (error) {
    await failure('refunds', error);
    attachReport(summary, 'refunds', { status: 'failed', errorCode: error?.code || error?.name, paginationComplete: false });
    summary.refunds = 'failed';
    logger.warn('order_enrichment_refunds_failed', { store_id: store.id, external_order_id: internal.externalOrderId, error_type: error?.code || error?.name });
  }

  // E4 fulfillments
  try {
    await begin('fulfillments');
    const parent = await db.orders.findFirst({
      where: { store_id: store.id, external_order_id: internal.externalOrderId },
      select: { id: true },
    });
    if (!parent) {
      const error = new Error('Cannot persist fulfillment without its tenant-scoped order');
      error.code = 'ORDER_FULFILLMENT_PARENT_MISSING';
      error.noFallback = true;
      throw error;
    }
    const fetched = await fetchFamily(store, orderGid, {
      kind: 'fulfillments', connectionQuery: FUL_CONNECTION_QUERY, listQuery: FUL_LIST_QUERY,
      extractField: 'fulfillments', first: 100,
    }, shapeCache);
    const rows = fetched.nodes.map(f => mapFulfillmentRow(store.id, internal.externalOrderId, f)).filter(Boolean);
    const writes = await upsertRows(db, 'order_fulfillments', rows, { storeId: store.id, externalOrderId: internal.externalOrderId }, fetched.complete);
    const report = { discovered: rows.length, ...writes, paginationComplete: fetched.complete, pagesCompleted: fetched.pagesCompleted };
    await success('fulfillments', report);
    attachReport(summary, 'fulfillments', { ...report, status: 'ok' });
    summary.fulfillments = rows.length;
  } catch (error) {
    const report = { discovered: error.discovered, pagesCompleted: error.pages_completed, paginationComplete: false };
    if (error?.accessDenied) {
      await degraded('fulfillments', 'SHOPIFY_ORDER_FULFILLMENTS_ACCESS_DENIED', report);
      attachReport(summary, 'fulfillments', { ...report, status: 'degraded', errorCode: 'SHOPIFY_ORDER_FULFILLMENTS_ACCESS_DENIED' });
      summary.fulfillments = 'degraded';
    } else {
      await failure('fulfillments', error, report);
      attachReport(summary, 'fulfillments', { ...report, status: 'failed', errorCode: error?.code || error?.name });
      summary.fulfillments = 'failed';
    }
    logger.warn('order_enrichment_fulfillments_failed', { store_id: store.id, external_order_id: internal.externalOrderId, error_type: error?.code || error?.name });
  }

  return summary;
}

function emptyAggregate() {
  return { discovered: 0, inserted: 0, updated: 0, deleted: 0, pagesCompleted: 0, failures: 0, degraded: 0, unexpected: 0 };
}

async function enrichOrders(store, orderNodes, db = prisma) {
  const domains = ['transactions', 'refunds', 'fulfillments'];
  const aggregates = Object.fromEntries(domains.map(domain => [domain, emptyAggregate()]));
  await Promise.all(domains.map(domain => beginAttempt(store.id, domain, db)));
  const shapeCache = {};
  const totals = { orders: 0, ok: 0 };
  for (const node of orderNodes) {
    const id = node?.id || null;
    if (!id) continue;
    totals.orders += 1;
    try {
      const summary = await enrichOrder(store, id, db, shapeCache, { manageLedger: false });
      totals.ok += 1;
      for (const domain of domains) {
        const report = summary._reports?.[domain];
        if (!report) { aggregates[domain].unexpected += 1; continue; }
        for (const key of ['discovered', 'inserted', 'updated', 'deleted', 'pagesCompleted']) {
          aggregates[domain][key] += Number.isFinite(report[key]) ? report[key] : 0;
        }
        if (report.status === 'failed') aggregates[domain].failures += 1;
        if (report.status === 'degraded') aggregates[domain].degraded += 1;
      }
    } catch (error) {
      for (const domain of domains) aggregates[domain].unexpected += 1;
      logger.warn('order_enrichment_failed', { store_id: store.id, error_type: error?.code || error?.name });
    }
  }

  for (const domain of domains) {
    const aggregate = aggregates[domain];
    const report = {
      discovered: aggregate.discovered, inserted: aggregate.inserted,
      updated: aggregate.updated, deleted: aggregate.deleted,
      pagesCompleted: aggregate.pagesCompleted,
    };
    if (aggregate.failures || aggregate.unexpected) {
      const error = new Error(`${domain} enrichment incomplete for ${aggregate.failures + aggregate.unexpected} order(s)`);
      error.code = 'SHOPIFY_ORDER_ENRICHMENT_INCOMPLETE';
      await recordFailure(store.id, domain, error, report, db);
    } else if (aggregate.degraded) {
      await recordDegraded(store.id, domain, `SHOPIFY_ORDER_${domain.toUpperCase()}_ACCESS_DENIED`, report, db);
    } else {
      await recordSuccess(store.id, domain, { ...report, paginationComplete: true }, db);
    }
    logger.info('order_enrichment_domain_completed', {
      store_id: store.id, domain, ...report,
      status: aggregate.failures || aggregate.unexpected ? 'failed' : aggregate.degraded ? 'degraded' : 'ok',
      failed_orders: aggregate.failures + aggregate.unexpected,
      degraded_orders: aggregate.degraded,
    });
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
