'use strict';

// Self-managing operations: coordination leases, sync supervision and
// recovery, permission registry, capability authorization requests, data
// health, reauthorization OAuth URLs and the Integrations projection.
//
// Every DB interaction runs against small in-memory models that honour the
// same contracts Postgres enforces (unique keys → P2002, conditional
// updateMany predicates), so the concurrency and recovery semantics under test
// are the real ones, not stubs that always succeed.

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.SHOPIFY_API_KEY ||= 'test-shopify-client-id';
process.env.SHOPIFY_API_SECRET ||= 'test-shopify-client-secret';
process.env.SHOPIFY_REDIRECT_URI ||= 'https://api.example.test/api/v1/shopify/callback';
process.env.BACKEND_URL ||= 'https://api.example.test';
process.env.FRONTEND_URL ||= 'https://app.example.test';

const test = require('node:test');
const assert = require('node:assert/strict');

// Every DB dependency below is injected; the shared client must never open a
// real connection from this suite.
{
  const id = require.resolve('../configs/database');
  require.cache[id] = { id, filename: id, loaded: true, exports: { prisma: {} } };
}

const coordination = require('../services/coordination');
const supervisor = require('../services/syncSupervisor');
const permissions = require('../services/permissionRegistry');
const authorizationRequests = require('../services/authorizationRequests');
const dataHealth = require('../services/dataHealth');
const { DOMAINS } = require('../services/syncDomainState');
const engineeringAlert = require('../utils/engineeringAlert');

// ---------------------------------------------------------------------------
// In-memory models
// ---------------------------------------------------------------------------

function p2002() {
  const error = new Error('Unique constraint failed');
  error.code = 'P2002';
  return error;
}

function leaseModel({ failWith = null } = {}) {
  const rows = new Map();
  const guard = () => { if (failWith) throw failWith; };
  return {
    rows,
    create: async ({ data }) => { guard(); if (rows.has(data.lease_key)) throw p2002(); rows.set(data.lease_key, { ...data }); return data; },
    updateMany: async ({ where, data }) => {
      guard();
      const row = rows.get(where.lease_key);
      if (!row) return { count: 0 };
      if (where.expires_at?.lt && !(row.expires_at < where.expires_at.lt)) return { count: 0 };
      if (where.owner && row.owner !== where.owner) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    deleteMany: async ({ where }) => {
      guard();
      if (where.lease_key) {
        const row = rows.get(where.lease_key);
        if (!row || (where.owner && row.owner !== where.owner)) return { count: 0 };
        rows.delete(where.lease_key);
        return { count: 1 };
      }
      let count = 0;
      for (const [key, row] of rows) if (row.expires_at < where.expires_at.lt) { rows.delete(key); count += 1; }
      return { count };
    },
    findUnique: async ({ where }) => { guard(); return rows.get(where.lease_key) || null; },
  };
}

function storeModel(initial) {
  const rows = new Map(initial.map(row => [row.id, { ...row }]));
  return {
    rows,
    findUnique: async ({ where }) => rows.get(where.id) || null,
    updateMany: async ({ where, data }) => {
      const row = rows.get(where.id);
      if (!row) return { count: 0 };
      for (const [key, value] of Object.entries(where)) {
        if (key !== 'id' && row[key] !== value) return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    },
    findMany: async () => [...rows.values()],
    count: async () => 0,
  };
}

function deadLetterModel() {
  const rows = [];
  return {
    rows,
    create: async ({ data }) => {
      if (data.open_key && rows.some(row => row.open_key === data.open_key)) throw p2002();
      const row = { id: `dl-${rows.length + 1}`, status: 'open', ...data };
      rows.push(row);
      return row;
    },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const row of rows) {
        if (where.open_key && row.open_key !== where.open_key) continue;
        if (where.status && row.status !== where.status) continue;
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    },
    findMany: async ({ where } = {}) => rows.filter(row => (!where?.status || row.status === where.status)),
    findUnique: async ({ where }) => rows.find(row => row.open_key === where.open_key) || null,
    update: async ({ where, data }) => { const row = rows.find(item => item.open_key === where.open_key); Object.assign(row, data); return row; },
  };
}

function authorizationRequestModel() {
  const rows = [];
  let seq = 0;
  return {
    rows,
    findUnique: async ({ where }) => rows.find(row => row.pending_key === where.pending_key) || null,
    create: async ({ data }) => {
      if (data.pending_key && rows.some(row => row.pending_key === data.pending_key)) throw p2002();
      seq += 1;
      const row = { id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, resolved_at: null, resolution_detail: null, ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }) => { const row = rows.find(item => item.id === where.id); Object.assign(row, data); return row; },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const row of rows) {
        if (where.id && row.id !== where.id) continue;
        if (where.status && row.status !== where.status) continue;
        if (where.expires_at?.lt && !(row.expires_at < where.expires_at.lt)) continue;
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    },
    findMany: async ({ where }) => rows.filter(row => (!where.store_id || row.store_id === (where.store_id.in ? row.store_id : where.store_id))
      && (!where.store_id?.in || where.store_id.in.includes(row.store_id))
      && (!where.status || row.status === where.status)),
  };
}

const { PRODUCTION_SCOPES, SYNCED_AT, productionRows, productionStore } = require('./selfManagingStoreFixtures');

// ---------------------------------------------------------------------------
// Coordination (Redis is no longer a single point of failure)
// ---------------------------------------------------------------------------

test('lease: one holder at a time, owner-only release, expired takeover', async () => {
  const db = { coordination_leases: leaseModel() };
  const now = new Date('2026-11-23T00:00:00Z');
  const first = await coordination.acquireLease('shopify:sync:s1', { ttlSeconds: 900, db, now });
  assert.ok(first);
  assert.equal(await coordination.acquireLease('shopify:sync:s1', { ttlSeconds: 900, db, now }), null, 'a live lease cannot be stolen');
  assert.equal(await coordination.releaseLease({ key: 'shopify:sync:s1', owner: 'someone-else' }, { db }), false);
  const later = new Date(now.getTime() + 901 * 1000);
  const takeover = await coordination.acquireLease('shopify:sync:s1', { ttlSeconds: 900, db, now: later });
  assert.ok(takeover, 'a crashed worker\'s expired lease is taken over');
  assert.equal(await coordination.releaseLease(first, { db }), false, 'the superseded owner cannot release the new lease');
  assert.equal(await coordination.releaseLease(takeover, { db }), true);
});

test('lease: concurrent acquirers — exactly one wins', async () => {
  const db = { coordination_leases: leaseModel() };
  const results = await Promise.all(Array.from({ length: 8 }, () => coordination.acquireLease('job:x', { ttlSeconds: 60, db })));
  assert.equal(results.filter(Boolean).length, 1);
});

test('claimOnce: true once, then false; DB errors propagate (fail closed)', async () => {
  const db = { coordination_leases: leaseModel() };
  assert.equal(await coordination.claimOnce('shopify:oauth:consumed:abc', { ttlSeconds: 900, db }), true);
  assert.equal(await coordination.claimOnce('shopify:oauth:consumed:abc', { ttlSeconds: 900, db }), false);
  const down = Object.assign(new Error('db down'), { code: 'P1001' });
  await assert.rejects(coordination.claimOnce('k', { ttlSeconds: 60, db: { coordination_leases: leaseModel({ failWith: down }) } }), { code: 'P1001' });
});

test('heartbeat renews a held lease and reports loss', async () => {
  const db = { coordination_leases: leaseModel() };
  const lease = await coordination.acquireLease('hb', { ttlSeconds: 5, db });
  const before = db.coordination_leases.rows.get('hb').expires_at;
  const lost = [];
  const stop = coordination.startHeartbeat(lease, { ttlSeconds: 5, intervalMs: 20, db, onLost: info => lost.push(info) });
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.ok(db.coordination_leases.rows.get('hb').expires_at > before, 'heartbeat extended expiry');
  db.coordination_leases.rows.get('hb').owner = 'intruder';
  await new Promise(resolve => setTimeout(resolve, 50));
  stop();
  assert.ok(lost.some(info => info.reason === 'lease_taken_over'));
});

test('purgeExpired removes only expired rows', async () => {
  const db = { coordination_leases: leaseModel() };
  const now = new Date('2026-11-23T00:00:00Z');
  await coordination.acquireLease('old', { ttlSeconds: 1, db, now: new Date(now.getTime() - 3600 * 1000) });
  await coordination.acquireLease('live', { ttlSeconds: 600, db, now });
  assert.equal(await coordination.purgeExpired({ db, now }), 1);
  assert.ok(db.coordination_leases.rows.has('live'));
});

// ---------------------------------------------------------------------------
// Sync supervision: backoff, classification, dead letters, isolation
// ---------------------------------------------------------------------------

test('backoff doubles from 2 minutes, caps at 6 hours, jitters ±20%, honours Retry-After', () => {
  const mid = () => 0.5;
  assert.equal(supervisor.backoffMs(1, { random: mid }), 2 * 60 * 1000);
  assert.equal(supervisor.backoffMs(2, { random: mid }), 4 * 60 * 1000);
  assert.equal(supervisor.backoffMs(30, { random: mid }), 6 * 60 * 60 * 1000);
  assert.ok(supervisor.backoffMs(1, { random: () => 0 }) >= 0.8 * 2 * 60 * 1000);
  assert.ok(supervisor.backoffMs(1, { random: () => 0.999 }) <= 1.2 * 2 * 60 * 1000);
  assert.ok(supervisor.backoffMs(1, { random: mid, retryAfterMs: 30 * 60 * 1000 }) >= 30 * 60 * 1000);
});

test('failure classification distinguishes auth, rate limit, transient and system errors', () => {
  const classify = code => supervisor.classifyStoreFailure(Object.assign(new Error(code), { code }));
  assert.equal(classify('SHOPIFY_TOKEN_INVALID'), supervisor.FAILURE.AUTH);
  assert.equal(supervisor.classifyStoreFailure(Object.assign(new Error('Throttled'), { code: 'SHOPIFY_THROTTLED', status: 429 })), supervisor.FAILURE.RATE_LIMITED);
  assert.equal(classify('ETIMEDOUT'), supervisor.FAILURE.TRANSIENT);
});

test('recordSyncOutcome: failures back off, auth waits for the merchant, 5th failure dead-letters, success recovers', async () => {
  engineeringAlert._resetForTests?.();
  const db = { stores: storeModel([{ id: 's1', sync_consecutive_failures: 0 }]), operation_dead_letters: deadLetterModel() };
  const now = new Date('2026-11-23T00:00:00Z');
  const transient = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const outcome = await supervisor.recordSyncOutcome({ id: 's1' }, { ok: false, error: transient, now, random: () => 0.5, db });
    assert.equal(outcome.failures, attempt);
    assert.ok(outcome.nextAttemptAt > now);
  }
  assert.equal(db.operation_dead_letters.rows.length, 0, 'no dead letter before the threshold');
  await supervisor.recordSyncOutcome({ id: 's1' }, { ok: false, error: transient, now, random: () => 0.5, db });
  assert.equal(db.operation_dead_letters.rows.filter(row => row.status === 'open').length, 1);
  await supervisor.recordSyncOutcome({ id: 's1' }, { ok: false, error: transient, now, random: () => 0.5, db });
  assert.equal(db.operation_dead_letters.rows.filter(row => row.status === 'open').length, 1, 'dead letter is deduplicated');

  const success = await supervisor.recordSyncOutcome({ id: 's1' }, { ok: true, now, db });
  assert.equal(success.failures, 0);
  const store = db.stores.rows.get('s1');
  assert.equal(store.sync_consecutive_failures, 0);
  assert.equal(store.sync_next_attempt_at, null);
  assert.ok(db.operation_dead_letters.rows.every(row => row.status !== 'open'), 'recovery resolves the dead letter');

  const auth = await supervisor.recordSyncOutcome({ id: 's1' }, { ok: false, error: Object.assign(new Error('Invalid API key or access token'), { code: 'SHOPIFY_TOKEN_INVALID' }), now, db });
  assert.equal(auth.failureClass, supervisor.FAILURE.AUTH);
  assert.equal(auth.nextAttemptAt, null, 'a dead token is never retried on a timer');
});

test('recordSyncOutcome never throws when the outcome cannot be persisted; raises an engineering alert', async () => {
  engineeringAlert._resetForTests?.();
  const db = { stores: { findUnique: async () => { throw Object.assign(new Error('down'), { code: 'P1001' }); }, updateMany: async () => { throw Object.assign(new Error('down'), { code: 'P1001' }); } } };
  const outcome = await supervisor.recordSyncOutcome({ id: 's1' }, { ok: false, error: new Error('x'), db });
  assert.equal(outcome.recorded, false);
});

test('runStoreSyncPass isolates per-store failures and reports every outcome', async () => {
  const stores = [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }, { id: 'c', status: 'syncing' }, { id: 'd', status: 'active' }];
  const db = { stores: { findMany: async () => stores, count: async () => 2 } };
  const counters = await supervisor.runStoreSyncPass({
    db, intervalMs: 900000, now: Date.parse('2026-11-23T00:00:00Z'),
    syncFn: async store => {
      if (store.id === 'b') throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
      if (store.id === 'd') return { alreadyRunning: true };
      return { success: true };
    },
  });
  assert.equal(counters.considered, 4);
  assert.equal(counters.succeeded, 2, 'an interrupted (syncing) store is resumed');
  assert.equal(counters.failed, 1);
  assert.deepEqual(counters.skip_reasons, { already_running: 1 });
  assert.equal(counters.failure_classes[supervisor.FAILURE.TRANSIENT], 1);
  assert.equal(counters.waiting_backoff, 2);
});

test('due-store selection excludes stores waiting on backoff or on the merchant', () => {
  const now = Date.parse('2026-11-23T00:00:00Z');
  const filter = JSON.stringify(supervisor.dueStoreFilter(now, 900000));
  assert.match(filter, /sync_next_attempt_at/);
  assert.match(filter, /authorization_revoked/);
  assert.match(filter, /"access_token":\{"not":null\}/);
});

// ---------------------------------------------------------------------------
// Permission registry
// ---------------------------------------------------------------------------

test('every synced domain maps to a capability (no silent gaps)', () => {
  assert.deepEqual(permissions.unmappedDomains(DOMAINS), []);
});

test('reauthorization requests only missing read scopes, never re-requests granted ones, refuses unsupported', () => {
  const plan = permissions.reauthorizationScopes(PRODUCTION_SCOPES, ['store_policies', 'url_redirects', 'navigation_menus']);
  assert.deepEqual(plan.added.sort(), ['read_legal_policies', 'read_online_store_navigation']);
  for (const scope of permissions.parseScopes(PRODUCTION_SCOPES)) assert.ok(!plan.added.includes(scope));
  assert.ok(plan.preserved.includes('write_discounts'), 'existing grants are preserved so the grant never shrinks');
  assert.ok(plan.refused.some(item => item.capability === 'navigation_menus' && item.reason === 'unsupported'));
  assert.ok(plan.added.every(scope => scope.startsWith('read_')));
});

test('write scope satisfies read; plan-restricted capabilities are never requestable', () => {
  assert.equal(permissions.scopeSatisfied(permissions.parseScopes('write_discounts'), 'read_discounts'), true);
  const b2b = permissions.evaluateCapability('b2b', PRODUCTION_SCOPES);
  assert.equal(b2b.state, 'plan_restricted');
  assert.equal(b2b.requestable, false);
});

// ---------------------------------------------------------------------------
// Capability authorization requests
// ---------------------------------------------------------------------------

const STORE = { id: '3ed79446-cb6d-4a1c-b174-9ec1ab91fe15', organization_id: '1dc6aa19-9737-4770-a340-ff812a8b139a', granted_scopes: PRODUCTION_SCOPES };

test('authorization requests: granted/unsupported are never requested; pending is deduplicated', async () => {
  const db = { authorization_requests: authorizationRequestModel() };
  const first = await authorizationRequests.ensureRequests({ db, store: STORE, capabilities: ['orders', 'url_redirects', 'navigation_menus', 'made_up'], trigger: 'rev_investigation', resume: { surface: 'rev', question: 'Which redirects are broken?', evil: 'x' } });
  assert.deepEqual(first.not_needed, ['orders']);
  assert.deepEqual(first.refused.map(item => item.reason).sort(), ['unknown_capability', 'unsupported']);
  assert.equal(first.requests.length, 1);
  assert.deepEqual(first.requests[0].missing_scopes, ['read_online_store_navigation']);
  assert.equal(first.requests[0].resume.evil, undefined, 'resume payload is whitelisted');
  const second = await authorizationRequests.ensureRequests({ db, store: STORE, capabilities: ['url_redirects'] });
  assert.equal(db.authorization_requests.rows.length, 1, 'one pending request per store + capability');
  assert.equal(second.requests[0].id, first.requests[0].id);
});

test('authorization requests resolve from Shopify\'s verified scopes, not from the redirect', async () => {
  const db = { authorization_requests: authorizationRequestModel() };
  await authorizationRequests.ensureRequests({ db, store: STORE, capabilities: ['url_redirects', 'store_policies'] });
  const outcome = await authorizationRequests.resolveWithGrantedScopes({
    db, storeId: STORE.id, grantedScopes: `${PRODUCTION_SCOPES},read_online_store_navigation`, viaOAuth: true,
  });
  assert.deepEqual(outcome.approved.map(row => row.capability), ['url_redirects']);
  assert.deepEqual(outcome.declined.map(row => row.capability), ['store_policies'], 'returned without the scope → declined, not looped');
  assert.ok(db.authorization_requests.rows.every(row => row.pending_key === null), 'closed requests free the pending slot');
});

test('stale authorization requests expire', async () => {
  const db = { authorization_requests: authorizationRequestModel() };
  const created = new Date('2026-11-01T00:00:00Z');
  await authorizationRequests.ensureRequests({ db, store: STORE, capabilities: ['markets'], now: created });
  assert.equal(await authorizationRequests.expireStaleRequests({ db, now: new Date('2026-11-23T00:00:00Z') }), 1);
  assert.equal(db.authorization_requests.rows[0].status, 'expired');
});

// ---------------------------------------------------------------------------
// Reauthorization OAuth URL
// ---------------------------------------------------------------------------

test('buildInstallUrl preserves granted scopes, adds only the missing read scopes, refuses anything else', () => {
  const { buildInstallUrl } = require('../utils/shopify');
  const plan = permissions.reauthorizationScopes(PRODUCTION_SCOPES, ['markets']);
  const url = new URL(buildInstallUrl({ shop: 'revluma-test-store-v1.myshopify.com', state: 'state-1', scopePlan: plan }));
  const scopes = url.searchParams.get('scope').split(',');
  assert.ok(scopes.includes('read_markets'), 'the missing capability scope is requested');
  assert.ok(scopes.includes('write_discounts'), 'existing grant preserved so the installation never loses access');
  assert.ok(scopes.includes('read_checkouts'));
  assert.equal(new Set(scopes).size, scopes.length, 'no duplicates');
  assert.throws(() => buildInstallUrl({ shop: 'revluma-test-store-v1.myshopify.com', state: 's', scopePlan: { preserved: [], added: ['write_products'] } }), { code: 'SHOPIFY_REAUTH_SCOPE_REFUSED' });
  const plain = new URL(buildInstallUrl({ shop: 'revluma-test-store-v1.myshopify.com', state: 's' }));
  const plainScopes = plain.searchParams.get('scope').split(',');
  assert.ok(!plainScopes.includes('read_markets') && !plainScopes.includes('write_discounts'), 'normal installs are unchanged');
});

// ---------------------------------------------------------------------------
// Data health
// ---------------------------------------------------------------------------

test('data health: production snapshot is healthy with limitations — optional gaps are not a sync failure', () => {
  const health = dataHealth.evaluateStoreHealth({ store: productionStore(), domainRows: productionRows(), domains: DOMAINS, now: Date.parse('2026-11-21T01:00:00Z') });
  assert.equal(health.overall, dataHealth.OVERALL.HEALTHY_WITH_LIMITATIONS);
  assert.equal(health.core_state, 'complete');
  assert.equal(health.merchant_action, null, 'no global merchant demand for optional permissions');
  assert.ok(health.optional_permissions.includes('url_redirects'));
  const redirects = health.resources.find(resource => resource.resource === 'content.redirects');
  assert.equal(redirects.state, 'unauthorized');
  assert.deepEqual(redirects.missing_scopes, ['read_online_store_navigation']);
  assert.equal(health.resources.find(resource => resource.resource === 'online-store.menus').state, 'unsupported');
  const journeys = health.resources.find(resource => resource.resource === 'customer_journeys');
  assert.equal(journeys.state, 'unsupported');
  assert.equal(journeys.reason, 'not_collected_by_revluma', 'never claims a retry for data Revluma does not collect');
  assert.ok(!health.limitations.some(line => /Customers: not yet retrieved/.test(line)));
});

test('data health: a failed refresh of core data with a prior success is stale and recovering, not unavailable', () => {
  const rows = productionRows().map(row => (row.domain === 'orders' ? { ...row, status: 'failed', coverage_state: 'retrieval_failure', retry_eligible: true } : row));
  const health = dataHealth.evaluateStoreHealth({ store: productionStore({ sync_next_attempt_at: '2026-11-21T01:10:00Z' }), domainRows: rows, domains: DOMAINS, now: Date.parse('2026-11-21T01:00:00Z') });
  const orders = health.resources.find(resource => resource.resource === 'orders');
  assert.equal(orders.state, 'stale');
  assert.equal(orders.reason, 'latest_refresh_failed');
  assert.equal(health.overall, dataHealth.OVERALL.RECOVERING);
  assert.equal(health.merchant_action, null);
});

test('data health: data older than the freshness window is stale', () => {
  const health = dataHealth.evaluateStoreHealth({ store: productionStore(), domainRows: productionRows(), domains: DOMAINS, now: Date.parse('2026-11-23T01:00:00Z') });
  assert.equal(health.resources.find(resource => resource.resource === 'orders').state, 'stale');
  assert.equal(health.core_state, 'stale');
});

test('data health: revoked connection → disconnected and a single reconnect action', () => {
  const health = dataHealth.evaluateStoreHealth({ store: productionStore({ integration_state: 'authorization_revoked' }), domainRows: productionRows(), domains: DOMAINS, now: Date.parse('2026-11-21T01:00:00Z') });
  assert.equal(health.overall, dataHealth.OVERALL.DISCONNECTED);
  assert.equal(health.merchant_action.kind, 'reconnect');
  assert.ok(health.resources.every(resource => resource.state === 'unauthorized' || resource.reason === 'not_collected_by_revluma'));
});

test('data health: a missing core permission is the only permission that demands merchant action', () => {
  const scopes = PRODUCTION_SCOPES.replace('read_inventory,', '');
  const health = dataHealth.evaluateStoreHealth({ store: productionStore({ granted_scopes: scopes }), domainRows: productionRows(), domains: DOMAINS, now: Date.parse('2026-11-21T01:00:00Z') });
  assert.equal(health.overall, dataHealth.OVERALL.ACTION_REQUIRED);
  assert.deepEqual(health.merchant_action, { kind: 'grant_permission', reason: 'core_permission_missing', capabilities: ['inventory'] });
});

test('data health: unknown granted scopes are "unknown", never "nothing granted"', () => {
  const health = dataHealth.evaluateStoreHealth({ store: productionStore({ granted_scopes: null }), domainRows: productionRows(), domains: DOMAINS, now: Date.parse('2026-11-21T01:00:00Z') });
  assert.equal(health.merchant_action, null);
  assert.equal(health.resources.find(resource => resource.resource === 'orders').state, 'complete');
});

test('data health: a fresh store with no ledger is syncing, then unavailable-but-scheduled', () => {
  const syncing = dataHealth.evaluateStoreHealth({ store: productionStore({ initial_sync_status: 'running', sync_started_at: '2026-11-21T00:55:00Z', last_synced_at: null }), domainRows: [], domains: DOMAINS, now: Date.parse('2026-11-21T01:00:00Z') });
  assert.equal(syncing.overall, dataHealth.OVERALL.SYNCING);
  assert.equal(syncing.resources.find(resource => resource.resource === 'orders').state, 'incomplete');
  const idle = dataHealth.evaluateStoreHealth({ store: productionStore({ initial_sync_status: 'not_started', last_synced_at: null }), domainRows: [], domains: DOMAINS, now: Date.parse('2026-11-21T01:00:00Z') });
  assert.equal(idle.resources.find(resource => resource.resource === 'orders').state, 'unavailable');
});

test('data health: agent summary fits its byte budget and keeps core gaps first', () => {
  const health = dataHealth.evaluateStoreHealth({ store: productionStore({ granted_scopes: 'read_products' }), domainRows: [], domains: DOMAINS, now: Date.parse('2026-11-21T01:00:00Z') });
  const lines = dataHealth.compactForAgent([health], { maxBytes: 600 });
  assert.ok(Buffer.byteLength(JSON.stringify(lines)) <= 700);
  assert.match(lines[0], /^health \| /);
  assert.match(lines[1], /^resource \| .* \| (orders|checkouts|products|inventory) \| /);
  assert.match(lines.at(-1), /^truncated \| /);
});


// ---------------------------------------------------------------------------
// Authorized-resource pass: blocked domains are recorded, never silently
// skipped, and resume automatically once Shopify grants the scope.
// ---------------------------------------------------------------------------

test('authorized resources: missing/unsupported/plan-restricted are recorded; approval resumes the domain', async () => {
  const productAction = require('../services/shopifyProductAction');
  const originalLiveScopes = productAction.liveScopes;
  const { syncAuthorizedResources } = require('../services/authorizedDataService');
  let live = permissions.parseScopes(PRODUCTION_SCOPES);
  productAction.liveScopes = async () => [...live];
  const blocked = [];
  const scopeWrites = [];
  const ledgerMock = {
    recordBlocked: async (storeId, domain, info) => { blocked.push({ domain, ...info }); },
    retireUnsyncedDomains: async () => 0,
  };
  const db = {
    stores: {
      updateMany: async ({ data }) => { if (data.granted_scopes) scopeWrites.push(data.granted_scopes); return { count: 1 }; },
      // Granted domains reach the real gateway, which fails fast here because
      // the store lookup finds nothing — enough to prove they were attempted.
      findFirst: async () => null,
      findUnique: async () => null,
    },
    store_sync_domain_states: { findMany: async () => [] },
    operation_dead_letters: deadLetterModel(),
  };
  try {
    const first = await syncAuthorizedResources({ id: STORE.id, organization_id: STORE.organization_id }, { db, ledger: ledgerMock, graphql: async () => ({}) });
    const byDomain = Object.fromEntries(blocked.map(item => [item.domain, item]));
    assert.equal(byDomain['content.redirects'].kind, 'missing_scope');
    assert.deepEqual(byDomain['content.redirects'].missingScopes, ['read_online_store_navigation']);
    assert.equal(byDomain['online-store.menus'].kind, 'unsupported');
    assert.equal(byDomain.companies.kind, 'plan_restricted');
    assert.ok(first.missing_scope >= 1 && first.unsupported >= 2);
    assert.equal(first.results.find(row => row.resource_id === 'content.redirects').status, 'missing_scope');
    assert.equal(scopeWrites[0], [...new Set(live)].sort().join(','), 'live scopes are persisted for the registry');

    // Merchant approves read_online_store_navigation through reauthorization.
    live = [...live, 'read_online_store_navigation'];
    blocked.length = 0;
    const second = await syncAuthorizedResources({ id: STORE.id, organization_id: STORE.organization_id }, { db, ledger: ledgerMock, graphql: async () => ({}) });
    assert.ok(!blocked.some(item => item.domain === 'content.redirects'), 'no longer blocked');
    assert.notEqual(second.results.find(row => row.resource_id === 'content.redirects').status, 'missing_scope', 'the domain is attempted again without any manual trigger');
  } finally {
    productAction.liveScopes = originalLiveScopes;
  }
});

test('authorized resources: a failing domain waits out its backoff instead of hammering Shopify', () => {
  const { domainRetryDue } = require('../services/authorizedDataService');
  const now = new Date('2026-11-23T01:00:00Z');
  const recent = { status: 'failed', retry_count: 2, last_checked_at: new Date(now.getTime() - 5 * 60 * 1000) };
  assert.equal(domainRetryDue(recent, now).due, false);
  const old = { status: 'failed', retry_count: 2, last_checked_at: new Date(now.getTime() - 2 * 3600 * 1000) };
  assert.equal(domainRetryDue(old, now).due, true);
  assert.equal(domainRetryDue({ status: 'ok' }, now).due, true);
});
