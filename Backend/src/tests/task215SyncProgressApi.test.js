'use strict';

// Task 215 — API boundary for the authoritative sync-progress contract and the
// idempotent manual sync-retry. Pinned behavior:
//  - GET  /stores/:storeId/sync-progress  -> 200 valid contract | 404 cross-tenant
//  - POST /stores/:storeId/sync-retry     -> 202 accepted | 404 cross-tenant |
//                                            409 permanent (reconnect) |
//                                            409 already_in_progress
// Tenant ownership is enforced server-side (membership + org-scoped store load);
// the contract is fail-closed at the boundary.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SHOPIFY_API_SECRET = 'test-shopify-api-secret-for-hmac';

const DB_PATH = require.resolve('../configs/database');
require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: { prisma: null } };

const NOW = new Date('2026-11-08T12:00:00Z');
const ISO = (s) => new Date(NOW.getTime() - s * 1000).toISOString();
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const USER_A = 'user-a';
const STORE_A = '11111111-1111-4111-8111-111111111111';
const STORE_B = '22222222-2222-4222-8222-222222222222';

function storeRow(id, orgId, overrides = {}) {
  return {
    id, organization_id: orgId, platform: 'shopify', shop_domain: 'test.myshopify.com',
    access_token: 'shpat_live_secret_value', status: 'active', granted_scopes: 'read_products,read_orders',
    installed_at: ISO(100000), last_synced_at: ISO(1000), updated_at: ISO(50),
    integration_state: 'connected', integration_reason_code: 'CONNECTED', authorization_verified_at: ISO(1000),
    initial_sync_status: 'failed', current_sync_job_id: 'job-0', sync_started_at: ISO(600),
    sync_completed_at: ISO(100), sync_error_code: 'SHOPIFY_HTTP_ERROR_503', sync_attempt_count: 1,
    recovery_status: 'required', ...overrides,
  };
}

function domainRow(domain, overrides = {}) {
  return {
    store_id: STORE_A, domain, status: 'never_run', records_discovered: 0, records_inserted: 0,
    records_updated: 0, records_deleted: 0, pages_completed: null, pagination_complete: false,
    error_code: null, retry_count: 0, last_attempted_at: null, last_succeeded_at: null, checkpoint: {},
    ...overrides,
  };
}

const state = {
  memberships: [{ id: 'm1', organization_id: ORG_A, role: 'owner', status: 'active' }],
  stores: [
    storeRow(STORE_A, ORG_A),
    storeRow(STORE_B, ORG_B, { shop_domain: 'other-tenant.myshopify.com' }),
  ],
  domainRows: [
    domainRow('products', { status: 'never_run' }),
    domainRow('orders', { status: 'failed', records_discovered: 50, records_inserted: 20, error_code: 'SHOPIFY_HTTP_ERROR_503', retry_count: 1, last_attempted_at: ISO(120) }),
    domainRow('abandoned_checkouts', { status: 'never_run' }),
  ],
  retryRequests: [],
  startedSyncs: 0,
};

const prismaMock = {
  organization_members: { findMany: async () => state.memberships },
  stores: {
    findFirst: async ({ where }) => state.stores.find(s =>
      (where.id == null || s.id === where.id) &&
      (where.organization_id == null || s.organization_id === where.organization_id) &&
      (where.platform == null || s.platform === where.platform) &&
      (where.access_token ? s.access_token != null : true) &&
      (where.status?.notIn ? !where.status.notIn.includes(s.status) : true)) || null,
    update: async ({ where, data }) => {
      const s = state.stores.find(x => x.id === where.id);
      if (!s) throw new Error('store not found');
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && v.increment !== undefined) s[k] = (s[k] || 0) + v.increment; else s[k] = v;
      }
      return s;
    },
  },
  store_sync_domain_states: { findMany: async ({ where }) => state.domainRows.filter(r => r.store_id == null || r.store_id === where.store_id) },
  sync_retry_requests: {
    findUnique: async ({ where }) => {
      const k = where.store_id_scope_request_key;
      return state.retryRequests.find(r => r.store_id === k.store_id && r.scope === k.scope && r.request_key === k.request_key) || null;
    },
    findFirst: async ({ where }) => state.retryRequests.find(r =>
      (where.store_id == null || r.store_id === where.store_id) &&
      (where.scope == null || r.scope === where.scope) &&
      (where.status?.in ? where.status.in.includes(r.status) : (where.status ? r.status === where.status : true))) || null,
    create: async ({ data }) => {
      const row = { id: `rr-${state.retryRequests.length + 1}`, status: 'requested', attempt: 1, created_at: NOW, updated_at: NOW, ...data };
      state.retryRequests.push(row);
      return row;
    },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const r of state.retryRequests) {
        if (where.store_id && r.store_id !== where.store_id) continue;
        if (where.status?.in && !where.status.in.includes(r.status)) continue;
        Object.assign(r, data); count++;
      }
      return { count };
    },
  },
  $transaction: async (cb) => cb(prismaMock),
};

// Guard the fire-and-forget sync so the API test stays hermetic: count attempts,
// never touch Redis/Shopify.
const shopifySyncPath = require.resolve('../services/shopifySync');
require.cache[shopifySyncPath] = {
  id: shopifySyncPath, filename: shopifySyncPath, loaded: true,
  exports: { syncShopifyStore: async () => { state.startedSyncs++; return { success: true, jobId: 'job-test' }; } },
};

require.cache[DB_PATH].exports = { prisma: prismaMock };
const storeController = require('../controller/storeController');

function makeRes() {
  return { statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(key, val) { this.headers[key] = val; return this; } };
}
async function call(fn, req, nextError = {}) {
  const res = makeRes();
  await fn(req, res, (err) => { nextError.error = err; });
  return { res, nextError };
}
const userA = () => ({ id: USER_A, tenantId: ORG_A });

test('GET /stores/:id/sync-progress returns the versioned contract (200, valid, tenant-scoped)', async () => {
  const { res, nextError } = await call(storeController.getSyncProgress, { user: userA(), params: { storeId: STORE_A } });
  assert.equal(nextError.error, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.contract_version, 'rev-sync-progress-v1');
  assert.equal(res.body.data.job.status, 'failed');
  assert.equal(res.body.data.retry.category, 'transient_provider');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.ok(!JSON.stringify(res.body).includes('shpat_live_secret_value'));
});

test('GET /stores/:id/sync-progress is 404 for a cross-tenant store (no existence leak)', async () => {
  const { res } = await call(storeController.getSyncProgress, { user: userA(), params: { storeId: STORE_B } });
  assert.equal(res.statusCode, 404);
});

test('POST /stores/:id/sync-retry accepts a transient failure (202) and starts exactly one sync', async () => {
  const { res, nextError } = await call(storeController.requestSyncRetry,
    { user: userA(), params: { storeId: STORE_A }, body: { scope: 'all', request_key: 'api-req-1' } }, {});
  assert.equal(nextError.error, undefined);
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.data.started, true);
  assert.equal(res.body.data.idempotent, false);
  assert.equal(state.startedSyncs, 1, 'exactly one sync started');
  assert.equal(state.retryRequests.length, 1);
});

test('POST /stores/:id/sync-retry is idempotent on the same request_key (no duplicate sync)', async () => {
  const { res } = await call(storeController.requestSyncRetry,
    { user: userA(), params: { storeId: STORE_A }, body: { scope: 'all', request_key: 'api-req-1' } }, {});
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.data.idempotent, true);
  assert.equal(res.body.data.started, false);
  assert.equal(state.startedSyncs, 1, 'no second sync for a replayed request');
  assert.equal(state.retryRequests.length, 1, 'no duplicate row');
});

test('POST /stores/:id/sync-retry is 404 for a cross-tenant store', async () => {
  const { res } = await call(storeController.requestSyncRetry,
    { user: userA(), params: { storeId: STORE_B }, body: { request_key: 'x' } }, {});
  assert.equal(res.statusCode, 404);
});

test('POST /stores/:id/sync-retry refuses a permanent authorization failure (409 reconnect, no sync)', async () => {
  state.stores[0] = storeRow(STORE_A, ORG_A, {
    initial_sync_status: 'failed', sync_error_code: 'SHOPIFY_UNAUTHORIZED',
  });
  state.domainRows = [domainRow('orders', { status: 'failed', error_code: 'SHOPIFY_UNAUTHORIZED', retry_count: 1, last_attempted_at: ISO(10) })];
  const before = state.startedSyncs;
  const { res } = await call(storeController.requestSyncRetry,
    { user: userA(), params: { storeId: STORE_A }, body: { request_key: 'api-perm' } }, {});
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'retry_not_eligible');
  assert.equal(res.body.data.next_step, 'reconnect');
  assert.equal(state.startedSyncs, before, 'no sync started for a permanent failure');
});

test('POST /stores/:id/sync-retry is 409 already_in_progress when a job is running (no duplicate)', async () => {
  state.stores[0] = storeRow(STORE_A, ORG_A, { initial_sync_status: 'running', sync_started_at: ISO(10), updated_at: ISO(5) });
  state.domainRows = [domainRow('products', { status: 'running', last_attempted_at: ISO(5) })];
  const before = state.startedSyncs;
  const { res } = await call(storeController.requestSyncRetry,
    { user: userA(), params: { storeId: STORE_A }, body: { request_key: 'api-run' } }, {});
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'already_in_progress');
  assert.equal(state.startedSyncs, before, 'no duplicate job');
});
