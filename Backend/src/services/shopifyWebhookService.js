const { prisma } = require('../configs/database');
const { shopifyGraphql } = require('./shopifyGraphql');
const logger = require('../utils/logger');

const REQUIRED_SUBSCRIPTIONS = Object.freeze([
  ['APP_UNINSTALLED', 'app/uninstalled'],
  ['ORDERS_CREATE', 'orders/create'],
  ['ORDERS_UPDATED', 'orders/updated'],
  ['ORDERS_CANCELLED', 'orders/cancelled'],
  ['ORDERS_DELETE', 'orders/delete'],
  ['CUSTOMERS_CREATE', 'customers/create'],
  ['CUSTOMERS_UPDATE', 'customers/update'],
  ['CHECKOUTS_CREATE', 'checkouts/create'],
  ['CHECKOUTS_UPDATE', 'checkouts/update'],
]);

async function listSubscriptions(store) {
  const query = `
    query WebhookSubscriptions {
      webhookSubscriptions(first: 250) {
        nodes { id topic uri }
      }
    }
  `;
  try {
    const data = await shopifyGraphql(store, query);
    return data.webhookSubscriptions?.nodes || [];
  } catch (error) {
    // Listing subscriptions is a prerequisite for reconciliation. Preserve the original
    // provider/network failure so the caller's final sync log records the actionable cause.
    const safeErrors = safeShopifyErrors(error);
    logger.error('shopify_webhook_subscription_list_failed', {
      store_id: store.id,
      stage: 'list_existing_subscriptions',
      error_code: error.code || error.name || 'webhook_subscription_list_error',
      http_status: error.status || error.response?.status || null,
      network_code: error.networkCode || null,
      shopify_errors: safeErrors,
    });
    error.setupStage = 'list_existing_subscriptions';
    throw error;
  }
}

async function createSubscription(store, topic, uri) {
  const mutation = `
    mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $subscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $subscription) {
        webhookSubscription { id topic uri }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphql(store, mutation, {
    topic,
    subscription: { uri, format: 'JSON' },
  });
  const result = data.webhookSubscriptionCreate;
  if (result?.userErrors?.length || !result?.webhookSubscription) {
    const error = new Error('shopify_webhook_subscription_failed');
    error.code = 'SHOPIFY_WEBHOOK_USER_ERROR';
    error.shopifyErrors = (result?.userErrors || []).slice(0, 5).map((item) => ({
      field: Array.isArray(item.field) ? item.field.slice(0, 8) : [],
      message: String(item.message || 'Unknown webhook user error').slice(0, 300),
    }));
    throw error;
  }
  return result.webhookSubscription;
}

function safeShopifyErrors(error) {
  return (error.shopifyErrors || []).slice(0, 5).map((item) => ({
    field: Array.isArray(item.field) ? item.field.slice(0, 8) : [],
    message: String(item.message || 'Webhook registration failed').slice(0, 300),
  }));
}

async function persistTopicFailure({ store, topic, uri, failureRecordId, safeMessage }) {
  // Persistence failures must not abort attempts for other independent webhook topics.
  const operations = [
    () => prisma.webhook_registrations.update({
      where: { store_id_external_id: { store_id: store.id, external_id: `setup-state:${topic}` } },
      data: { status: 'failed', last_error: safeMessage.slice(0, 2000), completed_at: new Date(), updated_at: new Date() },
    }),
    () => prisma.webhook_registrations.upsert({
      where: { store_id_external_id: { store_id: store.id, external_id: failureRecordId } },
      create: {
        store_id: store.id,
        external_id: failureRecordId,
        topic,
        delivery_url: uri,
        status: 'failed',
        last_error: safeMessage.slice(0, 2000),
        completed_at: new Date(),
      },
      update: { topic, delivery_url: uri, status: 'failed', last_error: safeMessage.slice(0, 2000), completed_at: new Date(), updated_at: new Date() },
    }),
  ];

  for (const persist of operations) {
    try {
      await persist();
    } catch (persistenceError) {
      logger.error('shopify_webhook_setup_state_persistence_failed', {
        store_id: store.id,
        topic,
        error_code: persistenceError.code || persistenceError.name || 'database_error',
      });
    }
  }
}

async function reconcileShopifyWebhooks(store) {
  const baseUrl = String(process.env.BACKEND_URL || '').replace(/\/$/, '');
  if (!/^https:\/\//i.test(baseUrl)) throw new Error('backend_public_url_required');
  // Listing is a global prerequisite: if Shopify cannot return its subscriptions, no topic
  // can be safely reconciled. Let the caller surface this as a setup-level failure.
  const existing = await listSubscriptions(store);
  let created = 0;
  const failures = [];

  for (const [topic, path] of REQUIRED_SUBSCRIPTIONS) {
    const uri = `${baseUrl}/api/v1/webhooks/shopify/${path}`;
    const failureRecordId = `setup-failure:${topic}`;
    try {
      // Setup-state persistence is best-effort at the start of a topic attempt. A transient
      // database write failure must not prevent us from asking Shopify to register the topic.
      try {
        await prisma.webhook_registrations.upsert({
          where: { store_id_external_id: { store_id: store.id, external_id: `setup-state:${topic}` } },
          create: { store_id: store.id, external_id: `setup-state:${topic}`, topic, delivery_url: uri, status: 'running', attempt_count: 1, started_at: new Date(), last_error: null },
          update: { topic, delivery_url: uri, status: 'running', attempt_count: { increment: 1 }, started_at: new Date(), completed_at: null, last_error: null, updated_at: new Date() },
        });
      } catch (persistenceError) {
        logger.error('shopify_webhook_setup_state_persistence_failed', {
          store_id: store.id,
          topic,
          error_code: persistenceError.code || persistenceError.name || 'database_error',
        });
      }

      let subscription = existing.find((item) => item.topic === topic && item.uri === uri);
      if (!subscription) {
        subscription = await createSubscription(store, topic, uri);
        created += 1;
      }

      await prisma.webhook_registrations.upsert({
        where: { store_id_external_id: { store_id: store.id, external_id: subscription.id } },
        create: {
          store_id: store.id,
          external_id: subscription.id,
          topic,
          delivery_url: uri,
          status: 'active',
          last_error: null,
          completed_at: new Date(),
        },
        update: { topic, delivery_url: uri, status: 'active', last_error: null, completed_at: new Date(), updated_at: new Date() },
      });
      await prisma.webhook_registrations.deleteMany({
        where: { store_id: store.id, external_id: failureRecordId },
      });
      await prisma.webhook_registrations.update({
        where: { store_id_external_id: { store_id: store.id, external_id: `setup-state:${topic}` } },
        data: { status: 'succeeded', last_error: null, completed_at: new Date(), updated_at: new Date() },
      });
      logger.info('shopify_webhook_topic_setup', { store_id: store.id, topic, outcome: 'registered' });
    } catch (error) {
      const safeErrors = safeShopifyErrors(error);
      const code = error.code || error.name || 'webhook_setup_error';
      failures.push({ topic, code, errors: safeErrors });
      const providerMessage = safeErrors.map((item) => item.message).filter(Boolean).join('; ');
      const safeMessage = (providerMessage || (error.code === 'SHOPIFY_WEBHOOK_USER_ERROR'
        ? 'Shopify rejected the webhook subscription.'
        : 'Webhook registration failed. Check server diagnostics.')).slice(0, 2000);

      await persistTopicFailure({ store, topic, uri, failureRecordId, safeMessage });
      logger.error('shopify_webhook_topic_setup', {
        store_id: store.id,
        topic,
        outcome: 'failed',
        error_code: code,
        http_status: error.status || null,
        network_code: error.networkCode || null,
        shopify_errors: safeErrors,
      });
      // Deliberately continue: one topic failure must not skip the remaining topics.
    }
  }

  if (failures.length) {
    const error = new Error('shopify_webhook_reconciliation_incomplete');
    error.code = 'SHOPIFY_WEBHOOK_RECONCILIATION_INCOMPLETE';
    error.webhookFailures = failures;
    throw error;
  }
  return { required: REQUIRED_SUBSCRIPTIONS.length, created, failures: [] };
}

module.exports = { REQUIRED_SUBSCRIPTIONS, reconcileShopifyWebhooks };
