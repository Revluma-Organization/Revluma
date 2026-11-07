'use strict';

// Task 215 — idempotent, tenant-scoped manual sync-retry service.
// Pins the hard requirements: server-side tenant ownership, deterministic
// eligibility (permanent => not sync-retryable, reconnect instead), and
// DATABASE-level idempotency/dedup (no in-memory lock): a replayed request_key
// returns the same job, an in-flight scope returns that job, and a running job
// is never double-started.

const test = require('node:test');
const assert = require('node:assert/strict');

const { requestSyncRetry, finalizeSyncRetry } = require('../integrationRetry');

const NOW = new Date('2026-11-08T12:00:00Z');
const ISO = (s) => new Date(NOW.getTime() - s * 1000).toISOString();
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const STORE_A = '11111111-1111-4111-8111-111111111111';

function store(overrides = {}) {
  return {
    id: STORE_A, organization_id: ORG_A, platform: 'shopify', shop_domain: 'test.myshopify.com',
    access_token: 'shpat_secret', status: 'active', granted_scopes: 'read_products,read_orders',
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

function makeDb({ stores = [store()], domainRows = [], retryRequests = [] } = {}) {
  const db = {
    _stores: stores,
    _domainRows: domainRows,
    _retryRequests: retryRequests,
    stores: {
      findFirst: async ({ where }) => db._stores.find(s =>
        (where.id == null || s.id === where.id) &&
        (where.organization_id == null || s.organization_id === where.organization_id) &&
        (where.platform == null || s.platform === where.platform) &&
        (where.access_token ? s.access_token != null : true) &&
        (where.status?.notIn ? !where.status.notIn.includes(s.status) : true)) || null,
      update: async ({ where, data }) => {
        const s = db._stores.find(x => x.id === where.id);
        if (!s) throw new Error('store not found');
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && v.increment !== undefined) s[k] = (s[k] || 0) + v.increment; else s[k] = v;
        }
        return s;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const s of db._stores) {
          if (where.id && s.id !== where.id) continue;
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === 'object' && v.increment !== undefined) s[k] = (s[k] || 0) + v.increment; else s[k] = v;
          }
          count++;
        }
        return { count };
      },
    },
    store_sync_domain_states: {
      findMany: async ({ where }) => db._domainRows.filter(r => where.store_id == null || r.store_id === where.store_id),
    },
    sync_retry_requests: {
      // Prisma composite-unique key: @@unique([store_id, scope, request_key])
      findUnique: async ({ where }) => {
        const k = where.store_id_scope_request_key;
        return db._retryRequests.find(r => r.store_id === k.store_id && r.scope === k.scope && r.request_key === k.request_key) || null;
      },
      findFirst: async ({ where }) => db._retryRequests.find(r =>
        (where.store_id == null || r.store_id === where.store_id) &&
        (where.scope == null || r.scope === where.scope) &&
        (where.status?.in ? where.status.in.includes(r.status) : (where.status ? r.status === where.status : true))) || null,
      create: async ({ data }) => {
        const row = { id: `rr-${db._retryRequests.length + 1}`, status: 'requested', attempt: 1, created_at: NOW, updated_at: NOW, ...data };
        db._retryRequests.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const r of db._retryRequests) {
          if (where.store_id && r.store_id !== where.store_id) continue;
          if (where.status?.in && !where.status.in.includes(r.status)) continue;
          Object.assign(r, data);
          count++;
        }
        return { count };
      },
    },
    $transaction: async (callback) => callback(db),
  };
  return db;
}

// A transient (provider) failure: orders failed with a 503.
function transientDb() {
  return makeDb({ domainRows: [
    domainRow('products', { status: 'never_run' }),
    domainRow('orders', { status: 'failed', records_discovered: 50, records_inserted: 20, error_code: 'SHOPIFY_HTTP_ERROR_503', retry_count: 1, last_attempted_at: ISO(120) }),
    domainRow('abandoned_checkouts', { status: 'never_run' }),
  ] });
}

test('tenant ownership: a cross-tenant store id is 404 (no existence leak)', async () => {
  const db = makeDb({ stores: [store({ id: '22222222-2222-4222-8222-222222222222', organization_id: ORG_B })] });
  const result = await requestSyncRetry({ db, organizationId: ORG_A, storeId: '22222222-2222-4222-8222-222222222222', now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 404);
  assert.equal(db._retryRequests.length, 0);
});

test('tenant ownership: an unknown store id is 404', async () => {
  const db = transientDb();
  const result = await requestSyncRetry({ db, organizationId: ORG_A, storeId: '99999999-9999-4999-8999-999999999999', now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 404);
});

test('transient failure is eligible: 202 accepted, store transitions to running, one request row created', async () => {
  const db = transientDb();
  const before = db._stores[0].sync_attempt_count;
  const result = await requestSyncRetry({ db, organizationId: ORG_A, storeId: STORE_A, scope: 'all', requestKey: 'req-1', now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.httpStatus, 202);
  assert.equal(result.data.started, true);
  assert.equal(result.data.status, 'accepted');
  assert.equal(result.data.idempotent, false);
  assert.equal(db._retryRequests.length, 1);
  assert.equal(db._retryRequests[0].status, 'accepted');
  assert.equal(db._retryRequests[0].request_key, 'req-1');
  assert.equal(db._stores[0].initial_sync_status, 'running');
  assert.equal(db._stores[0].sync_attempt_count, before + 1);
  assert.equal(db._stores[0].recovery_status, 'recovering');
});

test('idempotency: replaying the same request_key returns the SAME job, no duplicate row', async () => {
  const db = transientDb();
  const first = await requestSyncRetry({ db, organizationId: ORG_A, storeId: STORE_A, requestKey: 'req-dup', now: NOW });
  assert.equal(first.data.started, true);
  const firstJobId = first.data.job_id;
  // Replay the exact same request (same key) even though the store is now running.
  const second = await requestSyncRetry({ db, organizationId: ORG_A, storeId: STORE_A, requestKey: 'req-dup', now: NOW });
  assert.equal(second.ok, true);
  assert.equal(second.httpStatus, 202);
  assert.equal(second.data.idempotent, true, 'replay is idempotent, not a new job');
  assert.equal(second.data.started, false);
  assert.equal(second.data.job_id, firstJobId, 'same job id returned');
  assert.equal(db._retryRequests.length, 1, 'no duplicate row');
});

test('dedup: a second (different-key) retry while one is in-flight returns the existing job', async () => {
  const db = transientDb();
  const first = await requestSyncRetry({ db, organizationId: ORG_A, storeId: STORE_A, requestKey: 'req-a', now: NOW });
  assert.equal(first.data.started, true);
  // A NEW request key while the first is still in-flight (store running) =>
  // the already_in_progress guard returns the existing job, never a duplicate.
  const second = await requestSyncRetry({ db, organizationId: ORG_A, storeId: STORE_A, requestKey: 'req-b', now: NOW });
  assert.equal(second.ok, false);
  assert.equal(second.httpStatus, 409);
  assert.equal(second.error, 'already_in_progress');
  assert.equal(db._retryRequests.length, 1, 'no duplicate job started');
});

test('a running job is never double-started (409 already_in_progress)', async () => {
  const db = makeDb({
    stores: [store({ initial_sync_status: 'running', sync_started_at: ISO(10), updated_at: ISO(5) })],
    domainRows: [domainRow('products', { status: 'running', last_attempted_at: ISO(5) })],
  });
  const result = await requestSyncRetry({ db, organizationId: ORG_A, storeId: STORE_A, requestKey: 'req-run', now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 409);
  assert.equal(result.error, 'already_in_progress');
  assert.equal(db._retryRequests.length, 0);
});

test('permanent authorization failure is NOT sync-retryable (409, reconnect)', async () => {
  const db = makeDb({
    stores: [store({ initial_sync_status: 'failed', sync_error_code: 'SHOPIFY_UNAUTHORIZED' })],
    domainRows: [domainRow('orders', { status: 'failed', error_code: 'SHOPIFY_UNAUTHORIZED', retry_count: 1, last_attempted_at: ISO(10) })],
  });
  const result = await requestSyncRetry({ db, organizationId: ORG_A, storeId: STORE_A, requestKey: 'req-auth', now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 409);
  assert.equal(result.error, 'retry_not_eligible');
  assert.equal(result.data.next_step, 'reconnect');
  assert.equal(result.data.category, 'authorization');
  assert.equal(db._retryRequests.length, 0, 'no job started for a permanent failure');
  assert.equal(db._stores[0].initial_sync_status, 'failed', 'store state untouched');
});

test('permission failure is not sync-retryable (409, reconnect)', async () => {
  const db = makeDb({
    stores: [store({ initial_sync_status: 'failed', sync_error_code: 'SHOPIFY_ACCESS_DENIED' })],
    domainRows: [domainRow('orders', { status: 'failed', error_code: 'SHOPIFY_ACCESS_DENIED', retry_count: 2, last_attempted_at: ISO(10) })],
  });
  const result = await requestSyncRetry({ db, organizationId: ORG_A, storeId: STORE_A, requestKey: 'req-perm', now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'retry_not_eligible');
  assert.equal(result.data.category, 'permission');
  assert.equal(result.data.next_step, 'reconnect');
});

test('a healthy/idle store with nothing actionable refuses a retry (409, no fabricated work)', async () => {
  const db = makeDb({
    stores: [store({ initial_sync_status: 'completed', sync_error_code: null })],
    domainRows: [
      domainRow('products', { status: 'ok', records_discovered: 10, records_inserted: 10, pagination_complete: true, pages_completed: 1, last_succeeded_at: ISO(10) }),
      domainRow('orders', { status: 'ok', records_discovered: 5, records_inserted: 5, pagination_complete: true, pages_completed: 1, last_succeeded_at: ISO(10) }),
      domainRow('abandoned_checkouts', { status: 'ok', records_discovered: 1, records_inserted: 1, pagination_complete: true, pages_completed: 1, last_succeeded_at: ISO(10) }),
    ],
  });
  const result = await requestSyncRetry({ db, organizationId: ORG_A, storeId: STORE_A, requestKey: 'req-idle', now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 409);
  assert.equal(result.error, 'retry_not_eligible');
  assert.equal(result.data.reason_code, 'NO_ACTIONABLE_FAILURE');
  assert.equal(db._retryRequests.length, 0);
});

test('an invalid scope is rejected (400)', async () => {
  const db = transientDb();
  const result = await requestSyncRetry({ db, organizationId: ORG_A, storeId: STORE_A, scope: 'not-a-domain', requestKey: 'req-scope', now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 400);
});

test('a domain-scoped retry is accepted and recorded with that scope', async () => {
  const db = transientDb();
  const result = await requestSyncRetry({ db, organizationId: ORG_A, storeId: STORE_A, scope: 'orders', requestKey: 'req-orders', now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.httpStatus, 202);
  assert.equal(db._retryRequests[0].scope, 'orders');
});

test('finalizeSyncRetry marks in-flight requests terminal with a real timestamp', async () => {
  const db = transientDb();
  await requestSyncRetry({ db, organizationId: ORG_A, storeId: STORE_A, requestKey: 'req-fin', now: NOW });
  assert.equal(db._retryRequests[0].status, 'accepted');
  const res = await finalizeSyncRetry({ db, storeId: STORE_A, status: 'completed', now: NOW });
  assert.equal(res.updated, 1);
  assert.equal(db._retryRequests[0].status, 'completed');
  assert.ok(db._retryRequests[0].completed_at != null);
});

test('finalizeSyncRetry ignores non-terminal statuses (no-op)', async () => {
  const db = transientDb();
  await requestSyncRetry({ db, organizationId: ORG_A, storeId: STORE_A, requestKey: 'req-fin2', now: NOW });
  const res = await finalizeSyncRetry({ db, storeId: STORE_A, status: 'running', now: NOW });
  assert.equal(res.updated, 0);
  assert.equal(db._retryRequests[0].status, 'accepted', 'still in-flight');
});

test('a stalled job (worker gone) IS retryable (not blocked as already_in_progress)', async () => {
  const db = makeDb({
    stores: [store({ initial_sync_status: 'running', status: 'syncing', sync_started_at: ISO(100000), updated_at: ISO(100000) })],
    domainRows: [domainRow('products', { status: 'running', last_attempted_at: ISO(8000) })], // 8000s > 7200s stall threshold
  });
  const result = await requestSyncRetry({ db, organizationId: ORG_A, storeId: STORE_A, requestKey: 'req-stall', now: NOW });
  assert.equal(result.ok, true, 'a stalled job can be retried');
  assert.equal(result.httpStatus, 202);
});
