/**
 * Shopify live-access diagnostic: sanitized output, no secrets, no PII.
 * The GraphQL layer is stubbed; the live path is exercised only behind admin auth in production.
 */
'use strict';

// Stub the Prisma-backed database module so this suite runs without a generated client.
process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY =
  process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const dbPath = require.resolve('../configs/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: {} } };

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildStoreAccessDiagnostic, REQUIRED_SCOPES } = require('../services/shopifyAccessDiagnostic');

const STORE = {
  id: '3ed79446-0000-4000-8000-000000000001',
  organization_id: '1dc6aa19-0000-4000-8000-000000000001',
  platform: 'shopify',
  shop_domain: 'revluma-test-store.myshopify.com',
  status: 'active',
  installed_at: new Date('2026-10-27T09:00:00Z'),
  last_synced_at: new Date('2026-11-06T10:03:00Z'),
  granted_scopes: 'read_products,read_orders',
  access_token: 'v9-not-decryptable-here',
};

const FULL_GRANTED = ['read_products', 'read_orders', 'read_all_orders', 'read_customers', 'read_inventory', 'read_checkouts', 'read_content'];

function makeGraphql({ scopes = FULL_GRANTED, scopeError = null, probes = {} } = {}) {
  const calls = [];
  const graphql = async (store, query, variables = {}) => {
    assert.equal(store.id, STORE.id);
    calls.push(query);
    if (query.includes('currentAppInstallation')) {
      if (scopeError) throw scopeError;
      return { currentAppInstallation: { accessScopes: scopes.map((handle) => ({ handle })) } };
    }
    const rootByKey = { products: 'products(first:', orders: 'orders(first:', customers: 'customers(first:', checkouts: 'abandonedCheckouts(first:' };
    for (const key of Object.keys(probes)) {
      if (query.includes(rootByKey[key])) {
        const probe = probes[key];
        if (probe instanceof Error) throw probe;
        return { [key]: { nodes: probe === 'empty' ? [] : [{ id: 'gid://x/1' }] } };
      }
    }
    throw new Error('unexpected_probe_query');
  };
  return { graphql, calls };
}
const ACCESS_DENIED = () => Object.assign(new Error('access denied'), { code: 'SHOPIFY_GRAPHQL_ERROR', shopifyErrors: [{ message: 'access denied', codes: ['ACCESS_DENIED'] }] });

test('full installation: scopes verified, all probes ok, output allow-listed', async () => {
  const { graphql } = makeGraphql({ probes: { products: 'ok', orders: 'ok', customers: 'ok', checkouts: 'ok' } });
  const d = await buildStoreAccessDiagnostic({ store: STORE, graphql, now: new Date('2026-11-06T12:00:00Z') });
  assert.equal(d.scope_query_ok, true);
  assert.deepEqual(d.required_scopes_missing_live, []);
  assert.equal(d.read_products_live, true);
  assert.equal(d.read_all_orders_live, true);
  assert.equal(d.read_inventory_live, true);
  assert.deepEqual(d.probes, { products: 'ok', orders: 'ok', customers: 'ok', checkouts: 'ok' });
  // Only allow-listed top-level keys, and no secret-shaped values anywhere.
  assert.deepEqual(Object.keys(d).sort(), [
    'installed_at', 'last_synced_at', 'live_check_performed_at', 'live_granted_scopes',
    'notes', 'oauth_recorded_granted_scopes', 'organization_id', 'platform', 'probes',
    'read_all_orders_live', 'read_checkouts_live', 'read_customers_live', 'read_inventory_live',
    'read_orders_live', 'read_products_live', 'required_scopes_missing_live', 'scope_query_ok',
    'shop_domain', 'store_id', 'store_status',
  ].sort());
  const blob = JSON.stringify(d);
  assert.ok(Object.keys(d).every((k) => !/token|secret|cipher/i.test(k)));
  assert.ok(!blob.includes('v9-not-decryptable-here'));
  assert.ok(!JSON.stringify(d.probes).includes('gid'));
  assert.ok(!blob.includes('@'));
});

test('missing scopes are reported; probes classify access_denied vs empty vs error', async () => {
  const { graphql } = makeGraphql({
    scopes: ['read_orders'],
    probes: { products: ACCESS_DENIED(), orders: 'empty', customers: new Error('boom'), checkouts: ACCESS_DENIED() },
  });
  const d = await buildStoreAccessDiagnostic({ store: STORE, graphql });
  assert.deepEqual(d.required_scopes_missing_live, ['read_products', 'read_customers', 'read_inventory', 'read_checkouts']);
  assert.equal(d.probes.products, 'access_denied');
  assert.equal(d.probes.orders, 'empty');
  assert.equal(d.probes.customers, 'error:Error');
  assert.equal(d.probes.checkouts, 'access_denied');
  assert.deepEqual(d.oauth_recorded_granted_scopes, ['read_orders', 'read_products']);
});

test('scope query failure yields null live flags and does not fabricate access', async () => {
  const { graphql } = makeGraphql({ scopeError: new Error('provider down'), probes: { products: 'ok', orders: 'ok', customers: 'ok', checkouts: 'ok' } });
  const d = await buildStoreAccessDiagnostic({ store: STORE, graphql });
  assert.equal(d.scope_query_ok, false);
  assert.equal(d.live_granted_scopes, null);
  assert.equal(d.required_scopes_missing_live, null);
  assert.equal(d.read_products_live, null);
  assert.equal(d.read_all_orders_live, null);
});

test('REQUIRED_SCOPES covers the collections the product depends on', () => {
  for (const scope of ['read_products', 'read_orders', 'read_customers', 'read_inventory', 'read_checkouts']) {
    assert.ok(REQUIRED_SCOPES.includes(scope));
  }
});
