const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SENSITIVITY_FEATURES,
  churnTier,
  sensitivitySnapshot,
} = require('../trainingObservationService');
const { timingPolicyGroup } = require('../recoveryActionService');

test('sensitivity snapshots contain only the exact thirteen model features', () => {
  const snapshot = sensitivitySnapshot({
    past_orders_total: 2,
    avg_order_value: 80,
    visited_coupon_page: true,
    unrelated_field: 123,
  });
  assert.deepEqual(Object.keys(snapshot), SENSITIVITY_FEATURES);
  assert.equal(snapshot.is_return_visitor, 1);
  assert.equal(snapshot.unrelated_field, undefined);
});

test('observed inactivity maps to the model churn tiers', () => {
  assert.equal(churnTier(30), 'HEALTHY');
  assert.equal(churnTier(31), 'AT_RISK');
  assert.equal(churnTier(61), 'HIGH_RISK');
  assert.equal(churnTier(91), 'CRITICAL');
});

test('timing control assignment is stable and bounded', () => {
  const keys = Array.from({ length: 100 }, (_, index) => index.toString(16).padStart(8, '0'));
  const assignments = keys.map(timingPolicyGroup);
  assert.deepEqual(assignments, keys.map(timingPolicyGroup));
  assert.ok(assignments.includes('candidate'));
  assert.ok(assignments.includes('control'));
});
