'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../services/syncDomainState');

function fakeDb() {
  const rows = new Map(); // key store|domain -> row
  const key = (w) => `${w.store_id_domain?.store_id ?? ''}|${w.store_id_domain?.domain ?? ''}`;
  const table = {
    upsert: async ({ where, update, create }) => {
      const k = key(where);
      if (rows.has(k)) {
        const cur = rows.get(k);
        const u = { ...update };
        if (u.retry_count && typeof u.retry_count === 'object') {
          u.retry_count = (cur.retry_count ?? 0) + (u.retry_count.increment ?? 0);
        }
        rows.set(k, { ...cur, ...u });
      } else {
        rows.set(k, { ...create, retry_count: create.retry_count ?? 0 });
      }
      return rows.get(k);
    },
    findUnique: async ({ where, select }) => {
      const row = rows.get(key(where));
      if (!row) return null;
      if (select?.checkpoint) return { checkpoint: row.checkpoint ?? {} };
      if (select?.error_since) return { error_since: row.error_since ?? null };
      return row;
    },
    findMany: async () => [...rows.values()],
  };
  return {
    prisma: { store_sync_domain_states: table },
    rows,
    getRow: (storeId, domain) => rows.get(`${storeId}|${domain}`),
  };
}

test('unknown domain is rejected', async () => {
  const db = fakeDb().prisma;
  await assert.rejects(() => ledger.beginAttempt('s1', 'nonsense', db), /Unknown sync domain/);
  await assert.rejects(() => ledger.recordSuccess('s1', 'nonsense', {}, db), /Unknown sync domain/);
});

test('full attempt → failure → success cycle records honest state', async () => {
  const { prisma, getRow } = fakeDb();
  await ledger.beginAttempt('store-1', 'products', prisma);
  assert.equal(getRow('store-1', 'products').status, 'running');

  const err = Object.assign(new Error('x'.repeat(900)), { code: 'SHOPIFY_GRAPHQL_ERROR', pages_completed: 3 });
  await ledger.recordFailure('store-1', 'products', err, {}, prisma);
  const failed = getRow('store-1', 'products');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error_code, 'SHOPIFY_GRAPHQL_ERROR');
  assert.equal(failed.retry_count, 1);
  assert.equal(failed.pages_completed, 3);
  assert.ok(failed.error_details.length <= 500, 'details truncated to 500 chars');
  assert.ok(failed.error_since, 'error_since set');

  await ledger.recordFailure('store-1', 'products', err, {}, prisma);
  const failedAgain = getRow('store-1', 'products');
  assert.equal(failedAgain.retry_count, 2);
  assert.equal(failedAgain.error_since, failed.error_since, 'error_since preserved across retries');

  await ledger.recordSuccess('store-1', 'products', { discovered: 17, inserted: 17, paginationComplete: true, pagesCompleted: 2 }, prisma);
  const ok = getRow('store-1', 'products');
  assert.equal(ok.status, 'ok');
  assert.equal(ok.retry_count, 0);
  assert.equal(ok.error_code, null);
  assert.equal(ok.pagination_complete, true);
  assert.equal(ok.records_discovered, 17);
  assert.ok(ok.last_succeeded_at);
});

test('degraded records and keeps error-since semantics', async () => {
  const { prisma, getRow } = fakeDb();
  await ledger.recordDegraded('store-1', 'products', 'SHOPIFY_PRODUCTS_ACCESS_DENIED', {}, prisma);
  const row = getRow('store-1', 'products');
  assert.equal(row.status, 'degraded');
  assert.equal(row.error_code, 'SHOPIFY_PRODUCTS_ACCESS_DENIED');
  assert.equal(row.retry_count, 1);
});

test('ledger telemetry failures never throw into the sync pipeline', async () => {
  const brokenDb = { store_sync_domain_states: { upsert: async () => { throw new Error('db down'); }, findUnique: async () => { throw new Error('down'); }, findMany: async () => { throw new Error('down'); } } };
  assert.equal(await ledger.beginAttempt('s2', 'orders', brokenDb), false);
  assert.equal(await ledger.recordSuccess('s2', 'orders', {}, brokenDb), false);
  assert.equal(await ledger.recordFailure('s2', 'orders', new Error('boom'), {}, brokenDb), false);
  assert.equal(await ledger.recordDegraded('s2', 'customers', 'CODE', {}, brokenDb), false);
  assert.deepEqual(await ledger.snapshot('s2', brokenDb), []);
});

test('snapshot reports null freshness for never-succeeded domain', async () => {
  const { prisma } = fakeDb();
  await ledger.beginAttempt('store-9', 'orders', prisma);
  const snap = await ledger.snapshot('store-9', prisma);
  assert.equal(snap.length, 1);
  assert.equal(snap[0].freshness_seconds, null);
  assert.equal(snap[0].status, 'running');
});

test('checkpoint merge preserves existing keys', async () => {
  const { prisma, getRow } = fakeDb();
  await ledger.mergeCheckpoint('store-1', 'inventory', { cursor: 'abc', page: 1 }, prisma);
  await ledger.mergeCheckpoint('store-1', 'inventory', { page: 2 }, prisma);
  const row = getRow('store-1', 'inventory');
  assert.equal(row.checkpoint.cursor, 'abc');
  assert.equal(row.checkpoint.page, 2);
});

test('setup stage to domain mapping', () => {
  assert.equal(ledger.domainForSetupStage('product_sync'), 'products');
  assert.equal(ledger.domainForSetupStage('abandoned_checkout_sync'), 'abandoned_checkouts');
  assert.equal(ledger.domainForSetupStage('marking_store_syncing'), null);
});
