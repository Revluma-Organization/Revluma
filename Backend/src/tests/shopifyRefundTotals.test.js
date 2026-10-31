'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shopifyNetOrderTotal } = require('../services/commerceWebhookService');

const order = refunds => ({ total_price: '100.00', refunds });
const refund = (amount, status = 'success') => ({
  transactions: [{ kind: 'refund', status, amount }],
});

test('Shopify full refund yields zero net revenue', () => {
  assert.equal(shopifyNetOrderTotal(order([refund('100.00')])), '0.00');
});
test('Shopify partial refunds reconcile without double subtraction', () => {
  assert.equal(shopifyNetOrderTotal(order([refund('20.00'), refund('15.50')])), '64.50');
});
test('failed or pending refunds do not reduce revenue', () => {
  assert.equal(shopifyNetOrderTotal(order([refund('100.00', 'failure'), refund('10.00', 'pending')])), '100.00');
});
test('malformed refund transactions fail closed', () => {
  assert.equal(shopifyNetOrderTotal(order([{ id: 1 }])), null);
  assert.equal(shopifyNetOrderTotal(order([refund('not-a-number')])), null);
});
test('nonrefunded Shopify orders retain original total', () => {
  assert.equal(shopifyNetOrderTotal(order([])), '100.00');
});

test('decimal refund arithmetic does not introduce binary floating-point drift', () => {
  assert.equal(shopifyNetOrderTotal(order([refund('0.10'), refund('0.20')])), '99.70');
  assert.equal(shopifyNetOrderTotal({ total_price: '0.30', refunds: [refund('0.10'), refund('0.20')] }), '0.00');
});
test('missing order total is not converted to zero', () => {
  assert.equal(shopifyNetOrderTotal({ refunds: [] }), null);
  assert.equal(shopifyNetOrderTotal({ total_price: null, refunds: [] }), null);
});
test('over-refund is clamped to zero using decimal arithmetic', () => {
  assert.equal(shopifyNetOrderTotal(order([refund('150.00')])), '0.00');
});

test('missing Shopify refund collection is not treated as proof of no refunds', () => {
  assert.equal(shopifyNetOrderTotal({ total_price: '100.00' }), null);
});
