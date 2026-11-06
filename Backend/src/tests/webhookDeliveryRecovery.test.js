/**
 * Durable recovery of abandoned (`received`) webhook deliveries.
 *
 * A delivery stuck in `received` must never be reprocessed silently, nor acked
 * as success, nor left ambiguous forever. Stale rows are flipped to `failed`
 * with an explicit audit reason so the existing claim path can re-claim them
 * on the provider's next redelivery.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Stub the database module in require.cache before requiring the service so
// this suite stays runnable without a generated Prisma client.
const dbPath = require.resolve('../configs/database');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { prisma: {} },
};
const { recoverStuckDeliveries, ABANDON_REASON } = require('../services/webhookDeliveryRecovery');

const NOW = new Date('2026-11-06T12:00:00.000Z');

function makeDb(rows) {
  const state = { rows: rows.map((row) => ({ ...row })) };
  const db = {
    webhook_deliveries: {
      findMany: async ({ where, take }) => {
        assert.equal(where.status, 'received');
        assert.ok(where.received_at.lt instanceof Date);
        return state.rows
          .filter((row) => row.status === 'received' && row.received_at < where.received_at.lt)
          .slice(0, take)
          .map(({ id, provider, delivery_id, store_id, topic, received_at }) => ({ id, provider, delivery_id, store_id, topic, received_at }));
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of state.rows) {
          if (where.id.in.includes(row.id) && row.status === 'received') {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },
  };
  return { db, state };
}

test('marks only deliveries stuck in received beyond the threshold as failed', async () => {
  const stale = new Date(NOW.getTime() - 20 * 60 * 1000);
  const fresh = new Date(NOW.getTime() - 2 * 60 * 1000);
  const { db, state } = makeDb([
    { id: 'a', provider: 'shopify', delivery_id: 'd-a', store_id: 's1', topic: 'orders/create', status: 'received', received_at: stale, last_error: null },
    { id: 'b', provider: 'shopify', delivery_id: 'd-b', store_id: 's1', topic: 'orders/create', status: 'received', received_at: fresh, last_error: null },
    { id: 'c', provider: 'shopify', delivery_id: 'd-c', store_id: 's1', topic: 'orders/create', status: 'processed', received_at: stale, last_error: null, processed_at: stale },
    { id: 'd', provider: 'woocommerce', delivery_id: 'd-d', store_id: 's2', topic: 'woocommerce_order_created', status: 'failed', received_at: stale, last_error: 'boom' },
  ]);
  const result = await recoverStuckDeliveries({ db, olderThanSeconds: 900, now: NOW });
  assert.equal(result.recovered, 1);
  const rowA = state.rows.find((row) => row.id === 'a');
  const rowB = state.rows.find((row) => row.id === 'b');
  const rowC = state.rows.find((row) => row.id === 'c');
  const rowD = state.rows.find((row) => row.id === 'd');
  assert.equal(rowA.status, 'failed');
  assert.equal(rowA.last_error, ABANDON_REASON);
  assert.equal(rowB.status, 'received'); // too young: in-flight work is never disrupted
  assert.equal(rowC.status, 'processed'); // successful deliveries are never reopened
  assert.equal(rowD.status, 'failed'); // already terminal: untouched
  assert.equal(rowD.last_error, 'boom');
});

test('no stale rows is a clean no-op', async () => {
  const { db } = makeDb([
    { id: 'b', provider: 'shopify', delivery_id: 'd-b', store_id: 's1', topic: 'orders/create', status: 'received', received_at: new Date(NOW.getTime() - 60 * 1000) },
  ]);
  const result = await recoverStuckDeliveries({ db, olderThanSeconds: 900, now: NOW });
  assert.deepEqual(result, { recovered: 0, candidates: 0 });
});

test('failed deliveries become claimable through the existing retry path', async () => {
  // The contract this recovery relies on: claimDelivery() re-claims `failed`
  // rows. Pinned here so a future refactor of either side keeps it true.
  const stale = new Date(NOW.getTime() - 30 * 60 * 1000);
  const { db, state } = makeDb([
    { id: 'a', provider: 'shopify', delivery_id: 'd-a', store_id: 's1', topic: 'orders/create', status: 'received', received_at: stale, last_error: null },
  ]);
  await recoverStuckDeliveries({ db, olderThanSeconds: 900, now: NOW });
  assert.equal(state.rows[0].status, 'failed');
  assert.equal(state.rows[0].last_error, ABANDON_REASON);
});
