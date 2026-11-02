'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shopifyGraphqlOrderTotals,
  shopifyRefundedAmount,
} = require('../services/shopifyOrderFinancials');

const money = (amount, currencyCode = 'USD') => ({ shopMoney: { amount, currencyCode } });

// Shopify Admin GraphQL order shape as consumed by shopifySync.orderPayload.
const graphqlOrder = ({ current, gross, refunded, currency = 'USD' }) => ({
  currentTotalPriceSet: current === undefined ? null : money(current, currency),
  totalPriceSet: gross === undefined ? null : money(gross, currency),
  totalRefundedSet: refunded === undefined ? null : money(refunded, currency),
});

test('fully refunded #1004 ($1,025 -> $0) stores net 0 and records the refund', () => {
  const totals = shopifyGraphqlOrderTotals(graphqlOrder({ current: '0.00', gross: '1025.00', refunded: '1025.00' }));
  assert.equal(totals.net, 0);
  assert.equal(totals.gross, 1025);
  assert.equal(totals.refunded, 1025);
  assert.equal(totals.gross - totals.refunded, totals.net);
  assert.equal(totals.currency, 'USD');
});

test('fully refunded #1001 ($100 -> $0) stores net 0 and records the refund', () => {
  const totals = shopifyGraphqlOrderTotals(graphqlOrder({ current: '0.00', gross: '100.00', refunded: '100.00' }));
  assert.equal(totals.net, 0);
  assert.equal(totals.gross, 100);
  assert.equal(totals.refunded, 100);
});

test('partially refunded order stores the net total, not the gross', () => {
  const totals = shopifyGraphqlOrderTotals(graphqlOrder({ current: '70.00', gross: '100.00', refunded: '30.00' }));
  assert.equal(totals.net, 70);
  assert.equal(totals.refunded, 30);
});

test('missing currentTotalPriceSet falls back to gross minus refunded', () => {
  const totals = shopifyGraphqlOrderTotals(graphqlOrder({ current: null, gross: '100.00', refunded: '30.00' }));
  assert.equal(totals.net, 70);
});

test('missing current total and refunded total fails closed instead of billing gross', () => {
  const totals = shopifyGraphqlOrderTotals(graphqlOrder({ current: undefined, gross: '100.00', refunded: undefined }));
  assert.equal(totals.net, null);
  assert.equal(totals.gross, 100);
  assert.equal(totals.refunded, null);
});

test('a fully refunded order without a current total never regresses to gross', () => {
  // Regression guard: the previous `currentTotalPriceSet || totalPriceSet`
  // fallback would have stored $1,025 for this fully refunded order.
  const totals = shopifyGraphqlOrderTotals(graphqlOrder({ current: null, gross: '1025.00', refunded: '1025.00' }));
  assert.equal(totals.net, 0);
});

test('refunds larger than the gross total clamp net at zero', () => {
  const totals = shopifyGraphqlOrderTotals(graphqlOrder({ current: null, gross: '100.00', refunded: '120.00' }));
  assert.equal(totals.net, 0);
  assert.equal(totals.refunded, 120);
});

test('malformed or negative GraphQL money is not accepted as a value', () => {
  assert.equal(shopifyGraphqlOrderTotals(graphqlOrder({ current: 'not-a-number', gross: '100.00', refunded: '10.00' })).net, 90);
  assert.equal(shopifyGraphqlOrderTotals(graphqlOrder({ current: '-5.00', gross: '100.00', refunded: '10.00' })).net, 90);
  assert.equal(shopifyGraphqlOrderTotals(graphqlOrder({ current: '', gross: null, refunded: null })).net, null);
});

test('currency follows the current total and never assumes USD', () => {
  const totals = shopifyGraphqlOrderTotals(graphqlOrder({ current: '0.00', gross: '100.00', refunded: '100.00', currency: 'EUR' }));
  assert.equal(totals.currency, 'EUR');
  assert.equal(shopifyGraphqlOrderTotals({ currentTotalPriceSet: null, totalPriceSet: null }).currency, null);
});

test('mixed refunded currency evidence is surfaced, not silently converted', () => {
  const order = {
    currentTotalPriceSet: money('70.00', 'EUR'),
    totalPriceSet: money('100.00', 'USD'),
    totalRefundedSet: money('30.00', 'USD'),
  };
  const totals = shopifyGraphqlOrderTotals(order);
  // The authoritative net comes from the currency-consistent current total.
  assert.equal(totals.net, 70);
  assert.equal(totals.currency, 'EUR');
});

test('shopifyRefundedAmount prefers a declared total_refunded', () => {
  assert.equal(shopifyRefundedAmount({ total_refunded: 30, refunds: [] }), 30);
  assert.equal(shopifyRefundedAmount({ total_refunded: '0.00', refunds: [{ transactions: [] }] }), 0);
});

test('shopifyRefundedAmount treats an explicit null as unknown', () => {
  // Sync payloads always carry the key; a null means Shopify did not return
  // totalRefundedSet, which must not be mistaken for "nothing was refunded".
  assert.equal(shopifyRefundedAmount({ total_refunded: null, refunds: [] }), null);
});

test('shopifyRefundedAmount derives refunds from webhook transactions', () => {
  const payload = {
    refunds: [
      { transactions: [{ kind: 'refund', status: 'success', amount: '20.00' }] },
      { transactions: [{ kind: 'refund', status: 'success', amount: '5.50' }] },
      { transactions: [{ kind: 'refund', status: 'failure', amount: '99.00' }] },
    ],
  };
  assert.equal(shopifyRefundedAmount(payload), 25.5);
  assert.equal(shopifyRefundedAmount({ refunds: [] }), 0);
  assert.equal(shopifyRefundedAmount({}), null);
  assert.equal(shopifyRefundedAmount({ refunds: [{ id: 1 }] }), null);
});
