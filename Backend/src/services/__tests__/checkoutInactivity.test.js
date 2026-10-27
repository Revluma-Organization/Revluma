'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ABANDONMENT_INACTIVITY_MS, lastCheckoutActivity, isCheckoutInactive, nextCheckoutStatus,
} = require('../checkoutInactivity');

const now = new Date('2026-10-27T10:00:00.000Z');

test('a checkout remains active before 15 minutes', () => {
  assert.equal(isCheckoutInactive(new Date(now.getTime() - 14 * 60 * 1000), now), false);
  assert.equal(isCheckoutInactive(new Date(now.getTime() - ABANDONMENT_INACTIVITY_MS + 1), now), false);
});
test('checkout becomes eligible at 15 minutes', () => {
  assert.equal(isCheckoutInactive(new Date(now.getTime() - ABANDONMENT_INACTIVITY_MS), now), true);
  assert.equal(isCheckoutInactive(new Date(now.getTime() - 16 * 60 * 1000), now), true);
});
test('new checkout activity resets the timer', () => {
  const recent = lastCheckoutActivity({ updated_at: new Date(now.getTime() - 60 * 1000).toISOString() }, now);
  assert.equal(isCheckoutInactive(recent, now), false);
});
test('synchronization respects the original Shopify updated timestamp', () => {
  const historical = '2026-10-26T09:00:00.000Z';
  assert.equal(lastCheckoutActivity({ updated_at: historical }, now).toISOString(), historical);
});
test('new and active checkouts stay pending', () => {
  assert.equal(nextCheckoutStatus({}), 'pending');
  assert.equal(nextCheckoutStatus({ existingStatus: 'abandoned' }), 'pending');
});
test('completed checkouts remain recovered even after late webhook events', () => {
  assert.equal(nextCheckoutStatus({ completedAt: now.toISOString() }), 'recovered');
  assert.equal(nextCheckoutStatus({ existingStatus: 'recovered' }), 'recovered');
});
test('stale webhook events do not reset status', () => {
  assert.equal(nextCheckoutStatus({ existingStatus: 'abandoned', isStale: true }), 'abandoned');
});
test('invalid timestamps do not qualify as abandoned', () => {
  assert.equal(isCheckoutInactive('not-a-date', now), false);
});
