'use strict';

// Re-read the bounded Shopify source of truth after order ingestion. Never
// certify a period from local row counts or a generic "sync succeeded" flag.
const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const { shopifyGraphql } = require('./shopifyGraphql');
const { fetchConnection, verifyOrderReadScope } = require('./shopifySync');
const { TRUSTED_SOURCE, certifyOrderCoverage } = require('./intelligenceOrderCoverage');

const DAY = 86400000;
function asMoney(value) {
  const amount = value?.shopMoney?.amount;
  if (amount === null || amount === undefined || amount === '') return null;
  const exact = String(amount).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(exact)) return null;
  try {
    const decimal = new Prisma.Decimal(exact);
    return decimal.isFinite() && !decimal.isNegative() ? decimal : null;
  } catch {
    return null;
  }
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
    const amount = asMoney(order.currentTotalPriceSet);
    const rawCurrency = order.currentTotalPriceSet?.shopMoney?.currencyCode;
    const currency = typeof rawCurrency === 'string' && /^[A-Za-z]{3}$/.test(rawCurrency.trim())
      ? rawCurrency.trim().toUpperCase() : null;
    const created = new Date(order.createdAt);
    const cancelled = Boolean(order.cancelledAt) ||
      String(order.displayFinancialStatus || '').toUpperCase() === 'CANCELLED';
    if (!id || sourceById.has(id) || !Number.isFinite(created.getTime()) || created < start || created >= end ||
        ['FAILED', 'VOIDED'].includes(String(order.displayFinancialStatus || '').toUpperCase())) {
      throw verificationError('ORDER_COVERAGE_SOURCE_FINANCIALS_UNVERIFIED');
    }
    if (!cancelled && (!amount || !currency)) {
      throw verificationError('ORDER_COVERAGE_SOURCE_FINANCIALS_UNVERIFIED');
    }
    sourceById.set(id, { amount, currency, cancelled });
  }
  // Compare cancellation state as well as the order set. Cancelled records are
  // verified against Shopify and excluded from the revenue query on both sides.
  const local = await prisma.orders.findMany({
    where: { store_id: store.id, ordered_at: { gte: start, lt: end } },
    select: { external_order_id: true, total: true, currency: true, recovery_status: true },
  });
  if (local.length !== sourceById.size) throw verificationError('ORDER_COVERAGE_ORDER_SET_MISMATCH');
  for (const row of local) {
    const expected = sourceById.get(row.external_order_id);
    const locallyCancelled = String(row.recovery_status || '').toLowerCase() === 'cancelled';
    if (!expected || locallyCancelled !== expected.cancelled) {
      throw verificationError('ORDER_COVERAGE_ORDER_STATUS_MISMATCH');
    }
    if (!expected.cancelled && (expected.currency !== row.currency ||
        !new Prisma.Decimal(row.total).equals(expected.amount))) {
      throw verificationError('ORDER_COVERAGE_ORDER_TOTAL_MISMATCH');
    }
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
