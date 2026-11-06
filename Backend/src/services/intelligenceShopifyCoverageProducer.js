'use strict';

// Re-read the bounded Shopify source of truth after order ingestion. Never
// certify a period from local row counts or a generic "sync succeeded" flag.
const crypto = require('crypto');
const { shopifyGraphql } = require('./shopifyGraphql');
const { fetchConnection, verifyOrderReadScope } = require('./shopifySync');
const { TRUSTED_SOURCE, certifyOrderCoverage } = require('./intelligenceOrderCoverage');

const DAY = 86400000;
// Compare decimal strings exactly rather than rounding all currencies to two
// places (some currencies and Shopify money values have finer precision).
// Prisma Decimal supplies an exact toString; arbitrary objects and exponent
// notation are deliberately rejected rather than silently rounded.
function canonicalMoney(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)) return null;
  if (typeof value === 'object') {
    if (Array.isArray(value) || typeof value.toString !== 'function') return null;
    value = value.toString();
  }
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  if (text.length > 128 || !/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  const decimals = fraction.replace(/0+$/, '');
  return decimals ? `${integer}.${decimals}` : integer;
}
const orderId = gid => String(gid || '').split('/').pop();
function verificationError(code) {
  return Object.assign(new Error('Shopify historical coverage verification incomplete'), { code });
}

async function verifyShopifyOrderCoverage(prisma, store, { now = new Date(), graphql = shopifyGraphql, fetchPages = fetchConnection } = {}) {
  if (store.platform !== 'shopify' || !store.access_token || !store.organization_id) {
    throw verificationError('ORDER_COVERAGE_STORE_UNAUTHORIZED');
  }
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 14 * DAY);
  // read_orders normally covers only recent orders. Keep the certified
  // interval inside that window; older periods require read_all_orders.
  if (now.getTime() - start.getTime() >= 60 * DAY) {
    throw verificationError('ORDER_COVERAGE_HISTORICAL_SCOPE_REQUIRED');
  }
  const permissions = await verifyOrderReadScope(store, graphql);
  if (!permissions.readOrders) throw verificationError('ORDER_COVERAGE_ORDER_SCOPE_MISSING');
  const query = `query RevlumaCoverage($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true,
      query: "created_at:>=${start.toISOString()} created_at:<${end.toISOString()}") {
      nodes { id createdAt cancelledAt displayFinancialStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const source = await fetchPages(store, query, 'orders', graphql);
  const sourceById = new Map();
  for (const order of source) {
    const id = orderId(order.id);
    const amount = canonicalMoney(order.currentTotalPriceSet?.shopMoney?.amount);
    const currency = order.currentTotalPriceSet?.shopMoney?.currencyCode;
    const created = new Date(order.createdAt);
    if (!id || sourceById.has(id) || amount === null ||
        !currency || !Number.isFinite(created.getTime()) || created < start || created >= end ||
        order.cancelledAt || ['CANCELLED', 'FAILED', 'VOIDED'].includes(order.displayFinancialStatus)) {
      throw verificationError('ORDER_COVERAGE_SOURCE_FINANCIALS_UNVERIFIED');
    }
    sourceById.set(id, { amount, currency, createdAt: created.getTime() });
  }
  // Any cancelled or otherwise excluded Shopify order makes this window
  // uncertifiable until cancellation accounting is separately attested.
  const local = await prisma.orders.findMany({
    where: { store_id: store.id, ordered_at: { gte: start, lt: end } },
    select: { external_order_id: true, total: true, currency: true, ordered_at: true, recovery_status: true },
  });
  if (local.length !== sourceById.size) throw verificationError('ORDER_COVERAGE_ORDER_SET_MISMATCH');
  const seenLocalIds = new Set();
  for (const row of local) {
    const expected = sourceById.get(row.external_order_id);
    const localDate = row.ordered_at instanceof Date ? row.ordered_at.getTime() : NaN;
    const excludedStatus = ['cancelled', 'canceled', 'voided', 'deleted'].includes(String(row.recovery_status || '').toLowerCase());
    if (!expected || seenLocalIds.has(row.external_order_id) || expected.currency !== row.currency ||
        !Number.isFinite(localDate) || localDate !== expected.createdAt || excludedStatus ||
        canonicalMoney(row.total) !== expected.amount) {
      throw verificationError('ORDER_COVERAGE_ORDER_TOTAL_MISMATCH');
    }
    seenLocalIds.add(row.external_order_id);
  }
  const gaps = await prisma.webhook_deliveries.count({
    where: { store_id: store.id, provider: 'shopify',
      received_at: { gte: start, lt: end },
      status: { not: 'processed' },
      topic: { in: ['orders/create', 'orders/updated', 'orders/cancelled', 'orders/delete'] } },
  });
  if (gaps) throw verificationError('ORDER_COVERAGE_WEBHOOK_GAPS');
  // The Shopify response has reached a terminal page and every source order
  // matches the persisted, refund-adjusted total for this exact interval.
  return certifyOrderCoverage(prisma, {
    source: TRUSTED_SOURCE, organizationId: store.organization_id, storeId: store.id,
    runId: 'coverage-' + crypto.randomUUID(), start, end,
    paginationComplete: true, orderReadScopeVerified: true,
    historicalAccessVerified: true, refundsAndCancellationsReconciled: true,
    persistedOrdersVerified: true, noKnownIngestionGaps: true,
    customerLifetimeVerified: false,
  });
}

module.exports = { verifyShopifyOrderCoverage };
