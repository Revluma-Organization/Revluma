'use strict';

// Task 213 — canonical integration state at the API boundary.
//
// Runs without Prisma Client (the database module is mocked); the real
// controller, the real membership resolver and the real tenant-scoped
// evaluator are exercised. Asserts ACTUAL state, not HTTP 200.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const DB_PATH = require.resolve('../configs/database');
require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: { prisma: null } };

const { validateIntegrationState, INTEGRATION_STATE_CONTRACT_VERSION } = require('../services/revIntegrationState');

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '33333333-3333-4333-8333-333333333333';
const STORE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STORE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STORE_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// Anchor all fixture timestamps to the real clock so freshness policies
// (minutes-to-hours) evaluate as intended regardless of when the suite runs.
const NOW = new Date();
const HOUR_AGO = new Date(NOW.getTime() - 3600 * 1000);
const FIVE_MIN = new Date(NOW.getTime() - 5 * 60 * 1000);
const APP_SCOPES = 'read_orders,read_customers,read_products,read_inventory,read_locations,read_legal_policies,read_online_store_navigation';
const CRIT = ['store_domains', 'products', 'variants', 'orders', 'refunds', 'inventory', 'webhooks'];
const OPT = ['customers', 'locations', 'transactions', 'fulfillments', 'abandoned_checkouts'];
const TOPICS = ['orders/create', 'orders/updated', 'products/create', 'products/update', 'products/delete',
  'inventory_levels/updated', 'shopify_payments/terms_of_service_acceptance', 'app/uninstalled', 'customers/data_request'];

function freshStoreRow(id, org, domain = 'ok.myshopify.com', overrides = {}) {
  return {
    id, organization_id: org, platform: 'shopify', shop_domain: domain,
    status: 'active', access_token: 'shpat_live_secret_value',
    granted_scopes: APP_SCOPES,
    installed_at: new Date('2026-10-28T00:00:00.000Z'),
    last_synced_at: HOUR_AGO, updated_at: FIVE_MIN,
    ...overrides,
  };
}

function domainRows(storeId) {
  return [...CRIT, ...OPT].map(domain => ({
    store_id: storeId, domain, status: 'ok',
    last_attempted_at: HOUR_AGO, last_succeeded_at: HOUR_AGO,
    last_checked_at: HOUR_AGO, retry_count: 0,
    records_discovered: 100, records_inserted: 50, records_updated: 50,
    pages_completed: 10, pagination_complete: true, error_code: null,
    error_details: 'secret details that must never leak',
  }));
}

function regRows(storeId) {
  return TOPICS.map(topic => ({ store_id: storeId, topic, status: 'active', last_error: null, attempt_count: 1 }));
}

function delivRows(storeId) {
  return [{ store_id: storeId, topic: 'orders/create', status: 'processed',
    received_at: HOUR_AGO, processed_at: FIVE_MIN }];
}

function covRows(storeId) {
  return [{ store_id: storeId, organization_id: 'x', coverage_start: new Date('2026-10-01T00:00:00.000Z'),
    coverage_end: NOW, certified_at: HOUR_AGO, customer_lifetime_verified: false,
    source: 'shopify', source_run_id: 'run-1' }];
}

const DEFAULT_MEMBERSHIPS = [ { id: 'm1', organization_id: ORG_A, role: 'owner', status: 'active' } ];
const DEFAULT_STORES = [
  freshStoreRow(STORE_A, ORG_A),
  freshStoreRow(STORE_B, ORG_A, 'second.myshopify.com'),
  freshStoreRow(STORE_C, ORG_B, 'other-tenant.myshopify.com'),
];
const state = {
  memberships: DEFAULT_MEMBERSHIPS,
  stores: DEFAULT_STORES,
  queries: [],
  failDomainStates: false,
};

// ONE persistent mock installed BEFORE the controller is required (the
// controller captures the prisma object at module load); tests swap `state`.
const prismaMock = {
  organization_members: { findMany: async () => state.memberships },
  stores: {
    findMany: async ({ where }) => {
      state.queries.push({ table: 'stores', where });
      return state.stores.filter(row =>
        (where.organization_id == null || row.organization_id === where.organization_id)
        && (where.id == null || row.id === where.id));
    },
  },
  store_sync_domain_states: {
    findMany: async ({ where }) => {
      state.queries.push({ table: 'store_sync_domain_states', where });
      if (state.failDomainStates) throw new Error('sync ledger unavailable');
      const rows = [...domainRows(where.store_id)];
      if (where.store_id === STORE_B) {
        // Second store: a real, current limitation (stale orders domain).
        const orders = rows.find(row => row.domain === 'orders');
        Object.assign(orders, { status: 'ok', last_succeeded_at: new Date(NOW.getTime() - 3 * 24 * 3600 * 1000) });
      }
      return rows;
    },
  },
  webhook_registrations: {
    findMany: async ({ where }) => {
      const ids = Array.isArray(where.store_id) ? where.store_id
        : where.store_id != null && typeof where.store_id === 'object' && where.store_id.in ? where.store_id.in
        : where.store_id != null ? [where.store_id] : state.stores.map(row => row.id);
      return ids.flatMap(id => regRows(id));
    },
  },
  webhook_deliveries: {
    findMany: async ({ where }) => {
      const ids = where.store_id != null ? [where.store_id] : state.stores.map(row => row.id);
      return ids.flatMap(id => delivRows(id));
    },
  },
  intelligence_order_coverage: {
    findMany: async ({ where }) => {
      const ids = where.store_id != null ? [where.store_id] : state.stores.map(row => row.id);
      return ids.flatMap(id => covRows(id));
    },
  },
};

require.cache[DB_PATH].exports = { prisma: prismaMock };
const storeController = require('../controller/storeController');

function resetState({ memberships = DEFAULT_MEMBERSHIPS, stores = DEFAULT_STORES } = {}) {
  state.memberships = memberships;
  state.stores = stores;
  state.queries = [];
  state.failDomainStates = false;
}

function makeReq(user) { return { user }; }

function makeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function call(controllerFn, req, nextError = {}) {
  const res = makeRes();
  await controllerFn(req, res, (err) => { nextError.error = err; });
  return { res, nextError };
}

test('GET /stores/integration-states returns the versioned contract for the org (actual states asserted)', async () => {
  resetState();
  const { res, nextError } = await call(storeController.getIntegrationStates, makeReq({ id: USER_A, tenantId: ORG_A }));
  assert.equal(nextError.error, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.contract_version, INTEGRATION_STATE_CONTRACT_VERSION);
  assert.equal(res.body.data.states.length, 2); // ORG_A stores only — never ORG_B
  const byDomain = Object.fromEntries(res.body.data.states.map(s => [s.store.shop_domain, s]));
  assert.deepEqual(Object.keys(byDomain).sort(), ['ok.myshopify.com', 'second.myshopify.com']);
  for (const state of res.body.data.states) {
    assert.equal(validateIntegrationState(state).valid, true);
  }
  // Store A: fully fresh + complete coverage + healthy webhooks => connected.
  assert.equal(byDomain['ok.myshopify.com'].overall_status, 'connected');
  assert.equal(byDomain['ok.myshopify.com'].authorization.verified, true);
  // Store B: stale orders domain => limited_access (the actual limitation, not a boolean).
  assert.equal(byDomain['second.myshopify.com'].overall_status, 'limited_access');
  assert.ok(byDomain['second.myshopify.com'].capabilities
    .find(c => c.id === 'orders').freshness === 'stale');
  // Tenant isolation: the store query was org-scoped.
  const storeQueries = state.queries.filter(q => q.table === 'stores');
  for (const q of storeQueries) assert.equal(q.where.organization_id, ORG_A);
  // No secrets leak.
  const blob = JSON.stringify(res.body);
  assert.ok(!blob.includes('shpat_live_secret_value'));
  assert.ok(!blob.includes('secret details that must never leak'));
});

test('single-store endpoint returns the store state for a same-tenant id', async () => {
  resetState();
  const res = makeRes();
  await storeController.getIntegrationState(
    { user: { id: USER_A, tenantId: ORG_A }, params: { storeId: STORE_A } },
    res, () => {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.store.id, STORE_A);
  assert.equal(res.body.data.overall_status, 'connected');
  assert.equal(validateIntegrationState(res.body.data).valid, true);
});

test('cross-tenant store id is rejected with 404 and no existence leak', async () => {
  resetState();
  const res = makeRes();
  await storeController.getIntegrationState(
    { user: { id: USER_A, tenantId: ORG_A }, params: { storeId: STORE_C } },
    res, () => {});
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  const blob = JSON.stringify(res.body);
  assert.ok(!blob.includes('other-tenant'));
  assert.ok(!blob.includes(STORE_C));
});

test('unknown store id is rejected with 404', async () => {
  resetState();
  const res = makeRes();
  await storeController.getIntegrationState(
    { user: { id: USER_A, tenantId: ORG_A }, params: { storeId: '99999999-9999-4999-8999-999999999999' } },
    res, () => {});
  assert.equal(res.statusCode, 404);
});

test('no active membership -> 403 via the membership resolver', async () => {
  resetState({ memberships: [] });
  const nextError = {};
  const res = makeRes();
  await storeController.getIntegrationStates(
    { user: { id: USER_A, tenantId: ORG_A } }, res, (err) => { nextError.error = err; });
  assert.equal(nextError.error.statusCode, 403);
});

test('org with no stores returns an empty state list (200, not an error)', async () => {
  resetState({ stores: [] });
  const { res } = await call(storeController.getIntegrationStates, makeReq({ id: USER_A, tenantId: ORG_A }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.states, []);
});

test('a revoked store reports authorization_revoked even with fresh historical syncs', async () => {
  resetState({
    stores: [freshStoreRow(STORE_A, ORG_A, 'ok.myshopify.com', { status: 'revoked' })],
  });
  const { res } = await call(storeController.getIntegrationStates, makeReq({ id: USER_A, tenantId: ORG_A }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.states[0].overall_status, 'authorization_revoked');
  assert.equal(res.body.data.states[0].authorization.valid, false);
  assert.equal(res.body.data.states[0].merchant_action_required, true);
});

test('GET /stores response carries the canonical integration_state per store (additive)', async () => {
  resetState();
  const { res } = await call(storeController.getStores, makeReq({ id: USER_A, tenantId: ORG_A }));
  assert.equal(res.statusCode, 200);
  const stores = res.body.data.stores;
  assert.equal(stores.length, 2);
  for (const store of stores) {
    assert.ok(store.integration_state, 'canonical state attached');
    assert.equal(store.integration_state.contract_version, INTEGRATION_STATE_CONTRACT_VERSION);
    assert.equal(validateIntegrationState(store.integration_state).valid, true);
    // The shallow backward-compat fields remain, and the token is still stripped.
    assert.ok(!('access_token' in store));
  }
  const a = stores.find(s => s.id === STORE_A);
  assert.equal(a.integration_state.overall_status, 'connected');
  const blob = JSON.stringify(res.body);
  assert.ok(!blob.includes('shpat_live_secret_value'));
});

// The store-list contract is "return the stores": if evaluating the canonical
// state fails, the additive block degrades to null (the UI renders that as
// `unknown`, fail-closed — never connected) and the list still returns 200.
test('GET /stores degrades to integration_state null when canonical evaluation fails', async () => {
  resetState();
  state.failDomainStates = true;
  const { res, nextError } = await call(storeController.getStores, makeReq({ id: USER_A, tenantId: ORG_A }));
  assert.equal(nextError.error, undefined, 'store list must not fail');
  assert.equal(res.statusCode, 200);
  const stores = res.body.data.stores;
  assert.equal(stores.length, 2);
  for (const store of stores) {
    assert.equal(store.integration_state, null, 'additive block degrades to null, never a derived status');
    assert.ok(!('access_token' in store));
  }
});

// The dedicated endpoints stay strict: the same failure surfaces to the
// caller (the route maps it to a 500) — they exist to be the authoritative
// state source and never emit a half-evaluated contract.
test('GET /stores/integration-states fails closed when canonical evaluation fails', async () => {
  resetState();
  state.failDomainStates = true;
  const { res, nextError } = await call(storeController.getIntegrationStates, makeReq({ id: USER_A, tenantId: ORG_A }));
  assert.ok(nextError.error, 'dedicated endpoint must not swallow the failure');
  assert.equal(res.statusCode, 200, 'no body was committed before the error');
  assert.equal(res.body, null);
});
