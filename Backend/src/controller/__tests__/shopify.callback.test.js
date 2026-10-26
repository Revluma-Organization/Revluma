const assert = require('assert');
const crypto = require('crypto');

process.env.SHOPIFY_API_KEY ||= 'test-shopify-client-id';
process.env.SHOPIFY_API_SECRET ||= 'test-shopify-client-secret';
process.env.SHOPIFY_REDIRECT_URI ||= 'https://api.example.test/api/v1/shopify/callback';
process.env.BACKEND_URL ||= 'https://api.example.test';
process.env.FRONTEND_URL ||= 'https://app.example.test';
process.env.SHOPIFY_API_VERSION ||= '2026-10';

const mockPrisma = {
  organization_members: { findFirst: async () => null },
  organizations: { findFirst: async () => ({ id: 'org-123' }) },
  stores: {
    findFirst: async () => ({
      id: 'store-123',
      status: 'error',
      updated_at: new Date('2026-01-01T00:00:00Z'),
    }),
    findMany: async () => [{
      id: 'store-123',
      platform: 'shopify',
      shop_domain: 'revluma-test-store.myshopify.com',
      status: 'active',
      access_token: 'encrypted-token',
      installed_at: new Date('2026-01-01T00:00:00Z'),
      last_synced_at: new Date('2026-01-02T00:00:00Z'),
    }],
  },
  webhook_registrations: { findMany: async () => [] },
};

function mockModule(relativePath, exports) {
  const id = require.resolve(relativePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const syncFailure = new Error('webhook setup failed');
syncFailure.code = 'SHOPIFY_WEBHOOK_SETUP_FAILED';
let syncStarted = false;
const consumedStates = new Set();
mockModule('../../configs/redis', {
  isRedisReady: () => true,
  getRedisClient: () => ({ set: async (key) => consumedStates.has(key) ? null : (consumedStates.add(key), 'OK') }),
});
let failPersistence = false;
let tokenExchangeCalls = 0;
let deliveryStatus = 'failed';
mockModule('../../configs/database', { prisma: mockPrisma });
mockModule('../../services/mlService', { rfmSync: async () => ({ success: true }) });
mockModule('../../services/shopifyService', {
  exchangeAccessToken: async () => {
    tokenExchangeCalls += 1;
    return { accessToken: 'plain-test-token', grantedScopes: 'read_orders,read_customers' };
  },
  getOrganizationByUser: async () => ({ id: 'org-123' }),
  upsertStore: async ({ organizationId, shop }) => {
    if (failPersistence) {
      const error = new Error('database failure');
      error.code = 'P2021';
      throw error;
    }
    assert.strictEqual(organizationId, 'org-123');
    return { id: 'store-123', organization_id: organizationId, shop_domain: shop };
  },
  syncShopifyStore: () => {
    syncStarted = true;
    return Promise.reject(syncFailure);
  },
});
mockPrisma.webhook_deliveries = {
  create: async () => {
    const error = new Error('duplicate delivery');
    error.code = 'P2002';
    throw error;
  },
  updateMany: async ({ where }) => {
    if (where.status === 'failed' && deliveryStatus === 'failed') {
      deliveryStatus = 'received';
      return { count: 1 };
    }
    return { count: 0 };
  },
  findUnique: async () => ({ id: 'delivery-row', status: deliveryStatus }),
};

const { generateState } = require('../../utils/shopify');
const shopifyController = require('../shopifyController');
const storeController = require('../storeController');
const { REQUIRED_SUBSCRIPTIONS } = require('../../services/shopifyWebhookService');

function callbackHmac(query) {
  const message = Object.keys(query)
    .sort()
    .map((key) => `${key}=${query[key]}`)
    .join('&');
  return crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(message).digest('hex');
}

function callbackRequest(query, signedCookies = {}) {
  const response = { statusCode: null, payload: null, redirectUrl: null, clearedCookies: [] };
  const res = {
    clearCookie(name) {
      response.clearedCookies.push(name);
    },
    redirect(url) {
      response.redirectUrl = url;
      return this;
    },
    status(code) {
      response.statusCode = code;
      return this;
    },
    json(payload) {
      response.payload = payload;
      return response;
    },
  };
  return {
    response,
    invoke: () => shopifyController.shopifyCallback({
      query,
      cookies: {},
      signedCookies,
      headers: {},
    }, res),
  };
}

async function verifyCallbackSurvivesDeferredSetupFailure() {
  const state = generateState('merchant-123');
  const query = {
    code: 'test-authorization-code',
    shop: 'revluma-test-store.myshopify.com',
    state,
    timestamp: '1792240000',
  };
  query.hmac = callbackHmac(query);

  const callback = callbackRequest(query, { shopify_state: state, shopify_user: 'merchant-123', shopify_shop: 'revluma-test-store.myshopify.com' });
  await callback.invoke();

  assert.ok(syncStarted, 'initial setup should start after the token is persisted');
  assert.ok(callback.response.redirectUrl, 'the merchant should be redirected despite deferred webhook failure');
  assert.strictEqual(new URL(callback.response.redirectUrl).searchParams.get('shopify'), 'connected');
  assert.strictEqual(new URL(callback.response.redirectUrl).searchParams.get('shop'), query.shop);
  assert.strictEqual(tokenExchangeCalls, 1);
}

async function verifyInvalidHmacAndStateAreRejected() {
  const state = generateState('merchant-123');
  const query = {
    code: 'test-authorization-code',
    shop: 'revluma-test-store.myshopify.com',
    state,
    timestamp: '1792240000',
  };
  query.hmac = callbackHmac(query);

  const invalidHmac = callbackRequest({ ...query, hmac: 'not-a-real-hmac' }, {
    shopify_state: state,
    shopify_user: 'merchant-123',
    shopify_shop: 'revluma-test-store.myshopify.com',
  });
  await invalidHmac.invoke();
  assert.strictEqual(invalidHmac.response.statusCode, 400);
  assert.strictEqual(tokenExchangeCalls, 1, 'invalid HMAC must be rejected before token exchange');

  const invalidState = callbackRequest(query, {
    shopify_state: `${state}-tampered`,
    shopify_user: 'merchant-123',
    shopify_shop: 'revluma-test-store.myshopify.com',
  });
  await invalidState.invoke();
  assert.strictEqual(invalidState.response.statusCode, 400);
  assert.strictEqual(tokenExchangeCalls, 1, 'invalid OAuth state must be rejected before token exchange');
}

async function verifyPersistenceFailureReportsStageWithoutSecrets() {
  failPersistence = true;
  const state = generateState('merchant-123');
  const query = {
    code: 'test-authorization-code',
    shop: 'revluma-test-store.myshopify.com',
    state,
    timestamp: '1792240000',
  };
  query.hmac = callbackHmac(query);

  const callback = callbackRequest(query, { shopify_state: state, shopify_user: 'merchant-123', shopify_shop: 'revluma-test-store.myshopify.com' });
  await callback.invoke();
  failPersistence = false;

  const redirect = new URL(callback.response.redirectUrl);
  assert.strictEqual(redirect.searchParams.get('shopify'), 'error');
  assert.strictEqual(redirect.searchParams.get('stage'), 'store_persistence');
  assert.ok(redirect.searchParams.get('reference'));
  assert.strictEqual(redirect.searchParams.has('code'), false);
}

async function verifyAuthorizationDenialAndRetrySetup() {
  const denied = callbackRequest({ error: 'access_denied' }, {});
  await denied.invoke();
  assert.strictEqual(new URL(denied.response.redirectUrl).searchParams.get('shopify'), 'cancelled');
  assert.deepStrictEqual(denied.response.clearedCookies.sort(), ['oauth_user', 'shopify_shop', 'shopify_state', 'shopify_user']);

  let retryResponse;
  const res = {
    status(code) {
      return {
        json(payload) {
          retryResponse = { code, payload };
          return retryResponse;
        },
      };
    },
  };
  await shopifyController.retryShopifySetup({
    user: { id: 'merchant-123' },
    body: {},
  }, res, (error) => {
    throw error;
  });
  assert.strictEqual(retryResponse.code, 202);
  assert.strictEqual(retryResponse.payload.data.setup_status, 'in_progress');
}

async function verifyPersistedStoreIsReturnedWithoutCredentials() {
  // These fixture rows represent webhook registrations confirmed active in Shopify.
  mockPrisma.webhook_registrations.findMany = async () => REQUIRED_SUBSCRIPTIONS.map(([topic]) => ({
    store_id: 'store-123',
    topic,
    status: 'active',
    external_id: `gid://shopify/WebhookSubscription/${topic}`,
  }));

  let response;
  const res = {
    status(code) {
      return {
        json(payload) {
          response = { code, payload };
          return response;
        },
      };
    },
  };

  await storeController.getStores({ user: { id: 'merchant-123' } }, res, (error) => {
    throw error;
  });

  assert.strictEqual(response.code, 200);
  const [store] = response.payload.data.stores;
  assert.strictEqual(store.shop_domain, 'revluma-test-store.myshopify.com');
  assert.strictEqual(store.connection_status, 'connected');
  assert.strictEqual(store.setup_status, 'complete');
  assert.strictEqual(store.webhooks_registered, REQUIRED_SUBSCRIPTIONS.length);
  assert.strictEqual(Object.hasOwn(store, 'access_token'), false);
}

async function verifyFailedWebhookDeliveryCanRetryOnce() {
  const { claimDelivery } = require('../../services/commerceWebhookService');
  const retry = await claimDelivery('shopify', 'delivery-123', 'store-123', 'orders/create');
  assert.strictEqual(retry.status, 'received');
  const duplicate = await claimDelivery('shopify', 'delivery-123', 'store-123', 'orders/create');
  assert.strictEqual(duplicate, null, 'in-flight duplicate deliveries must remain idempotent');
}

(async () => {
  await verifyCallbackSurvivesDeferredSetupFailure();
  await verifyInvalidHmacAndStateAreRejected();
  await verifyPersistenceFailureReportsStageWithoutSecrets();
  await verifyAuthorizationDenialAndRetrySetup();
  await verifyPersistedStoreIsReturnedWithoutCredentials();
  await verifyFailedWebhookDeliveryCanRetryOnce();
  console.log('shopify.callback.test.js: all assertions passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
