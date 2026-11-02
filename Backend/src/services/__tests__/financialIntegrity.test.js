'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeCustomerLifetimeValue,
  normalizeCurrency,
  parseAmount,
  requireCurrency,
  resolveOrderRecoveryStatus,
  totalsByCurrency,
  verifiedCustomerLifetimeValue,
} = require('../financialIntegrity');

test('currency codes are validated, never defaulted to USD', () => {
  assert.equal(normalizeCurrency('usd'), 'USD');
  assert.equal(normalizeCurrency(' NGN '), 'NGN');
  for (const value of [null, undefined, '', 'US', 'USDT', 840, {}, true]) {
    assert.equal(normalizeCurrency(value), null);
  }
  assert.throws(
    () => requireCurrency(undefined, { code: 'ORDER_CURRENCY_UNVERIFIED' }),
    (error) => error.code === 'ORDER_CURRENCY_UNVERIFIED',
  );
});

test('amounts reject malformed and negative values instead of coercing to zero', () => {
  assert.equal(parseAmount('10.105'), 10.11);
  assert.equal(parseAmount(0), 0);
  assert.equal(parseAmount('not-a-number'), null);
  assert.equal(parseAmount(-1), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount(Number.NaN), null);
  assert.equal(parseAmount(Number.POSITIVE_INFINITY), null);
});

test('PostgreSQL NUMERIC values (Prisma Decimal) are read exactly', () => {
  const decimal = { toString: () => '364.50' };
  assert.equal(parseAmount(decimal), 364.5);
  assert.equal(parseAmount({ toString: () => '-5.00' }), null);
  assert.equal(parseAmount({ toString: () => 'nope' }), null);
  assert.equal(parseAmount({}), null);
  assert.equal(parseAmount([100]), null);
  const ltv = computeCustomerLifetimeValue([{ total: decimal, currency: 'USD', recovery_status: 'completed' }]);
  assert.equal(ltv.ltv, 364.5);
  assert.equal(ltv.ltv_currency, 'USD');
});

test('a mixed-currency customer never receives a combined total', () => {
  const ltv = computeCustomerLifetimeValue([
    { total: '10.00', currency: 'USD', recovery_status: 'completed' },
    { total: '20.00', currency: 'EUR', recovery_status: 'completed' },
  ]);
  assert.equal(ltv.ltv, null);
  assert.equal(ltv.mixed_currency, true);
});

test('totals never mix currencies and report rejected rows', () => {
  const { currencies, rejected } = totalsByCurrency([
    { currency: 'USD', total: '10.10' },
    { currency: 'usd', total: '20.20' },
    { currency: 'NGN', total: '1000' },
    { currency: null, total: '99' },
    { currency: 'USD', total: 'bad' },
  ]);
  assert.deepEqual(currencies, [
    { currency: 'NGN', value: 1000, count: 1 },
    { currency: 'USD', value: 30.3, count: 2 },
  ]);
  assert.equal(rejected, 2);
});

test('customer lifetime value is never a mixed-currency total', () => {
  const single = computeCustomerLifetimeValue([
    { total: '10.00', currency: 'USD', recovery_status: 'completed' },
    { total: '5.50', currency: 'USD', recovery_status: null },
    { total: '999.00', currency: 'USD', recovery_status: 'cancelled' },
  ]);
  assert.equal(single.ltv, 15.5);
  assert.equal(single.ltv_currency, 'USD');
  assert.equal(single.mixed_currency, false);
  assert.equal(single.orders_count, 2);

  const mixed = computeCustomerLifetimeValue([
    { total: '10.00', currency: 'USD', recovery_status: 'completed' },
    { total: '1000.00', currency: 'NGN', recovery_status: 'completed' },
  ]);
  assert.equal(mixed.ltv, null);
  assert.equal(mixed.ltv_currency, null);
  assert.equal(mixed.mixed_currency, true);
  assert.equal(mixed.orders_count, 2);
  assert.deepEqual(mixed.currencies, ['NGN', 'USD']);

  const empty = computeCustomerLifetimeValue([]);
  assert.equal(empty.ltv, 0);
  assert.equal(empty.orders_count, 0);
  assert.equal(empty.mixed_currency, false);
});

test('cancellation is terminal and a tombstone beats a delayed order create', () => {
  assert.equal(resolveOrderRecoveryStatus({ existing: null, tombstone: { observed_at: new Date() } }), 'cancelled');
  assert.equal(resolveOrderRecoveryStatus({ existing: { recovery_status: 'cancelled' } }), 'cancelled');
  assert.equal(resolveOrderRecoveryStatus({ existing: null, incomingCancelled: true }), 'cancelled');
  assert.equal(resolveOrderRecoveryStatus({ existing: { recovery_status: null } }), 'completed');
  assert.equal(resolveOrderRecoveryStatus({ existing: { recovery_status: 'completed' } }), 'completed');
});

test('customer LTV is only usable with a single verified currency', () => {
  const verified = verifiedCustomerLifetimeValue({ ltv: '520.00', ltv_currency: 'usd' });
  assert.deepEqual(verified, { value: 520, currency: 'USD', mixed: false, verified: true });

  // Mixed-currency customers must not become one number.
  assert.deepEqual(
    verifiedCustomerLifetimeValue({ ltv: 520, ltv_currency: null, ltv_mixed_currency: true }),
    { value: null, currency: null, mixed: true, verified: false },
  );
  // A legacy value with no stored currency must never be assumed to be USD.
  assert.deepEqual(
    verifiedCustomerLifetimeValue({ ltv: 520 }),
    { value: null, currency: null, mixed: false, verified: false },
  );
  assert.equal(verifiedCustomerLifetimeValue({ ltv: 1, ltv_currency: 'US' }).verified, false);
  assert.equal(verifiedCustomerLifetimeValue({ ltv: -1, ltv_currency: 'USD' }).verified, false);
  assert.equal(verifiedCustomerLifetimeValue({ ltv: 'not-a-number', ltv_currency: 'USD' }).verified, false);
  assert.equal(verifiedCustomerLifetimeValue(null).value, null);
});
