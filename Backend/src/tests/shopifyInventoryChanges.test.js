'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectAvailabilityTransitions } = require('../services/shopifyInventoryChanges');
const make = (available, at) => ({
  storeId: 'store-1', observedAt: at, scopeVerified: true,
  catalogPaginationComplete: true, variantPaginationComplete: true,
  products: [{ productId: 'p1', title: 'Example', status: 'ACTIVE',
    variants: [{ variantId: 'v1', availableForSale: available }] }],
});
test('records a verified availability transition without claiming a stockout', () => {
  const before = make(true, '2026-10-27T10:00:00Z');
  const after = make(false, '2026-10-28T10:00:00Z');
  const result = detectAvailabilityTransitions(before, after);
  assert.equal(result.verified, true);
  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0].currentAvailable, false);
  assert.equal(result.transitions[0].causeVerified, false);
  assert.equal(result.transitions[0].merchantAlertEligible, false);
});
test('refuses incomplete coverage and nonchronological comparisons', () => {
  const before = make(true, '2026-10-27T10:00:00Z');
  const after = make(false, '2026-10-28T10:00:00Z');
  assert.equal(detectAvailabilityTransitions(before, { ...after, variantPaginationComplete: false }).verified, false);
  assert.equal(detectAvailabilityTransitions(after, before).verified, false);
  assert.equal(detectAvailabilityTransitions(before, { ...after, storeId: 'other' }).verified, false);
});
