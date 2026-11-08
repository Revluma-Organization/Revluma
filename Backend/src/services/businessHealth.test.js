'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  BUSINESS_HEALTH_CONTRACT_VERSION,
  BUSINESS_STATUS,
  DATA_QUALITY,
  INDICATOR_CATEGORY,
  THRESHOLDS,
  domainCoverage,
  buildBusinessHealth,
  validateBusinessHealth,
} = require('./businessHealth');

const NOW = new Date('2026-11-07T12:00:00.000Z');
const DAY = 86400000;
const iso = (msOffset) => new Date(NOW.getTime() + (msOffset || 0)).toISOString();

// A domain whose sync succeeded and is fresh -> usable coverage.
function freshDomain(offsetMs = 0) {
  return { state: 'succeeded', freshness: { state: 'fresh' }, last_succeeded_at: iso(offsetMs) };
}
function staleDomain() {
  return { state: 'succeeded', freshness: { state: 'stale' }, last_succeeded_at: iso(-40 * 3600000) };
}
function neverDomain() {
  return { state: 'never_synchronized', freshness: { state: 'never_synchronized' }, last_succeeded_at: null };
}
function failedDomain() {
  return { state: 'failed', freshness: { state: 'never_synchronized' }, last_succeeded_at: null };
}

function integrationState({ domains, overall_status = 'connected', status_reason = 'all_verified' } = {}) {
  return {
    contract_version: 'rev-integration-state-v1',
    overall_status,
    status_reason,
    status_explanation: `state is ${overall_status}`,
    authorization: { verification: 'verified_by_successful_synchronization' },
    synchronization: {
      state: 'completed',
      last_succeeded_at: iso(0),
      running_domains: [],
      failed_domains: [],
      partial_domains: [],
      domains: domains || {},
    },
    evaluated_at: iso(0),
    recommended_next_step: 'No action required.',
    limitations: [],
  };
}

// A fully-synced, healthy bundle. Individual pieces can be overridden per test.
function bundle(overrides = {}) {
  const allFresh = { orders: freshDomain(), abandoned_checkouts: freshDomain(), products: freshDomain(), inventory: freshDomain() };
  return Object.assign({
    store: { id: 'store-1', organization_id: 'org-1', shop_domain: 'x.myshopify.com', iana_timezone: 'America/New_York', currency_code: 'USD' },
    reportingPeriod: {
      current: { label: 'last_7_days', start: iso(-7 * DAY), end: iso(0) },
      comparison: { label: 'previous_7_days', start: iso(-14 * DAY), end: iso(-7 * DAY) },
      timezone: 'America/New_York',
      period_basis: 'rolling_7d_utc',
    },
    integration: integrationState({ domains: allFresh }),
    revenue: { current: { net: 1000, gross: 1100, refunds: 100, discounts: 50, order_count: 40, currency: 'USD' }, comparison: { net: 1000, currency: 'USD' } },
    orders: { current: { count: 40, refunded_count: 5 }, comparison: { count: 40 } },
    checkouts: { current: { abandoned_count: 0, completed_count: 50, at_risk_value: 0, currency: 'USD' }, comparison: null },
    productAvailability: { snapshot: { available_count: 90, unavailable_count: 5, out_of_stock_count: 0, total_products: 95, synced_at: iso(0), snapshot_only: true } },
  }, overrides);
}

const byCat = (c) => c.by_category;

test('contract version + shape', () => {
  const c = buildBusinessHealth(bundle(), NOW);
  assert.equal(c.contract_version, BUSINESS_HEALTH_CONTRACT_VERSION);
  assert.equal(c.organization_id, 'org-1');
  assert.equal(c.store_id, 'store-1');
  assert.equal(c.shop_domain, 'x.myshopify.com');
  assert.equal(c.indicators.length, 5);
  for (const cat of Object.values(INDICATOR_CATEGORY)) assert.ok(byCat(c)[cat], `missing ${cat}`);
  assert.deepEqual(validateBusinessHealth(c), []);
});

// ── Scenario A: healthy store ─────────────────────────────────────────────
test('A: healthy store -> business_status healthy', () => {
  const c = buildBusinessHealth(bundle(), NOW);
  assert.equal(c.business_status, BUSINESS_STATUS.HEALTHY);
  assert.equal(byCat(c).revenue.status, BUSINESS_STATUS.HEALTHY);
  assert.equal(byCat(c).orders.status, BUSINESS_STATUS.HEALTHY);
  assert.equal(byCat(c).integration.status, BUSINESS_STATUS.HEALTHY);
});
test('A: revenue grows -> healthy', () => {
  const c = buildBusinessHealth(bundle({ revenue: { current: { net: 1050, currency: 'USD' }, comparison: { net: 1000, currency: 'USD' } } }), NOW);
  assert.equal(byCat(c).revenue.status, BUSINESS_STATUS.HEALTHY);
  assert.equal(byCat(c).revenue.change_pct, 5);
});
test('A: zero abandoned checkouts -> healthy (not attention)', () => {
  const c = buildBusinessHealth(bundle({ checkouts: { current: { abandoned_count: 0, completed_count: 50, at_risk_value: 0, currency: 'USD' } } }), NOW);
  assert.equal(byCat(c).checkouts.status, BUSINESS_STATUS.HEALTHY);
});
test('A: no out-of-stock -> product healthy', () => {
  const c = buildBusinessHealth(bundle(), NOW);
  assert.equal(byCat(c).product_availability.status, BUSINESS_STATUS.HEALTHY);
});

// ── Scenario B: revenue deterioration (documented thresholds) ─────────────
test('B: thresholds are documented constants', () => {
  assert.equal(THRESHOLDS.revenue.critical_pct, -40);
  assert.equal(THRESHOLDS.revenue.deteriorating_pct, -10);
  assert.equal(THRESHOLDS.orders.critical_pct, -50);
  assert.equal(THRESHOLDS.orders.deteriorating_pct, -20);
  assert.equal(THRESHOLDS.product.critical_oos_pct, 50);
  assert.equal(THRESHOLDS.product.deteriorating_oos_pct, 20);
});
test('B: revenue -15% -> deteriorating', () => {
  const c = buildBusinessHealth(bundle({ revenue: { current: { net: 850, currency: 'USD' }, comparison: { net: 1000, currency: 'USD' } } }), NOW);
  assert.equal(byCat(c).revenue.status, BUSINESS_STATUS.DETERIORATING);
  assert.equal(byCat(c).revenue.change_pct, -15);
});
test('B: revenue -45% -> critical', () => {
  const c = buildBusinessHealth(bundle({ revenue: { current: { net: 550, currency: 'USD' }, comparison: { net: 1000, currency: 'USD' } } }), NOW);
  assert.equal(byCat(c).revenue.status, BUSINESS_STATUS.CRITICAL);
});
test('B: revenue -5% -> attention', () => {
  const c = buildBusinessHealth(bundle({ revenue: { current: { net: 950, currency: 'USD' }, comparison: { net: 1000, currency: 'USD' } } }), NOW);
  assert.equal(byCat(c).revenue.status, BUSINESS_STATUS.ATTENTION);
});
test('B: boundary -40% -> critical', () => {
  const c = buildBusinessHealth(bundle({ revenue: { current: { net: 600, currency: 'USD' }, comparison: { net: 1000, currency: 'USD' } } }), NOW);
  assert.equal(byCat(c).revenue.status, BUSINESS_STATUS.CRITICAL);
});
test('B: boundary -10% -> deteriorating', () => {
  const c = buildBusinessHealth(bundle({ revenue: { current: { net: 900, currency: 'USD' }, comparison: { net: 1000, currency: 'USD' } } }), NOW);
  assert.equal(byCat(c).revenue.status, BUSINESS_STATUS.DETERIORATING);
});
test('B: revenue components preserve gross/net/refunds/discounts', () => {
  const c = buildBusinessHealth(bundle(), NOW);
  const vc = byCat(c).revenue.value_components;
  assert.equal(vc.net, 1000);
  assert.equal(vc.gross, 1100);
  assert.equal(vc.refunds, 100);
  assert.equal(vc.discounts, 50);
});
test('B: revenue value 2dp rounding, not fabricated', () => {
  const c = buildBusinessHealth(bundle({ revenue: { current: { net: 123.456, currency: 'USD' }, comparison: { net: 1000, currency: 'USD' } } }), NOW);
  assert.equal(byCat(c).revenue.value, 123.46);
});

// ── Currency boundaries ───────────────────────────────────────────────────
test('currency: different currency comparison -> no change, no fabricated %', () => {
  const c = buildBusinessHealth(bundle({ revenue: { current: { net: 850, currency: 'USD' }, comparison: { net: 1000, currency: 'EUR' } } }), NOW);
  const rev = byCat(c).revenue;
  assert.equal(rev.change_pct, null);
  assert.equal(rev.status, BUSINESS_STATUS.INSUFFICIENT_HISTORY);
  assert.ok(rev.limitations.some((l) => l.includes('currency')));
});

// ── Scenario C: order sync failure = data quality, not fabricated business ──
test('C: failed order sync -> revenue/orders NOT asserted (insufficient), value preserved', () => {
  const c = buildBusinessHealth(bundle({ integration: integrationState({ domains: { orders: failedDomain(), abandoned_checkouts: freshDomain(), products: freshDomain(), inventory: freshDomain() } }) }), NOW);
  const rev = byCat(c).revenue;
  assert.equal(rev.status, BUSINESS_STATUS.INSUFFICIENT_HISTORY);
  assert.notEqual(rev.data_quality, DATA_QUALITY.COMPLETE);
  assert.equal(rev.value, 1000); // verified history preserved, not erased
});
test('C: never-synchronized order domain -> data_quality unavailable', () => {
  const c = buildBusinessHealth(bundle({ integration: integrationState({ domains: { orders: neverDomain(), abandoned_checkouts: freshDomain(), products: freshDomain(), inventory: freshDomain() } }) }), NOW);
  assert.equal(byCat(c).revenue.data_quality, DATA_QUALITY.UNAVAILABLE);
  assert.equal(byCat(c).orders.data_quality, DATA_QUALITY.UNAVAILABLE);
});
test('C: stale order domain -> data_quality stale', () => {
  const c = buildBusinessHealth(bundle({ integration: integrationState({ domains: { orders: staleDomain(), abandoned_checkouts: freshDomain(), products: freshDomain(), inventory: freshDomain() } }) }), NOW);
  assert.equal(byCat(c).revenue.data_quality, DATA_QUALITY.STALE);
});
test('C: separation — integration sync_failed is deteriorating while revenue is not fabricated', () => {
  const c = buildBusinessHealth(bundle({ integration: integrationState({ domains: { orders: failedDomain(), abandoned_checkouts: freshDomain(), products: freshDomain(), inventory: freshDomain() }, overall_status: 'sync_failed' }) }), NOW);
  assert.equal(byCat(c).integration.status, BUSINESS_STATUS.DETERIORATING);
  assert.equal(byCat(c).revenue.status, BUSINESS_STATUS.INSUFFICIENT_HISTORY);
  // overall business status must not be fabricated from the incomplete revenue
  assert.notEqual(c.business_status, BUSINESS_STATUS.CRITICAL);
});

// ── Scenario D: incomplete checkout access ────────────────────────────────
test('D: checkout domain never synced -> unavailable, no manufactured metric', () => {
  const c = buildBusinessHealth(bundle({ integration: integrationState({ domains: { orders: freshDomain(), abandoned_checkouts: neverDomain(), products: freshDomain(), inventory: freshDomain() } }) }), NOW);
  assert.equal(byCat(c).checkouts.data_quality, DATA_QUALITY.UNAVAILABLE);
  assert.equal(byCat(c).checkouts.status, BUSINESS_STATUS.INSUFFICIENT_HISTORY);
});
test('D: abandoned checkouts -> attention, framed as at-risk exposure', () => {
  const c = buildBusinessHealth(bundle({ checkouts: { current: { abandoned_count: 3, completed_count: 37, at_risk_value: 300, currency: 'USD' } } }), NOW);
  const co = byCat(c).checkouts;
  assert.equal(co.status, BUSINESS_STATUS.ATTENTION);
  assert.ok(co.explanation.includes('at risk'));
  assert.ok(co.explanation.includes('not confirmed lost revenue'));
});
test('D: conversion rate only with a valid denominator', () => {
  const c = buildBusinessHealth(bundle({ checkouts: { current: { abandoned_count: 3, completed_count: 37, at_risk_value: 300, currency: 'USD' } } }), NOW);
  const co = byCat(c).checkouts;
  assert.equal(co.conversion_rate, Math.round((37 / 40) * 1000) / 10); // 37/(37+3)
  const noDenom = buildBusinessHealth(bundle({ checkouts: { current: { abandoned_count: 0, completed_count: 0, at_risk_value: 0, currency: 'USD' } } }), NOW);
  assert.equal(byCat(noDenom).checkouts.conversion_rate, null);
});

// ── Scenario E: inventory capability unavailable ──────────────────────────
test('E: product/inventory never synced -> unavailable', () => {
  const c = buildBusinessHealth(bundle({ integration: integrationState({ domains: { orders: freshDomain(), abandoned_checkouts: freshDomain(), products: neverDomain(), inventory: neverDomain() } }) }), NOW);
  assert.equal(byCat(c).product_availability.data_quality, DATA_QUALITY.UNAVAILABLE);
});
test('E: oos share >= 50% -> critical', () => {
  const c = buildBusinessHealth(bundle({ productAvailability: { snapshot: { available_count: 45, unavailable_count: 0, out_of_stock_count: 55, total_products: 100, synced_at: iso(0), snapshot_only: true } } }), NOW);
  assert.equal(byCat(c).product_availability.status, BUSINESS_STATUS.CRITICAL);
});
test('E: oos share >= 20% -> deteriorating', () => {
  const c = buildBusinessHealth(bundle({ productAvailability: { snapshot: { available_count: 70, unavailable_count: 10, out_of_stock_count: 25, total_products: 105, synced_at: iso(0), snapshot_only: true } } }), NOW);
  assert.equal(byCat(c).product_availability.status, BUSINESS_STATUS.DETERIORATING);
});
test('E: oos share < 20% -> attention', () => {
  const c = buildBusinessHealth(bundle({ productAvailability: { snapshot: { available_count: 90, unavailable_count: 5, out_of_stock_count: 4, total_products: 99, synced_at: iso(0), snapshot_only: true } } }), NOW);
  assert.equal(byCat(c).product_availability.status, BUSINESS_STATUS.ATTENTION);
});
test('E: zero products -> insufficient, NOT out-of-stock', () => {
  const c = buildBusinessHealth(bundle({ productAvailability: { snapshot: { available_count: 0, unavailable_count: 0, out_of_stock_count: 0, total_products: 0, synced_at: iso(0), snapshot_only: true } } }), NOW);
  assert.equal(byCat(c).product_availability.status, BUSINESS_STATUS.INSUFFICIENT_HISTORY);
  assert.ok(byCat(c).product_availability.explanation.includes('not read as an out-of-stock'));
});
test('E: snapshot-only limitation present (no historical inference)', () => {
  const c = buildBusinessHealth(bundle(), NOW);
  assert.ok(byCat(c).product_availability.limitations.some((l) => l.includes('current inventory snapshot only')));
});

// ── Scenario F: zero verified orders (0 != missing) ───────────────────────
test('F: verified zero orders under complete coverage -> healthy, distinguished from missing', () => {
  const c = buildBusinessHealth(bundle({ orders: { current: { count: 0 }, comparison: { count: 0 } } }), NOW);
  const o = byCat(c).orders;
  assert.equal(o.value, 0);
  assert.equal(o.status, BUSINESS_STATUS.HEALTHY);
  assert.ok(o.limitations.some((l) => l.includes('distinguished from a missing order count')));
});
test('F: zero orders under INCOMPLETE coverage -> insufficient (missing, not zero)', () => {
  const c = buildBusinessHealth(bundle({
    orders: { current: { count: 0 }, comparison: { count: 0 } },
    integration: integrationState({ domains: { orders: failedDomain(), abandoned_checkouts: freshDomain(), products: freshDomain(), inventory: freshDomain() } }),
  }), NOW);
  assert.equal(byCat(c).orders.status, BUSINESS_STATUS.INSUFFICIENT_HISTORY);
  assert.notEqual(byCat(c).orders.data_quality, DATA_QUALITY.COMPLETE);
});
test('F: decline to zero revenue (comparison positive) -> critical', () => {
  const c = buildBusinessHealth(bundle({ revenue: { current: { net: 0, currency: 'USD' }, comparison: { net: 1000, currency: 'USD' } } }), NOW);
  assert.equal(byCat(c).revenue.value, 0);
  assert.equal(byCat(c).revenue.change_pct, -100);
  assert.equal(byCat(c).revenue.status, BUSINESS_STATUS.CRITICAL);
});
test('F: unknown value (null) stays null, not fabricated 0', () => {
  const c = buildBusinessHealth(bundle({ revenue: { current: { net: null, currency: 'USD' }, comparison: { net: 1000, currency: 'USD' } } }), NOW);
  assert.equal(byCat(c).revenue.value, null);
});

// ── Scenario G: new merchant (no history / no integration) ────────────────
test('G: no integration state -> all data indicators unavailable, business insufficient', () => {
  const c = buildBusinessHealth(bundle({ integration: null }), NOW);
  assert.equal(c.business_status, BUSINESS_STATUS.INSUFFICIENT_HISTORY);
  assert.equal(byCat(c).revenue.data_quality, DATA_QUALITY.UNAVAILABLE);
  assert.equal(byCat(c).orders.data_quality, DATA_QUALITY.UNAVAILABLE);
  assert.equal(byCat(c).checkouts.data_quality, DATA_QUALITY.UNAVAILABLE);
  assert.equal(byCat(c).product_availability.data_quality, DATA_QUALITY.UNAVAILABLE);
  assert.equal(byCat(c).integration.data_quality, DATA_QUALITY.UNKNOWN);
});
test('G: integration unknown -> insufficient, not fabricated', () => {
  const c = buildBusinessHealth(bundle({ integration: integrationState({ domains: {}, overall_status: 'unknown', status_reason: 'evidence_incomplete' }) }), NOW);
  assert.equal(byCat(c).integration.status, BUSINESS_STATUS.INSUFFICIENT_HISTORY);
  assert.equal(c.business_status, BUSINESS_STATUS.INSUFFICIENT_HISTORY);
});
test('G: empty comparison (new store) -> no change classification', () => {
  const c = buildBusinessHealth(bundle({ revenue: { current: { net: 500, currency: 'USD' }, comparison: null }, orders: { current: { count: 5 }, comparison: null } }), NOW);
  assert.equal(byCat(c).revenue.status, BUSINESS_STATUS.INSUFFICIENT_HISTORY);
  assert.equal(byCat(c).revenue.change_pct, null);
});
test('G: lack of issues is NOT asserted healthy when there is no evidence', () => {
  const c = buildBusinessHealth({ store: { id: 's', organization_id: 'o', shop_domain: 'x' } }, NOW);
  assert.equal(c.business_status, BUSINESS_STATUS.INSUFFICIENT_HISTORY);
});

// ── Scenario I: partial resource failure does not suppress others ─────────
test('I: revenue fetch null (partial failure) does not suppress a healthy order indicator', () => {
  const c = buildBusinessHealth(bundle({ revenue: null, orders: { current: { count: 40 }, comparison: { count: 40 } } }), NOW);
  assert.equal(byCat(c).revenue.status, BUSINESS_STATUS.INSUFFICIENT_HISTORY);
  assert.equal(byCat(c).revenue.data_quality, DATA_QUALITY.UNAVAILABLE);
  assert.equal(byCat(c).orders.status, BUSINESS_STATUS.HEALTHY);
});
test('I: checkouts null does not suppress product availability', () => {
  const c = buildBusinessHealth(bundle({ checkouts: null }), NOW);
  assert.equal(byCat(c).checkouts.data_quality, DATA_QUALITY.UNAVAILABLE);
  assert.equal(byCat(c).product_availability.status, BUSINESS_STATUS.HEALTHY);
});

// ── Overall status = most severe among COMPLETE indicators only ───────────
test('overall: most severe across complete indicators; insufficient does not drive it', () => {
  const c = buildBusinessHealth(bundle({
    revenue: { current: { net: 550, currency: 'USD' }, comparison: { net: 1000, currency: 'USD' } }, // critical
    orders: { current: { count: 0 }, comparison: { count: 0 } },
    integration: integrationState({ domains: { orders: freshDomain(), abandoned_checkouts: neverDomain(), products: freshDomain(), inventory: freshDomain() } }), // checkouts unavailable
  }), NOW);
  assert.equal(c.business_status, BUSINESS_STATUS.CRITICAL);
  // checkouts is not complete, so it is not a business state driver
  assert.equal(byCat(c).checkouts.status, BUSINESS_STATUS.INSUFFICIENT_HISTORY);
});
test('overall: data_quality summary buckets indicators correctly', () => {
  const c = buildBusinessHealth(bundle({ integration: integrationState({ domains: { orders: freshDomain(), abandoned_checkouts: neverDomain(), products: staleDomain(), inventory: staleDomain() } }) }), NOW);
  assert.ok(c.data_quality.complete.includes('revenue'));
  assert.ok(c.data_quality.unavailable.includes('checkouts'));
  assert.ok(c.data_quality.stale.includes('product_availability'));
});
test('overall: affected_indicators_note present when integration degraded', () => {
  const c = buildBusinessHealth(bundle({ integration: integrationState({ domains: { orders: failedDomain(), abandoned_checkouts: freshDomain(), products: freshDomain(), inventory: freshDomain() }, overall_status: 'disconnected' }) }), NOW);
  assert.ok(Array.isArray(c.affected_indicators_note));
});

// ── domainCoverage unit behavior ──────────────────────────────────────────
test('domainCoverage: all fresh -> complete', () => {
  const cov = domainCoverage({ orders: freshDomain() }, ['orders'], NOW);
  assert.equal(cov.complete, true);
  assert.equal(cov.data_quality, DATA_QUALITY.COMPLETE);
});
test('domainCoverage: one of two stale -> partial (usable gap)', () => {
  const cov = domainCoverage({ products: freshDomain(), inventory: staleDomain() }, ['products', 'inventory'], NOW);
  assert.equal(cov.complete, false);
  assert.equal(cov.data_quality, DATA_QUALITY.PARTIAL);
});
test('domainCoverage: all succeeded but stale -> stale (data exists, not current)', () => {
  const cov = domainCoverage({ orders: staleDomain() }, ['orders'], NOW);
  assert.equal(cov.data_quality, DATA_QUALITY.STALE);
});
test('domainCoverage: never run -> unavailable', () => {
  const cov = domainCoverage({ orders: neverDomain() }, ['orders'], NOW);
  assert.equal(cov.data_quality, DATA_QUALITY.UNAVAILABLE);
});
test('domainCoverage: no domain map at all -> unavailable', () => {
  const cov = domainCoverage(null, ['orders'], NOW);
  assert.equal(cov.data_quality, DATA_QUALITY.UNAVAILABLE);
});

// ── Integration indicator maps the canonical state (never re-derived) ─────
test('integration: connected -> healthy; carries canonical explanation', () => {
  const c = buildBusinessHealth(bundle(), NOW);
  const i = byCat(c).integration;
  assert.equal(i.value, 'connected');
  assert.equal(i.status, BUSINESS_STATUS.HEALTHY);
  assert.equal(i.explanation, 'state is connected');
  assert.ok(i.limitations.some((l) => l.includes('fully synchronized')));
});
test('integration: authorization_revoked -> critical', () => {
  const c = buildBusinessHealth(bundle({ integration: integrationState({ domains: {}, overall_status: 'authorization_revoked' }) }), NOW);
  assert.equal(byCat(c).integration.status, BUSINESS_STATUS.CRITICAL);
});

// ── Fail-closed validator ─────────────────────────────────────────────────
test('validate: valid contract -> no problems', () => {
  assert.deepEqual(validateBusinessHealth(buildBusinessHealth(bundle(), NOW)), []);
});
test('validate: wrong contract_version -> problem', () => {
  const c = buildBusinessHealth(bundle(), NOW);
  c.contract_version = 'rev-business-health-v0';
  assert.ok(validateBusinessHealth(c).some((p) => p.includes('contract_version')));
});
test('validate: missing indicator category -> problem', () => {
  const c = buildBusinessHealth(bundle(), NOW);
  c.indicators = c.indicators.filter((i) => i.category !== 'checkouts');
  assert.ok(validateBusinessHealth(c).some((p) => p.includes('missing indicator category: checkouts')));
});
test('validate: invalid business status -> problem', () => {
  const c = buildBusinessHealth(bundle(), NOW);
  c.indicators[0].status = 'explosive';
  assert.ok(validateBusinessHealth(c).some((p) => p.includes('status invalid')));
});
test('validate: non-object -> problem', () => {
  assert.ok(validateBusinessHealth(null).length > 0);
});
