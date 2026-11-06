'use strict';
/**
 * Privacy compliance webhook workflow tests.
 *
 * The database is mocked at the module boundary; Shopify and the network are
 * never contacted. These tests verify the durable, tenant-scoped behaviour
 * required for the mandatory Shopify privacy topics:
 *
 *   - customers/data_request  → durable request + compiled export artifact
 *   - customers/redact        → personal data erased for the right store only
 *   - shop/redact             → store data erased in FK-safe order
 *   - idempotency             → completed requests never reprocessed
 *   - failure safety          → failure leaves the request visibly failed
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.SHOPIFY_API_SECRET = 'test-only-secret';

const STORE_A = { id: 'store-a', organization_id: 'org-a', shop_domain: 'a.myshopify.com', platform: 'shopify', status: 'installed' };
const STORE_B = { id: 'store-b', organization_id: 'org-b', shop_domain: 'b.myshopify.com', platform: 'shopify', status: 'installed' };

// In-memory "database". Every store-scoped model keeps only rows for the two
// test stores so cross-tenant leakage is directly observable.
function freshDb() {
  return {
    privacy_requests: [],
    audit_logs: [],
    commerce_resource_records: [
      { resource_id: 'customer.addresses', external_id: 'address-a', store_id: 'store-a', payload: { id: 'gid://shopify/Customer/1001', address1: 'private' } },
      { resource_id: 'customer.addresses', external_id: 'address-b', store_id: 'store-b', payload: { id: 'gid://shopify/Customer/1001', address1: 'untouched' } },
    ],
    commerce_action_requests: [{ id: 'action-a', store_id: 'store-a' }],
    customers: [
      { id: 'cust-a1', store_id: 'store-a', external_id: '1001', email: 'alice@example.com', full_name: 'Alice A', phone: '+111', anonymous_id: 'anon-a', consent_email: true, consent_sms: true, consent_updated_at: null, orders_count: 2, ltv: 120.5, created_at: new Date('2025-01-01T00:00:00Z'), rfm_segment: 'loyal', churn_tier: 'high', primary_churn_signal: 'x', recommended_channel: 'email' },
      { id: 'cust-b1', store_id: 'store-b', external_id: '1001', email: 'bob@example.com', full_name: 'Bob B', phone: '+222', anonymous_id: 'anon-b', consent_email: true, consent_sms: false, consent_updated_at: null, orders_count: 1, ltv: 40, created_at: new Date('2025-02-01T00:00:00Z'), rfm_segment: 'new', churn_tier: null, primary_churn_signal: null, recommended_channel: null },
    ],
    orders: [
      { id: 'ord-a1', store_id: 'store-a', customer_id: 'cust-a1', external_order_id: '5001', ordered_at: new Date('2026-01-10T00:00:00Z'), total: 60, currency: 'USD', refunded_total: 0, discount_amount: 5, recovery_status: null, coupon_code: 'SAVE5' },
      { id: 'ord-b1', store_id: 'store-b', customer_id: 'cust-b1', external_order_id: '5002', ordered_at: new Date('2026-02-10T00:00:00Z'), total: 40, currency: 'USD', refunded_total: 0, discount_amount: 0, recovery_status: null, coupon_code: null },
    ],
    order_items: [
      { id: 'li-a1', store_id: 'store-a', order_id: 'ord-a1', product_name: 'Widget', quantity: 1, unit_price: 60, line_total: 60, ordered_at: new Date('2026-01-10T00:00:00Z') },
    ],
    abandoned_carts: [
      { id: 'cart-a1', store_id: 'store-a', customer_id: 'cust-a1', external_cart_id: 'c1', cart_value: 99, currency: 'USD', status: 'abandoned', abandoned_at: new Date('2026-01-11T00:00:00Z'), recovered_at: null, recovery_url: 'https://checkout.example.com/cart-a1', session_id: 'sess-a', source_cart_token: 'tok-a', source_checkout_token: 'ctok-a', source_checkout_id: 'co-a' },
    ],
    abandoned_cart_items: [
      { id: 'ci-a1', abandoned_cart_id: 'cart-a1', product_name: 'Widget', price: 99, quantity: 1 },
    ],
    events: [
      { id: 'evt-a1', store_id: 'store-a', customer_id: 'cust-a1' },
      { id: 'evt-b1', store_id: 'store-b', customer_id: 'cust-b1' },
    ],
    ml_session_features: [
      { id: 'mlf-a1', store_id: 'store-a', customer_id: 'cust-a1' },
    ],
    churn_training_observations: [
      { id: 'cto-a1', store_id: 'store-a', customer_id: 'cust-a1' },
    ],
    sensitivity_training_observations: [
      { id: 'sto-a1', store_id: 'store-a', customer_id: 'cust-a1' },
    ],
    sequence_sends: [
      { id: 'ss-a1', store_id: 'store-a', customer_id: 'cust-a1' },
    ],
    sequence_events: [
      { id: 'se-a1', sequence_send_id: 'ss-a1' },
    ],
    sequences: [{ id: 'seq-a1', store_id: 'store-a' }],
    coupons: [{ id: 'cpn-a1', store_id: 'store-a' }],
    feature_jobs: [{ id: 'fj-a1', store_id: 'store-a' }],
    intelligence_findings: [{ id: 'find-a1', store_id: 'store-a' }],
    intelligence_order_coverage: [{ store_id: 'store-a' }],
    order_checkout_reconciliation_cases: [{ id: 'ocr-a1', store_id: 'store-a' }],
    order_cancellation_tombstones: [{ store_id: 'store-a' }],
    product_images: [{ id: 'pi-a1', store_id: 'store-a' }],
    product_tag_links: [{ store_id: 'store-a' }],
    product_category_links: [{ store_id: 'store-a' }],
    product_attributes: [{ id: 'pa-a1', store_id: 'store-a' }],
    product_tags: [{ id: 'pt-a1', store_id: 'store-a' }],
    product_categories: [{ id: 'pc-a1', store_id: 'store-a' }],
    products: [{ id: 'prod-a1', store_id: 'store-a' }],
    store_settings: [{ id: 'set-a1', store_id: 'store-a' }],
    webhook_deliveries: [{ id: 'wh-a1', store_id: 'store-a' }],
    webhook_registrations: [{ id: 'reg-a1', store_id: 'store-a' }],
    stores: [
      { ...STORE_A },
      { ...STORE_B },
    ],
  };
}

function deleteBy(state, table, where) {
  const rows = state[table];
  const before = rows.length;
  state[table] = rows.filter((row) => {
    if (where.store_id && row.store_id !== where.store_id) return true;
    if (where.OR) {
      const matches = where.OR.some((clause) => {
        if (Array.isArray(clause.resource_id?.in) && !clause.resource_id.in.includes(row.resource_id)) return false;
        if (typeof clause.resource_id === 'string' && clause.resource_id !== row.resource_id) return false;
        const value = clause.payload.path.reduce((current, key) => current?.[key], row.payload);
        return clause.payload.in.includes(value);
      });
      if (!matches) return true;
    }
    if (where.customer_id?.in && !where.customer_id.in.includes(row.customer_id)) return true;
    if (where.abandoned_cart_id?.in && !where.abandoned_cart_id.in.includes(row.abandoned_cart_id)) return true;
    if (where.sequence_send_id?.in && !where.sequence_send_id.in.includes(row.sequence_send_id)) return true;
    if (where.order_id?.in && !where.order_id.in.includes(row.order_id)) return true;
    return false;
  });
  return { count: before - state[table].length };
}

function makePrisma(state) {
  const storeScoped = (table) => ({
    deleteMany: async ({ where = {} }) => deleteBy(state, table, where),
  });
  const prisma = {
    privacy_requests: {
      findUnique: async ({ where }) => state.privacy_requests.find((row) =>
        row.store_id === where.store_id_provider_topic_request_key.store_id &&
        row.provider === where.store_id_provider_topic_request_key.provider &&
        row.topic === where.store_id_provider_topic_request_key.topic &&
        row.request_key === where.store_id_provider_topic_request_key.request_key) || null,
      create: async ({ data }) => {
        if (state.privacy_requests.some((row) =>
          row.store_id === data.store_id && row.provider === data.provider &&
          row.topic === data.topic && row.request_key === data.request_key)) {
          throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        }
        const row = { id: `pr-${state.privacy_requests.length + 1}`, received_at: new Date(), processed_at: null, last_error: null, result: null, ...data };
        state.privacy_requests.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = state.privacy_requests.find((r) => r.id === where.id);
        if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
        if (data.attempts?.increment) row.attempts += data.attempts.increment;
        for (const [key, value] of Object.entries(data)) {
          if (key === 'attempts') continue;
          row[key] = value;
        }
        return row;
      },
    },
    audit_logs: { create: async ({ data }) => { state.audit_logs.push(data); return data; } },
    commerce_resource_records: {
      ...storeScoped('commerce_resource_records'),
      findMany: async ({ where }) => state.commerce_resource_records.filter((row) => {
        if (row.store_id !== where.store_id) return false;
        return where.OR.some((clause) => {
          if (Array.isArray(clause.resource_id?.in) && !clause.resource_id.in.includes(row.resource_id)) return false;
          if (typeof clause.resource_id === 'string' && clause.resource_id !== row.resource_id) return false;
          const value = clause.payload.path.reduce((current, key) => current?.[key], row.payload);
          return clause.payload.in.includes(value);
        });
      }),
    },
    commerce_action_requests: storeScoped('commerce_action_requests'),
    customers: {
      findMany: async ({ where }) => state.customers.filter((row) => {
        if (row.store_id !== where.store_id) return false;
        const or = where.OR || [];
        return or.some((clause) =>
          (clause.external_id && row.external_id === clause.external_id) ||
          (clause.email && row.email === clause.email));
      }),
      deleteMany: async ({ where }) => deleteBy(state, 'customers', where),
      update: async ({ where, data }) => {
        const row = state.customers.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    orders: {
      findMany: async ({ where, select, take }) => {
        let rows = state.orders.filter((row) => row.store_id === where.store_id);
        if (where.customer_id?.in) rows = rows.filter((row) => where.customer_id.in.includes(row.customer_id));
        return rows.slice(0, take ?? rows.length);
      },
      deleteMany: async ({ where }) => deleteBy(state, 'orders', where),
    },
    order_items: {
      findMany: async ({ where, take }) => state.order_items.filter((row) =>
        row.store_id === where.store_id && where.order_id.in.includes(row.order_id)).slice(0, take ?? 5000),
      deleteMany: async ({ where }) => deleteBy(state, 'order_items', where),
    },
    abandoned_carts: {
      findMany: async ({ where, select, take }) => state.abandoned_carts.filter((row) => {
        if (row.store_id !== where.store_id) return false;
        if (where.customer_id?.in && !where.customer_id.in.includes(row.customer_id)) return false;
        return true;
      }).slice(0, take ?? 1000),
      deleteMany: async ({ where }) => deleteBy(state, 'abandoned_carts', where),
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of state.abandoned_carts) {
          if (row.store_id !== where.store_id) continue;
          if (where.customer_id?.in && !where.customer_id.in.includes(row.customer_id)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
    },
    abandoned_cart_items: storeScoped('abandoned_cart_items'),
    events: storeScoped('events'),
    ml_session_features: storeScoped('ml_session_features'),
    churn_training_observations: storeScoped('churn_training_observations'),
    sensitivity_training_observations: storeScoped('sensitivity_training_observations'),
    sequence_sends: {
      ...storeScoped('sequence_sends'),
      findMany: async ({ where }) => state.sequence_sends.filter((row) => row.store_id === where.store_id),
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of state.sequence_sends) {
          if (row.store_id !== where.store_id) continue;
          if (where.customer_id?.in && !where.customer_id.in.includes(row.customer_id)) continue;
          row.customer_id = data.customer_id;
          count += 1;
        }
        return { count };
      },
    },
    sequence_events: storeScoped('sequence_events'),
    sequences: storeScoped('sequences'),
    coupons: storeScoped('coupons'),
    feature_jobs: storeScoped('feature_jobs'),
    intelligence_findings: storeScoped('intelligence_findings'),
    intelligence_order_coverage: storeScoped('intelligence_order_coverage'),
    order_checkout_reconciliation_cases: storeScoped('order_checkout_reconciliation_cases'),
    order_cancellation_tombstones: storeScoped('order_cancellation_tombstones'),
    product_images: storeScoped('product_images'),
    product_tag_links: storeScoped('product_tag_links'),
    product_category_links: storeScoped('product_category_links'),
    product_attributes: storeScoped('product_attributes'),
    product_tags: storeScoped('product_tags'),
    product_categories: storeScoped('product_categories'),
    products: storeScoped('products'),
    store_settings: storeScoped('store_settings'),
    webhook_deliveries: storeScoped('webhook_deliveries'),
    webhook_registrations: storeScoped('webhook_registrations'),
    stores: {
      findMany: async ({ where }) => {
        const candidates = where.shop_domain?.in || [where.shop_domain];
        return state.stores.filter((row) =>
          row.platform === where.platform && candidates.includes(row.shop_domain) && row.status !== (where.status?.not));
      },
      findFirst: async ({ where }) => state.stores.find((row) =>
        row.platform === where.platform && row.shop_domain === where.shop_domain && row.status !== (where.status?.not)) || null,
      update: async ({ where, data }) => {
        const row = state.stores.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    $transaction: async (callback) => callback(prisma),
  };
  return prisma;
}

function installPrisma(state) {
  const dbPath = require.resolve('../configs/database');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: makePrisma(state) } };
}

const db = freshDb();
installPrisma(db);
const { processCommerceWebhook } = require('../services/commerceWebhookService');
const { handleShopifyPrivacyWebhook } = require('../services/privacyWebhookService');

const dataRequestPayload = {
  shop_id: 123, shop_domain: STORE_A.shop_domain,
  customer: { id: 1001, email: 'alice@example.com' },
  orders_requested: ['5001'],
};

test('customers/data_request durably records the request and compiles an artifact', async () => {
  const result = await processCommerceWebhook({
    provider: 'shopify', store: STORE_A, topic: 'customers/data_request', payload: dataRequestPayload,
  });
  assert.equal(result.action, 'privacy_data_request_compiled');
  assert.equal(result.summary.customers_located, 1);
  assert.equal(result.summary.orders_exported, 1);
  const recorded = db.privacy_requests.filter((row) => row.topic === 'customers/data_request');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].status, 'completed');
  assert.equal(recorded[0].store_id, 'store-a');
  assert.ok(recorded[0].result, 'export artifact must be persisted');
  assert.equal(recorded[0].result.orders_exported, 1);
  assert.ok(!JSON.stringify(result).includes('alice@example.com'), 'PII must not leak into the webhook response');
});

test('a redelivered completed data_request is acknowledged without reprocessing', async () => {
  const again = await processCommerceWebhook({
    provider: 'shopify', store: STORE_A, topic: 'customers/data_request', payload: dataRequestPayload,
  });
  assert.equal(again.action, 'privacy_request_already_completed');
  assert.equal(db.privacy_requests.filter((row) => row.topic === 'customers/data_request').length, 1);
});

test('customers/redact erases only the targeted store\'s customer data', async () => {
  const before = db.customers.find((row) => row.id === 'cust-b1');
  const result = await processCommerceWebhook({
    provider: 'shopify', store: STORE_A, topic: 'customers/redact',
    payload: { shop_id: 123, shop_domain: STORE_A.shop_domain, customer: { id: 1001, email: 'alice@example.com' } },
  });
  assert.equal(result.action, 'privacy_customer_redacted');
  assert.equal(result.summary.customers_redacted, 1);
  const redacted = db.customers.find((row) => row.id === 'cust-a1');
  assert.match(redacted.email, /^redacted-[0-9a-f]{24}@redacted\.invalid$/);
  assert.equal(redacted.full_name, null);
  assert.equal(redacted.phone, null);
  assert.equal(redacted.anonymous_id, null);
  assert.equal(redacted.consent_email, false);
  assert.equal(redacted.consent_sms, false);
  // Tenant isolation: store-b's row for the same external id is untouched.
  const untouched = db.customers.find((row) => row.id === 'cust-b1');
  assert.equal(untouched.email, before.email);
  assert.equal(untouched.full_name, before.full_name);
  // Events and derived customer artifacts for the erased customer are removed.
  assert.equal(db.events.some((row) => row.customer_id === 'cust-a1'), false);
  assert.equal(db.events.some((row) => row.customer_id === 'cust-b1'), true);
  assert.equal(db.ml_session_features.length, 0);
  assert.equal(db.churn_training_observations.length, 0);
  // Cart keeps aggregate value but loses identifying checkout pointers.
  const cart = db.abandoned_carts.find((row) => row.id === 'cart-a1');
  assert.equal(cart.recovery_url, null);
  assert.equal(cart.session_id, null);
  // Orders keep financial integrity but remain linked only by internal id.
  assert.equal(db.orders.some((row) => row.id === 'ord-a1'), true);
});

test('shop/redact erases store-scoped data in FK-safe order and redacts the store', async () => {
  const result = await processCommerceWebhook({
    provider: 'shopify', store: STORE_A, topic: 'shop/redact',
    payload: { shop_id: 123, shop_domain: STORE_A.shop_domain },
  });
  assert.equal(result.action, 'privacy_shop_redacted');
  for (const table of ['orders', 'order_items', 'customers', 'products', 'sequences', 'sequence_sends', 'abandoned_carts', 'events', 'intelligence_findings', 'store_settings']) {
    assert.equal(db[table].some((row) => row.store_id === 'store-a'), false, `${table} must be erased`);
  }
  assert.equal(db.abandoned_cart_items.length, 0);
  assert.equal(db.sequence_events.length, 0);
  const store = db.stores.find((row) => row.id === 'store-a');
  assert.equal(store.status, 'redacted');
  assert.equal(store.access_token, null);
  assert.equal(store.granted_scopes, null);
  // Store-b data is untouched by store-a's erasure.
  assert.equal(db.customers.some((row) => row.store_id === 'store-b'), true);
  assert.equal(db.orders.some((row) => row.store_id === 'store-b'), true);
  // The redaction ran inside a transaction boundary.
  const record = db.privacy_requests.find((row) => row.topic === 'shop/redact');
  assert.equal(record.status, 'completed');
  assert.ok(db.audit_logs.some((entry) => entry.action === 'privacy_shop_redacted'));
});

test('a processing failure leaves the request visibly failed (never silently acknowledged)', async () => {
  const state = freshDb();
  installPrisma(state);
  const broken = { ...STORE_A };
  // Reload the service so it binds to the fresh fake database.
  for (const key of Object.keys(require.cache)) {
    if (key.includes('privacyWebhookService') || key.includes('commerceWebhookService')) delete require.cache[key];
  }
  const { handleShopifyPrivacyWebhook: handle } = require('../services/privacyWebhookService');
  const databaseModule = require.cache[require.resolve('../configs/database')];
  // Force failure deep inside processing: orders.findMany throws.
  const original = databaseModule.exports.prisma.orders.findMany;
  databaseModule.exports.prisma.orders.findMany = async () => { throw Object.assign(new Error('boom'), { code: 'DB_DOWN' }); };
  await assert.rejects(handle({ store: broken, topic: 'customers/data_request', payload: dataRequestPayload }));
  databaseModule.exports.prisma.orders.findMany = original;
  const failed = state.privacy_requests.find((row) => row.topic === 'customers/data_request');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.processed_at, null);
  assert.ok(failed.last_error);
});

test('controller routes privacy webhooks through the durable workflow and acknowledges', async () => {
  const state = freshDb();
  installPrisma(state);
  // Rewire delivery tracking on the shared fake.
  const databaseModule = require.cache[require.resolve('../configs/database')];
  databaseModule.exports.prisma.webhook_deliveries = {
    create: async () => ({ id: 'delivery-1' }),
    update: async ({ where, data }) => { state.audit_logs.push({ action: 'delivery_state', context: { deliveryId: where.id, ...data } }); return { id: where.id, ...data }; },
  };
  const cryptoLocal = crypto;
  const raw = Buffer.from(JSON.stringify({ shop_id: 123, shop_domain: STORE_A.shop_domain, customer: { id: 1001, email: 'alice@example.com' } }));
  const signature = cryptoLocal.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(raw).digest('base64');
  // Fresh module registry so the controller picks up the new fake database.
  for (const key of Object.keys(require.cache)) {
    if (key.includes('commerceWebhook') || key.includes('privacyWebhook')) delete require.cache[key];
  }
  const { receive } = require('../controller/commerceWebhookController');
  let statusCode = null;
  let responded = false;
  const res = { status(code) { statusCode = code; return this; }, json() { responded = true; return this; } };
  let forwarded = null;
  await receive({ params: { provider: 'shopify', topic: 'customers/redact' }, body: raw, headers: {
    'x-shopify-shop-domain': STORE_A.shop_domain,
    'x-shopify-hmac-sha256': signature,
    'x-shopify-webhook-id': 'delivery-1',
  } }, res, (err) => { forwarded = err; });
  assert.equal(forwarded, null);
  assert.equal(statusCode, 200);
  assert.equal(responded, true);
  assert.ok(state.privacy_requests.some((row) => row.topic === 'customers/redact' && row.status === 'completed'));
});
