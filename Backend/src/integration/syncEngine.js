const { createAdapter } = require('./index');
const logger = require('../utils/logger');

class SyncEngine {
  constructor(prisma) {
    this.prisma = prisma;
    this.adapters = new Map();
    this.runningJobs = new Map();
  }

  getAdapter(storeId) {
    if (!this.adapters.has(storeId)) {
      return null;
    }
    return this.adapters.get(storeId);
  }

  async initializeStore(storeId) {
    const config = await this.prisma.storeConfig.findUnique({
      where: { id: storeId },
    });

    if (!config) {
      throw new Error(`Store config not found: ${storeId}`);
    }

    const adapter = createAdapter(config.platform, this.prisma);
    this.adapters.set(storeId, adapter);

    return adapter;
  }

  async startSync(storeId, resource) {
    if (this.runningJobs.has(`${storeId}_${resource}`)) {
      logger.warn(`Sync already running for ${storeId}/${resource}`);
      return;
    }

    const adapter = await this.initializeStore(storeId);
    const config = await this.prisma.storeConfig.findUnique({
      where: { id: storeId },
    });

    const job = await this.prisma.syncJob.create({
      data: {
        storeId,
        resource,
        status: 'running',
        startedAt: new Date(),
      },
    });

    this.runningJobs.set(`${storeId}_${resource}`, { adapter, job });

    this.processSync(storeId, resource, adapter, job.id).catch(err => {
      logger.error(`Sync failed for ${storeId}/${resource}`, { error: err.message });
      this.runningJobs.delete(`${storeId}_${resource}`);
    });
  }

  async processSync(storeId, resource, adapter, jobId) {
    const cursor = await adapter.getSyncCursor(storeId, resource);

    const params = {
      storeId,
      since: cursor?.timestamp,
      cursor: cursor?.cursor,
    };

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

    let processedCount = 0;
    const errors = [];

    try {
      for await (const item of adapter[fetchMethod](params)) {
        try {
          await this.processItem(storeId, resource, item);
          processedCount++;

          if (processedCount % 100 === 0) {
            await adapter.setSyncCursor(storeId, resource, {
              cursor: cursor?.cursor || '',
              timestamp: new Date(),
              processedCount,
            });

            await this.prisma.syncJob.update({
              where: { id: jobId },
              data: { recordsProcessed: processedCount },
            });
          }
        } catch (itemError) {
          errors.push(`Error processing item ${item.id}: ${itemError.message}`);
        }
      }

      await this.prisma.syncJob.update({
        where: { id: jobId },
        data: {
          status: 'complete',
          recordsProcessed: processedCount,
          completedAt: new Date(),
          errors,
        },
      });

      await this.prisma.storeConfig.update({
        where: { id: storeId },
        data: { lastSyncAt: new Date() },
      });

    } catch (error) {
      await this.prisma.syncJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          errors: [...errors, error.message],
        },
      });

      throw error;
    } finally {
      this.runningJobs.delete(`${storeId}_${resource}`);
    }
  }

  async processItem(storeId, resource, item) {
    switch (resource) {
      case 'customers':
        await this.processCustomer(storeId, item);
        break;
      case 'orders':
        await this.processOrder(storeId, item);
        break;
      case 'products':
        await this.processProduct(storeId, item);
        break;
      case 'checkouts':
        await this.processCheckout(storeId, item);
        break;
    }
  }

  async processCustomer(storeId, customer) {
    const config = await this.prisma.storeConfig.findUnique({
      where: { id: storeId },
    });

    await this.prisma.customerCrm.upsert({
      where: {
        tenantId_externalId: {
          tenantId: config.tenantId,
          externalId: customer.ref.externalId,
        },
      },
      create: {
        tenantId: config.tenantId,
        externalId: customer.ref.externalId,
        email: customer.email,
        name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || null,
        phone: customer.phone,
        totalPurchases: customer.ordersCount,
        totalSpent: customer.totalSpent,
        lastPurchase: null,
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

  async processOrder(storeId, order) {
    const config = await this.prisma.storeConfig.findUnique({
      where: { id: storeId },
    });

    await this.prisma.customerEvent.create({
      data: {
        tenantId: config.tenantId,
        eventSource: config.platform,
        eventType: 'order.created',
        payload: order,
        sessionId: null,
      },
    });
  }

  async processProduct(storeId, product) {
    logger.debug(`Processed product ${product.id}`);
  }

  async processCheckout(storeId, checkout) {
    const config = await this.prisma.storeConfig.findUnique({
      where: { id: storeId },
    });

    const abandonment = config.abandonmentWindowMinutes
      ? config.abandonmentWindowMinutes
      : 60;

    const isAbandoned = this.checkAbandoned(
      checkout,
      abandonment,
      config.platform
    );

    if (isAbandoned) {
      const existingCart = await this.prisma.abandonedCart.findFirst({
        where: {
          tenantId: config.tenantId,
          externalCartId: checkout.ref.externalId,
        },
      });

      if (!existingCart) {
        await this.prisma.abandonedCart.create({
          data: {
            tenantId: config.tenantId,
            externalCartId: checkout.ref.externalId,
            customerEmail: checkout.email,
            customerPhone: checkout.phone,
            cartValue: checkout.totalPrice,
            currency: checkout.currency,
            items: checkout.lineItems,
            abandonmentAt: checkout.lastActivityAt,
          },
        });
      }
    }
  }

  checkAbandoned(checkout, windowMinutes, platform) {
    if (checkout.status !== 'active') {
      return false;
    }

    if (checkout.completedAt) {
      return false;
    }

    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
    return new Date(checkout.lastActivityAt) < cutoff;
  }

  async pauseSync(storeId, resource) {
    const jobKey = `${storeId}_${resource}`;
    const running = this.runningJobs.get(jobKey);
    if (running) {
      await this.prisma.syncJob.update({
        where: { id: running.job.id },
        data: { status: 'paused' },
      });
      this.runningJobs.delete(jobKey);
    }
  }

  async getJobStatus(storeId, resource) {
    const job = await this.prisma.syncJob.findFirst({
      where: { storeId, resource },
      orderBy: { startedAt: 'desc' },
    });
    return job;
  }

  async runFullSync(storeId) {
    await this.startSync(storeId, 'customers');
    await this.startSync(storeId, 'orders');
    await this.startSync(storeId, 'products');
    await this.startSync(storeId, 'checkouts');
  }
}

module.exports = { SyncEngine };