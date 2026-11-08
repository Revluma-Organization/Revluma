'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

test('order ingestion uses an explicit bounded transaction budget', async () => {
  let options;
  let persisted = false;
  const order = { id: 'order-1', store_id: 'store-1', abandoned_cart_id: null };
  const tx = {
    customers: {
      upsert: async () => ({ id: 'customer-1' }),
      update: async () => ({}),
    },
    orders: {
      findFirst: async () => persisted ? order : null,
      upsert: async () => { persisted = true; return order; },
      findMany: async () => [],
    },
    order_cancellation_tombstones: { findUnique: async () => null },
    abandoned_carts: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    order_checkout_reconciliation_cases: { upsert: async () => ({}) },
  };
  const prisma = {
    $transaction: async (callback, transactionOptions) => {
      options = transactionOptions;
      return callback(tx);
    },
  };

  const path = require.resolve('../services/commerceWebhookService');
  delete require.cache[path];
  const original = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === '../configs/database') return { prisma };
    if (request === '../utils/logger') return { info() {}, warn() {}, error() {} };
    if (request === './mlService') return { rfmSync: async () => ({ success: true }) };
    if (request === './privacyWebhookService') return { isPrivacyTopic: () => false, handleShopifyPrivacyWebhook: async () => ({}) };
    return original.call(this, request, parent, isMain);
  };
  let service;
  try { service = require('../services/commerceWebhookService'); }
  finally { Module._load = original; }

  await service.upsertOrder({ id: 'store-1' }, 'shopify', {
    id: '1001', created_at: '2026-11-08T00:00:00Z', total_price: '25.00', currency: 'USD',
  });
  assert.deepEqual(options, { maxWait: 10000, timeout: 30000 });
});
