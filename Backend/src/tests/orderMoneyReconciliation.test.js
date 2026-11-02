'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileOrderMoney } = require('../services/financialIntegrity');

// Shopify delivery is not ordered. These cases pin the rule that a stale
// snapshot can never resurrect revenue that a refund already removed.

test('a delayed pre-refund create does not resurrect a fully refunded order', () => {
  const result = reconcileOrderMoney({ incomingNet: 1025, incomingRefunded: 0, storedRefunded: 1025 });
  assert.equal(result.total, 0);
  assert.equal(result.refunded_total, 1025);
});

test('a delayed create cannot drop a recorded refund back to zero', () => {
  const result = reconcileOrderMoney({ incomingNet: 100, incomingRefunded: 0, storedRefunded: 100 });
  assert.equal(result.total, 0);
  assert.equal(result.refunded_total, 100);
});

test('a payload without refund evidence still honours the stored refund', () => {
  const result = reconcileOrderMoney({ incomingNet: 100, incomingRefunded: null, storedRefunded: 30 });
  assert.equal(result.total, 70);
  assert.equal(result.refunded_total, 30);
});

test('a partial refund update keeps the net total and records the refund', () => {
  const result = reconcileOrderMoney({ incomingNet: 70, incomingRefunded: 30, storedRefunded: 30 });
  assert.equal(result.total, 70);
  assert.equal(result.refunded_total, 30);
});

test('additional refunds increase the recorded refunded amount (monotonic)', () => {
  const first = reconcileOrderMoney({ incomingNet: 80, incomingRefunded: 20, storedRefunded: null });
  assert.deepEqual(first, { total: 80, refunded_total: 20 });

  const second = reconcileOrderMoney({
    incomingNet: 64.5, incomingRefunded: 35.5, storedRefunded: first.refunded_total,
  });
  assert.equal(second.total, 64.5);
  assert.equal(second.refunded_total, 35.5);
});

test('a refund reversal request cannot raise net revenue above zero after a full refund', () => {
  const result = reconcileOrderMoney({ incomingNet: 100, incomingRefunded: 0, storedRefunded: 100 });
  assert.equal(result.total, 0);
  assert.equal(result.refunded_total, 100);
});

test('refunds larger than the incoming total clamp net at zero', () => {
  const result = reconcileOrderMoney({ incomingNet: 50, incomingRefunded: 0, storedRefunded: 100 });
  assert.equal(result.total, 0);
  assert.equal(result.refunded_total, 100);
});

test('with no refund evidence anywhere the net total stands alone', () => {
  assert.deepEqual(
    reconcileOrderMoney({ incomingNet: '100.00', incomingRefunded: null, storedRefunded: null }),
    { total: 100, refunded_total: null },
  );
});

test('a malformed or negative incoming net total fails closed', () => {
  assert.equal(reconcileOrderMoney({ incomingNet: 'not-a-number', incomingRefunded: 10, storedRefunded: 10 }).total, null);
  assert.equal(reconcileOrderMoney({ incomingNet: -5, incomingRefunded: 0, storedRefunded: 0 }).total, null);
  assert.equal(reconcileOrderMoney({ incomingNet: null, incomingRefunded: 0, storedRefunded: 0 }).total, null);
});

test('a malformed incoming refunded amount falls back to stored evidence', () => {
  // The ingestion layer already normalises an unreadable refund payload to
  // "unknown", so reconciliation must not invent a refund or drop the stored
  // one; it keeps the known refund and deducts it.
  assert.deepEqual(
    reconcileOrderMoney({ incomingNet: 100, incomingRefunded: 'not-a-number', storedRefunded: 10 }),
    { total: 90, refunded_total: 10 },
  );
});

test('a negative incoming refunded amount fails closed', () => {
  assert.deepEqual(
    reconcileOrderMoney({ incomingNet: 100, incomingRefunded: -1, storedRefunded: 10 }),
    { total: null, refunded_total: null },
  );
});

test('stored decimal strings from PostgreSQL are accepted', () => {
  const result = reconcileOrderMoney({ incomingNet: '1025.00', incomingRefunded: '0.00', storedRefunded: '1025.00' });
  assert.equal(result.total, 0);
  assert.equal(result.refunded_total, 1025);
});

test('unverifiable stored refund evidence is ignored, not invented', () => {
  const result = reconcileOrderMoney({ incomingNet: 100, incomingRefunded: 0, storedRefunded: 'not-a-number' });
  assert.deepEqual(result, { total: 100, refunded_total: 0 });
});
