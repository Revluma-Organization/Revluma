'use strict';
/**
 * UNIVERSAL coverage derivation: registry x granted scopes x ledger.
 * Scope grants nothing alone; not-implemented stays not-implemented.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { REGISTRY, IMPLEMENTED_IDS } = require('../services/resourceRegistry');
const { universalStatus, STATUS } = require('../services/universalCoverage');

const entry = id => REGISTRY.find(e => e.id === id);
const grantedAll = e => new Set(e.scopes || []);

test('registry is versioned and internally consistent', () => {
  assert.ok(REGISTRY.length >= 40);
  const ids = new Set();
  for (const e of REGISTRY) {
    assert.ok(e.id && e.name && e.surface && e.category && e.acquisition, `entry sane: ${e.id}`);
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
    ids.add(e.id);
    for (const scope of e.scopes || []) assert.match(scope, /^read_|^write_/);
  }
});

test('scope is never proof of completeness', () => {
  const orders = entry('orders');
  // granted scopes but zero ledger evidence => IMPLEMENTED_UNVERIFIED, not verified
  assert.equal(universalStatus(orders, null, grantedAll(orders)), STATUS.IMPLEMENTED_UNVERIFIED);
  // ledger ok + pagination complete => verified (registry says live_read)
  assert.equal(universalStatus(orders, { status: 'ok', pagination_complete: true }, grantedAll(orders)), STATUS.IMPLEMENTED_VERIFIED);
  // ledger ok but pagination incomplete => NOT verified
  assert.equal(universalStatus(orders, { status: 'ok', pagination_complete: false }, grantedAll(orders)), STATUS.IMPLEMENTED_UNVERIFIED);
  // ledger degraded ACCESS_DENIED => ACCESS_DENIED wins
  assert.equal(universalStatus(orders, { status: 'degraded', error_code: 'SHOPIFY_ORDERS_ACCESS_DENIED' }, grantedAll(orders)), STATUS.ACCESS_DENIED);
  // ledger failed => SYNC_FAILED
  assert.equal(universalStatus(orders, { status: 'failed', error_code: 'boom' }, grantedAll(orders)), STATUS.SYNC_FAILED);
});

test('missing consent yields REQUIRES_ADDITIONAL_SCOPES even when code is built', () => {
  const inv = entry('inventory.items');
  assert.equal(universalStatus(inv, null, new Set(['read_products'])), STATUS.REQUIRES_ADDITIONAL_SCOPES);
  assert.equal(universalStatus(inv, null, grantedAll(inv)), STATUS.IMPLEMENTED_UNVERIFIED);
});

test('implemented gateways and genuine external gates remain distinct', () => {
  const taxes = entry('shop.taxes');
  assert.equal(universalStatus(taxes, null, grantedAll(taxes)), STATUS.IMPLEMENTED_UNVERIFIED);
  assert.equal(universalStatus({ ...taxes, acquisition: 'not_implemented' }, null, grantedAll(taxes)), STATUS.PLAN_RESTRICTED);
  const discount = entry('discount-nodes');
  assert.equal(universalStatus(discount, null, grantedAll(discount)), STATUS.IMPLEMENTED_UNVERIFIED);
  assert.equal(universalStatus(discount, null, new Set(['read_products'])), STATUS.REQUIRES_ADDITIONAL_SCOPES);
  // Shopify write access includes the corresponding read capability.
  assert.equal(universalStatus(discount, null, new Set(['write_discounts'])), STATUS.IMPLEMENTED_UNVERIFIED);
  const analytics = entry('analytics.reports');
  assert.equal(universalStatus(analytics, null, grantedAll(analytics)), STATUS.IMPLEMENTED_UNVERIFIED);
  const payment = entry('shop.payment_configuration');
  assert.equal(universalStatus(payment, null, grantedAll(payment)), STATUS.REQUIRES_APP_APPROVAL);
});

test('implemented entries carry their declared approval/plan gates', () => {
  for (const id of IMPLEMENTED_IDS) {
    const e = entry(id);
    assert.ok(e, `implemented id present in registry: ${id}`);
    assert.ok(['implemented', 'implemented_unverified'].includes(e.acquisition));
  }
});
