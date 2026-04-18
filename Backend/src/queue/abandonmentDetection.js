const { PrismaClient } = require('@prisma/client');
const { addRecoveryTrigger } = require('./index');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

async function detectAbandonedCheckouts() {
  logger.info('[abandonment] Running detection job');

  try {
    const stores = await prisma.storeConfig.findMany({
      where: {
        status: 'connected',
      },
    });

    for (const store of stores) {
      await detectForStore(store);
    }

    logger.info('[abandonment] Detection job completed');
  } catch (error) {
    logger.error('[abandonment] Detection job failed', { error: error.message });
  } finally {
    await prisma.$disconnect();
  }
}

async function detectForStore(store) {
  const windowMs = store.abandonmentWindowMinutes * 60 * 1000;
  const gracePeriod = store.platform === 'WOOCOMMERCE' ? 15 * 60 * 1000 : 0;
  const effectiveWindowMs = windowMs + gracePeriod;

  const candidates = await prisma.checkout.findMany({
    where: {
      storeId: store.id,
      status: 'ACTIVE',
      completedAt: null,
      lastActivityAt: {
        lt: new Date(Date.now() - effectiveWindowMs),
      },
    },
  });

  logger.info(`[abandonment] Found ${candidates.length} abandoned checkouts for store ${store.id}`);

  for (const checkout of candidates) {
    const existingOrder = await prisma.customerEvent.findFirst({
      where: {
        tenantId: store.tenantId,
        eventType: { in: ['order.created', 'order.completed'] },
        payload: {
          path: ['email'],
          equals: checkout.email,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingOrder && new Date(existingOrder.createdAt) > new Date(checkout.lastActivityAt)) {
      logger.info(`[abandonment] Skipping checkout ${checkout.id} - order already placed`);
      continue;
    }

    await markAbandoned(checkout, store);
  }
}

async function markAbandoned(checkout, store) {
  await prisma.checkout.update({
    where: { id: checkout.id },
    data: {
      status: 'ABANDONED',
      abandonedAt: new Date(),
    },
  });

  logger.info(`[abandonment] Marked checkout ${checkout.id} as abandoned`, {
    storeId: store.id,
    platform: store.platform,
    email: checkout.email,
    value: checkout.totalPrice,
  });

  if (store.emailRecoveryEnabled !== false) {
    await addRecoveryTrigger(checkout.id, 'email', 1);
  }

  if (store.smsRecoveryEnabled) {
    await addRecoveryTrigger(checkout.id, 'sms', 1);
  }

  if (store.whatsappRecoveryEnabled) {
    await addRecoveryTrigger(checkout.id, 'whatsapp', 1);
  }
}

if (require.main === module) {
  detectAbandonedCheckouts()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { detectAbandonedCheckouts };