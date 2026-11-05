'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
process.env.SHOPIFY_API_SECRET = 'test-only-secret';
let updates = [];
const dbPath = require.resolve('../configs/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: {
  stores: { findFirst: async () => ({ id: 'store-test' }) },
  webhook_deliveries: {
    create: async () => ({ id: 'delivery-test' }),
    update: async args => { updates.push(args.data); },
  },
} } };
const { processCommerceWebhook } = require('../services/commerceWebhookService');
const { receive } = require('../controller/commerceWebhookController');

for (const topic of ['customers/data_request', 'customers/redact', 'shop/redact']) {
  test(`${topic} is never incorrectly acknowledged as processed`, async () => {
    await assert.rejects(processCommerceWebhook({ provider: 'shopify', store: { id: 'store-test' }, topic, payload: {} }),
      { code: 'SHOPIFY_PRIVACY_WEBHOOK_UNIMPLEMENTED' });
    updates = [];
    const raw = Buffer.from('{}');
    const signature = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(raw).digest('base64');
    let forwarded;
    let responseSent = false;
    await receive({ params: { provider: 'shopify', topic }, body: raw, headers: {
      'x-shopify-shop-domain': 'revluma-test-store-v1.myshopify.com',
      'x-shopify-hmac-sha256': signature, 'x-shopify-webhook-id': 'test-delivery',
    } }, { status() { responseSent = true; return this; }, json() { responseSent = true; return this; } }, err => { forwarded = err; });
    assert.equal(responseSent, false);
    assert.equal(forwarded.code, 'SHOPIFY_PRIVACY_WEBHOOK_UNIMPLEMENTED');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].status, 'failed');
    assert.equal(updates[0].processed_at, null);
  });
}
