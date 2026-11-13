'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const dbPath = require.resolve('../configs/database');
const lifecycleWrites = [];
const prisma = new Proxy({ abandoned_carts: { async updateMany(args) { lifecycleWrites.push(args); return {count: 1}; } } }, { get(target, key) { if (!(key in target)) throw new Error('unexpected database access'); return target[key]; } });
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma } };
const service = require('../services/recoveryActionService');

test('legacy switches and consent cannot authorize recovery or discount automation', () => {
  const previous = process.env.BETA_AUTOMATION_KILL_SWITCH;
  try {
    process.env.BETA_AUTOMATION_KILL_SWITCH = 'false';
    const policy = { enabled: true, kill_switch: false, allowed_actions: ['cart_recovery_message', 'percentage_discount'], allowed_channels: ['email'], max_discount_pct: 25 };
    assert.equal(service.automationPermitted(policy, { consent_email: true }, 10), false);
  } finally { if (previous === undefined) delete process.env.BETA_AUTOMATION_KILL_SWITCH; else process.env.BETA_AUTOMATION_KILL_SWITCH = previous; }
});
test('enqueue rejects without database or provider access', async () => {
  assert.deepEqual(await service.enqueueRecoveryAction({ store: { id: 'store-a' }, customer: { id: 'customer-a' } }), { queued: false, reason: 'read_only_mvp' });
});
test('direct processing of a previously queued send does not send or change it', async () => {
  assert.deepEqual(await service.processRecoverySend({ id: 'queued-send', store_id: 'store-a' }), { sent: false, reason: 'read_only_mvp' });
});
test('scheduler does not claim, mutate, or deliver queued recovery messages', async () => {
  assert.deepEqual(await service.runRecoveryActions({ limit: 100 }), { processed: 0, failed: 0, disabled: true, reason: 'read_only_mvp' });
  assert.equal(lifecycleWrites.length, 1); assert.equal(lifecycleWrites[0].where.status, 'pending');
  assert.equal(lifecycleWrites[0].where.recovered_at, null); assert.equal(lifecycleWrites[0].data.status, 'abandoned');
});

test('OAuth scope configuration drops merchant write scopes while retaining configured reads', () => {
  const oldScopes = process.env.SHOPIFY_SCOPES;
  const oldKey = process.env.SHOPIFY_API_KEY;
  const oldUri = process.env.SHOPIFY_REDIRECT_URI;
  const oldSecret = process.env.SHOPIFY_API_SECRET, oldBackend = process.env.BACKEND_URL, oldFrontend = process.env.FRONTEND_URL;
  try {
    process.env.SHOPIFY_SCOPES = 'write_products,write_discounts,write_orders,read_discounts,read_content';
    process.env.SHOPIFY_API_KEY = 'fixture'; process.env.SHOPIFY_REDIRECT_URI = 'https://example.invalid/api/v1/shopify/callback';
    process.env.SHOPIFY_API_SECRET = 'fixture'; process.env.BACKEND_URL = 'https://example.invalid'; process.env.FRONTEND_URL = 'https://example.invalid';
    const { buildInstallUrl } = require('../utils/shopify');
    const scopes = new URL(buildInstallUrl({shop:'example.myshopify.com',state:'fixture'})).searchParams.get('scope').split(',');
    assert.ok(scopes.includes('read_discounts')); assert.ok(scopes.includes('read_orders'));
    assert.ok(scopes.every(scope => scope.startsWith('read_')));
  } finally {
    for (const [key,value] of [['SHOPIFY_SCOPES',oldScopes],['SHOPIFY_API_KEY',oldKey],['SHOPIFY_REDIRECT_URI',oldUri],['SHOPIFY_API_SECRET',oldSecret],['BACKEND_URL',oldBackend],['FRONTEND_URL',oldFrontend]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
