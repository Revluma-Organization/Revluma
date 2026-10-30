const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', relativePath), 'utf8');
}

const app = read('src/app.js');
const mlService = read('src/services/mlService.js');
const revController = read('src/controller/revController.js');
const webhookController = read('src/controller/commerceWebhookController.js');
const internalController = read('src/controller/internalController.js');
const internalRoute = read('src/route/internalRoute.js');

assert.ok(app.indexOf("express.raw({ type: 'application/json', limit: '2mb' })") < app.indexOf('express.json('), 'raw webhooks must be mounted before global JSON parsing');
assert.ok(webhookController.includes('verifyShopifySignature'), 'commerce webhooks must verify Shopify signatures');
assert.ok(webhookController.includes('claimDelivery'), 'commerce webhooks must claim deliveries idempotently');
assert.ok(mlService.includes("path: '/api/alerts/check'"), 'alert calls must use the ML gateway');
assert.ok(!revController.includes("require('axios').post"), 'Rev controllers must not call Python directly');
assert.ok(internalRoute.includes("router.post('/store-sync'"), 'the protected internal store-sync route must be mounted');
assert.ok(internalController.includes('syncShopifyStore(store)'), 'the internal store-sync route must invoke the real Shopify sync');

assert.ok(webhookController.includes("process.env.TASK013_CHECKOUT_FIELD_CAPTURE === 'true'"), 'Task 013 diagnostics must be opt-in');
assert.ok(webhookController.includes("headers.domain === 'revluma-test-store-v1.myshopify.com'"), 'Task 013 diagnostics must be test-store-only');
assert.ok(webhookController.includes("task013_checkout_field_presence"), 'Task 013 diagnostics must emit field-presence evidence');
assert.ok(!webhookController.includes("logger.info('task013_checkout_field_presence', payload"), 'Task 013 must not log raw checkout payloads');

console.log('integration.contract.test.js: all assertions passed');
