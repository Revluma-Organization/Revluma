'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shopifyNetOrderTotal } = require('../services/commerceWebhookService');

const order = refunds => ({ total_price: '100.00', currency: 'USD', refunds });
const refund = (amount, status = 'success') => ({
  transactions: [{ kind: 'refund', status, amount, currency: 'USD' }],
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
test('over-refund is contradictory evidence and fails closed instead of becoming zero', () => {
  assert.equal(shopifyNetOrderTotal(order([refund('150.00')])), null);
});

test('missing Shopify refund collection is not treated as proof of no refunds', () => {
  assert.equal(shopifyNetOrderTotal({ total_price: '100.00' }), null);
});

test('amounts exceeding the persisted DECIMAL(10,2) precision fail closed', () => {
  assert.equal(shopifyNetOrderTotal({ total_price: '1.234', refunds: [] }), null);
  assert.equal(shopifyNetOrderTotal({ total_price: '100.00', refunds: [refund('0.001')] }), null);
  assert.equal(shopifyNetOrderTotal({ total_price: '100000000.00', refunds: [] }), null);
});

test('successful refund in a different or unverifiable currency fails closed', () => {
  assert.equal(shopifyNetOrderTotal({
    total_price: '100.00', currency: 'USD',
    refunds: [{ transactions: [{ kind: 'refund', status: 'success', amount: '10.00', currency: 'EUR' }] }],
  }), null);
  assert.equal(shopifyNetOrderTotal({
    total_price: '100.00',
    refunds: [{ transactions: [{ kind: 'refund', status: 'success', amount: '10.00', currency: 'EUR' }] }],
  }), null);
});

test('empty or unknown refund transaction states are not treated as no refund', () => {
  assert.equal(shopifyNetOrderTotal(order([{ transactions: [] }])), null);
  assert.equal(shopifyNetOrderTotal(order([refund('10.00', 'mystery-status')])), null);
});

test('refund transaction without a refund kind is malformed evidence', () => {
  assert.equal(shopifyNetOrderTotal(order([{ transactions: [{ status: 'success', amount: '10.00' }] }])), null);
});

test('successful refund without a verifiable currency fails closed', () => {
  assert.equal(shopifyNetOrderTotal({
    total_price: '100.00',
    currency: 'USD',
    refunds: [{ transactions: [{ kind: 'refund', status: 'success', amount: '10.00' }] }],
  }), null);
});
