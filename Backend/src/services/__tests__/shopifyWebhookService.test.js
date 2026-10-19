const assert = require('assert');

process.env.BACKEND_URL ||= 'https://api.example.test';

const REQUIRED = [
  ['APP_UNINSTALLED', 'app/uninstalled'],
  ['ORDERS_CREATE', 'orders/create'],
  ['ORDERS_UPDATED', 'orders/updated'],
  ['ORDERS_CANCELLED', 'orders/cancelled'],
  ['ORDERS_DELETE', 'orders/delete'],
  ['CUSTOMERS_CREATE', 'customers/create'],
  ['CUSTOMERS_UPDATE', 'customers/update'],
  ['CHECKOUTS_CREATE', 'checkouts/create'],
  ['CHECKOUTS_UPDATE', 'checkouts/update'],
];

function installMocks({ failTopic = null, failTopicOnce = false, failPersistenceTopic = null } = {}) {
  const attempts = [];
  const rows = new Map();
  let topicFailureUsed = false;
  const prisma = {
    webhook_registrations: {
      async upsert(args) {
        const externalId = args.where.store_id_external_id.external_id;
        const topic = args.create?.topic || args.update?.topic;
        if (failPersistenceTopic && topic === failPersistenceTopic && externalId === `setup-state:${topic}`) {
          const error = new Error('simulated database write failure');
          error.code = 'P2025';
          throw error;
        }
        rows.set(externalId, { ...(rows.get(externalId) || {}), ...(args.create || {}), ...(args.update || {}) });
        return rows.get(externalId);
      },
      async update(args) {
        const externalId = args.where.store_id_external_id.external_id;
        const topic = externalId.replace('setup-state:', '');
        if (failPersistenceTopic && topic === failPersistenceTopic && externalId.startsWith('setup-state:')) {
          const error = new Error('simulated database update failure');
          error.code = 'P2025';
          throw error;
        }
        rows.set(externalId, { ...(rows.get(externalId) || {}), ...args.data });
        return rows.get(externalId);
      },
      async deleteMany({ where }) {
        rows.delete(where.external_id);
        return { count: 1 };
      },
    },
  };
  const shopifyGraphql = async (_store, query, variables = {}) => {
    if (query.includes('query WebhookSubscriptions')) return { webhookSubscriptions: { nodes: [] } };
    const topic = variables.topic;
    attempts.push(topic);
    if (topic === failTopic && (!failTopicOnce || !topicFailureUsed)) {
      topicFailureUsed = true;
      return { webhookSubscriptionCreate: { webhookSubscription: null, userErrors: [{ field: ['topic'], message: 'Topic ORDERS_CREATE is not available for this app' }] } };
    }
    return { webhookSubscriptionCreate: { webhookSubscription: { id: `gid://shopify/WebhookSubscription/${topic}`, topic, uri: variables.subscription?.uri }, userErrors: [] } };
  };
  const logger = { info() {}, error() {} };

  for (const path of [
    require.resolve('../../configs/database'),
    require.resolve('../shopifyGraphql'),
    require.resolve('../../utils/logger'),
  ]) delete require.cache[path];
  require.cache[require.resolve('../../configs/database')] = {
    id: require.resolve('../../configs/database'), filename: require.resolve('../../configs/database'),
    loaded: true, exports: { prisma },
  };
  require.cache[require.resolve('../shopifyGraphql')] = {
    id: require.resolve('../shopifyGraphql'), filename: require.resolve('../shopifyGraphql'),
    loaded: true, exports: { shopifyGraphql },
  };
  require.cache[require.resolve('../../utils/logger')] = {
    id: require.resolve('../../utils/logger'), filename: require.resolve('../../utils/logger'),
    loaded: true, exports: logger,
  };
  delete require.cache[require.resolve('../shopifyWebhookService')];
  const service = require('../shopifyWebhookService');
  return { service, attempts, rows };
}

const store = { id: 'store-test', shop_domain: 'example.myshopify.com', access_token: 'encrypted-token' };

async function verifyTopicRejectionDoesNotStopOtherTopics() {
  const { service, attempts, rows } = installMocks({ failTopic: 'ORDERS_CREATE' });
  let thrown;
  try {
    await service.reconcileShopifyWebhooks(store);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, 'reconciliation should report incomplete setup');
  assert.strictEqual(thrown.code, 'SHOPIFY_WEBHOOK_RECONCILIATION_INCOMPLETE');
  assert.deepStrictEqual(attempts, REQUIRED.map(([topic]) => topic), 'all nine Shopify topics must be attempted in order');
  const failure = thrown.webhookFailures.find((item) => item.topic === 'ORDERS_CREATE');
  assert.ok(failure, 'ORDERS_CREATE failure should be included in the result');
  assert.match(failure.errors[0].message, /not available for this app/);
  assert.match(rows.get('setup-state:ORDERS_CREATE').last_error, /not available for this app/);
  assert.strictEqual(rows.get('setup-state:ORDERS_CREATE').status, 'failed');
}

async function verifyRetryCanRecoverAfterShopifyRejection() {
  const { service, attempts, rows } = installMocks({ failTopic: 'ORDERS_CREATE', failTopicOnce: true });
  await assert.rejects(service.reconcileShopifyWebhooks(store), (error) => error.code === 'SHOPIFY_WEBHOOK_RECONCILIATION_INCOMPLETE');
  const firstAttemptCount = attempts.length;
  const result = await service.reconcileShopifyWebhooks(store);
  assert.strictEqual(firstAttemptCount, REQUIRED.length);
  assert.strictEqual(attempts.length, REQUIRED.length * 2);
  assert.deepStrictEqual(result.failures, []);
  assert.strictEqual(rows.get('setup-state:ORDERS_CREATE').status, 'succeeded');
  assert.strictEqual(rows.has('setup-failure:ORDERS_CREATE'), false);
}

async function verifyPersistenceFailureDoesNotBlockRemainingTopics() {
  const { service, attempts } = installMocks({ failPersistenceTopic: 'ORDERS_CREATE' });
  let thrown;
  try {
    await service.reconcileShopifyWebhooks(store);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, 'persistence failure should be surfaced as incomplete setup');
  assert.deepStrictEqual(attempts, REQUIRED.map(([topic]) => topic), 'database status-write failure must not prevent later Shopify topic attempts');
  assert.ok(thrown.webhookFailures.some((item) => item.topic === 'ORDERS_CREATE'));
}

(async () => {
  assert.deepStrictEqual(REQUIRED.map(([topic]) => topic), (require('../shopifyWebhookService').REQUIRED_SUBSCRIPTIONS || REQUIRED).map(([topic]) => topic));
  await verifyTopicRejectionDoesNotStopOtherTopics();
  await verifyRetryCanRecoverAfterShopifyRejection();
  await verifyPersistenceFailureDoesNotBlockRemainingTopics();
  console.log('shopifyWebhookService.test.js: all assertions passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
