const { createAdapter } = require('../integration');
const { addSyncJob } = require('./index');
const logger = require('../utils/logger');

async function processSyncJob(job) {
  const { storeId, platform, resource } = job.data;

  logger.info(`[sync] Starting sync for store ${storeId}, resource ${resource}`);

  const adapter = createAdapter(platform, null);
  const fetchMap = {
    customers: 'fetchCustomers',
    orders: 'fetchOrders',
    products: 'fetchProducts',
    checkouts: 'fetchCheckouts',
  };

  const fetchMethod = fetchMap[resource];
  if (!adapter[fetchMethod]) {
    throw new Error(`Unknown resource: ${resource}`);
  }

  let processed = 0;
  let failed = 0;

  try {
    const cursor = await adapter.getSyncCursor(storeId, resource);
    const params = {
      storeId,
      since: cursor?.timestamp,
      cursor: cursor?.cursor,
    };

    for await (const item of adapter[fetchMethod](params)) {
      try {
        await upsertItem(platform, resource, item);
        processed++;

        if (processed % 100 === 0) {
          await adapter.setSyncCursor(storeId, resource, {
            cursor: cursor?.cursor || '',
            timestamp: new Date(),
            processedCount: processed,
          });
          await job.updateProgress(Math.round((processed / 1000) * 100));
        }
      } catch (itemError) {
        logger.error(`[sync] Error processing item ${item.id}`, { error: itemError.message });
        failed++;
      }
    }

    logger.info(`[sync] Completed for ${storeId}/${resource}`, { processed, failed });
    return { processed, failed };

  } catch (error) {
    logger.error(`[sync] Failed for ${storeId}/${resource}`, { error: error.message });
    throw error;
  }
}

async function upsertItem(platform, resource, item) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    switch (resource) {
      case 'customers':
        await prisma.customerCrm.upsert({
          where: { tenantId_externalId: { tenantId: 'unknown', externalId: item.id } },
          create: {
            tenantId: 'unknown',
            externalId: item.id,
            email: item.email,
            name: [item.firstName, item.lastName].filter(Boolean).join(' ') || null,
            phone: item.phone,
            totalPurchases: item.ordersCount,
            totalSpent: item.totalSpent,
          },
          update: {
            email: item.email,
            name: [item.firstName, item.lastName].filter(Boolean).join(' ') || null,
            phone: item.phone,
            totalPurchases: item.ordersCount,
            totalSpent: item.totalSpent,
          },
        });
        break;

      case 'orders':
        await prisma.customerEvent.create({
          data: {
            tenantId: 'unknown',
            eventSource: platform,
            eventType: 'order.created',
            payload: item,
            sessionId: null,
          },
        });
        break;

      case 'checkouts':
        await prisma.checkout.upsert({
          where: {
            platform_storeId_externalId: {
              platform: platform.toUpperCase(),
              storeId: item.ref.storeId,
              externalId: item.id,
            },
          },
          create: {
            storeId: item.ref.storeId,
            platform: platform.toUpperCase(),
            externalId: item.id,
            customerId: item.customerId,
            email: item.email,
            phone: item.phone,
            status: item.status.toUpperCase(),
            lineItems: item.lineItems,
            totalPrice: item.totalPrice,
            currency: item.currency,
            checkoutUrl: item.checkoutUrl,
            lastActivityAt: item.lastActivityAt,
            completedAt: item.completedAt,
          },
          update: {
            customerId: item.customerId,
            email: item.email,
            phone: item.phone,
            status: item.status.toUpperCase(),
            lineItems: item.lineItems,
            totalPrice: item.totalPrice,
            currency: item.currency,
            checkoutUrl: item.checkoutUrl,
            lastActivityAt: item.lastActivityAt,
            completedAt: item.completedAt,
          },
        });
        break;

      default:
        logger.debug(`Skipping unhandled resource: ${resource}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { processSyncJob };