const { prisma } = require('../configs/database');
const { shopifyGraphql } = require('./shopifyGraphql');

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
    throw new Error('shopify_webhook_subscription_failed');
  }
  return result.webhookSubscription;
}

async function reconcileShopifyWebhooks(store) {
  const baseUrl = String(process.env.BACKEND_URL || '').replace(/\/$/, '');
  if (!/^https:\/\//i.test(baseUrl)) throw new Error('backend_public_url_required');
  const existing = await listSubscriptions(store);
  let created = 0;
  for (const [topic, path] of REQUIRED_SUBSCRIPTIONS) {
    const uri = `${baseUrl}/api/v1/webhooks/shopify/${path}`;
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
  }
  return { required: REQUIRED_SUBSCRIPTIONS.length, created };
}

module.exports = { REQUIRED_SUBSCRIPTIONS, reconcileShopifyWebhooks };
