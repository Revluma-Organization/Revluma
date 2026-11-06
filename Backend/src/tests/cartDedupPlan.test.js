'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planDedup, canonicalCheckoutIdentity } = require('../../scripts/lib/dedupPlan');

const base = { storeId: 'store-a', cartValue: 100, currency: 'USD', status: 'abandoned' };

test('numeric checkout identity wins over opaque token', () => {
  const a = canonicalCheckoutIdentity({ ...base, sourceCheckoutId: 'gid://shopify/Checkout/1234567890', sourceCartToken: 'tok' });
  assert.equal(a, 'store-a|checkout|1234567890');
});

test('external cart GID embeds numeric checkout id', () => {
  const id = canonicalCheckoutIdentity({ ...base, externalCartId: 'gid://shopify/Checkout/99887766', sourceCartToken: null, sourceCheckoutToken: null, sourceCheckoutId: null });
  assert.equal(id, 'store-a|checkout|99887766');
});

test('opaque token falls back, never cross-store merged', () => {
  const id = canonicalCheckoutIdentity({ ...base, externalCartId: null, sourceCheckoutId: null, sourceCheckoutToken: null, sourceCartToken: 'cart-token-xyz' });
  assert.equal(id, 'store-a|token|cart-token-xyz');
  const other = canonicalCheckoutIdentity({ ...base, storeId: 'store-b', externalCartId: null, sourceCheckoutId: null, sourceCheckoutToken: null, sourceCartToken: 'cart-token-xyz' });
  assert.notEqual(id, other);
});

test('planDedup keeps earliest, supersedes the rest, tolerates unidentified rows', () => {
  const rows = [
    { ...base, id: 'r1', sourceCheckoutId: '55555555', createdAt: '2026-10-30T00:00:00Z' },
    { ...base, id: 'r2', sourceCheckoutId: 'gid://shopify/Checkout/55555555', createdAt: '2026-10-30T01:00:00Z' },
    { ...base, id: 'r3', sourceCheckoutId: null, externalCartId: null, sourceCheckoutToken: null, sourceCartToken: null, createdAt: '2026-10-30T02:00:00Z' },
    { ...base, storeId: 'store-b', id: 'r4', sourceCheckoutId: '55555555', createdAt: '2026-10-30T00:30:00Z' },
  ];
  const plan = planDedup(rows);
  assert.equal(plan.rowsScanned, 4);
  assert.equal(plan.unidentified, 1);
  assert.equal(plan.groups.length, 1); // store-b r4 is a distinct tenant, no group
  assert.equal(plan.groups[0].keep.id, 'r1');
  assert.deepEqual(plan.groups[0].supersede.map(r => r.id), ['r2']);
  assert.equal(plan.totalSuperseded, 1);
});
