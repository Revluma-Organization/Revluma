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

assert.ok(app.indexOf("express.raw({ type: 'application/json', limit: '2mb' })") < app.indexOf('express.json('), 'raw webhooks must be mounted before global JSON parsing');
assert.ok(webhookController.includes('verifyShopifySignature'), 'commerce webhooks must verify Shopify signatures');
assert.ok(webhookController.includes('claimDelivery'), 'commerce webhooks must claim deliveries idempotently');
assert.ok(mlService.includes("path: '/api/alerts/check'"), 'alert calls must use the ML gateway');
assert.ok(!revController.includes("require('axios').post"), 'Rev controllers must not call Python directly');

console.log('integration.contract.test.js: all assertions passed');
