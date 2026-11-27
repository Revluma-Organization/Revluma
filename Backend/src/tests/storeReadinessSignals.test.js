'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateOrganizationFindings, buildSignalEvaluationSummary } = require('../services/intelligenceFindingsAggregator');
const { persistVerifiedFindings } = require('../services/intelligenceFindingsRepository');
const { certifiedFinding } = require('../services/revMerchantContext');
const { prioritizedFindings, presentPriorityFinding } = require('../services/priorityFindingService');
const { TRUSTED_SOURCE } = require('../services/intelligenceOrderCoverage');

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const STORE_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-24T12:00:00.000Z');
const RECENT_SYNC = new Date('2026-11-24T11:30:00.000Z');

function allFreshDomains(overrides = {}) {
  const base = {
    store_domains: { domain: 'store_domains', status: 'ok', capability_state: 'available', last_succeeded_at: RECENT_SYNC, pagination_complete: true },
    'analytics.reports': { domain: 'analytics.reports', status: 'ok', capability_state: 'available', last_succeeded_at: RECENT_SYNC, pagination_complete: true },
    orders: { domain: 'orders', status: 'ok', capability_state: 'available', last_succeeded_at: RECENT_SYNC, pagination_complete: true },
    abandoned_checkouts: { domain: 'abandoned_checkouts', status: 'ok', capability_state: 'available', last_succeeded_at: RECENT_SYNC, pagination_complete: true },
    products: { domain: 'products', status: 'ok', capability_state: 'available', last_succeeded_at: RECENT_SYNC, pagination_complete: true },
    inventory: { domain: 'inventory', status: 'ok', capability_state: 'available', last_succeeded_at: RECENT_SYNC, pagination_complete: true },
    fulfillments: { domain: 'fulfillments', status: 'ok', capability_state: 'available', last_succeeded_at: RECENT_SYNC, pagination_complete: true },
    refunds: { domain: 'refunds', status: 'ok', capability_state: 'available', last_succeeded_at: RECENT_SYNC, pagination_complete: true },
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) delete base[k];
    else base[k] = { ...base[k], domain: k, ...v };
  }
  return Object.values(base);
}

function makePrisma({
  primaryDomainHost = 'demo-store.myshopify.com',
  domains = [{ host: 'demo-store.myshopify.com', kind: 'myshopify', ssl_enabled: true, synced_at: RECENT_SYNC }],
  activeProducts = 15,
  totalProducts = 17,
  eventsCount = 0,
  abandonedCarts = [],
  inventoryLevels = [{ quantities: { available: 12 }, synced_at: RECENT_SYNC }],
  orders = [],
  latestOrder = null,
  domainStates = allFreshDomains(),
  hasOrderCoverage = true,
} = {}) {
  const persisted = new Map();
  let seq = 1;
  return {
    persisted,
    stores: {
      findMany: async () => [{ id: STORE_ID, status: 'active', last_synced_at: RECENT_SYNC, platform: 'shopify', shop_domain: 'demo-store.myshopify.com' }],
      findFirst: async () => ({ id: STORE_ID }),
    },
    webhook_registrations: { count: async () => 0 },
    store_sync_domain_states: {
      findMany: async () => domainStates,
      findFirst: async () => null,
    },
    store_profiles: {
      findFirst: async () => ({
        primary_domain_host: primaryDomainHost,
        myshopify_domain: 'demo-store.myshopify.com',
        primary_domain_ssl: true,
        currency_code: 'USD',
        synced_at: RECENT_SYNC,
      }),
    },
    store_domains: { findMany: async () => domains },
    products: {
      count: async ({ where }) => (where && where.status === 'active' ? activeProducts : totalProducts),
    },
    events: { count: async () => eventsCount },
    abandoned_carts: { findMany: async () => abandonedCarts },
    inventory_levels: { findMany: async () => inventoryLevels },
    intelligence_order_coverage: {
      findFirst: async () => (hasOrderCoverage
        ? { source: TRUSTED_SOURCE, source_run_id: 'run-certified-1', certified_at: RECENT_SYNC, customer_lifetime_verified: false }
        : null),
    },
    order_transactions: { findMany: async () => [] },
    orders: {
      findMany: async () => orders,
      findFirst: async () => latestOrder,
    },
    intelligence_findings: {
      upsert: async ({ create }) => {
        const id = `33333333-3333-4333-8333-${String(seq++).padStart(12, '0')}`;
        const row = { id, status: 'open', detected_at: NOW, updated_at: NOW, ...create };
        persisted.set(create.dedupe_key, row);
        return row;
      },
    },
  };
}

test('Scenario 1: .myshopify.com primary domain surfaces a calibrated medium-severity storefront readiness finding', async () => {
  const prisma = makePrisma({
    primaryDomainHost: 'revluma-test-store-v1.myshopify.com',
    domains: [{ host: 'revluma-test-store-v1.myshopify.com', kind: 'myshopify', ssl_enabled: true, synced_at: RECENT_SYNC }],
    eventsCount: 45,
    orders: [
      { customer_id: 'c1', total: 80, currency: 'USD', ordered_at: new Date('2026-11-22T10:00:00Z'), recovery_status: 'paid', refunded_total: 0, display_fulfillment_status: 'FULFILLED' },
      { customer_id: 'c2', total: 85, currency: 'USD', ordered_at: new Date('2026-11-15T10:00:00Z'), recovery_status: 'paid', refunded_total: 0, display_fulfillment_status: 'FULFILLED' },
    ],
  });

  const result = await evaluateOrganizationFindings(prisma, ORG_ID, { now: NOW });
  const domainFinding = result.findings.find(f => f.type === 'storefront_domain_unconfigured');
  assert.ok(domainFinding, 'expected storefront_domain_unconfigured finding');
  assert.equal(domainFinding.severity, 'medium', 'domain unconfigured should be medium severity, not inflated high');
  assert.equal(domainFinding.evaluation_state, 'verified');

  const saved = await persistVerifiedFindings(prisma, ORG_ID, result.findings);
  assert.equal(saved, 1);
  const rows = [...prisma.persisted.values()];
  assert.equal(certifiedFinding(rows[0]), true);

  const ranked = prioritizedFindings(rows, { now: NOW });
  assert.equal(ranked.candidates.length, 1);
  const presented = presentPriorityFinding(ranked.candidates[0], ORG_ID);
  assert.equal(presented.signal_category, 'storefront_readiness');
  assert.equal(presented.evaluation_state, 'verified');
  assert.match(presented.investigation.route, /^\/dashboard\/rev-intell\?finding=/);
});

test('Scenario 2: verified zero traffic with successful analytics access emits no_recorded_traffic', async () => {
  const prisma = makePrisma({
    primaryDomainHost: 'shop.example.com',
    domains: [{ host: 'shop.example.com', kind: 'custom', ssl_enabled: true, synced_at: RECENT_SYNC }],
    eventsCount: 0,
    orders: [
      { customer_id: 'c1', total: 50, currency: 'USD', ordered_at: new Date('2026-11-22T10:00:00Z'), recovery_status: 'paid', refunded_total: 0, display_fulfillment_status: 'FULFILLED' },
      { customer_id: 'c2', total: 55, currency: 'USD', ordered_at: new Date('2026-11-15T10:00:00Z'), recovery_status: 'paid', refunded_total: 0, display_fulfillment_status: 'FULFILLED' },
    ],
  });

  const result = await evaluateOrganizationFindings(prisma, ORG_ID, {
    now: NOW,
    analyticsByStore: { [STORE_ID]: { status: 'ok', sessions: 0, source: 'shopify_analytics' } },
  });
  const trafficFinding = result.findings.find(f => f.type === 'no_recorded_traffic');
  assert.ok(trafficFinding, 'expected verified no_recorded_traffic finding');
  assert.equal(trafficFinding.evidence.analyticsAccessVerified, true);
  assert.equal(trafficFinding.evidence.verifiedSessions, 0);

  await persistVerifiedFindings(prisma, ORG_ID, result.findings);
  const row = [...prisma.persisted.values()].find(r => r.type === 'no_recorded_traffic');
  assert.equal(certifiedFinding(row), true);
  assert.equal(result.signal_evaluation.signals.find(s => s.id === 'traffic_acquisition').state, 'verified');
});

test('Scenario 3: failed or unavailable analytics NEVER reports zero traffic and marks traffic_acquisition honestly', async () => {
  const failedPrisma = makePrisma({
    primaryDomainHost: 'shop.example.com',
    domains: [{ host: 'shop.example.com', kind: 'custom', ssl_enabled: true, synced_at: RECENT_SYNC }],
    eventsCount: 0,
    domainStates: allFreshDomains({
      'analytics.reports': { status: 'failed', capability_state: 'failed', last_succeeded_at: null, error_code: 'SHOPIFY_GRAPHQL_ERROR' },
    }),
    orders: [
      { customer_id: 'c1', total: 50, currency: 'USD', ordered_at: new Date('2026-11-22T10:00:00Z'), recovery_status: 'paid', refunded_total: 0, display_fulfillment_status: 'FULFILLED' },
      { customer_id: 'c2', total: 55, currency: 'USD', ordered_at: new Date('2026-11-15T10:00:00Z'), recovery_status: 'paid', refunded_total: 0, display_fulfillment_status: 'FULFILLED' },
    ],
  });

  const failedResult = await evaluateOrganizationFindings(failedPrisma, ORG_ID, { now: NOW });
  assert.equal(failedResult.findings.some(f => f.type === 'no_recorded_traffic'), false, 'must NEVER emit zero traffic on analytics failure');
  assert.equal(failedResult.findings.some(f => f.type === 'no_storefront_events'), false, 'must NEVER emit no_storefront_events on analytics failure');
  const trafficSig = failedResult.signal_evaluation.signals.find(s => s.id === 'traffic_acquisition');
  assert.equal(trafficSig.state, 'evaluation_failed');
  assert.equal(failedResult.signal_evaluation.incomplete, true);
  assert.equal(failedResult.signal_evaluation.summary.failed_count, 1);

  // Also test missing analytics scope/access -> not_evaluated
  const unavailPrisma = makePrisma({
    primaryDomainHost: 'shop.example.com',
    domains: [{ host: 'shop.example.com', kind: 'custom', ssl_enabled: true, synced_at: RECENT_SYNC }],
    eventsCount: 0,
    domainStates: allFreshDomains({ 'analytics.reports': null }),
    orders: [
      { customer_id: 'c1', total: 50, currency: 'USD', ordered_at: new Date('2026-11-22T10:00:00Z'), recovery_status: 'paid', refunded_total: 0, display_fulfillment_status: 'FULFILLED' },
      { customer_id: 'c2', total: 55, currency: 'USD', ordered_at: new Date('2026-11-15T10:00:00Z'), recovery_status: 'paid', refunded_total: 0, display_fulfillment_status: 'FULFILLED' },
    ],
  });
  const unavailResult = await evaluateOrganizationFindings(unavailPrisma, ORG_ID, { now: NOW });
  assert.equal(unavailResult.findings.some(f => f.type === 'no_recorded_traffic'), false);
  assert.equal(unavailResult.signal_evaluation.signals.find(s => s.id === 'traffic_acquisition').state, 'not_evaluated');
  assert.equal(unavailResult.signal_evaluation.incomplete, true);
});

test('Scenario 4: zero orders in certified period emits no_recent_orders without inventing a proven conversion cause', async () => {
  const prisma = makePrisma({
    primaryDomainHost: 'shop.example.com',
    domains: [{ host: 'shop.example.com', kind: 'custom', ssl_enabled: true, synced_at: RECENT_SYNC }],
    domainStates: allFreshDomains({ 'analytics.reports': null }),
    orders: [],
    latestOrder: { ordered_at: new Date('2026-11-01T10:00:00Z') },
  });

  const result = await evaluateOrganizationFindings(prisma, ORG_ID, { now: NOW });
  const noOrders = result.findings.find(f => f.type === 'no_recent_orders');
  assert.ok(noOrders, 'expected no_recent_orders');
  assert.equal(noOrders.evidence.currentCount, 0);
  assert.equal(noOrders.evidence.trafficEvaluated, false);
  assert.equal(result.findings.some(f => f.type === 'traffic_without_orders'), false, 'must NOT claim traffic_without_orders when traffic is unevaluated');

  await persistVerifiedFindings(prisma, ORG_ID, result.findings);
  const row = [...prisma.persisted.values()].find(r => r.type === 'no_recent_orders');
  assert.equal(certifiedFinding(row), true);
  const ranked = prioritizedFindings([row], { now: NOW });
  const presented = presentPriorityFinding(ranked.candidates[0], ORG_ID);
  assert.ok(
    presented.limitations.some(l => /traffic data was not verified/i.test(l)),
    'limitations must disclose that traffic was not verified'
  );
});

test('Scenario 5: verified traffic (>0 sessions) with zero orders emits traffic_without_orders', async () => {
  const prisma = makePrisma({
    primaryDomainHost: 'shop.example.com',
    domains: [{ host: 'shop.example.com', kind: 'custom', ssl_enabled: true, synced_at: RECENT_SYNC }],
    orders: [],
    abandonedCarts: [
      { status: 'abandoned', cart_value: 145, currency: 'USD', abandoned_at: new Date('2026-11-23T08:00:00Z') },
    ],
  });

  const result = await evaluateOrganizationFindings(prisma, ORG_ID, {
    now: NOW,
    analyticsByStore: { [STORE_ID]: { status: 'ok', sessions: 320, source: 'shopify_analytics' } },
  });
  const trafficNoOrders = result.findings.find(f => f.type === 'traffic_without_orders');
  assert.ok(trafficNoOrders, 'expected traffic_without_orders finding');
  assert.equal(trafficNoOrders.severity, 'high');
  assert.equal(trafficNoOrders.evidence.verifiedSessions, 320);
  assert.equal(trafficNoOrders.evidence.currentOrdersCount, 0);
  assert.equal(trafficNoOrders.evidence.analyticsAccessVerified, true);

  await persistVerifiedFindings(prisma, ORG_ID, result.findings);
  const row = [...prisma.persisted.values()].find(r => r.type === 'traffic_without_orders');
  assert.equal(certifiedFinding(row), true);
  const ranked = prioritizedFindings([row], { now: NOW });
  const presented = presentPriorityFinding(ranked.candidates[0], ORG_ID);
  assert.equal(presented.signal_category, 'conversion_purchasing');
  assert.ok(presented.limitations.some(l => /do not by themselves establish/i.test(l)));
});

test('Scenario 6: complete evaluation with zero threshold-crossing issues returns clean empty findings and complete coverage', async () => {
  const prisma = makePrisma({
    primaryDomainHost: 'shop.example.com',
    domains: [{ host: 'shop.example.com', kind: 'custom', ssl_enabled: true, synced_at: RECENT_SYNC }],
    activeProducts: 15,
    totalProducts: 15,
    eventsCount: 240,
    abandonedCarts: [],
    inventoryLevels: [{ quantities: { available: 25 }, synced_at: RECENT_SYNC }],
    orders: [
      { customer_id: 'c1', total: 100, currency: 'USD', ordered_at: new Date('2026-11-22T10:00:00Z'), recovery_status: 'paid', refunded_total: 0, display_fulfillment_status: 'FULFILLED' },
      { customer_id: 'c2', total: 105, currency: 'USD', ordered_at: new Date('2026-11-15T10:00:00Z'), recovery_status: 'paid', refunded_total: 0, display_fulfillment_status: 'FULFILLED' },
    ],
  });

  const result = await evaluateOrganizationFindings(prisma, ORG_ID, { now: NOW });
  assert.equal(result.findings.length, 0, 'expected zero findings when all evaluated signals are normal');
  assert.equal(result.signal_evaluation.complete, true);
  assert.equal(result.signal_evaluation.incomplete, false);
  assert.equal(result.signal_evaluation.summary.total_signals, 6);
  assert.equal(result.signal_evaluation.summary.evaluated_count, 6);
  assert.equal(result.signal_evaluation.summary.not_detected_count, 6);
  assert.equal(result.signal_evaluation.summary.failed_count, 0);
  assert.equal(result.signal_evaluation.summary.not_evaluated_count, 0);
});

test('Scenario 7: partial evaluation surfaces verified findings alongside explicit incomplete coverage AND detects inventory/fulfillment/unpublished catalog signals', async () => {
  const prisma = makePrisma({
    primaryDomainHost: 'revluma-test-store-v1.myshopify.com',
    domains: [{ host: 'revluma-test-store-v1.myshopify.com', kind: 'myshopify', ssl_enabled: true, synced_at: RECENT_SYNC }],
    activeProducts: 2,
    totalProducts: 10,
    abandonedCarts: [
      { status: 'abandoned', cart_value: 250, currency: 'USD', abandoned_at: new Date('2026-11-22T09:00:00Z'), source_resource: 'abandonedCheckouts', source_state: 'available', recovered_at: null, completed_at: null },
    ],
    inventoryLevels: [
      { quantities: { available: 0 }, synced_at: RECENT_SYNC },
      { quantities: { available: 0 }, synced_at: RECENT_SYNC },
      { quantities: { available: 10 }, synced_at: RECENT_SYNC },
    ],
    orders: [
      { customer_id: 'c1', total: 95, currency: 'USD', ordered_at: new Date('2026-11-19T08:00:00Z'), recovery_status: 'paid', refunded_total: 0, display_fulfillment_status: 'UNFULFILLED' },
      { customer_id: 'c2', total: 90, currency: 'USD', ordered_at: new Date('2026-11-14T08:00:00Z'), recovery_status: 'paid', refunded_total: 0, display_fulfillment_status: 'FULFILLED' },
    ],
    domainStates: allFreshDomains({
      'analytics.reports': { status: 'failed', capability_state: 'failed', last_succeeded_at: null, error_code: 'SHOPIFY_GRAPHQL_ERROR' },
    }),
  });

  const result = await evaluateOrganizationFindings(prisma, ORG_ID, { now: NOW });
  const types = new Set(result.findings.map(f => f.type));
  assert.ok(types.has('storefront_domain_unconfigured'), 'expected storefront_domain_unconfigured');
  assert.ok(types.has('products_unpublished_or_unavailable'), 'expected products_unpublished_or_unavailable');
  assert.ok(types.has('abandoned_checkouts_open'), 'expected abandoned_checkouts_open');
  assert.ok(types.has('inventory_stockouts'), 'expected inventory_stockouts');
  assert.ok(types.has('unfulfilled_orders_backlog'), 'expected unfulfilled_orders_backlog');
  assert.equal(types.has('no_recorded_traffic'), false, 'failed analytics must NOT emit zero traffic');

  // Coverage must truthfully reflect partial evaluation
  assert.equal(result.signal_evaluation.incomplete, true);
  assert.equal(result.signal_evaluation.complete, false);
  assert.equal(result.signal_evaluation.summary.failed_count, 1);
  assert.ok(result.signal_evaluation.summary.verified_findings_count >= 4);

  // Persist, certify, and verify ranking puts high severity ahead of medium
  const saved = await persistVerifiedFindings(prisma, ORG_ID, result.findings);
  assert.equal(saved, result.findings.length);
  const rows = [...prisma.persisted.values()];
  for (const row of rows) {
    assert.equal(certifiedFinding(row), true, `expected ${row.type} to pass certification`);
  }
  const ranked = prioritizedFindings(rows, { now: NOW });
  assert.equal(ranked.candidates.length, rows.length);
  assert.equal(ranked.candidates[0].finding.severity, 'high', 'high-severity finding should outrank medium findings');
});

test('buildSignalEvaluationSummary marks stale domains (>48h) as stale rather than not_detected', () => {
  const staleTime = new Date(NOW.getTime() - 72 * 3600_000);
  const summary = buildSignalEvaluationSummary({
    store: { id: STORE_ID },
    domainRows: allFreshDomains({
      orders: { status: 'ok', last_succeeded_at: staleTime },
    }),
    storeProfile: { primary_domain_host: 'shop.example.com', synced_at: RECENT_SYNC },
    coverage: { source: TRUSTED_SOURCE, source_run_id: 'run-1' },
    activeFindings: [],
    now: NOW,
  });
  assert.equal(summary.incomplete, true);
  assert.equal(summary.summary.stale_count, 1);
  assert.equal(summary.signals.find(s => s.id === 'sales_revenue').state, 'stale');
});
