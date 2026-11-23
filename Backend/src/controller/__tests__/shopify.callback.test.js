const assert = require('assert');
const crypto = require('crypto');

process.env.SHOPIFY_API_KEY ||= 'test-shopify-client-id';
process.env.SHOPIFY_API_SECRET ||= 'test-shopify-client-secret';
process.env.SHOPIFY_REDIRECT_URI ||= 'https://api.example.test/api/v1/shopify/callback';
process.env.BACKEND_URL ||= 'https://api.example.test';
process.env.FRONTEND_URL ||= 'https://app.example.test';
process.env.SHOPIFY_API_VERSION ||= '2026-10';

const mockPrisma = {
  organization_members: { findMany: async () => [{ id: 'member-123', organization_id: 'org-123', role: 'owner', status: 'active' }] },
  organizations: { findFirst: async () => ({ id: 'org-123' }) },
  stores: {
    findFirst: async () => ({
      id: 'store-123',
      status: 'error',
      updated_at: new Date('2026-01-01T00:00:00Z'),
    }),
    update: async () => ({}),
    findMany: async () => [{
      id: 'store-123',
      platform: 'shopify',
      shop_domain: 'revluma-test-store.myshopify.com',
      status: 'active',
      integration_state: 'connected',
      access_token: 'encrypted-token',
      installed_at: new Date('2026-01-01T00:00:00Z'),
      last_synced_at: new Date('2026-01-02T00:00:00Z'),
      // Completion is recorded explicitly; a historical timestamp alone is
      // not proof that the required initial resources finished syncing.
      initial_sync_status: 'completed',
      sync_completed_at: new Date('2026-01-02T00:00:00Z'),
    }],
  },
  store_sync_domain_states: { findMany: async () => ['products', 'orders', 'abandoned_checkouts'].map(domain => ({
    store_id: 'store-123', domain, status: 'ok', pagination_complete: true,
    last_succeeded_at: new Date('2026-01-02T00:00:00Z'),
  })) },
  webhook_registrations: { findMany: async () => [] },
};

function mockModule(relativePath, exports) {
  const id = require.resolve(relativePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const syncFailure = new Error('webhook setup failed');
syncFailure.code = 'SHOPIFY_WEBHOOK_SETUP_FAILED';
let syncStarted = false;
// OAuth replay protection and OAuth sessions live in Postgres
// (coordination_leases). This in-memory model honours the primary key
// (P2002 on duplicates) and the expiry predicate used for takeover.
const leases = new Map();
let leaseStoreDown = false;
function leaseStoreGuard() {
  if (leaseStoreDown) {
    const error = new Error('database unavailable');
    error.code = 'P1001';
    throw error;
  }
}
mockPrisma.coordination_leases = {
  create: async ({ data }) => {
    leaseStoreGuard();
    if (leases.has(data.lease_key)) { const error = new Error('unique'); error.code = 'P2002'; throw error; }
    leases.set(data.lease_key, { ...data });
    return data;
  },
  updateMany: async ({ where, data }) => {
    leaseStoreGuard();
    const row = leases.get(where.lease_key);
    if (!row) return { count: 0 };
    if (where.expires_at?.lt && !(row.expires_at < where.expires_at.lt)) return { count: 0 };
    if (where.owner && row.owner !== where.owner) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  },
  deleteMany: async ({ where }) => {
    leaseStoreGuard();
    const row = leases.get(where.lease_key);
    if (!row || (where.owner && row.owner !== where.owner)) return { count: 0 };
    leases.delete(where.lease_key);
    return { count: 1 };
  },
};
mockPrisma.authorization_requests = {
  findMany: async () => [],
  updateMany: async () => ({ count: 0 }),
};
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
mockModule('../../services/shopifyAuthorization', {
  verifyShopifyAuthorization: async () => ({ verified: true, grantedScopes: ['read_orders', 'read_products', 'read_inventory', 'read_checkouts'], verifiedAt: new Date('2026-01-03T00:00:00Z') }),
});
mockModule('../../services/shopifyWebhookService', {
  REQUIRED_SUBSCRIPTIONS: require('../../services/shopifyWebhookTopics').REQUIRED_SUBSCRIPTIONS,
  reconcileShopifyWebhooks: async () => ({ required: 12, created: 0, failures: [] }),
});
mockModule('../../services/integrationLifecycleStore', {
  recordIntegrationEvent: async () => ({ accepted: true, state: 'connected', reasonCode: 'CONNECTED' }),
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
  findUnique: async () => ({ id: 'delivery-row', status: deliveryStatus, store_id: 'store-123', topic: 'orders/create' }),
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
  assert.strictEqual(new URL(callback.response.redirectUrl).searchParams.get('shopify'), 'authorized');
  assert.strictEqual(new URL(callback.response.redirectUrl).searchParams.get('shop'), query.shop);
  assert.strictEqual(tokenExchangeCalls, 1);
}

async function verifyReplayedCallbackIsRejectedWithoutSecondExchange() {
  const state = generateState('merchant-123');
  const query = { code: 'replay-code', shop: 'revluma-test-store.myshopify.com', state, timestamp: '1792240001' };
  query.hmac = callbackHmac(query);
  const cookies = { shopify_state: state, shopify_user: 'merchant-123', shopify_shop: 'revluma-test-store.myshopify.com' };
  const before = tokenExchangeCalls;
  const first = callbackRequest(query, cookies);
  await first.invoke();
  assert.strictEqual(tokenExchangeCalls, before + 1);
  const replay = callbackRequest(query, cookies);
  await replay.invoke();
  assert.strictEqual(replay.response.statusCode, 409, 'a replayed OAuth state must be rejected');
  assert.strictEqual(tokenExchangeCalls, before + 1, 'a replayed state must never reach token exchange');
  const digest = crypto.createHash('sha256').update(state).digest('hex');
  assert.ok(leases.has(`shopify:oauth:consumed:${digest}`), 'state consumption is a durable Postgres claim');
}

async function verifyReplayStoreOutageFailsClosed() {
  const state = generateState('merchant-123');
  const query = { code: 'outage-code', shop: 'revluma-test-store.myshopify.com', state, timestamp: '1792240002' };
  query.hmac = callbackHmac(query);
  const before = tokenExchangeCalls;
  leaseStoreDown = true;
  const callback = callbackRequest(query, { shopify_state: state, shopify_user: 'merchant-123', shopify_shop: 'revluma-test-store.myshopify.com' });
  try {
    await callback.invoke();
  } finally {
    leaseStoreDown = false;
  }
  assert.strictEqual(callback.response.statusCode, 503, 'an unanswerable replay store must fail closed');
  assert.strictEqual(tokenExchangeCalls, before, 'no code exchange while replay protection is unavailable');
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
  assert.deepStrictEqual(denied.response.clearedCookies.sort(), ['oauth_user', 'shopify_organization', 'shopify_reauth_store', 'shopify_reconnect_attempt', 'shopify_reconnect_store', 'shopify_shop', 'shopify_state', 'shopify_user']);

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
    last_verified_at: new Date('2026-01-03T00:00:00Z'),
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
  assert.strictEqual(store.sync_status, 'complete');
  assert.strictEqual(store.diagnostics.synchronization.required_resources_complete, true);
  assert.strictEqual(store.webhooks_registered, REQUIRED_SUBSCRIPTIONS.length);
  assert.strictEqual(Object.hasOwn(store, 'access_token'), false);
}

async function verifyTimestampAloneDoesNotClaimCompletedSetup() {
  const findStores = mockPrisma.stores.findMany;
  const findDomains = mockPrisma.store_sync_domain_states.findMany;
  try {
    mockPrisma.stores.findMany = async () => (await findStores()).map(store => ({
      ...store, initial_sync_status: null, sync_completed_at: null,
    }));
    mockPrisma.store_sync_domain_states.findMany = async () => [];
    let response;
    const res = { status(code) { return { json(payload) { response = { code, payload }; } }; } };
    await storeController.getStores({ user: { id: 'merchant-123' } }, res, (error) => { throw error; });
    assert.strictEqual(response.code, 200);
    const [store] = response.payload.data.stores;
    assert.ok(store.last_synced_at, 'the historical timestamp is deliberately present');
    assert.strictEqual(store.webhooks_registered, REQUIRED_SUBSCRIPTIONS.length);
    assert.strictEqual(store.sync_status, 'unknown');
    assert.strictEqual(store.setup_status, 'unknown');
    assert.strictEqual(store.diagnostics.synchronization.required_resources_complete, false);
    assert.strictEqual(Object.hasOwn(store, 'access_token'), false);
  } finally {
    mockPrisma.stores.findMany = findStores;
    mockPrisma.store_sync_domain_states.findMany = findDomains;
  }
}

async function verifyHistoricalFailuresDoNotOverrideActiveWebhooks() {
  mockPrisma.webhook_registrations.findMany = async () => [
    ...REQUIRED_SUBSCRIPTIONS.map(([topic]) => ({
      store_id: 'store-123',
      topic,
      status: 'active',
      external_id: `gid://shopify/WebhookSubscription/${topic}`,
    last_verified_at: new Date('2026-01-03T00:00:00Z'),
    })),
    ...REQUIRED_SUBSCRIPTIONS.map(([topic]) => ({
      store_id: 'store-123',
      topic,
      status: 'failed',
      external_id: `setup-failure:${topic}`,
      last_error: 'Historical registration failure',
    })),
    { store_id: 'store-123', topic: 'UNRELATED_TOPIC', status: 'active', external_id: 'extra-topic' },
  ];
  let response;
  const res = { status(code) { return { json(payload) { response = { code, payload }; } }; } };
  await storeController.getStores({ user: { id: 'merchant-123' } }, res, (error) => { throw error; });
  assert.strictEqual(response.code, 200);
  const [store] = response.payload.data.stores;
  assert.strictEqual(store.setup_status, 'complete');
  assert.strictEqual(store.webhooks_registered, REQUIRED_SUBSCRIPTIONS.length);
  assert.ok(store.webhook_details.every((item) => item.status === 'registered' && item.error === null));
}

async function verifyFailedWebhookDeliveryCanRetryOnce() {
  const { claimDelivery } = require('../../services/commerceWebhookService');
  const retry = await claimDelivery('shopify', 'delivery-123', 'store-123', 'orders/create');
  assert.strictEqual(retry.status, 'received');
  await assert.rejects(claimDelivery('shopify', 'delivery-123', 'store-123', 'orders/create'), { code: 'WEBHOOK_DELIVERY_PENDING' });
  deliveryStatus = 'processed';
  assert.strictEqual(await claimDelivery('shopify', 'delivery-123', 'store-123', 'orders/create'), null);
}

(async () => {
  await verifyCallbackSurvivesDeferredSetupFailure();
  await verifyInvalidHmacAndStateAreRejected();
  await verifyReplayedCallbackIsRejectedWithoutSecondExchange();
  await verifyReplayStoreOutageFailsClosed();
  await verifyPersistenceFailureReportsStageWithoutSecrets();
  await verifyAuthorizationDenialAndRetrySetup();
  await verifyPersistedStoreIsReturnedWithoutCredentials();
  await verifyHistoricalFailuresDoNotOverrideActiveWebhooks();
  await verifyTimestampAloneDoesNotClaimCompletedSetup();
  await verifyFailedWebhookDeliveryCanRetryOnce();
  console.log('shopify.callback.test.js: all assertions passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
