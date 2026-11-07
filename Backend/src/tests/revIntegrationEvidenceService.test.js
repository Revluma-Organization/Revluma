'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const DB_PATH = require.resolve('../configs/database');
require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: { prisma: null } };
const {
  retrieveIntegrationEvidence, retrieveIntegrationEvidenceById,
} = require('../services/revIntegrationEvidenceService');
const { validateEvidenceCollection } = require('../services/revEvidenceContract');

const ORG = '11111111-1111-4111-8111-111111111111';
const ORG2 = '44444444-4444-4444-8444-444444444444';
const STORE = '22222222-2222-4222-8222-222222222222';
const STORE2 = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-11-07T12:00:00.000Z');
const FIVE_MIN = new Date('2026-11-07T11:55:00.000Z');
const THREE_DAYS = new Date('2026-11-04T11:55:00.000Z');
const FULL_SCOPES = 'read_products,read_orders,read_inventory,read_customers,read_checkouts,read_locations,read_discounts,read_content,read_themes,read_shipping,read_returns';
const DOMAINS = ['store_domains', 'products', 'variants', 'orders', 'refunds', 'inventory', 'locations', 'transactions', 'fulfillments', 'customers', 'abandoned_checkouts', 'webhooks'];

const store = (overrides = {}) => ({
  id: STORE, organization_id: ORG, platform: 'shopify', status: 'active',
  shop_domain: 'ok.myshopify.com', granted_scopes: FULL_SCOPES,
  last_synced_at: FIVE_MIN, installed_at: new Date('2026-10-01T00:00:00.000Z'),
  ...overrides,
});
const ledgers = (storeRow = STORE, mutate = () => {}) => DOMAINS.map(domain => {
  const row = {
    store_id: storeRow, domain, status: 'ok', last_attempted_at: FIVE_MIN,
    last_succeeded_at: FIVE_MIN, last_checked_at: FIVE_MIN, retry_count: 0,
    records_discovered: 100, records_inserted: 90, records_updated: 10,
    pages_completed: 1, pagination_complete: true, error_code: null,
    error_details: 'details that must never leak',
  };
  return mutate(row) || row;
});
const regs = (overrides = []) => [{ store_id: STORE, topic: 'orders/create', status: 'active', last_error: null, attempt_count: 0, ...overrides }];
const delivs = (overrides = {}) => [{ store_id: STORE, topic: 'orders/create', status: 'processed', received_at: FIVE_MIN, processed_at: FIVE_MIN, ...overrides }];
const cov = (overrides = {}) => [{ store_id: STORE, coverage_start: new Date('2026-10-01T00:00:00.000Z'), coverage_end: NOW, ...overrides }];

function db({ stores = [store()], ledgerRows = ledgers(), regRows = regs(), delivRows = delivs(), covRows = cov(), hasToken = {} } = {}) {
  const calls = [];
  return {
    calls,
    stores: {
      findMany: async (args) => {
        calls.push(['stores', args]);
        return stores.filter(row =>
          row.organization_id === args.where.organization_id
          && row.platform === (args.where.platform || row.platform)
          && !(args.where.status?.notIn || []).includes(row.status)
          && (!args.where.id || row.id === args.where.id));
      },
    },
    $queryRawUnsafe: async (sql, ...values) => {
      calls.push(['raw', String(sql)]);
      const ids = values.map(String);
      return ids.map(id => ({ store_id: id, has_token: hasToken[id] !== false }));
    },
    store_sync_domain_states: {
      findMany: async (args) => { calls.push(['ledgers', args]); return ledgerRows.filter(row => args.where.store_id.in.includes(row.store_id)); },
    },
    webhook_registrations: {
      findMany: async (args) => { calls.push(['regs', args]); return regRows.filter(row => args.where.store_id.in.includes(row.store_id)); },
    },
    webhook_deliveries: {
      findMany: async (args) => { calls.push(['delivs', args]); return delivRows.filter(row => args.where.store_id.in.includes(row.store_id)); },
    },
    intelligence_order_coverage: {
      findMany: async (args) => { calls.push(['cov', args]); return covRows.filter(row => args.where.store_id.in.includes(row.store_id)); },
    },
  };
}

const query = (overrides = {}) => ({ organizationId: ORG, ...overrides });
const only = (result) => { assert.equal(result.stores.length, 1); return result.stores[0]; };

test('healthy store: explicit states, valid contract items, no credentials', async () => {
  const fakeDb = db();
  const result = await retrieveIntegrationEvidence(query(), { db: fakeDb, now: NOW });
  assert.equal(result.schema_version, 'rev-evidence-v2');
  assert.equal(result.metric_family, 'integration');
  assert.equal(result.overall_status, 'healthy');
  const s = only(result);
  assert.equal(s.connection.state, 'authenticated');
  assert.equal(s.health.components.synchronization, 'healthy');
  assert.equal(s.health.critical_failures.length, 0);
  assert.equal(s.webhooks.state, 'healthy');
  // The credential probe must stay a scalar-bound IN list (no token column selected).
  const rawCall = fakeDb.calls.find(entry => entry[0] === 'raw');
  assert.ok(rawCall, 'credential probe must run');
  assert.match(rawCall[1], /s\.id::text IN \(\$1/);
  // The token column may appear only inside the IS NOT NULL boolean probe.
  assert.equal(rawCall[1].split('access_token').length - 1, 1);
  assert.match(rawCall[1], /access_token IS NOT NULL/);
  assert.equal(validateEvidenceCollection(result.items, { organizationId: ORG, storeIds: result.store_ids }).valid, true);
  const payload = JSON.stringify(result);
  assert.ok(!payload.includes('access_token'));
  assert.ok(!payload.includes('webhook_secret'));
  assert.ok(!payload.includes('error_details'));
  assert.ok(!payload.includes('details that must never leak'));
});

test('no store: disconnected, never healthy', async () => {
  const result = await retrieveIntegrationEvidence(query(), { db: db({ stores: [] }), now: NOW });
  assert.equal(result.overall_status, 'disconnected');
  assert.deepEqual(result.stores, []);
});

test('failed orders sync is partially_operational and visible, never hidden', async () => {
  const result = await retrieveIntegrationEvidence(query(), {
    db: db({ ledgerRows: ledgers(STORE, row => (row.domain === 'orders' ? { ...row, status: 'failed', error_code: 'SHOPIFY_API 500' } : row)) }),
    now: NOW,
  });
  assert.equal(result.overall_status, 'partially_operational');
  const s = only(result);
  assert.equal(s.synchronization.orders.state, 'failed');
  assert.equal(s.synchronization.orders.failure_class, 'shopify_api');
  assert.ok(s.health.critical_failures.some(f => f.resource_id === 'orders'));
  const item = result.items.find(i => i.metric === 'integration.resource.orders');
  assert.equal(item.value, 'failed');
  assert.equal(result.items.find(i => i.metric === 'integration.health_overall').value, 'partially_operational');
});

test('missing critical scope is unauthorized with the missing permission named', async () => {
  const result = await retrieveIntegrationEvidence(query(), {
    db: db({ stores: [store({ granted_scopes: FULL_SCOPES.replace('read_orders,', '') })] }),
    now: NOW,
  });
  assert.equal(result.overall_status, 'unauthorized');
  const s = only(result);
  assert.ok(s.health.missing_permissions.includes('read_orders'));
  const orders = s.capabilities.find(cap => cap.resource_id === 'orders');
  assert.equal(orders.authorization.state, 'missing_scope');
  assert.equal(orders.operational, false);
});

test('token rejection is attention_required with verification_failed connection', async () => {
  const result = await retrieveIntegrationEvidence(query(), {
    db: db({ ledgerRows: ledgers(STORE, row => (row.domain === 'orders' ? { ...row, status: 'failed', error_code: 'SHOPIFY_API 401 TOKEN_INVALID' } : row)) }),
    now: NOW,
  });
  assert.equal(result.overall_status, 'attention_required');
  assert.equal(only(result).connection.state, 'verification_failed');
});

test('fresh installation is verification_pending, not a failure', async () => {
  const result = await retrieveIntegrationEvidence(query(), {
    db: db({
      stores: [store({ status: 'syncing', last_synced_at: null })],
      ledgerRows: [], regRows: [], delivRows: [], covRows: [],
    }),
    now: NOW,
  });
  assert.equal(result.overall_status, 'verification_pending');
  const s = only(result);
  assert.equal(s.connection.state, 'installation_pending');
  assert.ok(s.health.critical_failures.every(f => f.class === 'never_synchronized'));
});

test('stale orders sync is partially_operational with the stale resource named', async () => {
  const result = await retrieveIntegrationEvidence(query(), {
    db: db({ ledgerRows: ledgers(STORE, row => (row.domain === 'orders' ? { ...row, last_succeeded_at: THREE_DAYS, last_attempted_at: THREE_DAYS } : row)) }),
    now: NOW,
  });
  assert.equal(result.overall_status, 'partially_operational');
  const s = only(result);
  assert.equal(s.synchronization.orders.freshness.state, 'stale');
  assert.ok(s.health.stale_resources.includes('orders'));
  const item = result.items.find(i => i.metric === 'integration.resource.orders');
  assert.equal(item.value, 'stale');
});

test('running domain: sync state explicit, refresh on recent success stays operational', async () => {
  const result = await retrieveIntegrationEvidence(query(), {
    db: db({ ledgerRows: ledgers(STORE, row => (row.domain === 'orders' ? { ...row, status: 'running' } : row)) }),
    now: NOW,
  });
  const s = only(result);
  assert.equal(s.synchronization.orders.state, 'running');
  assert.equal(s.synchronization.orders.freshness.state, 'synchronizing');
  const orders = s.capabilities.find(cap => cap.resource_id === 'orders');
  assert.equal(orders.operational, true);
  assert.equal(result.overall_status, 'healthy');
  assert.deepEqual(s.health.syncing_domains, ['orders']);
});

test('webhook states: registered-but-silent is unknown, delivered-not-processed is degraded', async () => {
  const silent = await retrieveIntegrationEvidence(query(), { db: db({ delivRows: [] }), now: NOW });
  assert.equal(only(silent).webhooks.state, 'unknown');
  assert.equal(silent.overall_status, 'degraded');
  const unprocessed = await retrieveIntegrationEvidence(query(), {
    db: db({ delivRows: delivs({ status: 'received', processed_at: null }) }), now: NOW,
  });
  const wh = only(unprocessed).webhooks;
  assert.equal(wh.state, 'degraded');
  assert.match(wh.note, /delivery is working, processing is not/);
});

test('failed webhook registrations surface in health', async () => {
  const result = await retrieveIntegrationEvidence(query(), {
    db: db({
      regRows: regs({ status: 'failed', last_error: 'HTTP 404 from Shopify' }),
      delivRows: delivs({ status: 'failed', processed_at: null }),
    }),
    now: NOW,
  });
  const s = only(result);
  assert.equal(s.webhooks.state, 'failed');
  assert.deepEqual(s.webhooks.failed_topics, ['orders/create']);
  assert.equal(result.overall_status, 'partially_operational');
});

test('cross-tenant stores are never readable', async () => {
  const foreign = db({ stores: [store({ id: '66666666-6666-4666-8666-666666666666', organization_id: ORG2 })] });
  const result = await retrieveIntegrationEvidence(query(), { db: foreign, now: NOW });
  assert.equal(result.overall_status, 'disconnected');
  assert.deepEqual(result.stores, []);
  const storeIdResult = await retrieveIntegrationEvidence(query({ storeId: STORE }), { db: foreign, now: NOW });
  assert.equal(storeIdResult.overall_status, 'disconnected');
});

test('organization context is required and never client-chosen', async () => {
  await assert.rejects(
    () => retrieveIntegrationEvidence({ organizationId: null }, { db: db(), now: NOW }),
    err => err.code === 'INTEGRATION_AUTHORIZATION_REQUIRED',
  );
  await assert.rejects(
    () => retrieveIntegrationEvidence({ organizationId: 123 }, { db: db(), now: NOW }),
    err => err.code === 'INTEGRATION_AUTHORIZATION_REQUIRED',
  );
});

test('multi-store rollup reports the worst store state', async () => {
  const second = store({ id: STORE2, shop_domain: 'two.myshopify.com' });
  const badLedgers = ledgers(STORE2, row => (row.domain === 'orders' ? { ...row, status: 'failed', error_code: 'API_ERROR 500' } : row));
  const result = await retrieveIntegrationEvidence(query(), {
    db: db({
      stores: [store(), second],
      ledgerRows: [...ledgers(STORE), ...badLedgers],
      regRows: [...regs(), { store_id: STORE2, topic: 'orders/create', status: 'active', last_error: null, attempt_count: 0 }],
      delivRows: [...delivs(), { store_id: STORE2, topic: 'orders/create', status: 'processed', received_at: FIVE_MIN, processed_at: FIVE_MIN }],
      covRows: [...cov(), { store_id: STORE2, coverage_start: new Date('2026-10-01T00:00:00.000Z'), coverage_end: NOW }],
    }),
    now: NOW,
  });
  assert.equal(result.stores.length, 2);
  assert.equal(result.overall_status, 'partially_operational');
  const perStore = Object.fromEntries(result.stores.map(s => [s.store_id, s.health.overall_status]));
  assert.equal(perStore[STORE], 'healthy');
  assert.equal(perStore[STORE2], 'partially_operational');
  assert.equal(validateEvidenceCollection(result.items, { organizationId: ORG, storeIds: result.store_ids }).valid, true);
});

test('unrecorded scopes with a fresh sync are healthy, never unauthorized', async () => {
  const result = await retrieveIntegrationEvidence(query(), { db: db({ stores: [store({ granted_scopes: null })] }), now: NOW });
  assert.equal(result.overall_status, 'healthy');
  const s = only(result);
  const orders = s.capabilities.find(cap => cap.resource_id === 'orders');
  assert.equal(orders.operational, true);
  assert.equal(orders.authorization.state, 'effective_verified');
  assert.equal(orders.authorization.missing_scopes.length, 0);
  assert.match(orders.authorization.note, /No granted scopes are recorded/);
  assert.ok(s.health.warnings.some(w => w.includes('No granted Shopify scopes are recorded')));
  const auth = result.items.find(i => i.metric === 'integration.authorization');
  assert.equal(auth.value, null);
  assert.ok(auth.limitations.some(l => String(l).includes('No granted Shopify scopes are recorded')));
  assert.equal(s.health.missing_permissions.length, 0);
});

test('unrecorded scopes with a failed sync is partially_operational, not unauthorized', async () => {
  const result = await retrieveIntegrationEvidence(query(), {
    db: db({
      stores: [store({ granted_scopes: null })],
      ledgerRows: ledgers(STORE, row => (row.domain === 'orders' ? { ...row, status: 'failed', error_code: 'SHOPIFY_API 500' } : row)),
    }),
    now: NOW,
  });
  assert.equal(result.overall_status, 'partially_operational');
  const s = only(result);
  const failure = s.health.critical_failures.find(f => f.resource_id === 'orders');
  assert.match(failure.reason, /^sync_/);
  assert.notEqual(failure.reason, 'missing_scope');
  assert.equal(s.health.missing_permissions.length, 0);
});

test('evidence ids are resolvable by reference', async () => {
  const fakeDb = db();
  const result = await retrieveIntegrationEvidence(query(), { db: fakeDb, now: NOW });
  const target = result.items.find(item => item.metric === 'integration.health_overall');
  const fetched = await retrieveIntegrationEvidenceById(query({ evidenceId: target.id }), { db: fakeDb, now: NOW });
  assert.equal(fetched.id, target.id);
  await assert.rejects(
    () => retrieveIntegrationEvidenceById(query({ evidenceId: 'ev-000000000000000000000000' }), { db: fakeDb, now: NOW }),
    err => err.code === 'EVIDENCE_NOT_FOUND',
  );
});
