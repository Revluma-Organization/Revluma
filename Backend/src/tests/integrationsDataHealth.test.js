'use strict';

// Integrations projection reads the shared data-health evaluation: routine
// optional-permission and unsupported gaps are disclosed but are not a sync
// failure; genuine core problems still surface, and only merchant-actionable
// ones ask the merchant to act.

process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ||= 'a'.repeat(64);

const test = require('node:test');
const assert = require('node:assert/strict');

function mockModule(relativePath, exports) {
  const id = require.resolve(relativePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
mockModule('../configs/database', { prisma: {} });

const { responseStore } = require('../controller/storeController')._private;
const { OVERALL } = require('../services/dataHealth');
const { REQUIRED_SUBSCRIPTIONS } = require('../services/shopifyWebhookTopics');
const { productionRows, productionStore } = require('./selfManagingStoreFixtures');

const RECENT = () => new Date(Date.now() - 10 * 60 * 1000).toISOString();

function project(storeExtra = {}, rows = productionRows(RECENT()), extras = {}) {
  const store = { ...productionStore({ last_synced_at: RECENT(), ...storeExtra }), platform: 'shopify', shop_domain: 'revluma-test-store-v1.myshopify.com', authorization_verified_at: '2026-11-20T00:00:00Z' };
  const registrations = REQUIRED_SUBSCRIPTIONS.map(([topic]) => ({ store_id: store.id, topic, status: 'active', external_id: `gid://shopify/WebhookSubscription/${topic}`, last_verified_at: new Date() }));
  return responseStore(store, registrations, [], rows.map(row => ({ ...row, store_id: store.id, pagination_complete: true })), [], extras);
}

test('limitations-only sync is complete with limitations, not a failure', () => {
  const result = project();
  assert.equal(result.data_health.overall, OVERALL.HEALTHY_WITH_LIMITATIONS);
  assert.equal(result.sync_status, 'complete_with_limitations');
  assert.equal(result.setup_status, 'complete');
  assert.ok(result.sync_limitations.some(line => /URL redirects: Shopify permission not granted/.test(line)), 'limitations stay disclosed');
  assert.equal(Object.hasOwn(result, 'access_token'), false);
});

test('core data retrying on a schedule shows as recovering, not as needs-attention', () => {
  const rows = productionRows(RECENT()).map(row => (row.domain === 'orders'
    ? { ...row, status: 'failed', coverage_state: 'retrieval_failure', retry_eligible: true, last_succeeded_at: new Date(Date.now() - 8 * 3600 * 1000).toISOString() } : row));
  const result = project({ sync_next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() }, rows);
  assert.equal(result.data_health.overall, OVERALL.RECOVERING);
  assert.equal(result.setup_status, 'recovering');
});

test('exhausted recovery (store dead letter) still surfaces as failed', () => {
  const rows = productionRows(RECENT()).map(row => (row.domain === 'orders'
    ? { ...row, status: 'failed', coverage_state: 'retrieval_failure', retry_eligible: true, last_succeeded_at: new Date(Date.now() - 8 * 3600 * 1000).toISOString() } : row));
  const result = project({ sync_next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() }, rows, {
    deadLetters: [{ kind: 'store_sync', subject_key: 'x', status: 'open', failure_class: 'transient', attempts: 5 }],
  });
  assert.equal(result.setup_status, 'failed');
});

test('missing core permission asks the merchant (and only then)', () => {
  const scopes = productionStore().granted_scopes.replace('read_inventory,', '');
  const result = project({ granted_scopes: scopes });
  assert.equal(result.data_health.merchant_action.kind, 'grant_permission');
  assert.equal(result.setup_status, 'failed');
});
