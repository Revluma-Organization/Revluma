'use strict';
// Real-PostgreSQL financial regression for the ingestion path.
//
// Requires a disposable local database (never production):
//   CREATE DATABASE revluma_rc;
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/revluma_rc?schema=public
//   RELEASE_CANDIDATE_ISOLATED_DB=true node src/tests/financialIntegrity.integration.js
//
// The scenario set covers refunds, cancellations, delayed and out-of-order
// delivery, duplicates, missing financial evidence, currency separation and
// customer lifetime value, all through the production ingestion functions.

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prisma } = require('../configs/database');
const { upsertOrder, cancelOrder } = require('../services/commerceWebhookService');
const {
  computeCustomerLifetimeValue,
  reconcileOrderMoney,
} = require('../services/financialIntegrity');

const url = String(process.env.DATABASE_URL || '');
if (process.env.RELEASE_CANDIDATE_ISOLATED_DB !== 'true' || !/@127\.0\.0\.1:5432\/revluma_rc\b/.test(url)) {
  throw new Error('Disposable localhost revluma_rc PostgreSQL and explicit opt-in required');
}

const results = [];
function record(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push({ name, ok: true }))
    .catch((error) => results.push({ name, ok: false, error }));
}

const refund = (amount, status = 'success') => ({ transactions: [{ kind: 'refund', status, amount }] });

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const userId = randomUUID();
  const orgId = randomUUID();
  const storeId = randomUUID();
  const eurStoreId = randomUUID();
  const customerId = randomUUID();
  const mixedCustomerId = randomUUID();

  await prisma.users.create({ data: { id: userId, full_name: 'RC Test', email: `rc-${suffix}@example.invalid`, password_hash: 'x' } });
  await prisma.organizations.create({
    data: {
      id: orgId, owner_id: userId, company_name: `RC ${suffix}`,
      slug: `rc-${suffix}`, industry: 'test', country: 'NG',
    },
  });
  await prisma.stores.createMany({
    data: [
      { id: storeId, organization_id: orgId, platform: 'shopify', shop_domain: `rc-usd-${suffix}.myshopify.com`, status: 'active' },
      { id: eurStoreId, organization_id: orgId, platform: 'shopify', shop_domain: `rc-eur-${suffix}.myshopify.com`, status: 'active' },
    ],
  });
  await prisma.customers.createMany({
    data: [
      { id: customerId, store_id: storeId, external_id: `cust-${suffix}`, email: `cust-${suffix}@example.invalid` },
      { id: mixedCustomerId, store_id: storeId, external_id: `mixed-${suffix}`, email: `mixed-${suffix}@example.invalid` },
    ],
  });

  const store = { id: storeId };
  const eurStore = { id: eurStoreId };
  const created = Date.now();
  const base = (id, extra = {}) => ({
    id,
    created_at: new Date(created).toISOString(),
    currency: 'USD',
    customer: { id: `cust-${suffix}`, email: `cust-${suffix}@example.invalid` },
    line_items: [],
    ...extra,
  });
  const order = async (externalId) => prisma.orders.findFirst({ where: { store_id: storeId, external_order_id: String(externalId) } });
  const money = (value) => (value === null || value === undefined ? null : Number(value));

  await record('fully refunded #1004 ($1,025) stores net 0 and refunded 1025', async () => {
    await upsertOrder(store, 'shopify', base('1004', { total_price: '1025.00', refunds: [refund('1025.00')] }));
    const row = await order('1004');
    assert.equal(money(row.total), 0);
    assert.equal(money(row.refunded_total), 1025);
  });

  await record('fully refunded #1001 ($100) stores net 0 and refunded 100', async () => {
    await upsertOrder(store, 'shopify', base('1001', { total_price: '100.00', refunds: [refund('100.00')] }));
    const row = await order('1001');
    assert.equal(money(row.total), 0);
    assert.equal(money(row.refunded_total), 100);
  });

  await record('partial refund stores net 70 and refunded 30', async () => {
    await upsertOrder(store, 'shopify', base('2001', { total_price: '100.00', refunds: [refund('30.00')] }));
    const row = await order('2001');
    assert.equal(money(row.total), 70);
    assert.equal(money(row.refunded_total), 30);
  });

  await record('multiple successful refunds reconcile once', async () => {
    await upsertOrder(store, 'shopify', base('2002', { total_price: '100.00', refunds: [refund('20.00'), refund('15.50')] }));
    const row = await order('2002');
    assert.equal(money(row.total), 64.5);
    assert.equal(money(row.refunded_total), 35.5);
  });

  await record('failed and pending refund transactions do not reduce revenue', async () => {
    await upsertOrder(store, 'shopify', base('2003', {
      total_price: '100.00',
      refunds: [refund('100.00', 'failure'), refund('10.00', 'pending')],
    }));
    const row = await order('2003');
    assert.equal(money(row.total), 100);
    assert.equal(money(row.refunded_total), 0);
  });

  await record('a payload with no verifiable total is rejected and not persisted', async () => {
    await assert.rejects(
      upsertOrder(store, 'shopify', base('2006', { total_price: null, refunds: [] })),
      { code: 'ORDER_FINANCIAL_TOTAL_UNVERIFIED' },
    );
    assert.equal(await order('2006'), null);
  });

  await record('a currency-less order is rejected instead of defaulting to USD', async () => {
    await assert.rejects(
      upsertOrder(store, 'shopify', base('2007', { total_price: '10.00', refunds: [], currency: null })),
      { code: 'ORDER_CURRENCY_UNVERIFIED' },
    );
    assert.equal(await order('2007'), null);
  });

  await record('a cancellation that arrives before the order tombstones it', async () => {
    await cancelOrder(store, base('2005', { total_price: '400.00', cancelled_at: new Date(created).toISOString() }));
    await upsertOrder(store, 'shopify', base('2005', { total_price: '400.00', refunds: [] }));
    const row = await order('2005');
    assert.equal(row.recovery_status, 'cancelled');
  });

  await record('a delayed update after cancellation cannot un-cancel it', async () => {
    await upsertOrder(store, 'shopify', base('2005', { total_price: '400.00', refunds: [] }));
    const row = await order('2005');
    assert.equal(row.recovery_status, 'cancelled');
  });

  await record('a delayed pre-refund create cannot resurrect refunded revenue', async () => {
    // Refund update first (net 0), then a stale orders/create snapshot (gross).
    await upsertOrder(store, 'shopify', base('3001', { total_price: '100.00', refunds: [refund('100.00')] }));
    await upsertOrder(store, 'shopify', base('3001', { total_price: '100.00', refunds: [] }));
    const row = await order('3001');
    assert.equal(money(row.total), 0);
    assert.equal(money(row.refunded_total), 100);
  });

  await record('a delayed create with unknown refunds still honours stored refunds', async () => {
    await upsertOrder(store, 'shopify', base('3002', { total_price: '100.00', refunds: [refund('40.00')] }));
    await upsertOrder(store, 'shopify', base('3002', { total_price: '100.00', total_refunded: null }));
    const row = await order('3002');
    assert.equal(money(row.total), 60);
    assert.equal(money(row.refunded_total), 40);
  });

  await record('duplicate delivery is idempotent', async () => {
    const payload = base('3003', { total_price: '80.00', refunds: [refund('10.00')] });
    await upsertOrder(store, 'shopify', payload);
    await upsertOrder(store, 'shopify', payload);
    const rows = await prisma.orders.findMany({ where: { store_id: storeId, external_order_id: '3003' } });
    assert.equal(rows.length, 1);
    assert.equal(money(rows[0].total), 70);
  });

  await record('sync-shaped payload (net + refunded, no itemised refunds) is stored as supplied', async () => {
    await upsertOrder(store, 'shopify', base('3004', { total_price: 0, total_refunded: 25, refunds: [] }));
    const row = await order('3004');
    assert.equal(money(row.total), 0);
    assert.equal(money(row.refunded_total), 25);
  });

  await record('EUR and USD revenue never mix', async () => {
    await upsertOrder(eurStore, 'shopify', base('4001', {
      total_price: '40.00', refunds: [], currency: 'EUR',
      customer: { id: `eur-${suffix}`, email: `eur-${suffix}@example.invalid` },
    }));
    const row = await prisma.orders.findFirst({ where: { store_id: eurStoreId, external_order_id: '4001' } });
    assert.equal(row.currency, 'EUR');
    assert.equal(money(row.total), 40);
  });

  await record('revenue aggregation excludes cancellations and nets refunds', async () => {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(total), 0)::text AS total, COUNT(*)::int AS count
         FROM orders
        WHERE store_id = $1::uuid AND currency = 'USD'
          AND (recovery_status IS NULL OR recovery_status NOT IN ('cancelled','canceled','voided','deleted'))`,
      storeId,
    );
    // 1004 (0) + 1001 (0) + 2001 (70) + 2002 (64.5) + 2003 (100) + 3001 (0) + 3002 (60) + 3003 (70) + 3004 (0)
    assert.equal(Number(rows[0].total), 364.5);
    assert.equal(rows[0].count, 9);
  });

  await record('gross order value is reconstructable as net + refunded', async () => {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(total + COALESCE(refunded_total, 0)), 0)::text AS gross
         FROM orders
        WHERE store_id = $1::uuid AND currency = 'USD'
          AND (recovery_status IS NULL OR recovery_status <> 'cancelled')`,
      storeId,
    );
    // net 364.5 + refunded (1025 + 100 + 30 + 35.5 + 0 + 100 + 40 + 10 + 25 = 1365.5)
    assert.equal(Number(rows[0].gross), 1730);
  });

  await record('customer lifetime value uses net totals and separate currencies', async () => {
    const rows = await prisma.orders.findMany({ where: { customer_id: customerId }, select: { total: true, currency: true, recovery_status: true } });
    // NUMERIC comes back as Prisma Decimal objects; the service accepts their
    // exact string form (production callers normalise the same way).
    const ltv = computeCustomerLifetimeValue(rows.map((row) => ({
      total: row.total == null ? null : String(row.total),
      currency: row.currency,
      recovery_status: row.recovery_status,
    })));
    assert.equal(ltv.mixed_currency, false);
    assert.equal(ltv.ltv_currency, 'USD');
    assert.equal(ltv.ltv, 364.5);
  });

  await record('a customer with two currencies reports mixed instead of a total', async () => {
    const usd = (await prisma.orders.findMany({ where: { customer_id: customerId }, select: { total: true, currency: true, recovery_status: true } }))
      .map((row) => ({ total: String(row.total), currency: row.currency, recovery_status: row.recovery_status }));
    const ltv = computeCustomerLifetimeValue([
      ...usd,
      { total: 40, currency: 'EUR', recovery_status: 'completed' },
    ]);
    assert.equal(ltv.mixed_currency, true);
    assert.equal(ltv.ltv, null);
  });

  await record('reconciliation keeps refunds monotonic across replays', () => {
    const first = reconcileOrderMoney({ incomingNet: 100, incomingRefunded: 0, storedRefunded: null });
    const second = reconcileOrderMoney({ incomingNet: 0, incomingRefunded: 100, storedRefunded: first.refunded_total });
    assert.deepEqual(second, { total: 0, refunded_total: 100 });
  });

  // Cleanup: cascades to stores, orders, customers.
  await prisma.organizations.delete({ where: { id: orgId } }).catch(() => {});
  await prisma.users.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();

  const failures = results.filter((entry) => !entry.ok);
  for (const entry of results) {
    console.log(`${entry.ok ? 'PASS' : 'FAIL'} ${entry.name}`);
    if (!entry.ok) console.log(`     ${entry.error && entry.error.message}`);
  }
  console.log(`financial integration: ${results.length - failures.length}/${results.length} scenarios passed`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error('financial integration harness failed:', error.message);
  process.exitCode = 1;
  return prisma.$disconnect().catch(() => {});
});
