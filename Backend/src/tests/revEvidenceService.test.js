const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const DB_PATH = require.resolve('../configs/database');
require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: { prisma: null } };
const { retrieveEvidence, retrieveEvidenceById } = require('../services/revEvidenceService');

const ORG = '11111111-1111-4111-8111-111111111111';
const STORE = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-07T12:00:00.000Z');
const store = (overrides = {}) => ({ id: STORE, organization_id: ORG, status: 'active', last_synced_at: NOW, granted_scopes: 'read_orders', ...overrides });
const ledger = (overrides = {}) => ({ store_id: STORE, domain: 'orders', status: 'ok', last_succeeded_at: NOW, last_checked_at: NOW, records_discovered: 1, pagination_complete: true, error_code: null, checkpoint: { sync_run_id: 'run-1', reconciliation: { missing: 0, duplicates: 0, mapping_errors: 0 } }, ...overrides });
const record = (overrides = {}) => ({ store_id: STORE, resource_id: 'orders', source_id: 'order-1', sync_run_id: 'run-1', content_hash: 'hash-1', synced_at: NOW, ...overrides });
const orderRow = (overrides = {}) => ({ store_id: STORE, ordered_at: '2026-11-07T10:00:00.000Z', total: '100.00', currency: 'USD', ...overrides });
const profile = (overrides = {}) => ({ store_id: STORE, currency_code: 'USD', ...overrides });
function db({ stores = [store()], ledgers = [ledger()], records = [record()], orders = [], profiles = [profile()], fail = null } = {}) {
  const calls = [];
  return {
    calls,
    stores: {
      findFirst: async (args) => { calls.push(['store', args]); return stores.find(s => s.id === args.where.id && s.organization_id === args.where.organization_id) || null; },
      findMany: async (args) => { calls.push(['stores', args]); return stores; },
    },
    store_sync_domain_states: { findMany: async (args) => { if (fail === 'ledger') throw new Error('storage unavailable'); calls.push(['ledgers', args]); return ledgers.filter(row => row.store_id === STORE || (args.where.OR && args.where.OR.some(pair => pair.store_id === row.store_id))); } },
    store_profiles: { findMany: async (args) => { calls.push(['profiles', args]); return profiles.filter(row => args.where.store_id.in.includes(row.store_id)); } },
    orders: { findMany: async (args) => { if (fail === 'orders') throw new Error('storage unavailable'); calls.push(['orders', args]); return orders.filter(row => row.store_id === args.where.store_id && row.ordered_at >= args.where.ordered_at.gte && row.ordered_at < args.where.ordered_at.lt); } },
    commerce_resource_records: {
      findMany: async (args) => { calls.push(['records', args]); return records; },
      groupBy: async (args) => { if (fail === 'records') throw new Error('storage unavailable'); calls.push(['counts', args]); return records.length ? [{ store_id: STORE, resource_id: 'orders', _count: { _all: records.length }, _max: { synced_at: NOW } }] : []; },
    },
  };
}
const query = (overrides = {}) => ({ organizationId: ORG, storeId: STORE, resourceId: 'orders', ...overrides });

test('reconciled snapshots return reproducible evidence and bounded source lineage', async () => {
  const result = await retrieveEvidence(query(), { db: db(), now: NOW });
  assert.equal(result.items[0].status, 'available');
  assert.equal(result.items[0].value, 1);
  assert.equal(result.items[0].provenance.reproducible, true);
  assert.equal(result.items[0].source.references[0].source_id, 'order-1');
  assert.equal(result.items[0].organization_id, ORG);
  assert.match(result.items[0].definition, /not historical activity|latest completely paginated/i);
});

test('certified zero and missing data are distinct', async () => {
  const zero = await retrieveEvidence(query(), { db: db({ ledgers: [ledger({ records_discovered: 0 })], records: [] }), now: NOW });
  assert.equal(zero.items[0].status, 'verified_zero');
  assert.equal(zero.items[0].value, 0);
  const missing = await retrieveEvidence(query(), { db: db({ ledgers: [], records: [] }), now: NOW });
  assert.equal(missing.items[0].status, 'not_synchronized');
  assert.equal(missing.items[0].value, null);
  assert.equal(missing.items[0].classification, 'unknown');
});

test('stale, pending, failed, partial and unsupported states remain explicit', async () => {
  const cases = [
    [ledger({ last_succeeded_at: new Date('2026-11-07T08:00:00Z'), last_checked_at: new Date('2026-11-07T08:00:00Z') }), 'stale'],
    [ledger({ status: 'running' }), 'pending'],
    [ledger({ status: 'failed', error_code: 'THROTTLED' }), 'retrieval_failed'],
    [ledger({ pagination_complete: false }), 'partial'],
  ];
  for (const [state, expected] of cases) {
    const result = await retrieveEvidence(query(), { db: db({ ledgers: [state] }), now: NOW });
    assert.equal(result.items[0].status, expected);
    assert.equal(result.complete, false);
  }
  const unsupported = await retrieveEvidence(query({ resourceId: 'price-rules' }), { db: db(), now: NOW });
  assert.equal(unsupported.items[0].status, 'unsupported');
  assert.equal(unsupported.items[0].value, null);
});

test('missing scopes are authorization failures and cannot query snapshot records', async () => {
  const fixture = db({ stores: [store({ granted_scopes: '' })], records: [record()] });
  const result = await retrieveEvidence(query(), { db: fixture, now: NOW });
  assert.equal(result.items[0].status, 'unauthorized');
  assert.equal(result.errors[0].code, 'UNAUTHORIZED');
  assert.equal(fixture.calls.filter(([kind]) => kind === 'records' || kind === 'counts').length, 0);
});

test('cross-tenant store and evidence references are rejected before snapshot queries', async () => {
  const fixture = db();
  await assert.rejects(() => retrieveEvidence(query({ storeId: OTHER }), { db: fixture, now: NOW }), /Store evidence is unavailable/);
  assert.equal(fixture.calls.filter(([kind]) => kind === 'records' || kind === 'counts').length, 0);
  await assert.rejects(() => retrieveEvidenceById(query({ evidenceId: 'ev-000000000000000000000000' }), { db: fixture, now: NOW }), /Evidence reference is unavailable/);
});

test('contradictory counts and reconciliation become non-affirmative evidence', async () => {
  const count = await retrieveEvidence(query(), { db: db({ ledgers: [ledger({ records_discovered: 2 })] }), now: NOW });
  assert.equal(count.items[0].status, 'contradictory');
  assert.equal(count.items[0].value, null);
  const reconciliation = await retrieveEvidence(query(), { db: db({ ledgers: [ledger({ checkpoint: { reconciliation: { missing: 1, duplicates: 0, mapping_errors: 0 } } })] }), now: NOW });
  assert.equal(reconciliation.items[0].status, 'contradictory');
});

test('storage failures and cancellation are explicit and do not return empty success', async () => {
  await assert.rejects(() => retrieveEvidence(query(), { db: db({ fail: 'ledger' }), now: NOW }), (error) => error.code === 'EVIDENCE_STORAGE_FAILURE');
  await assert.rejects(() => retrieveEvidence(query({ signal: { aborted: true } }), { db: db(), now: NOW }), (error) => error.code === 'EVIDENCE_RETRIEVAL_CANCELLED');
});

test('unsupported evidence and errors contain no credentials', async () => {
  const result = await retrieveEvidence(query({ resourceId: 'price-rules' }), { db: db(), now: NOW });
  const serialized = JSON.stringify(result);
  assert.equal(result.items[0].status, 'unsupported');
  assert.doesNotMatch(serialized, /access_token|password|authorization: bearer/i);
});

// ── Task 198 — computed revenue resource ─────────────────────────────────────

const PERIOD = { start: '2026-11-01T00:00:00.000Z', end: '2026-11-08T00:00:00.000Z', timezone: 'Africa/Lagos' };

test('revenue sums a single verified currency as a decimal string with measurement', async () => {
  const result = await retrieveEvidence(query({ resourceId: 'revenue', period: PERIOD }), { db: db({ orders: [orderRow({ total: '100.00' }), orderRow({ total: '25.50' })] }), now: NOW });
  const item = result.items[0];
  assert.equal(item.status, 'partial'); // explicit period => partial completeness
  assert.equal(item.metric, 'revenue.recorded_order_value');
  assert.equal(item.value, '125.50');
  assert.equal(item.unit, 'currency');
  assert.equal(item.currency, 'USD');
  assert.equal(item.measurement.amount, '125.50');
  assert.equal(item.measurement.currency, 'USD');
  assert.equal(item.period.timezone, 'Africa/Lagos');
  assert.equal(result.complete, false);
});

test('revenue never sums incompatible currencies into one scalar', async () => {
  const result = await retrieveEvidence(query({ resourceId: 'revenue', period: PERIOD }), {
    db: db({ orders: [orderRow({ currency: 'USD', total: '10.00' }), orderRow({ currency: 'NGN', total: '1000.00' })], profiles: [profile({ currency_code: null })] }),
    now: NOW,
  });
  const item = result.items[0];
  assert.equal(item.status, 'partial');
  assert.equal(item.value, null);
  assert.equal(item.classification, 'unknown');
  assert.match(item.definition, /multiple currencies/i);
  assert.match(item.definition, /NGN, USD/);
  // No fabricated cross-currency total anywhere.
  assert.doesNotMatch(JSON.stringify(result), /1010\.00/);
});

test('revenue with no orders asserts a labelled currency zero only when certified', async () => {
  // Default (non-explicit) period + fully certified empty window + known store
  // currency => an asserted "0.00", not a count zero and not unlabelled.
  const result = await retrieveEvidence(query({ resourceId: 'revenue' }), { db: db({ orders: [] }), now: NOW });
  const item = result.items[0];
  assert.equal(item.status, 'available');
  assert.equal(item.value, '0.00');
  assert.equal(item.currency, 'USD');
  assert.equal(result.complete, true);
});

test('revenue with no orders and no verified currency is not asserted', async () => {
  const result = await retrieveEvidence(query({ resourceId: 'revenue', period: PERIOD }), {
    db: db({ orders: [], profiles: [profile({ currency_code: null })] }), now: NOW,
  });
  const item = result.items[0];
  assert.equal(item.value, null);
  assert.equal(item.classification, 'unknown');
  assert.match(item.definition, /no verified currency/i);
});

test('orders without a verified currency are excluded and reported, never coerced', async () => {
  const result = await retrieveEvidence(query({ resourceId: 'revenue', period: PERIOD }), {
    db: db({ orders: [orderRow({ currency: 'USD', total: '10.00' }), orderRow({ currency: 'us', total: '999.00' })] }), now: NOW,
  });
  const item = result.items[0];
  assert.equal(item.status, 'partial');
  assert.equal(item.currency, 'USD');
  assert.equal(item.value, '10.00');
  assert.ok(item.limitations.some(line => /1 order row\(s\) without a verified ISO currency code/i.test(line)));
});

test('revenue inherits the orders ledger certification and fails closed', async () => {
  const notSynced = await retrieveEvidence(query({ resourceId: 'revenue', period: PERIOD }), { db: db({ ledgers: [], orders: [orderRow()] }), now: NOW });
  assert.equal(notSynced.items[0].status, 'not_synchronized');
  assert.equal(notSynced.items[0].value, null);

  const running = await retrieveEvidence(query({ resourceId: 'revenue', period: PERIOD }), { db: db({ ledgers: [ledger({ status: 'running' })] }), now: NOW });
  assert.equal(running.items[0].status, 'pending');
  assert.equal(running.items[0].value, null);

  const partial = await retrieveEvidence(query({ resourceId: 'revenue', period: PERIOD }), { db: db({ ledgers: [ledger({ pagination_complete: false })] }), now: NOW });
  assert.equal(partial.items[0].status, 'partial');
  assert.equal(partial.items[0].value, null);

  const unauthorized = await retrieveEvidence(query({ resourceId: 'revenue', period: PERIOD }), { db: db({ stores: [store({ granted_scopes: '' })] }), now: NOW });
  assert.equal(unauthorized.items[0].status, 'unauthorized');
  assert.equal(unauthorized.items[0].value, null);
});

test('revenue respects the requested half-open period and excludes test orders', async () => {
  const fixture = db({ orders: [
    orderRow({ ordered_at: '2026-10-31T23:59:59.000Z', total: '1.00' }),   // before start
    orderRow({ ordered_at: '2026-11-01T00:00:00.000Z', total: '5.00' }),    // start boundary (inclusive)
    orderRow({ ordered_at: '2026-11-07T23:59:59.000Z', total: '7.00' }),    // inside
    orderRow({ ordered_at: '2026-11-08T00:00:00.000Z', total: '9.00' }),    // end boundary (exclusive)
  ] });
  const result = await retrieveEvidence(query({ resourceId: 'revenue', period: PERIOD }), { db: fixture, now: NOW });
  assert.equal(result.items[0].value, '12.00');
  const ordersCall = fixture.calls.find(([kind]) => kind === 'orders');
  assert.equal(ordersCall[1].where.ordered_at.gte, PERIOD.start);
  assert.equal(ordersCall[1].where.ordered_at.lt, PERIOD.end);
});

test('revenue period must be half-open with a valid IANA timezone', async () => {
  await assert.rejects(
    () => retrieveEvidence(query({ resourceId: 'revenue', period: { start: '2026-11-08T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' } }), { db: db(), now: NOW }),
    (error) => error.code === 'EVIDENCE_PERIOD_INVALID');
  await assert.rejects(
    () => retrieveEvidence(query({ resourceId: 'revenue', period: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-08T00:00:00.000Z', timezone: 'Not/A_Zone' } }), { db: db(), now: NOW }),
    (error) => error.code === 'EVIDENCE_PERIOD_INVALID');
});

test('period parameters are rejected for snapshot resources, not silently ignored', async () => {
  await assert.rejects(
    () => retrieveEvidence(query({ resourceId: 'orders', period: PERIOD }), { db: db(), now: NOW }),
    (error) => error.code === 'EVIDENCE_PERIOD_UNSUPPORTED');
});
