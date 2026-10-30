'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../configs/database');
const { upsertAbandonedCart } = require('../services/commerceWebhookService');
const { nextCheckoutStatus } = require('../services/checkoutInactivity');

async function run() {
  if (process.env.TASK016_ISOLATED_DB !== 'true' || !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')) {
    throw new Error('Task 016 requires explicitly opted-in localhost isolated PostgreSQL');
  }
  const runId = crypto.randomUUID().slice(0, 8);
  const id = () => crypto.randomUUID();
  const storeId = id();
  const store2Id = id();
  const now = new Date('2026-10-30T00:15:00.000Z');
  const base = key => ({
    id: `task016-${runId}-${key}`, created_at: '2026-10-30T00:00:00.000Z',
    updated_at: now.toISOString(), total_price: '100.00', currency: 'USD',
  });
  const completed = key => ({ ...base(key), completed_at: now.toISOString() });
  const store = { id: storeId, platform: 'shopify' };
  const otherStore = { id: store2Id, platform: 'shopify' };
  const checks = [];
  const check = async (name, callback) => {
    try { await callback(); checks.push({ name, pass: true }); }
    catch (error) { checks.push({ name, pass: false, error: error.message }); }
  };
  try {
    await prisma.stores.createMany({ data: [
      { id: storeId, platform: 'shopify', shop_domain: `task016-${runId}.myshopify.com`, name: 'Task016 A' },
      { id: store2Id, platform: 'shopify', shop_domain: `task016-${runId}-b.myshopify.com`, name: 'Task016 B' },
    ] });
    await check('01 valid completion persisted', async () => {
      await upsertAbandonedCart(store, completed('01'));
      const row = await prisma.abandoned_carts.findFirstOrThrow({ where: { store_id: storeId, external_cart_id: completed('01').id } });
      assert.equal(row.status, 'recovered');
    });
    await check('02 completed on checkout creation', async () => {
      const row = await upsertAbandonedCart(store, completed('02'));
      assert.equal(row.status, 'recovered');
    });
    await check('03 pending to completed update', async () => {
      await upsertAbandonedCart(store, base('03'));
      const row = await upsertAbandonedCart(store, completed('03'));
      assert.equal(row.status, 'recovered');
    });
    await check('04 abandoned to recovered', async () => {
      const row = await upsertAbandonedCart(store, base('04'));
      await prisma.abandoned_carts.update({ where: { id: row.id }, data: { status: 'abandoned' } });
      assert.equal((await upsertAbandonedCart(store, completed('04'))).status, 'recovered');
    });
    await check('05 timestamp preserved exactly', async () => {
      const row = await upsertAbandonedCart(store, completed('05'));
      assert.equal(row.recovered_at.toISOString(), now.toISOString());
    });
    await check('06 missing completion remains pending', async () => {
      assert.equal((await upsertAbandonedCart(store, base('06'))).status, 'pending');
    });
    await check('07 null completion remains pending', async () => {
      assert.equal((await upsertAbandonedCart(store, { ...base('07'), completed_at: null })).status, 'pending');
    });
    await check('08 malformed completion rejected without persisted recovery', async () => {
      let rejected = false;
      try { await upsertAbandonedCart(store, { ...base('08'), completed_at: 'not-a-date' }); }
      catch { rejected = true; }
      assert.equal(rejected, true);
      const row = await prisma.abandoned_carts.findFirst({ where: { store_id: storeId, external_cart_id: base('08').id } });
      assert.equal(row, null);
      assert.equal(nextCheckoutStatus({ completedAt: 'not-a-date' }), 'recovered', 'record known helper weakness separately');
    });
    await check('09 duplicate completed delivery reuses row', async () => {
      const a = await upsertAbandonedCart(store, completed('09'));
      const b = await upsertAbandonedCart(store, completed('09'));
      assert.equal(a.id, b.id);
      assert.equal(await prisma.abandoned_carts.count({ where: { store_id: storeId, external_cart_id: completed('09').id } }), 1);
    });
    await check('10 later noncompletion preserves recovery', async () => {
      await upsertAbandonedCart(store, completed('10'));
      const row = await upsertAbandonedCart(store, { ...base('10'), updated_at: '2026-10-30T00:16:00.000Z' });
      assert.equal(row.status, 'recovered');
      assert.equal(row.recovered_at.toISOString(), now.toISOString());
    });
    await check('11 missing optional fields tolerated', async () => {
      assert.equal((await upsertAbandonedCart(store, completed('11'))).status, 'recovered');
    });
    await check('12 product items retained after empty update', async () => {
      const row = await upsertAbandonedCart(store, { ...completed('12'), line_items: [{ product_id: 1, title: 'Synthetic item', quantity: 2, price: 5 }] });
      await upsertAbandonedCart(store, completed('12'));
      assert.equal(await prisma.abandoned_cart_items.count({ where: { abandoned_cart_id: row.id } }), 1);
    });
    await check('13 merchant isolation', async () => {
      await upsertAbandonedCart(otherStore, base('13'));
      await upsertAbandonedCart(store, completed('13'));
      const a = await prisma.abandoned_carts.findFirstOrThrow({ where: { store_id: storeId, external_cart_id: base('13').id } });
      const b = await prisma.abandoned_carts.findFirstOrThrow({ where: { store_id: store2Id, external_cart_id: base('13').id } });
      assert.equal(a.status, 'recovered');
      assert.equal(b.status, 'pending');
    });
  } finally {
    await prisma.stores.deleteMany({ where: { id: { in: [storeId, store2Id] } } });
    await prisma.$disconnect();
  }
  console.log(JSON.stringify({ task: '016', checks, passed: checks.filter(x => x.pass).length, total: checks.length }));
  if (checks.some(x => !x.pass)) process.exitCode = 1;
}
run().catch(error => { console.error(error); process.exitCode = 1; });
