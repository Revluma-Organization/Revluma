'use strict';
// One-time operator-run Task030 verification. No public route or webhook bypass.
// Never log credentials, customer PII, checkout tokens, or raw payloads.
const assert = require('node:assert/strict');
const { prisma } = require('../configs/database');
const { upsertAbandonedCart } = require('../services/commerceWebhookService');

const STORE_ID = '3ed79446-cb6d-4a1c-b174-9ec1ab91fe15';
const CART_ID = '2d713193-4327-4058-8c57-411f318efd3b';
const ORDER_ID = '5b0ec8a8-4398-4315-9926-86f16e7f59c6';
const EXPECTED_ORDER_TOTAL = 749.95;
const OLD_SOURCE_TIMESTAMP = '2026-10-30T07:59:00.000Z';

async function main() {
  if (process.env.TASK030_REPLAY_APPROVED !== 'I_APPROVE_ONE_TEST_CHECKOUT') {
    throw new Error('Explicit one-time replay approval required');
  }
  if (process.env.NODE_ENV !== 'production') throw new Error('Requires production context');
  const store = await prisma.stores.findUniqueOrThrow({ where: { id: STORE_ID } });
  assert.equal(store.platform, 'shopify');
  assert.equal(store.shop_domain, 'revluma-test-store-v1.myshopify.com');
  const before = await prisma.abandoned_carts.findUniqueOrThrow({ where: { id: CART_ID } });
  const order = await prisma.orders.findUniqueOrThrow({ where: { id: ORDER_ID } });
  assert.equal(before.store_id, STORE_ID);
  assert.equal(order.store_id, STORE_ID);
  assert.equal(order.abandoned_cart_id, CART_ID);
  assert.equal(Number(order.total), EXPECTED_ORDER_TOTAL);
  assert.equal(before.status, 'recovered');
  assert.ok(before.recovered_at);
  assert.ok(before.source_checkout_token);
  assert.equal(before.source_checkout_token, order.source_checkout_token);
  assert.ok(new Date(OLD_SOURCE_TIMESTAMP) < new Date(before.updated_at));
  const baseline = {
    status: before.status,
    recovered_at: before.recovered_at.toISOString(),
    updated_at: before.updated_at.toISOString(),
    source_checkout_token: before.source_checkout_token,
    external_cart_id: before.external_cart_id,
  };
  const linkedBefore = await prisma.orders.count({ where: { store_id: STORE_ID, abandoned_cart_id: CART_ID } });
  const duplicatesBefore = await prisma.abandoned_carts.count({ where: { store_id: STORE_ID, external_cart_id: before.external_cart_id } });
  assert.equal(linkedBefore, 1);
  assert.equal(duplicatesBefore, 1);
  // Uses production ingestion service; NOT a forged Shopify HMAC or public webhook request.
  // This event is explicitly synthetic, not a genuine delayed Shopify delivery.
  const result = await upsertAbandonedCart(store, {
    id: before.external_cart_id,
    token: before.source_checkout_token,
    created_at: OLD_SOURCE_TIMESTAMP,
    updated_at: OLD_SOURCE_TIMESTAMP,
    total_price: String(EXPECTED_ORDER_TOTAL),
    currency: 'USD',
  });
  assert.equal(result.id, CART_ID);
  const after = await prisma.abandoned_carts.findUniqueOrThrow({ where: { id: CART_ID } });
  for (const [field, expected] of Object.entries(baseline)) {
    const actual = after[field] instanceof Date ? after[field].toISOString() : after[field];
    assert.equal(actual, expected, field + ' must remain unchanged');
  }
  assert.equal(await prisma.orders.count({ where: { store_id: STORE_ID, abandoned_cart_id: CART_ID } }), 1);
  assert.equal(await prisma.abandoned_carts.count({ where: { store_id: STORE_ID, external_cart_id: before.external_cart_id } }), 1);
  assert.equal(await prisma.abandoned_carts.count({ where: { id: CART_ID, status: { in: ['pending', 'abandoned'] }, recovered_at: null } }), 0);
  console.log(JSON.stringify({ test: 'TASK030_CONTROLLED_SOURCE_STALE_REPLAY', result: 'PASS', store: 'revluma-test-store-v1', orderLinked: true, recoveredPreserved: true, duplicateCheckout: false, activeAbandonment: false }));
}
main().catch((error) => { console.error('TASK030_CONTROLLED_SOURCE_STALE_REPLAY FAIL:', error.message); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
