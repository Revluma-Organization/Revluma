'use strict';
/**
 * Webhook drift-analysis unit tests (pure function, no network, no database).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { diffSubscriptions } = require('../services/shopifyWebhookDrift');
const { REQUIRED_SUBSCRIPTIONS } = require('../services/shopifyWebhookTopics');

const BASE = 'https://current-backend.example.com';

function remoteFor(topic, uri, id) {
  return { id: id || `gid://shopify/WebhookSubscription/${Math.random().toString(36).slice(2)}`, topic, uri };
}

test('complete fulfilment at the expected URL reports no drift', () => {
  const remote = REQUIRED_SUBSCRIPTIONS.map(([topic, path]) => remoteFor(topic, `${BASE}/api/v1/webhooks/shopify/${path}`));
  const report = diffSubscriptions(remote, BASE + '/');
  assert.equal(report.missing.length, 0);
  assert.equal(report.duplicates.length, 0);
  assert.equal(report.unexpected.length, 0);
  assert.equal(report.legacy_url.length, 0);
  assert.equal(report.fulfilled, REQUIRED_SUBSCRIPTIONS.length);
  assert.equal(report.drift, false);
});

test('products topics missing produce exactly three missing entries and drift', () => {
  const remote = REQUIRED_SUBSCRIPTIONS
    .filter(([topic]) => !topic.startsWith('PRODUCTS_'))
    .map(([topic, path]) => remoteFor(topic, `${BASE}/api/v1/webhooks/shopify/${path}`));
  const report = diffSubscriptions(remote, BASE);
  assert.deepEqual(report.missing.map((entry) => entry.topic).sort(), ['PRODUCTS_CREATE', 'PRODUCTS_DELETE', 'PRODUCTS_UPDATE']);
  assert.equal(report.drift, true);
});

test('same topic at the legacy URL is legacy_url, not missing or unexpected', () => {
  const legacyBase = 'https://legacy-backend.example.com';
  const remote = REQUIRED_SUBSCRIPTIONS.map(([topic, path]) =>
    remoteFor(topic, `${legacyBase}/api/v1/webhooks/shopify/${path}`));
  const report = diffSubscriptions(remote, BASE);
  assert.equal(report.legacy_url.length, REQUIRED_SUBSCRIPTIONS.length);
  assert.equal(report.missing.length, REQUIRED_SUBSCRIPTIONS.length);
  assert.equal(report.unexpected.length, 0);
  assert.equal(report.drift, true);
});

test('duplicate fulfilment at the current URL is reported with counts', () => {
  const uri = `${BASE}/api/v1/webhooks/shopify/orders/create`;
  const remote = [
    ...REQUIRED_SUBSCRIPTIONS.map(([topic, path]) => remoteFor(topic, `${BASE}/api/v1/webhooks/shopify/${path}`)),
    remoteFor('ORDERS_CREATE', uri, 'gid://shopify/WebhookSubscription/duplicate-2'),
  ];
  const report = diffSubscriptions(remote, BASE);
  assert.deepEqual(report.duplicates, [{ topic: 'ORDERS_CREATE', uri, count: 2 }]);
  assert.equal(report.missing.length, 0);
  assert.equal(report.drift, true);
});

test('a topic we do not require is unexpected and drifts', () => {
  const remote = [
    ...REQUIRED_SUBSCRIPTIONS.map(([topic, path]) => remoteFor(topic, `${BASE}/api/v1/webhooks/shopify/${path}`)),
    remoteFor('REFUNDS_CREATE', `${BASE}/api/v1/webhooks/shopify/refunds/create`, 'gid://shopify/WebhookSubscription/unexpected-1'),
  ];
  const report = diffSubscriptions(remote, BASE);
  assert.equal(report.unexpected.length, 1);
  assert.equal(report.unexpected[0].topic, 'REFUNDS_CREATE');
  assert.equal(report.drift, true);
});
