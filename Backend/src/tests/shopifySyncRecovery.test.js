'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { STALE_SYNC_MS, storeSyncEligibility } = require('../services/shopifySyncRecovery');

const NOW = Date.parse('2026-10-29T12:00:00Z');
function matches(row, clause) {
  return Object.entries(clause).every(([key, rule]) => {
    if (key === 'OR') return rule.some(part => matches(row, part));
    const value = row[key];
    if (rule && typeof rule === 'object' && !(rule instanceof Date)) {
      if ('in' in rule) return rule.in.includes(value);
      if ('lte' in rule) return value != null && new Date(value).getTime() <= rule.lte.getTime();
    }
    return value === rule;
  });
}

test('stale syncing store is selected after 20 minutes', () => {
  const where = storeSyncEligibility(NOW);
  assert.equal(STALE_SYNC_MS, 20 * 60 * 1000);
  assert.equal(matches({ platform: 'shopify', status: 'syncing', updated_at: new Date(NOW - STALE_SYNC_MS) }, where), true);
});

test('recent syncing store is excluded to avoid duplicate execution', () => {
  const where = storeSyncEligibility(NOW);
  assert.equal(matches({ platform: 'shopify', status: 'syncing', updated_at: new Date(NOW - STALE_SYNC_MS + 1) }, where), false);
});

test('active store with old sync is eligible but fresh active store is not', () => {
  const where = storeSyncEligibility(NOW);
  assert.equal(matches({ platform: 'shopify', status: 'active', last_synced_at: new Date(NOW - 16 * 60 * 1000) }, where), true);
  assert.equal(matches({ platform: 'shopify', status: 'active', last_synced_at: new Date(NOW - 2 * 60 * 1000) }, where), false);
});

test('non-Shopify and disconnected stores are never retried', () => {
  const where = storeSyncEligibility(NOW);
  assert.equal(matches({ platform: 'woocommerce', status: 'syncing', updated_at: new Date(0) }, where), false);
  assert.equal(matches({ platform: 'shopify', status: 'disconnected', updated_at: new Date(0) }, where), false);
});
