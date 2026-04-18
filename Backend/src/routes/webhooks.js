const express = require('express');
const { createAdapter } = require('../integration');
const logger = require('../utils/logger');

function createWebhookRouter(platform, prisma) {
  const router = express.Router();

  router.post(`/${platform}`, express.raw({ type: 'application/json' }), async (req, res) => {
    const rawBody = req.body;
    const headers = req.headers;

    logger.info(`[webhook] Received ${platform} webhook`, {
      topic: headers['x-shopify-topic'] || headers['x-wc-webhook-topic'] || 'unknown',
      signature: headers['x-shopify-hmac-sha256'] ? 'present' : 'none',
    });

    try {
      const adapter = createAdapter(platform, prisma);

      const isValid = adapter.verifyWebhookSignature(headers, rawBody);
      if (!isValid) {
        logger.warn(`[webhook] Invalid signature for ${platform}`);
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const topic = 
        headers['x-shopify-topic'] || 
        headers['x-wc-webhook-topic'] ||
        headers['x-bc-webhook-topic'];

      const payload = JSON.parse(rawBody.toString());

      const event = adapter.normalizeWebhookEvent(topic, payload);

      if (!event) {
        logger.warn(`[webhook] Could not normalize event for topic: ${topic}`);
        return res.status(200).json({ message: 'Event not supported' });
      }

      await processWebhookEvent(prisma, platform, event);

      return res.status(200).json({ message: 'Webhook processed' });

    } catch (error) {
      logger.error(`[webhook] Error processing ${platform} webhook`, {
        error: error.message,
        stack: error.stack,
      });
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get(`/${platform}`, (req, res) => {
    res.status(200).json({ 
      status: 'ok', 
      platform,
      message: `${platform} webhook endpoint active` 
    });
  });

  return router;
}

async function processWebhookEvent(prisma, platform, event) {
  const eventType = event.type;

  if (eventType === 'checkout.abandoned') {
    const checkout = event.checkout;
    await handleAbandonedCheckout(prisma, platform, checkout);
    return;
  }

  if (eventType === 'order.created' || eventType === 'order.updated') {
    const order = event.order;
    await handleOrderEvent(prisma, platform, order);
    return;
  }

  if (eventType === 'customer.created' || eventType === 'customer.updated') {
    const customer = event.customer;
    await handleCustomerEvent(prisma, platform, customer);
    return;
  }
}

async function handleAbandonedCheckout(prisma, platform, checkout) {
  const storeConfig = await prisma.storeConfig.findFirst({
    where: {
      platform,
      storeUrl: { contains: checkout.ref.storeId },
    },
  });

  if (!storeConfig) {
    logger.warn(`[webhook] No store config found for ${checkout.ref.storeId}`);
    return;
  }

  const existingCart = await prisma.abandonedCart.findFirst({
    where: {
      tenantId: storeConfig.tenantId,
      externalCartId: checkout.ref.externalId,
    },
  });

  if (existingCart) {
    logger.info(`[webhook] Abandoned cart already exists: ${checkout.ref.externalId}`);
    return;
  }

  await prisma.abandonedCart.create({
    data: {
      tenantId: storeConfig.tenantId,
      externalCartId: checkout.ref.externalId,
      customerEmail: checkout.email,
      customerPhone: checkout.phone,
      cartValue: checkout.totalPrice,
      currency: checkout.currency,
      items: checkout.lineItems,
      abandonmentAt: checkout.lastActivityAt,
    },
  });

  logger.info(`[webhook] Created abandoned cart: ${checkout.ref.externalId}`);
}

async function handleOrderEvent(prisma, platform, order) {
  const storeConfig = await prisma.storeConfig.findFirst({
    where: {
      platform,
      storeUrl: { contains: order.ref.storeId },
    },
  });

  if (!storeConfig) return;

  const eventType = order.status === 'completed' 
    ? 'order.completed' 
    : 'order.updated';

  await prisma.customerEvent.create({
    data: {
      tenantId: storeConfig.tenantId,
      eventSource: platform,
      eventType,
      payload: order,
      sessionId: null,
    },
  });

  if (order.status === 'completed') {
    await prisma.abandonedCart.updateMany({
      where: {
        tenantId: storeConfig.tenantId,
        customerEmail: order.email,
        status: { in: ['new', 'sent1'] },
      },
      data: {
        status: 'recovered',
      },
    });
  }
}

async function handleCustomerEvent(prisma, platform, customer) {
  const storeConfig = await prisma.storeConfig.findFirst({
    where: {
      platform,
      storeUrl: { contains: customer.ref.storeId },
    },
  });

  if (!storeConfig) return;

  await prisma.customerCrm.upsert({
    where: {
      tenantId_externalId: {
        tenantId: storeConfig.tenantId,
        externalId: customer.ref.externalId,
      },
    },
    create: {
      tenantId: storeConfig.tenantId,
      externalId: customer.ref.externalId,
      email: customer.email,
      name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || null,
      phone: customer.phone,
      totalPurchases: customer.ordersCount,
      totalSpent: customer.totalSpent,
    },
    update: {
      email: customer.email,
      name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || null,
      phone: customer.phone,
      totalPurchases: customer.ordersCount,
      totalSpent: customer.totalSpent,
    },
  });
}

module.exports = { createWebhookRouter };