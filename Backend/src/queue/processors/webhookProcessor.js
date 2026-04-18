const { createAdapter } = require('../integration');
const { PrismaClient } = require('@prisma/client');
const { addInternalEvent } = require('./index');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

async function processWebhookJob(job) {
  const { storeId, platform, topic, rawBody, headers, receivedAt } = job.data;

  logger.info(`[webhook] Processing ${platform} webhook: ${topic}`, { storeId });

  try {
    const dedupKey = `${platform}:${storeId}:${headers['x-event-id'] || headers['x-shopify-order-id'] || ''}`;
    
    if (dedupKey) {
      const existing = await prisma.webhookEvent.findUnique({
        where: {
          platform_storeId_externalEventId: {
            platform: platform.toUpperCase(),
            storeId,
            externalEventId: dedupKey,
          },
        },
      });

      if (existing) {
        logger.info(`[webhook] Duplicate event detected: ${dedupKey}`);
        return { status: 'duplicate', deduplicated: true };
      }
    }

    const adapter = createAdapter(platform, prisma);
    const isValid = adapter.verifyWebhookSignature(headers, Buffer.from(rawBody));

    if (!isValid) {
      await createWebhookEvent(storeId, platform, topic, headers['x-event-id'], 'REJECTED', 'Invalid signature');
      logger.warn(`[webhook] Invalid signature for ${platform} webhook`);
      return { status: 'rejected', reason: 'Invalid signature' };
    }

    const payload = JSON.parse(rawBody);
    const event = adapter.normalizeWebhookEvent(topic, payload);

    if (!event) {
      await createWebhookEvent(storeId, platform, topic, headers['x-event-id'], 'PROCESSED', null);
      logger.info(`[webhook] Event normalized to null, skipping`);
      return { status: 'skipped', reason: 'Event not supported' };
    }

    await createWebhookEvent(storeId, platform, topic, headers['x-event-id'], 'PROCESSED', null);

    await addInternalEvent({
      type: event.type,
      platform,
      storeId,
      data: event,
    });

    logger.info(`[webhook] Successfully processed ${platform}/${topic}`);
    return { status: 'processed', eventType: event.type };

  } catch (error) {
    logger.error(`[webhook] Error processing webhook`, { 
      platform, 
      topic, 
      error: error.message 
    });
    
    await createWebhookEvent(storeId, platform, topic, headers['x-event-id'], 'FAILED', error.message);
    
    throw error;
  }
}

async function createWebhookEvent(storeId, platform, topic, externalEventId, status, error) {
  try {
    await prisma.webhookEvent.create({
      data: {
        storeId,
        platform: platform.toUpperCase(),
        topic,
        externalEventId: externalEventId || null,
        status,
        processingError: error || null,
        rawPayload: status === 'FAILED' ? {} : null,
        receivedAt: new Date(),
        processedAt: status !== 'RECEIVED' ? new Date() : null,
      },
    });
  } catch (e) {
    if (!e.code === 'P2002') {
      logger.error(`[webhook] Failed to create webhook event`, { error: e.message });
    }
  }
}

module.exports = { processWebhookJob };