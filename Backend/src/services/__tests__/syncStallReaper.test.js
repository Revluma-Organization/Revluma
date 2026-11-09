'use strict';

// Task 229 §3/§9 — the stale-running reaper that un-sticks a store wedged in
// `running`. Exercises the full reap -> re-derive -> persist flow against an
// in-memory mock DB, plus the pure selection logic.

const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../syncStallReaper');

const NOW = new Date('2026-11-10T00:00:00Z');
const STALE = new Date('2026-11-09T10:51:00Z'); // ~13h before NOW (> 2h window)
const FRESH = new Date('2026-11-09T23:30:00Z'); // < 2h before NOW

// --- build a mock db that simulates store_sync_domain_states + stores -------
function makeDb({ stores, domains }) {
  const states = new Map();
  for (const d of domains) states.set(`${d.store_id}:${d.domain}`, { ...d });
  const db = {
    store_sync_domain_states: {
      async upsert({ where, update, create }) {
        const key = `${where.store_id_domain.store_id}:${where.store_id_domain.domain}`;
        const existing = states.get(key);
        if (existing) {
          for (const [k, v] of Object.entries(update)) {
            if (v && typeof v === 'object' && 'increment' in v) existing[k] = (Number(existing[k]) || 0) + v.increment;
            else existing[k] = v;
          }
        } else states.set(key, { ...create });
        return existing || states.get(key);
      },
      async findUnique({ where, select }) {
        const key = `${where.store_id_domain.store_id}:${where.store_id_domain.domain}`;
        const row = states.get(key);
        if (!row) return null;
        return select ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : { ...row };
      },
      async findMany({ where }) {
        return [...states.values()]
          .filter(r => (where.store_id ? r.store_id === where.store_id : true))
          .sort((a, b) => a.domain.localeCompare(b.domain))
          .map(r => ({ ...r }));
      },
    },
    stores: {
      async findMany(q = {}) {
        let list = stores.map(s => ({ ...s }));
        const w = q.where || {};
        if (w.platform) list = list.filter(s => s.platform === w.platform);
        if (w.status && w.status.in) list = list.filter(s => w.status.in.includes(s.status));
        if (w.initial_sync_status && w.initial_sync_status.in) list = list.filter(s => w.initial_sync_status.in.includes(s.initial_sync_status));
        if (q.take != null) list = list.slice(0, q.take);
        return list;
      },
      async update({ where, data }) {
        const s = stores.find(x => x.id === where.id);
        Object.assign(s, data);
        return { ...s };
      },
    },
  };
  return { db, states, stores };
}

const S1 = 'store-1';
const okRow = (store_id, domain, required) => ({
  store_id, domain, status: 'ok', records_discovered: 5, records_inserted: 5, records_updated: 0,
  records_deleted: 0, pagination_complete: true, last_succeeded_at: FRESH, last_attempted_at: FRESH,
  last_checked_at: FRESH, retry_count: 0, error_code: null, error_details: null,
});

// ===========================================================================
// pure selection
// ===========================================================================
test('staleRunningDomains: only stale running/starting rows are reaped', () => {
  const rows = [
    { domain: 'a', status: 'running', last_attempted_at: STALE },      // stale running -> reap
    { domain: 'b', status: 'running', last_attempted_at: FRESH },      // fresh running -> keep
    { domain: 'c', status: 'starting', last_attempted_at: STALE },     // stale starting -> reap
    { domain: 'd', status: 'ok', last_attempted_at: STALE },           // terminal -> ignore
    { domain: 'e', status: 'failed', last_attempted_at: STALE },       // terminal -> ignore
    { domain: 'f', status: 'never_run' },                              // ignore
    { domain: 'g', status: 'running' },                                // no heartbeat -> reap
  ];
  const reaped = R.staleRunningDomains(rows, { now: NOW, staleMs: R.DEFAULT_STALE_MS }).map(r => r.domain);
  assert.deepEqual(reaped.sort(), ['a', 'c', 'g']);
});

test('staleRunningDomains: a fresh heartbeat is never reaped regardless of window', () => {
  const rows = [{ domain: 'x', status: 'running', last_attempted_at: FRESH }];
  assert.deepEqual(R.staleRunningDomains(rows, { now: NOW, staleMs: R.DEFAULT_STALE_MS }), []);
});

// ===========================================================================
// the production stuck-store scenario
// ===========================================================================
test('reconcileStore: un-sticks the wedged store -> initial_completed_with_limitations', async () => {
  const store = {
    id: S1, status: 'syncing', initial_sync_status: 'running', recovery_status: 'recovering',
    current_sync_job_id: 'job-1', sync_started_at: STALE, sync_completed_at: null, sync_error_code: null,
  };
  const domains = [
    okRow(S1, 'products'),
    okRow(S1, 'orders'),
    okRow(S1, 'abandoned_checkouts'),
    okRow(S1, 'customers'),
    // the hung domain (stale running)
    { ...okRow(S1, 'shop.shipping_configuration'), status: 'running', last_attempted_at: STALE, last_succeeded_at: null, pagination_complete: false, records_discovered: 0, records_inserted: 0 },
    // optional failed domains (never succeeded)
    { ...okRow(S1, 'shop.policies'), status: 'failed', error_code: 'SHOPIFY_GRAPHQL_ERROR', last_succeeded_at: null, records_discovered: 0, records_inserted: 0, pagination_complete: false },
    { ...okRow(S1, 'online-store.menus'), status: 'failed', error_code: 'SHOPIFY_GRAPHQL_ERROR', last_succeeded_at: null, records_discovered: 0, records_inserted: 0, pagination_complete: false },
  ];
  const { db, states, stores } = makeDb({ stores: [store], domains });

  const res = await R.reconcileStore(db, store, await db.store_sync_domain_states.findMany({ where: { store_id: S1 } }), { now: NOW });

  // The stale-running domain was reaped to a transient, retryable failure.
  assert.deepEqual(res.reaped, ['shop.shipping_configuration']);
  const reapedRow = states.get(`${S1}:shop.shipping_configuration`);
  assert.equal(reapedRow.status, 'failed');
  assert.equal(reapedRow.canonical_status, 'failed');
  assert.equal(reapedRow.failure_class, 'transient');
  assert.equal(reapedRow.retry_eligible, true);
  assert.equal(reapedRow.error_code, 'SYNC_STALE_TIMEOUT');

  // The store left "running" and reached the correct terminal state.
  assert.equal(res.derived_status, 'initial_completed_with_limitations');
  assert.equal(res.changed, true);
  const s = stores[0];
  assert.equal(s.initial_sync_status, 'initial_completed_with_limitations');
  assert.equal(s.recovery_status, 'completed');
  assert.equal(s.status, 'active'); // promoted from 'syncing', not demoted
  assert.equal(s.current_sync_job_id, null);
  assert.ok(s.sync_completed_at instanceof Date);
  // Limitations surfaced, not hidden.
  assert.ok(res.limitations.some(l => l.domain === 'shop.policies'));
  assert.ok(res.limitations.some(l => l.domain === 'online-store.menus'));
});

test('reconcileStore: a fresh-running store is left alone (no false reap, no change)', async () => {
  const store = {
    id: S1, status: 'syncing', initial_sync_status: 'running', recovery_status: 'recovering',
    current_sync_job_id: 'job-1', sync_started_at: FRESH,
  };
  const domains = [
    okRow(S1, 'products'),
    { ...okRow(S1, 'orders'), status: 'running', last_attempted_at: FRESH, pagination_complete: false },
  ];
  const { db, stores } = makeDb({ stores: [store], domains });
  const res = await R.reconcileStore(db, store, await db.store_sync_domain_states.findMany({ where: { store_id: S1 } }), { now: NOW });
  assert.deepEqual(res.reaped, []);
  assert.equal(res.derived_status, 'running');
  assert.equal(res.changed, false);
  assert.equal(stores[0].initial_sync_status, 'running');
});

test('reconcileStore: all required failed with auth -> failed + recovery required', async () => {
  const store = { id: S1, status: 'syncing', initial_sync_status: 'running', recovery_status: 'recovering', current_sync_job_id: 'job-1', sync_started_at: STALE };
  const failedAuth = d => ({ ...okRow(S1, d), status: 'failed', error_code: 'SHOPIFY_READ_ORDERS_NOT_GRANTED', last_succeeded_at: null, records_discovered: 0, records_inserted: 0, pagination_complete: false });
  const domains = [failedAuth('products'), failedAuth('orders'), failedAuth('abandoned_checkouts')];
  const { db, stores } = makeDb({ stores: [store], domains });
  const res = await R.reconcileStore(db, store, await db.store_sync_domain_states.findMany({ where: { store_id: S1 } }), { now: NOW });
  assert.equal(res.derived_status, 'failed');
  assert.equal(res.changed, true);
  assert.equal(stores[0].initial_sync_status, 'failed');
  assert.equal(stores[0].recovery_status, 'required'); // merchant action needed
  assert.equal(stores[0].sync_error_code, 'INITIAL_SYNC_FAILED');
});

test('reconcileStore: all required complete -> initial_completed (no limitations)', async () => {
  const store = { id: S1, status: 'syncing', initial_sync_status: 'running', recovery_status: 'recovering', current_sync_job_id: 'job-1', sync_started_at: STALE };
  const domains = [okRow(S1, 'products'), okRow(S1, 'orders'), okRow(S1, 'abandoned_checkouts')];
  const { db, stores } = makeDb({ stores: [store], domains });
  const res = await R.reconcileStore(db, store, await db.store_sync_domain_states.findMany({ where: { store_id: S1 } }), { now: NOW });
  assert.equal(res.derived_status, 'initial_completed');
  assert.equal(stores[0].initial_sync_status, 'initial_completed');
  assert.equal(stores[0].recovery_status, 'completed');
});

test('reconcileStore: an already-terminal store is never regressed', async () => {
  const store = { id: S1, status: 'active', initial_sync_status: 'initial_completed', recovery_status: 'completed', current_sync_job_id: null };
  const domains = [okRow(S1, 'products'), okRow(S1, 'orders'), okRow(S1, 'abandoned_checkouts')];
  const { db, stores } = makeDb({ stores: [store], domains });
  const res = await R.reconcileStore(db, store, await db.store_sync_domain_states.findMany({ where: { store_id: S1 } }), { now: NOW });
  assert.equal(res.changed, false);
  assert.equal(stores[0].initial_sync_status, 'initial_completed');
});

// ===========================================================================
// scheduler entry (batch)
// ===========================================================================
test('runReaper: reconciles a bounded batch of in-flight stores and reports', async () => {
  const stuck = { id: S1, platform: 'shopify', status: 'syncing', initial_sync_status: 'running', recovery_status: 'recovering', current_sync_job_id: 'j', sync_started_at: STALE };
  const done = { id: 'store-2', platform: 'shopify', status: 'active', initial_sync_status: 'initial_completed', recovery_status: 'completed' };
  const domains = [
    okRow(S1, 'products'), okRow(S1, 'orders'), okRow(S1, 'abandoned_checkouts'),
    { ...okRow(S1, 'fulfillments'), status: 'running', last_attempted_at: STALE, pagination_complete: false, records_discovered: 0, records_inserted: 0 },
  ];
  const { db, stores } = makeDb({ stores: [stuck, done], domains });
  const out = await R.runReaper(db, { now: NOW });
  assert.equal(out.considered, 1); // only the in-flight store is selected
  assert.equal(out.reaped_domains, 1);
  assert.equal(out.terminalized_stores, 1);
  assert.equal(stores[0].initial_sync_status, 'initial_completed_with_limitations');
  assert.equal(stores[1].initial_sync_status, 'initial_completed'); // untouched
});

test('inFlightWhere: only selects in-flight shopify stores', () => {
  const w = R.inFlightWhere();
  assert.equal(w.platform, 'shopify');
  assert.deepEqual(w.initial_sync_status.in, ['queued', 'starting', 'running']);
  assert.ok(w.status.in.includes('syncing'));
});

// ===========================================================================
// D4 honesty refinement: an already-terminal "completed" store that has a
// terminally-failed/partial domain must read as completed_with_limitations.
// ===========================================================================
test('reconcileStore refines a misreported "completed" store (all required ok + optional failed) to completed_with_limitations, preserving completion time (D4)', async () => {
  const stores = [{ id: S1, platform: 'shopify', shop_domain: 't.myshopify.com', status: 'active', initial_sync_status: 'completed', recovery_status: 'completed', current_sync_job_id: 'stale-job', sync_completed_at: STALE, updated_at: STALE }];
  const domains = [
    okRow(S1, 'products'), okRow(S1, 'orders'), okRow(S1, 'abandoned_checkouts'),
    { store_id: S1, domain: 'refunds', status: 'failed', records_discovered: 0, records_inserted: 0, records_updated: 0, records_deleted: 0, pagination_complete: false, last_succeeded_at: null, last_attempted_at: STALE, last_checked_at: STALE, retry_count: 1, error_code: 'SHOPIFY_GRAPHQL_ERROR', error_details: null },
  ];
  const { db } = makeDb({ stores, domains });
  const res = await R.reconcileStore(db, stores[0], domains, { now: NOW });
  assert.equal(res.changed, true);
  assert.equal(res.refined, true, 'a refinement of an already-terminal store');
  assert.equal(res.derived_status, 'initial_completed_with_limitations');
  assert.equal(stores[0].initial_sync_status, 'initial_completed_with_limitations');
  assert.equal(stores[0].current_sync_job_id, null, 'stale job id cleared');
  assert.equal(new Date(stores[0].sync_completed_at).getTime(), STALE.getTime(), 'real completion timestamp preserved (not reset to now)');
});

test('findMisreportedTerminalStores: only "completed" stores with a failed/partial domain (idempotent + convergent)', async () => {
  const domains = [
    { store_id: 's1', domain: 'refunds', status: 'failed' },
    { store_id: 's1', domain: 'orders', status: 'ok' },
    { store_id: 's2', domain: 'fulfillments', status: 'degraded' },
    { store_id: 's3', domain: 'products', status: 'ok' }, // s3: no failed/partial domain
    { store_id: 's4', domain: 'variants', status: 'failed' },
  ];
  const stores = [
    { id: 's1', platform: 'shopify', status: 'active', initial_sync_status: 'completed', updated_at: STALE }, // legacy "completed" spelling
    { id: 's2', platform: 'shopify', status: 'active', initial_sync_status: 'initial_completed_with_limitations', updated_at: STALE }, // already honest -> excluded
    { id: 's3', platform: 'shopify', status: 'active', initial_sync_status: 'completed', updated_at: STALE }, // no failure -> excluded
    { id: 's4', platform: 'shopify', status: 'active', initial_sync_status: 'initial_completed', updated_at: STALE }, // canonical spelling
  ];
  const db = {
    store_sync_domain_states: {
      async findMany({ where, select, distinct, take } = {}) {
        let rows = domains.filter(d => !where || !where.status || !where.status.in || where.status.in.includes(d.status));
        if (distinct && distinct.length) { const seen = new Set(); rows = rows.filter(r => (seen.has(r[distinct[0]]) ? false : (seen.add(r[distinct[0]]), true))); }
        rows = rows.slice(0, take);
        return rows.map(r => (select ? Object.fromEntries(Object.keys(select).map(k => [k, r[k]])) : { ...r }));
      },
    },
    stores: {
      async findMany({ where, take } = {}) {
        let list = stores.filter(s => where.id.in.includes(s.id));
        if (where.platform) list = list.filter(s => s.platform === where.platform);
        if (where.initial_sync_status) {
          if (where.initial_sync_status.in) list = list.filter(s => where.initial_sync_status.in.includes(s.initial_sync_status));
          else if (typeof where.initial_sync_status === 'string') list = list.filter(s => s.initial_sync_status === where.initial_sync_status);
        }
        if (where.status && where.status.in) list = list.filter(s => where.status.in.includes(s.status));
        return list.slice(0, take);
      },
    },
  };
  const res = await R.findMisreportedTerminalStores(db, { limit: 5 });
  // Both the legacy "completed" (s1) and canonical "initial_completed" (s4)
  // spellings with a failed domain are matched; s2 (already honest) and s3 (no
  // failure) are excluded.
  assert.deepEqual(res.map(s => s.id), ['s1', 's4']);
});
