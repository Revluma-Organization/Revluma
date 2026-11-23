'use strict';

// Store synchronization is observable and Redis-independent.
//
// The store-sync stall went unnoticed because runStoreSync coordinated through
// a Redis lock that silently returned null when Redis was not ready, and
// wrote nothing to automation_job_state. It now claims the Postgres job lock,
// delegates to the sync supervisor (backoff/auth-aware selection, per-store
// isolation) and records structured counters — and a lock-store failure is
// itself recorded instead of vanishing.

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ||= '0'.repeat(64);

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const servicesDir = path.join(__dirname, '..');

function stubModule(requestPath, exports) {
  const resolved = require.resolve(path.join(servicesDir, requestPath));
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [],
  };
}

const rawCalls = [];
const upserts = [];
const skips = [];
let rawFailure = null;
const due = [
  { id: 'store-ok', status: 'active', platform: 'shopify' },
  { id: 'store-throttled', status: 'active', platform: 'shopify' },
  { id: 'store-interrupted', status: 'syncing', platform: 'shopify' },
];

const prisma = {
  automation_job_state: {
    upsert: async (args) => { upserts.push(args); },
    update: async (args) => { skips.push(args); return {}; },
  },
  $executeRaw: (strings, ...values) => {
    if (rawFailure) return Promise.reject(rawFailure);
    rawCalls.push(values);
    return Promise.resolve(1);
  },
  $queryRaw: () => Promise.resolve([]),
  stores: {
    findMany: async ({ where }) => {
      assert.ok(JSON.stringify(where).includes('sync_next_attempt_at'), 'selection honours per-store backoff');
      return due;
    },
    updateMany: async () => ({ count: 0 }),
    count: async () => 0,
  },
  abandoned_checkouts: { updateMany: async () => ({ count: 0 }) },
  checkouts: { updateMany: async () => ({ count: 0 }) },
};

const synced = [];
stubModule('../configs/database', { prisma });
stubModule('./shopifySync', {
  syncShopifyStore: async (store, options) => {
    synced.push({ id: store.id, options });
    if (store.id === 'store-throttled') {
      throw Object.assign(new Error('Throttled'), { code: 'SHOPIFY_THROTTLED', status: 429 });
    }
    return { success: true };
  },
});
stubModule('../utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

const scheduler = require('../schedulerService');

test('a store-sync pass is claimed, supervised and recorded in automation_job_state', async () => {
  await scheduler.runStoreSync();

  assert.ok(upserts.some(call => call?.where?.job_name === 'store-sync'), 'store-sync job row was ensured');
  assert.deepEqual(synced.map(item => item.id), ['store-ok', 'store-throttled', 'store-interrupted'],
    'one failing store does not stop the pass; an interrupted sync is resumed');
  assert.ok(synced.every(item => item.options?.reconcileWebhooks === false));

  const release = rawCalls.find(values => values.includes('partial'));
  assert.ok(release, `expected a partial-status release, saw ${JSON.stringify(rawCalls)}`);
  const stored = JSON.parse(release.find(value => typeof value === 'string' && value.includes('"considered"')));
  assert.equal(stored.considered, 3);
  assert.equal(stored.succeeded, 2);
  assert.equal(stored.failed, 1);
  assert.equal(stored.failure_classes.rate_limited, 1);
  assert.ok(Number.isFinite(stored.latency_ms));
});

test('a lock-store outage is recorded and alerted, never silent', async () => {
  rawFailure = Object.assign(new Error('connection refused'), { code: 'P1001' });
  synced.length = 0;
  skips.length = 0;
  try {
    await scheduler.runStoreSync();
  } finally {
    rawFailure = null;
  }
  assert.equal(synced.length, 0, 'no sync without a coordinated claim');
  assert.ok(skips.some(call => call.where.job_name === 'store-sync' && /lock_error/.test(call.data.last_error)),
    'the skipped pass is visible in automation_job_state');
});
