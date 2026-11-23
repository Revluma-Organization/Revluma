'use strict';

// Root cause of the store-sync stall: syncShopifyStore took a Redis lock and
// threw SHOPIFY_SETUP_LOCK_UNAVAILABLE whenever Redis was not ready, so every
// scheduled sync failed and the merchant's data silently stopped refreshing.
// The per-store lock is now a Postgres lease. These tests run with Redis
// completely unavailable and prove sync coordination no longer depends on it.

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ||= '0'.repeat(64);

const test = require('node:test');
const assert = require('node:assert/strict');

function stub(requestPath, exports) {
  const resolved = require.resolve(requestPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const leases = new Map();
let leaseStoreDown = false;
const storeUpdates = [];
let releaseGate = null;

function guard() {
  if (leaseStoreDown) throw Object.assign(new Error('db down'), { code: 'P1001' });
}

const prisma = {
  coordination_leases: {
    create: async ({ data }) => { guard(); if (leases.has(data.lease_key)) throw Object.assign(new Error('dup'), { code: 'P2002' }); leases.set(data.lease_key, { ...data }); },
    updateMany: async ({ where, data }) => {
      guard();
      const row = leases.get(where.lease_key);
      if (!row || (where.owner && row.owner !== where.owner) || (where.expires_at?.lt && !(row.expires_at < where.expires_at.lt))) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    deleteMany: async ({ where }) => {
      guard();
      const row = leases.get(where.lease_key);
      if (!row || row.owner !== where.owner) return { count: 0 };
      leases.delete(where.lease_key);
      return { count: 1 };
    },
  },
  stores: {
    findUnique: async ({ select }) => (select?.sync_consecutive_failures ? { sync_consecutive_failures: 0 } : { status: 'active', updated_at: new Date(), last_synced_at: null }),
    updateMany: async (args) => { storeUpdates.push(args); return { count: 1 }; },
    update: async () => ({}),
  },
  // The first write of a real run. Holding it open lets the test observe the
  // lease while the run is "in progress"; then it fails the run so the
  // failure path (outcome recording + lease release) is exercised.
  intelligence_order_coverage: {
    deleteMany: async () => {
      if (releaseGate) await releaseGate;
      throw Object.assign(new Error('Shopify unavailable'), { code: 'ECONNRESET' });
    },
  },
  store_sync_domain_states: { upsert: async () => ({}), updateMany: async () => ({ count: 0 }), findMany: async () => [], findUnique: async () => null },
  operation_dead_letters: { findUnique: async () => null, create: async () => ({}), update: async () => ({}), updateMany: async () => ({ count: 0 }) },
};

stub('../configs/database', { prisma });
stub('../configs/redis', {
  isRedisReady: () => false,
  getRedisClient: () => { throw new Error('Redis is not available'); },
  connectRedis: async () => { throw new Error('Redis is not available'); },
});
stub('../utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

const { syncShopifyStore, syncLeaseKey } = require('../services/shopifySync');

test('sync acquires a Postgres lease with Redis down; a concurrent run is told it is already running', async () => {
  let open;
  releaseGate = new Promise(resolve => { open = resolve; });
  const store = { id: '3ed79446-cb6d-4a1c-b174-9ec1ab91fe15', organization_id: 'org', shop_domain: 'x.myshopify.com', access_token: 'enc' };
  const first = syncShopifyStore({ ...store }, { reconcileWebhooks: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(leases.has(syncLeaseKey(store.id)), 'the per-store lease is held in Postgres');
  const concurrent = await syncShopifyStore({ ...store }, { reconcileWebhooks: false });
  assert.deepEqual(concurrent, { success: false, alreadyRunning: true }, 'never two syncs for one store');
  open();
  await assert.rejects(first, { code: 'ECONNRESET' });
  releaseGate = null;
  assert.equal(leases.has(syncLeaseKey(store.id)), false, 'the lease is released when the run ends, even on failure');
  const outcome = storeUpdates.find(call => call.data?.sync_consecutive_failures === 1);
  assert.ok(outcome, 'the failure is recorded for supervised retry');
  assert.ok(outcome.data.sync_next_attempt_at instanceof Date, 'a backoff is scheduled — no manual trigger needed');
});

test('if the coordination store itself is down, sync fails loudly instead of running uncoordinated', async () => {
  leaseStoreDown = true;
  try {
    await assert.rejects(syncShopifyStore({ id: 'store-2' }, { reconcileWebhooks: false }), { code: 'SHOPIFY_SYNC_COORDINATION_UNAVAILABLE' });
  } finally {
    leaseStoreDown = false;
  }
});
