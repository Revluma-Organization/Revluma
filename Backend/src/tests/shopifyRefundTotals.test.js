'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shopifyNetOrderTotal } = require('../services/commerceWebhookService');

const order = refunds => ({ total_price: '100.00', refunds });
const refund = (amount, status = 'success') => ({
  transactions: [{ kind: 'refund', status, amount }],
});

test('Shopify full refund yields zero net revenue', () => {
  assert.equal(shopifyNetOrderTotal(order([refund('100.00')])), 0);
});
test('Shopify partial refunds reconcile without double subtraction', () => {
  assert.equal(shopifyNetOrderTotal(order([refund('20.00'), refund('15.50')])), 64.5);
});
test('failed or pending refunds do not reduce revenue', () => {
  assert.equal(shopifyNetOrderTotal(order([refund('100.00', 'failure'), refund('10.00', 'pending')])), 100);
});
test('malformed refund transactions fail closed', () => {
  assert.equal(shopifyNetOrderTotal(order([{ id: 1 }])), null);
  assert.equal(shopifyNetOrderTotal(order([refund('not-a-number')])), null);
});
test('nonrefunded Shopify orders retain original total', () => {
  assert.equal(shopifyNetOrderTotal(order([])), 100);
});
