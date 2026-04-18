const crypto = require('crypto');
const { RateLimiter } = require('./rateLimiter');
const { encrypt, decrypt } = require('./encryption');
const logger = require('../utils/logger');

class BaseAdapter {
  constructor(platform, prisma) {
    this.platform = platform;
    this.prisma = prisma;
    this.rateLimiters = new Map();
  }

  async getStoreConfig(storeId) {
    const config = await this.prisma.storeConfig.findUnique({
      where: { id: storeId },
    });
    return config;
  }

  async getCredentials(storeId) {
    const config = await this.getStoreConfig(storeId);
    if (!config?.credentialsEncrypted) {
      throw new Error(`No credentials found for store ${storeId}`);
    }
    const decrypted = decrypt(config.credentialsEncrypted);
    return JSON.parse(decrypted);
  }

  async getOrCreateRateLimiter(storeId) {
    if (!this.rateLimiters.has(storeId)) {
      this.rateLimiters.set(storeId, new RateLimiter({
        maxTokens: 40,
        refillRate: 20,
        intervalMs: 1000,
      }));
    }
    return this.rateLimiters.get(storeId);
  }

  async connect(credentials) {
    try {
      const testConnection = await this.healthCheckFromCredentials(credentials);
      if (!testConnection.healthy) {
        return {
          success: false,
          error: testConnection.error || 'Connection test failed',
        };
      }

      return {
        success: true,
        storeId: this.generateStoreId(credentials),
        storeName: testConnection.storeName,
      };
    } catch (error) {
      logger.error(`[${this.platform}] Connect failed`, { error: error.message });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  generateStoreId(credentials) {
    const base = credentials.shopDomain || credentials.storeUrl || credentials.storeHash;
    return `${this.platform}_${base.replace(/[^a-zA-Z0-9]/g, '_')}`;
  }

  async healthCheck(storeId) {
    const credentials = await this.getCredentials(storeId);
    return this.healthCheckFromCredentials(credentials);
  }

  async healthCheckFromCredentials(credentials) {
    throw new Error('healthCheckFromCredentials must be implemented by subclass');
  }

  async disconnect(storeId) {
    await this.prisma.storeConfig.update({
      where: { id: storeId },
      data: { status: 'disconnected' },
    });
  }

  async registerWebhooks(storeId, topics) {
    throw new Error('registerWebhooks must be implemented by subclass');
  }

  verifyWebhookSignature(headers, rawBody) {
    throw new Error('verifyWebhookSignature must be implemented by subclass');
  }

  normalizeWebhookEvent(topic, payload) {
    throw new Error('normalizeWebhookEvent must be implemented by subclass');
  }

  async *fetchAllPages(fetchFn, params) {
    let cursor = params.cursor || null;
    let hasMore = true;

    while (hasMore) {
      const rateLimiter = await this.getOrCreateRateLimiter(params.storeId || 'default');
      await rateLimiter.acquire();

      const result = await fetchFn({ ...params, cursor });

      for (const item of result.items) {
        yield item;
      }

      cursor = result.nextCursor;
      hasMore = !!cursor && (!params.limit || result.items.length > 0);
    }
  }

  async getSyncCursor(storeId, resource) {
    const syncState = await this.prisma.syncCursor.findUnique({
      where: {
        storeId_resource: { storeId, resource },
      },
    });

    if (!syncState) return null;

    return {
      cursor: syncState.cursor,
      timestamp: syncState.timestamp,
      processedCount: syncState.processedCount,
    };
  }

  async setSyncCursor(storeId, resource, cursor) {
    await this.prisma.syncCursor.upsert({
      where: {
        storeId_resource: { storeId, resource },
      },
      create: {
        storeId,
        resource,
        cursor: cursor.cursor,
        timestamp: cursor.timestamp,
        processedCount: cursor.processedCount,
      },
      update: {
        cursor: cursor.cursor,
        timestamp: cursor.timestamp,
        processedCount: cursor.processedCount,
      },
    });
  }

  normalizeRef(externalId, platformSpecificId) {
    return {
      platform: this.platform,
      storeId: platformSpecificId,
      externalId,
    };
  }

  buildCursor(timestamp, id) {
    const timestampEpoch = new Date(timestamp).getTime();
    return Buffer.from(`${timestampEpoch}_${id}`).toString('base64');
  }

  parseCursor(cursor) {
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
      const [timestampEpoch, id] = decoded.split('_');
      return {
        timestamp: new Date(parseInt(timestampEpoch, 10)),
        id,
      };
    } catch {
      return { timestamp: new Date(0), id: '' };
    }
  }

  calculateAbandonment(
    abandonedTimeoutMinutes,
    lastActivityAt,
    completedAt,
    checkoutStatus
  ) {
    if (completedAt || checkoutStatus === 'completed') {
      return { isAbandoned: false, reason: 'completed' };
    }

    if (checkoutStatus !== 'active') {
      return { isAbandoned: false, reason: `status: ${checkoutStatus}` };
    }

    const cutoff = new Date(
      Date.now() - abandonedTimeoutMinutes * 60 * 1000
    );

    if (new Date(lastActivityAt) < cutoff) {
      return {
        isAbandoned: true,
        reason: `inactive since ${lastActivityAt}`,
      };
    }

    return { isAbandoned: false, reason: 'recently active' };
  }

  toInternalCustomer(platformCustomer) {
    return {
      id: platformCustomer.id,
      ref: this.normalizeRef(platformCustomer.id, platformCustomer.storeId),
      email: platformCustomer.email,
      phone: platformCustomer.phone || null,
      firstName: platformCustomer.first_name || platformCustomer.firstName || null,
      lastName: platformCustomer.last_name || platformCustomer.lastName || null,
      totalSpent: platformCustomer.total_spent || platformCustomer.totalSpent || 0,
      currency: platformCustomer.currency || 'USD',
      ordersCount: platformCustomer.orders_count || platformCustomer.ordersCount || 0,
      tags: platformCustomer.tags || [],
      createdAt: new Date(platformCustomer.created_at || platformCustomer.createdAt),
      updatedAt: new Date(platformCustomer.updated_at || platformCustomer.updatedAt),
    };
  }

  toInternalOrder(platformOrder) {
    return {
      id: platformOrder.id,
      ref: this.normalizeRef(platformOrder.id, platformOrder.storeId),
      customerId: platformOrder.customer_id || platformOrder.customerId || null,
      email: platformOrder.email || '',
      status: this.normalizeOrderStatus(platformOrder.status),
      totalPrice: platformOrder.total_price || platformOrder.totalPrice || 0,
      subtotalPrice: platformOrder.subtotal_price || platformOrder.subtotalPrice || 0,
      totalTax: platformOrder.total_tax || platformOrder.totalTax || 0,
      totalDiscounts: platformOrder.total_discounts || platformOrder.totalDiscounts || 0,
      currency: platformOrder.currency || 'USD',
      lineItems: platformOrder.line_items || platformOrder.lineItems || [],
      shippingAddress: platformOrder.shipping_address || platformOrder.shippingAddress || null,
      tags: platformOrder.tags || [],
      createdAt: new Date(platformOrder.created_at || platformOrder.createdAt),
      updatedAt: new Date(platformOrder.updated_at || platformOrder.updatedAt),
      closedAt: platformOrder.closed_at ? new Date(platformOrder.closed_at) : null,
    };
  }

  normalizeOrderStatus(status) {
    const statusMap = {
      pending: 'pending',
      open: 'pending',
      'in progress': 'processing',
      processing: 'processing',
      shipped: 'completed',
      completed: 'completed',
      fulfilled: 'completed',
      cancelled: 'cancelled',
      voided: 'cancelled',
      refunded: 'refunded',
      partially_refunded: 'refunded',
      failed: 'failed',
    };
    return statusMap[status?.toLowerCase()] || 'pending';
  }

  toInternalCheckout(platformCheckout) {
    return {
      id: platformCheckout.id,
      ref: this.normalizeRef(platformCheckout.id, platformCheckout.storeId),
      customerId: platformCheckout.customer_id || platformCheckout.customerId || null,
      email: platformCheckout.email || platformCheckout.customer?.email || null,
      phone: platformCheckout.phone || platformCheckout.customer?.phone || null,
      status: this.normalizeCheckoutStatus(platformCheckout.status),
      lineItems: platformCheckout.line_items || platformCheckout.lineItems || [],
      totalPrice: platformCheckout.total_price || platformCheckout.totalPrice || 0,
      currency: platformCheckout.currency || 'USD',
      checkoutUrl: platformCheckout.web_url || platformCheckout.checkoutUrl || null,
      lastActivityAt: new Date(
        platformCheckout.updated_at ||
        platformCheckout.updatedAt ||
        platformCheckout.created_at ||
        platformCheckout.createdAt
      ),
      completedAt: platformCheckout.completed_at
        ? new Date(platformCheckout.completed_at)
        : null,
      createdAt: new Date(
        platformCheckout.created_at || platformCheckout.createdAt
      ),
    };
  }

  normalizeCheckoutStatus(status) {
    const statusMap = {
      open: 'active',
      active: 'active',
      completed: 'completed',
      checkout: 'completed',
      closed: 'abandoned',
      abandoned: 'abandoned',
      expired: 'abandoned',
    };
    return statusMap[status?.toLowerCase()] || 'unknown';
  }
}

module.exports = { BaseAdapter };