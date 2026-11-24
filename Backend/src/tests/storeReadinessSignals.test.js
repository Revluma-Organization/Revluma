'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateOrganizationFindings } = require('../services/intelligenceFindingsAggregator');
const { persistVerifiedFindings } = require('../services/intelligenceFindingsRepository');
const { certifiedFinding } = require('../services/revMerchantContext');
const { prioritizedFindings, presentPriorityFinding } = require('../services/priorityFindingService');
const { TRUSTED_SOURCE } = require('../services/intelligenceOrderCoverage');

const ORG_ID = '1dc6aa19-9737-4770-a340-ff812a8b139a';
const STORE_ID = '3ed79446-cb6d-4a1c-b174-9ec1ab91fe15';
const NOW = new Date('2026-11-24T12:00:00Z');

function makeRichStoreDb({
  primaryDomainHost = 'revluma-test-store-v1.myshopify.com',
  domains = [{ host: 'revluma-test-store-v1.myshopify.com', kind: 'myshopify', synced_at: NOW }],
  orders = [],
  lastOrder = { ordered_at: new Date('2026-10-30T08:00:34Z') },
  activeProducts = 15,
  abandonedCarts = [
    ...Array.from({ length: 31 }, () => ({
      status: 'abandoned',
      cart_value: '1106.75',
      currency: 'USD',
      abandoned_at: new Date('2026-11-15T10:00:00Z'),
    })),
    ...Array.from({ length: 4 }, () => ({
      status: 'recovered',
      cart_value: '986.71',
      currency: 'USD',
      abandoned_at: new Date('2026-11-16T10:00:00Z'),
    })),
  ],
  inventoryLevels = [
    ...Array.from({ length: 6 }, () => ({ quantities: { available: 0 }, synced_at: NOW })),
    ...Array.from({ length: 22 }, () => ({ quantities: { available: 12 }, synced_at: NOW })),
  ],
  eventsCount = 0,
} = {}) {
  const persistedRows = new Map();
  let idCounter = 1;
  return {
    persistedRows,
    stores: {
      findMany: async () => [{
        id: STORE_ID,
        organization_id: ORG_ID,
        status: 'active',
        last_synced_at: new Date('2026-11-24T11:12:54Z'),
        platform: 'shopify',
        shop_domain: 'revluma-test-store-v1.myshopify.com',
      }],
      findFirst: async () => ({ id: STORE_ID }),
    },
    webhook_registrations: { count: async () => 0 },
    store_profiles: {
      findFirst: async () => ({
        primary_domain_host: primaryDomainHost,
        myshopify_domain: 'revluma-test-store-v1.myshopify.com',
        currency_code: 'USD',
        synced_at: NOW,
      }),
    },
    store_domains: { findMany: async () => domains },
    products: { count: async () => activeProducts },
    abandoned_carts: { findMany: async () => abandonedCarts },
    inventory_levels: { findMany: async () => inventoryLevels },
    events: { count: async () => eventsCount },
    intelligence_order_coverage: {
      findFirst: async () => ({
        source: TRUSTED_SOURCE,
        source_run_id: 'coverage-run-1',
        certified_at: NOW,
        customer_lifetime_verified: false,
      }),
    },
    orders: {
      findMany: async () => orders,
      findFirst: async () => lastOrder,
      groupBy: async () => [],
    },
    intelligence_findings: {
      upsert: async ({ where, create, update }) => {
        const key = where.organization_id_dedupe_key.dedupe_key;
        const existing = persistedRows.get(key);
        const row = existing
          ? { ...existing, ...update }
          : {
              id: `00000000-0000-4000-8000-00000000000${idCounter++}`,
              ...create,
              status: 'open',
              detected_at: NOW,
              updated_at: NOW,
            };
        persistedRows.set(key, row);
        return row;
      },
    },
  };
}

test('detects, persists, certifies, ranks, and presents all five verified store-readiness and zero-sales signals', async () => {
  const db = makeRichStoreDb();
  const evaluated = await evaluateOrganizationFindings(db, ORG_ID, { now: NOW });
  const types = evaluated.findings.map(f => f.type);

  assert.ok(types.includes('no_recent_orders'), 'expected no_recent_orders');
  assert.ok(types.includes('storefront_domain_unconfigured'), 'expected storefront_domain_unconfigured');
  assert.ok(types.includes('abandoned_checkouts_open'), 'expected abandoned_checkouts_open');
  assert.ok(types.includes('inventory_stockouts'), 'expected inventory_stockouts');
  assert.ok(types.includes('no_storefront_events'), 'expected no_storefront_events');

  const saved = await persistVerifiedFindings(db, ORG_ID, evaluated.findings);
  assert.equal(saved, 5);

  const stored = [...db.persistedRows.values()];
  for (const row of stored) {
    assert.equal(certifiedFinding(row), true, `expected ${row.type} to pass certifiedFinding`);
  }

  const ranked = prioritizedFindings(stored, { now: NOW });
  assert.equal(ranked.excluded.length, 0, `unexpected exclusions: ${JSON.stringify(ranked.excluded)}`);
  assert.equal(ranked.candidates.length, 5);
  assert.equal(ranked.candidates[0].finding.type, 'no_recent_orders');
  assert.equal(ranked.candidates[0].finding.severity, 'critical');

  const presented = ranked.candidates.map(entry => presentPriorityFinding(entry, ORG_ID));
  for (const item of presented) {
    assert.equal(item.recommendation.available, true, `expected recommendation for ${item.type}`);
    assert.ok(item.evidence.observations.length >= 2, `expected observations for ${item.type}`);
    assert.equal(item.evidence.classification, 'verified_observation');
  }
});

test('does not emit readiness signals when store has a custom domain, recent orders, stocked inventory, no open abandoned carts, and traffic events', async () => {
  const db = makeRichStoreDb({
    primaryDomainHost: 'shop.brandstore.com',
    domains: [
      { host: 'revluma-test-store-v1.myshopify.com', kind: 'myshopify', synced_at: NOW },
      { host: 'shop.brandstore.com', kind: 'custom', synced_at: NOW },
    ],
    orders: [
      { customer_id: 'c1', total: '120.00', refunded_total: '0.00', currency: 'USD', ordered_at: new Date('2026-11-22T10:00:00Z'), recovery_status: 'completed' },
    ],
    abandonedCarts: [],
    inventoryLevels: [
      { quantities: { available: 25 }, synced_at: NOW },
    ],
    eventsCount: 420,
  });

  const evaluated = await evaluateOrganizationFindings(db, ORG_ID, { now: NOW });
  assert.equal(evaluated.findings.length, 0);
});
