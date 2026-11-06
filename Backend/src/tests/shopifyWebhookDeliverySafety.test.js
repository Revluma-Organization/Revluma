'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
let row;
let claims;
const db = require.resolve('../configs/database');
require.cache[db] = { id: db, filename: db, loaded: true, exports: { prisma: { webhook_deliveries: {
  create: async () => { throw Object.assign(new Error('duplicate'), { code: 'P2002' }); },
  findUnique: async () => row,
  updateMany: async ({ where }) => {
    if (row.status === where.status && row.store_id === where.store_id && row.topic === where.topic) {
      claims++; row = { ...row, status: 'received' }; return { count: 1 };
    }
    return { count: 0 };
  },
} } } };
const { claimDelivery } = require('../services/commerceWebhookService');
const incoming = () => claimDelivery('shopify', 'delivery-1', 'store-a', 'orders/create');

test('only a processed delivery is acknowledged as a duplicate', async () => {
  row = { id: 'd', store_id: 'store-a', topic: 'orders/create', status: 'processed' }; claims = 0;
  assert.equal(await incoming(), null); assert.equal(claims, 0);
  row = { ...row, status: 'received' };
  await assert.rejects(incoming(), { code: 'WEBHOOK_DELIVERY_PENDING' }); assert.equal(claims, 0);
});
test('failed delivery retries once and a concurrent duplicate does not acknowledge it', async () => {
  row = { id: 'd', store_id: 'store-a', topic: 'orders/create', status: 'failed' }; claims = 0;
  assert.equal((await incoming()).status, 'received');
  await assert.rejects(incoming(), { code: 'WEBHOOK_DELIVERY_PENDING' });
  assert.equal(claims, 1);
});
test('a delivery ID cannot be claimed or acknowledged for another store or topic', async () => {
  for (const other of [{ store_id: 'store-b', topic: 'orders/create' }, { store_id: 'store-a', topic: 'customers/redact' }]) {
    row = { id: 'd', status: 'failed', ...other }; claims = 0;
    await assert.rejects(incoming(), { code: 'WEBHOOK_DELIVERY_IDENTITY_MISMATCH' });
    assert.equal(claims, 0);
  }
});
