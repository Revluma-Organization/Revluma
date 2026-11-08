// src/services/businessHealthRepository.js
// Task 218 — thin, tenant-scoped I/O layer that fetches the `bundle` consumed
// by the pure buildBusinessHealth(bundle, now) (businessHealth.js).
//
// Invariants (Task 218 §11, §12):
//   • Tenant + store scoped: the store is resolved by (id, organization_id)
//     from the authenticated membership. A cross-tenant / unknown store id
//     resolves to null (404, no existence leak). Organization/store scope is
//     NEVER taken from query parameters.
//   • Efficient + bounded: every query is a bounded aggregate/group-by scoped
//     to one store and one window. No N+1 — independent fetches run in a
//     single Promise.all and each is at most a handful of set operations.
//   • Graceful partial responses: each independent data source is wrapped so a
//     single resource failure degrades that indicator (unavailable/partial)
//     instead of suppressing the unrelated indicators that succeeded.
//   • No secrets: only counts/sums/dates are returned; no payloads, tokens, or
//     customer PII.
//   • Reporting period: explicit rolling 7-day windows on UTC instants, with the
//     store IANA timezone carried for display context (documented decision).

'use strict';

const { retrieveIntegrationStates } = require('./revIntegrationState');

const DAY_MS = 24 * 3600 * 1000;
const PERIOD_DAYS = 7;

const iso = (value) => {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

async function safe(promise, fallback) {
  try {
    const value = await promise;
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function windows(now) {
  const curEnd = now;
  const curStart = new Date(now.getTime() - PERIOD_DAYS * DAY_MS);
  const cmpStart = new Date(now.getTime() - 2 * PERIOD_DAYS * DAY_MS);
  return { curStart, curEnd, cmpStart, cmpEnd: curStart };
}

function computeReportingPeriod(profile, now) {
  const { curStart, curEnd, cmpStart, cmpEnd } = windows(now);
  return {
    current: { label: 'last_7_days', start: iso(curStart), end: iso(curEnd) },
    comparison: { label: 'previous_7_days', start: iso(cmpStart), end: iso(cmpEnd) },
    timezone: (profile && typeof profile.iana_timezone === 'string' && profile.iana_timezone) ? profile.iana_timezone : 'UTC',
    period_basis: 'rolling_7d_utc',
    note: 'Rolling 7-day windows on UTC instants; the store IANA timezone is carried for display context.',
  };
}

const toNum = (v) => (v == null ? null : Number(v));

// Orders are the single source for BOTH the revenue indicator (authoritative
// net totals) and the order indicator (distinct order count). orders.total is
// NET (gross minus refunded) per the shopifyOrderFinancials financial rules.
// Test orders are excluded so synthetic traffic never inflates real revenue.
async function orderAggregate(prisma, storeId, start, end) {
  const baseWhere = {
    store_id: storeId,
    ordered_at: { gte: start, lte: end },
    OR: [{ test_flag: null }, { test_flag: false }],
  };
  const [main, refundedRows] = await Promise.all([
    prisma.orders.aggregate({
      where: baseWhere,
      _sum: { total: true, refunded_total: true, discount_amount: true, subtotal: true },
      _count: { _all: true },
    }),
    prisma.orders.aggregate({
      where: { ...baseWhere, refunded_total: { gt: 0 } },
      _count: { _all: true },
    }),
  ]);
  const count = main._count ? main._count._all : 0;
  const net = count === 0 ? 0 : toNum(main._sum ? main._sum.total : null);
  const refundedSum = count === 0 ? 0 : toNum(main._sum ? main._sum.refunded_total : null);
  const discounts = count === 0 ? 0 : toNum(main._sum ? main._sum.discount_amount : null);
  // gross = net + refunds is the exact algebraic inverse of net = gross -
  // refunds (documented financial rule) — a reconstruction, not a fabrication.
  const gross = (net != null && refundedSum != null) ? Math.round((net + refundedSum) * 100) / 100
    : (count === 0 ? 0 : null);
  const refundedCount = refundedRows._count ? refundedRows._count._all : 0;
  // One aggregate feeds BOTH the revenue indicator (net/gross/refunds/discounts/
  // order_count) and the order indicator (count/refunded_count); the aliases
  // keep each consumer's keys explicit.
  return {
    // order indicator
    count,
    cancelled_count: null,
    refunded_count: refundedCount,
    // revenue indicator
    net,
    gross,
    refunds: refundedSum,
    discounts,
    order_count: count,
    last_verified_at: iso(start), // the window end bounds how recent the data is
  };
}

async function fetchOrderData(prisma, storeId, now) {
  const { curStart, curEnd, cmpStart, cmpEnd } = windows(now);
  const [current, comparison] = await Promise.all([
    orderAggregate(prisma, storeId, curStart, curEnd),
    orderAggregate(prisma, storeId, cmpStart, cmpEnd),
  ]);
  return { current, comparison };
}

// Checkouts: actual abandoned_carts semantics. `abandoned` is a verified status;
// at-risk value excludes recovered carts; completed carts (converted) provide
// the conversion denominator. No abandonment is inferred from incompletion.
async function cartAggregate(prisma, storeId, start, end) {
  const abandonedWhere = { store_id: storeId, status: 'abandoned', abandoned_at: { gte: start, lte: end } };
  const [abandoned, completed, atRisk] = await Promise.all([
    prisma.abandoned_carts.aggregate({ where: abandonedWhere, _count: { _all: true } }),
    prisma.abandoned_carts.aggregate({ where: { store_id: storeId, completed_at: { gte: start, lte: end } }, _count: { _all: true } }),
    prisma.abandoned_carts.aggregate({ where: { ...abandonedWhere, recovered_at: null }, _sum: { cart_value: true } }),
  ]);
  const abandonedCount = abandoned._count ? abandoned._count._all : 0;
  const atRiskValue = abandonedCount === 0 ? 0 : (atRisk._sum && atRisk._sum.cart_value != null ? toNum(atRisk._sum.cart_value) : 0);
  return {
    abandoned_count: abandonedCount,
    completed_count: completed._count ? completed._count._all : 0,
    at_risk_value: atRiskValue,
  };
}

async function fetchCheckoutData(prisma, storeId, now) {
  const { curStart, curEnd } = windows(now);
  // The checkout indicator uses the current window only (abandonment is a
  // count + at-risk value; no period-over-period change classification), so no
  // comparison window is fetched.
  const current = await cartAggregate(prisma, storeId, curStart, curEnd);
  return { current, comparison: null };
}

// Product availability snapshot (current inventory only; no history).
async function fetchProductSnapshot(prisma, storeId) {
  const [byStock, invMax] = await Promise.all([
    prisma.products.groupBy({ by: ['stock_status'], where: { store_id: storeId }, _count: { _all: true } }),
    prisma.inventory_levels.aggregate({ where: { store_id: storeId }, _max: { synced_at: true } }),
  ]);
  let inStock = 0;
  let outOfStock = 0;
  let total = 0;
  for (const row of byStock || []) {
    const n = row._count ? row._count._all : 0;
    total += n;
    if (row.stock_status === 'instock') inStock += n;
    else if (row.stock_status === 'outofstock') outOfStock += n;
  }
  const unavailable = Math.max(0, total - inStock - outOfStock);
  return {
    snapshot: {
      available_count: inStock,
      unavailable_count: unavailable,
      out_of_stock_count: outOfStock,
      total_products: total,
      synced_at: invMax && invMax._max && invMax._max.synced_at ? iso(invMax._max.synced_at) : null,
      snapshot_only: true,
    },
  };
}

/**
 * Fetch the business-health bundle for ONE tenant-scoped store.
 * Returns null when the store id does not belong to the organization
 * (cross-tenant / unknown -> 404, no existence leak).
 */
async function fetchBusinessHealthBundle(prisma, organizationId, storeId, now = new Date(), canonicalIntegration = null) {
  if (!organizationId) throw new Error('Authenticated organization is required');
  const nowD = now instanceof Date ? now : new Date(now);

  const store = await prisma.stores.findFirst({
    where: { id: storeId, organization_id: organizationId },
    select: { id: true, organization_id: true, shop_domain: true, platform: true, status: true, last_synced_at: true },
  });
  if (!store) return null;

  // Independent data sources fetched in parallel; each degrades to null on
  // failure so one failing resource never suppresses the others.
  const [profile, integration, orderData, checkoutData, productData] = await Promise.all([
    safe(prisma.store_profiles.findFirst({
      where: { store_id: store.id },
      select: { iana_timezone: true, currency_code: true },
    }), null),
    canonicalIntegration ? canonicalIntegration : safe(retrieveIntegrationStates({ prisma, organizationId, storeId: store.id, now: nowD }), null),
    safe(fetchOrderData(prisma, store.id, nowD), null),
    safe(fetchCheckoutData(prisma, store.id, nowD), null),
    safe(fetchProductSnapshot(prisma, store.id), null),
  ]);

  const currencyCode = profile && typeof profile.currency_code === 'string' ? profile.currency_code : null;

  return {
    store: {
      ...store,
      iana_timezone: profile && typeof profile.iana_timezone === 'string' ? profile.iana_timezone : null,
      currency_code: currencyCode,
    },
    reportingPeriod: computeReportingPeriod(profile, nowD),
    integration,
    revenue: orderData ? { current: { ...orderData.current, currency: currencyCode }, comparison: orderData.comparison ? { ...orderData.comparison, currency: currencyCode } : null } : null,
    orders: orderData || null,
    checkouts: checkoutData ? { current: { ...checkoutData.current, currency: currencyCode }, comparison: checkoutData.comparison ? { ...checkoutData.comparison, currency: currencyCode } : null } : null,
    productAvailability: productData || null,
  };
}

module.exports = { fetchBusinessHealthBundle, computeReportingPeriod };
