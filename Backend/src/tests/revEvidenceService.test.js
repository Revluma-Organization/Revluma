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
function db({ stores = [store()], ledgers = [ledger()], records = [record()], fail = null } = {}) {
  const calls = [];
  return {
    calls,
    stores: {
      findFirst: async (args) => { calls.push(['store', args]); return stores.find(s => s.id === args.where.id && s.organization_id === args.where.organization_id) || null; },
      findMany: async (args) => { calls.push(['stores', args]); return stores; },
    },
    store_sync_domain_states: { findMany: async (args) => { if (fail === 'ledger') throw new Error('storage unavailable'); calls.push(['ledgers', args]); return ledgers; } },
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
