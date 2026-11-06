'use strict';
/**
 * Coverage-report derivation rules: a scope grants nothing by itself;
 * COMPLETE requires an ok ledger row with pagination_complete.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { DOMAIN_CAPABILITIES, IMPLEMENTED_DOMAINS } = require('../services/domainCatalog');
const { rowStatus } = require('../services/domainCatalog');

test('scope is never proof of completeness', () => {
  const orders = DOMAIN_CAPABILITIES.find(d => d.domain === 'orders');
  assert.equal(rowStatus(orders, null), 'NOT_YET_SYNCED');
  assert.equal(rowStatus(orders, { status: 'failed' }), 'FAILED');
  assert.equal(rowStatus(orders, { status: 'ok', pagination_complete: false }), 'INCOMPLETE');
  assert.equal(rowStatus(orders, { status: 'ok', pagination_complete: true }), 'COMPLETE');
  assert.equal(rowStatus(orders, { status: 'degraded' }), 'DEGRADED');
  assert.equal(rowStatus(orders, { status: 'running' }), 'SYNCING');
});

test('approval-gated domains are APPROVAL_REQUIRED, not fabricated green', () => {
  const pixel = DOMAIN_CAPABILITIES.find(d => d.domain === 'pixel_events');
  assert.equal(rowStatus(pixel, null), 'APPROVAL_REQUIRED');
  const txn = DOMAIN_CAPABILITIES.find(d => d.domain === 'transactions');
  assert.equal(rowStatus(txn, null), 'NOT_YET_SYNCED');
});

test('catalog remains the authority on implemented domains', () => {
  for (const d of DOMAIN_CAPABILITIES) {
    if (d.implementation === 'implemented') {
      assert.ok(d.required_scopes.every(scope => typeof scope === 'string' && scope.length), `${d.domain} scopes sane`);
    }
  }
  assert.ok(IMPLEMENTED_DOMAINS.includes('transactions'));
  assert.ok(!IMPLEMENTED_DOMAINS.includes('pixel_events'));
  assert.ok(!IMPLEMENTED_DOMAINS.includes('markets'));
});
