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
  const data = await shopifyGraphql(store, query);
  return data.webhookSubscriptions?.nodes || [];
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

async function reconcileShopifyWebhooks(store) {
  const baseUrl = String(process.env.BACKEND_URL || '').replace(/\/$/, '');
  if (!/^https:\/\//i.test(baseUrl)) throw new Error('backend_public_url_required');
  const existing = await listSubscriptions(store);
  let created = 0;
  const failures = [];
  for (const [topic, path] of REQUIRED_SUBSCRIPTIONS) {
    const uri = `${baseUrl}/api/v1/webhooks/shopify/${path}`;
    const failureRecordId = `setup-failure:${topic}`;
    try {
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
        },
        update: { topic, delivery_url: uri, status: 'active', updated_at: new Date() },
      });
      // Clear any previous synthetic failure record after a successful retry.
      await prisma.webhook_registrations.deleteMany({
        where: { store_id: store.id, external_id: failureRecordId },
      });
      logger.info('shopify_webhook_topic_setup', { store_id: store.id, topic, outcome: 'registered' });
    } catch (error) {
      const safeErrors = (error.shopifyErrors || []).slice(0, 5).map((item) => ({
        field: Array.isArray(item.field) ? item.field.slice(0, 8) : [],
        message: String(item.message || 'Webhook registration failed').slice(0, 300),
      }));
      failures.push({ topic, code: error.code || error.name || 'webhook_setup_error', errors: safeErrors });
      // Persist per-topic failure without storing credentials or raw provider payloads.
      await prisma.webhook_registrations.upsert({
        where: { store_id_external_id: { store_id: store.id, external_id: failureRecordId } },
        create: {
          store_id: store.id,
          external_id: failureRecordId,
          topic,
          delivery_url: uri,
          status: 'failed',
        },
        update: { topic, delivery_url: uri, status: 'failed', updated_at: new Date() },
      });
      logger.error('shopify_webhook_topic_setup', {
        store_id: store.id,
        topic,
        outcome: 'failed',
        error_code: error.code || error.name || 'webhook_setup_error',
        http_status: error.status || null,
        network_code: error.networkCode || null,
        shopify_errors: safeErrors,
      });
      // Continue so independent webhook topics get their own real outcome.
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
