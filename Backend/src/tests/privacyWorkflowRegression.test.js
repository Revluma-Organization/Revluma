'use strict';
/**
 * Privacy workflow regression pins — extends shopifyPrivacyWebhookWorkflow with
 * schema/erasure-quality assertions that cannot regress silently:
 *   1. request keys are deterministic and distinct across requests;
 *   2. export artifacts carry only external identifiers and the v1 schema;
 *   3. erasure pseudonymises emails deterministically and strips PII;
 *   4. financial orders are retained while personal links are severed.
 */
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

function freshState() {
  return {
    stores: [{ id: 'store-a', platform: 'shopify', shop_domain: 'a.myshopify.com', status: 'active', organization_id: 'org-a' }],
    customers: [
      { id: 'internal-cust-1', store_id: 'store-a', external_id: 'ext-shopify-1', email: 'buyer@example.com', full_name: 'Buyer Person', phone: '+15551234567', anonymous_id: 'anon-1', orders_count: 2, ltv: '123.45', created_at: new Date('2026-01-01T00:00:00Z'), consent_email: true, consent_sms: true, churn_tier: 'at-risk', primary_churn_signal: 'x', recommended_channel: 'email' },
    ],
    orders: [
      { id: 'order-1', store_id: 'store-a', customer_id: 'internal-cust-1', external_order_id: '18975112233', ordered_at: new Date('2026-10-30T00:00:00Z'), total: '749.95', currency: 'USD', refunded_total: null, discount_amount: '0.00', recovery_status: null, coupon_code: null },
    ],
    order_items: [{ id: 'item-1', store_id: 'store-a', order_id: 'order-1', product_name: 'Widget', quantity: 1, unit_price: '749.95', line_total: '749.95', ordered_at: new Date('2026-10-30T00:00:00Z') }],
    events: [{ id: 'evt-1', store_id: 'store-a', customer_id: 'internal-cust-1' }],
    ml_session_features: [{ id: 'mlf-1', store_id: 'store-a', customer_id: 'internal-cust-1' }],
    churn_training_observations: [{ id: 'cto-1', store_id: 'store-a', customer_id: 'internal-cust-1' }],
    sensitivity_training_observations: [{ id: 'sto-1', store_id: 'store-a', customer_id: 'internal-cust-1' }],
    abandoned_carts: [{ id: 'cart-1', store_id: 'store-a', customer_id: 'internal-cust-1', external_cart_id: 'ec-1', cart_value: '749.95', currency: 'USD', status: 'abandoned', abandoned_at: new Date('2026-10-29T00:00:00Z'), recovered_at: null, recovery_url: 'https://recover.example/x', session_id: 'sess-1', source_cart_token: 'ct', source_checkout_token: 'ckt', source_checkout_id: 'ckid' }],
    sequence_sends: [{ id: 'send-1', store_id: 'store-a', customer_id: 'internal-cust-1' }],
    commerce_resource_records: [
      { resource_id: 'customer.addresses', external_id: 'gid://shopify/CustomerAddress/1', store_id: 'store-a', payload: { id: 'gid://shopify/Customer/ext-shopify-1', address1: 'private' } },
      { resource_id: 'metafields.customers', external_id: 'gid://shopify/Metafield/1', store_id: 'store-a', payload: { id: 'gid://shopify/Metafield/1', owner: { id: 'gid://shopify/Customer/ext-shopify-1' }, value: 'private' } },
      { resource_id: 'customer.addresses', external_id: 'gid://shopify/CustomerAddress/2', store_id: 'store-a', payload: { id: 'gid://shopify/Customer/other', address1: 'retain' } },
    ],
    privacy_requests: [],
    audit_logs: [],
  };
}

function makePrisma(state) {
  const snapshotMatches = (row, where) => row.store_id === where.store_id && where.OR.some((clause) => {
    if (Array.isArray(clause.resource_id?.in) && !clause.resource_id.in.includes(row.resource_id)) return false;
    if (clause.resource_id && typeof clause.resource_id === 'string' && row.resource_id !== clause.resource_id) return false;
    const path = clause.payload.path;
    const value = path.reduce((current, key) => current?.[key], row.payload);
    return clause.payload.in.includes(value);
  });
  const deleteMany = (table) => async ({ where = {} }) => {
    const before = state[table].length;
    state[table] = state[table].filter((row) => {
      if (where.store_id && row.store_id !== where.store_id) return true;
      if (where.customer_id?.in && !where.customer_id.in.includes(row.customer_id)) return true;
      return false;
    });
    return { count: before - state[table].length };
  };
  const updateMany = (table) => async ({ where = {}, data }) => {
    let count = 0;
    for (const row of state[table]) {
      const storeMatch = !where.store_id || row.store_id === where.store_id;
      const custMatch = !where.customer_id?.in || where.customer_id.in.includes(row.customer_id);
      if (storeMatch && custMatch) { Object.assign(row, data); count += 1; }
    }
    return { count };
  };
  const prisma = {
    stores: { findFirst: async ({ where }) => state.stores.find((row) => row.platform === where.platform && row.shop_domain === where.shop_domain && row.status !== 'deleted') || null },
    privacy_requests: {
      findUnique: async ({ where }) => state.privacy_requests.find((row) => {
        const key = where.store_id_provider_topic_request_key;
        return row.store_id === key.store_id && row.provider === key.provider && row.topic === key.topic && row.request_key === key.request_key;
      }) || null,
      create: async ({ data }) => {
        if (state.privacy_requests.some((row) => row.request_key === data.request_key && row.store_id === data.store_id)) {
          throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        }
        const row = { id: `pr-${state.privacy_requests.length + 1}`, result: null, processed_at: null, ...data };
        state.privacy_requests.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = state.privacy_requests.find((r) => r.id === where.id);
        if (data.attempts?.increment) row.attempts += data.attempts.increment;
        for (const [key, value] of Object.entries(data)) { if (key !== 'attempts') row[key] = value; }
        return row;
      },
    },
    audit_logs: { create: async ({ data }) => { state.audit_logs.push(data); return data; } },
    commerce_resource_records: {
      findMany: async ({ where }) => state.commerce_resource_records.filter((row) => snapshotMatches(row, where)),
      deleteMany: async ({ where }) => {
        const before = state.commerce_resource_records.length;
        state.commerce_resource_records = state.commerce_resource_records.filter((row) => !snapshotMatches(row, where));
        return { count: before - state.commerce_resource_records.length };
      },
    },
    customers: {
      findMany: async ({ where }) => state.customers.filter((row) => row.store_id === where.store_id &&
        (where.OR || []).some((clause) => (clause.external_id && row.external_id === clause.external_id) || (clause.email && row.email === clause.email))),
      update: async ({ where, data }) => { const row = state.customers.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    },
    orders: { findMany: async ({ where }) => state.orders.filter((row) => row.store_id === where.store_id && where.customer_id.in.includes(row.customer_id)) },
    order_items: { findMany: async ({ where }) => state.order_items.filter((row) => row.store_id === where.store_id && where.order_id.in.includes(row.order_id)) },
    abandoned_carts: {
      findMany: async ({ where }) => state.abandoned_carts.filter((row) => row.store_id === where.store_id && where.customer_id.in.includes(row.customer_id)),
      updateMany: updateMany('abandoned_carts'),
    },
    sequence_sends: { updateMany: updateMany('sequence_sends') },
    events: { deleteMany: deleteMany('events') },
    ml_session_features: { deleteMany: deleteMany('ml_session_features') },
    churn_training_observations: { deleteMany: deleteMany('churn_training_observations') },
    sensitivity_training_observations: { deleteMany: deleteMany('sensitivity_training_observations') },
    $transaction: async (callback) => callback(prisma),
  };
  const dbPath = require.resolve('../configs/database');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma } };
  return prisma;
}

const PAYLOAD = { customer: { id: 555, email: 'BUYER@example.com' }, shop_id: 777, shop_domain: 'a.myshopify.com' };

function loadService(state) {
  makePrisma(state);
  for (const key of Object.keys(require.cache)) {
    if (key.includes('privacyWebhookService')) delete require.cache[key];
  }
  return require('../services/privacyWebhookService');
}

test('requestKey is deterministic and distinct per subject and shop', () => {
  const state = freshState();
  const service = loadService(state);
  const key1 = service.requestKey('customers/redact', PAYLOAD);
  assert.equal(key1, service.requestKey('customers/redact', PAYLOAD));
  assert.notEqual(key1, service.requestKey('customers/data_request', PAYLOAD));
  assert.notEqual(key1, service.requestKey('customers/redact', { ...PAYLOAD, customer: { id: 556, email: 'BUYER@example.com' } }));
});

test('data_request artifact carries v1 schema and external identifiers only', async () => {
  const state = freshState();
  const service = loadService(state);
  await service.handleShopifyPrivacyWebhook({ store: state.stores[0], topic: 'customers/data_request', payload: PAYLOAD });
  const request = state.privacy_requests[0];
  assert.equal(request.status, 'completed');
  const artifact = request.result.artifact;
  assert.equal(artifact.schema, 'revluma-privacy-data-request-v1');
  assert.deepEqual(Object.keys(artifact).sort(), ['abandoned_carts', 'authorized_resource_snapshots', 'generated_at', 'located_customers', 'order_items', 'orders', 'schema', 'store', 'subject']);
  assert.equal(artifact.authorized_resource_snapshots.length, 2);
  assert.deepEqual(Object.keys(artifact.located_customers[0]).sort(), ['created_at', 'email', 'external_id', 'lifetime_value', 'orders_count']);
  assert.ok(!JSON.stringify(artifact).includes('internal-cust-1'));
  assert.equal(request.result.customers_located, 1);
  assert.equal(request.result.orders_exported, 1);
});

test('redact pseudonymises deterministically and strips PII to null', async () => {
  const state = freshState();
  const service = loadService(state);
  await service.handleShopifyPrivacyWebhook({ store: state.stores[0], topic: 'customers/redact', payload: PAYLOAD });
  const customer = state.customers[0];
  const digest = crypto.createHash('sha256').update('internal-cust-1').digest('hex').slice(0, 24);
  assert.equal(customer.email, `redacted-${digest}@redacted.invalid`);
  assert.equal(customer.full_name, null);
  assert.equal(customer.phone, null);
  assert.equal(customer.anonymous_id, null);
  assert.equal(customer.consent_email, false);
  assert.equal(customer.consent_sms, false);
  assert.equal(customer.churn_tier, null);
  assert.equal(state.events.length, 0);
  assert.equal(state.ml_session_features.length, 0);
  assert.equal(state.abandoned_carts[0].recovery_url, null);
  assert.equal(state.abandoned_carts[0].session_id, null);
  assert.equal(state.sequence_sends[0].customer_id, null);
  assert.equal(state.commerce_resource_records.length, 1);
  assert.equal(state.commerce_resource_records[0].payload.id, 'gid://shopify/Customer/other');
});

test('financial orders are retained after redact', async () => {
  const state = freshState();
  const service = loadService(state);
  await service.handleShopifyPrivacyWebhook({ store: state.stores[0], topic: 'customers/redact', payload: PAYLOAD });
  assert.equal(state.orders.length, 1);
  assert.equal(state.orders[0].total, '749.95');
  assert.equal(state.order_items.length, 1);
});
