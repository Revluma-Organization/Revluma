const { BaseAdapter } = require('./baseAdapter');
const crypto = require('crypto');
const logger = require('../utils/logger');

class BigCommerceAdapter extends BaseAdapter {
  constructor(prisma) {
    super('bigcommerce', prisma);
    this.apiVersion = 'v2';
  }

  buildApiUrl(credentials, endpoint, params = {}) {
    const base = `https://api.bigcommerce.com/stores/${credentials.storeHash}`;
    const url = new URL(`${base}/${this.apiVersion}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.append(key, value);
    }
    return url.toString();
  }

  async healthCheckFromCredentials(credentials) {
    const start = Date.now();

    try {
      const url = this.buildApiUrl(credentials, 'time.json');

      const response = await fetch(url, {
        headers: {
          'X-Auth-Token': credentials.accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return {
          healthy: false,
          latencyMs: Date.now() - start,
          error: `BigCommerce API error: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        storeName: credentials.storeHash,
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: error.message,
      };
    }
  }

  async *fetchCustomers(params) {
    const credentials = await this.getCredentials(params.storeId);
    const rateLimiter = await this.getOrCreateRateLimiter(params.storeId);

    let url = this.buildApiUrl(credentials, 'customers.json', {
      limit: 50,
      page: 1,
    });

    if (params.since) {
      url += `&min_date_created=${params.since.toISOString()}`;
    }

    while (url) {
      await rateLimiter.acquire();

      const response = await fetch(url, {
        headers: {
          'X-Auth-Token': credentials.accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch customers: ${response.status}`);
      }

      const data = await response.json();
      const customers = data || [];

      for (const customer of customers) {
        yield this.toInternalCustomer({
          ...customer,
          storeId: credentials.storeHash,
        });
      }

      const page = url.match(/page=(\d+)/)?.[1];
      if (data.length === 50) {
        url = url.replace(/page=\d+/, `page=${parseInt(page, 10) + 1}`);
      } else {
        url = null;
      }
    }
  }

  async *fetchOrders(params) {
    const credentials = await this.getCredentials(params.storeId);
    const rateLimiter = await this.getOrCreateRateLimiter(params.storeId);

    const queryParams = {
      limit: 50,
      page: 1,
    };

    if (params.status) {
      queryParams.status_id = this.mapOrderStatus(params.status);
    }

    if (params.since) {
      queryParams.min_date_created = params.since.toISOString();
    }

    let url = this.buildApiUrl(credentials, 'orders.json', queryParams);

    while (url) {
      await rateLimiter.acquire();

      const response = await fetch(url, {
        headers: {
          'X-Auth-Token': credentials.accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch orders: ${response.status}`);
      }

      const data = await response.json();
      const orders = data || [];

      for (const order of orders) {
        yield this.toInternalOrder({
          ...order,
          storeId: credentials.storeHash,
        });
      }

      const page = url.match(/page=(\d+)/)?.[1];
      if (orders.length === 50) {
        url = url.replace(/page=\d+/, `page=${parseInt(page, 10) + 1}`);
      } else {
        url = null;
      }
    }
  }

  mapOrderStatus(status) {
    const statusMap = {
      pending: 1,
      processing: 2,
      shipped: 3,
      delivered: 4,
      cancelled: 5,
      declined: 6,
      refunded: 7,
    };
    return statusMap[status?.toLowerCase()] || null;
  }

  async *fetchProducts(params) {
    const credentials = await this.getCredentials(params.storeId);
    const rateLimiter = await this.getOrCreateRateLimiter(params.storeId);

    const queryParams = {
      limit: 50,
      page: 1,
    };

    if (params.since) {
      queryParams.min_date_modified = params.since.toISOString();
    }

    let url = this.buildApiUrl(credentials, 'products.json', queryParams);

    while (url) {
      await rateLimiter.acquire();

      const response = await fetch(url, {
        headers: {
          'X-Auth-Token': credentials.accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch products: ${response.status}`);
      }

      const data = await response.json();
      const products = data || [];

      for (const product of products) {
        yield this.toInternalProduct({
          ...product,
          storeId: credentials.storeHash,
        });
      }

      const page = url.match(/page=(\d+)/)?.[1];
      if (products.length === 50) {
        url = url.replace(/page=\d+/, `page=${parseInt(page, 10) + 1}`);
      } else {
        url = null;
      }
    }
  }

  toInternalProduct(platformProduct) {
    return {
      id: platformProduct.id,
      ref: this.normalizeRef(platformProduct.id, platformProduct.storeId),
      title: platformProduct.name,
      description: platformProduct.description,
      vendor: platformProduct.brand || null,
      productType: platformProduct.type === 'physical' ? 'physical' : 'digital',
      status: platformProduct.is_active ? 'active' : 'draft',
      variants: (platformProduct.variants || []).map(v => ({
        id: v.id,
        sku: v.sku,
        title: v.option_values?.map(o => o.label).join(' / ') || '',
        price: parseFloat(v.price) || 0,
        compareAtPrice: v.calculated_price ? parseFloat(v.calculated_price) : null,
        inventoryQuantity: v.inventory_level,
        weight: v.weight ? parseFloat(v.weight) : null,
        options: Object.fromEntries(
          (v.option_values || []).map(o => [o.option_id.toString(), o.label])
        ),
      })),
      images: platformProduct.images?.map(img => img.url_standard) || [],
      createdAt: new Date(platformProduct.date_created),
      updatedAt: new Date(platformProduct.date_modified),
    };
  }

  async registerWebhooks(storeId, topics) {
    const credentials = await this.getCredentials(storeId);
    const config = await this.getStoreConfig(storeId);
    const rateLimiter = await this.getOrCreateRateLimiter(storeId);

    const webhookTopics = {
      'orders/create': 'order.created',
      'orders/update': 'order.updated',
      'orders/delete': 'order.deleted',
      'customers/create': 'customer.created',
      'customers/update': 'customer.updated',
      'products/create': 'product.created',
      'products/update': 'product.updated',
    };

    const registered = [];

    for (const topic of topics) {
      const bcTopic = webhookTopics[topic];
      if (!bcTopic) continue;

      await rateLimiter.acquire();

      const secret = crypto.randomBytes(32).toString('hex');

      try {
        const url = this.buildApiUrl(credentials, 'webhooks.json');

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'X-Auth-Token': credentials.accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            scope: bcTopic,
            destination: `${config.callbackUrl}/webhooks/${this.platform}`,
            headers: {
              'X-BC-Webhook-Secret': secret,
            },
            is_active: true,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const webhookId = data[0]?.id;

          await this.prisma.webhookRegistration.create({
            data: {
              storeId,
              topic,
              webhookId: webhookId?.toString(),
              callbackUrl: `${config.callbackUrl}/webhooks/${this.platform}`,
              secret,
            },
          });

          registered.push({
            topic,
            callbackUrl: `${config.callbackUrl}/webhooks/${this.platform}`,
            webhookId: webhookId?.toString(),
            registeredAt: new Date(),
          });
        }
      } catch (error) {
        logger.error(`[${this.platform}] Failed to register webhook`, {
          topic,
          error: error.message,
        });
      }
    }

    return registered;
  }

  verifyWebhookSignature(headers, rawBody) {
    const signature = headers['x-bc-webhook-signature'];
    const storeHash = headers['x-bc-webhook-store-hash'];

    if (!signature || !storeHash) {
      return false;
    }

    return true;
  }

  normalizeWebhookEvent(topic, payload) {
    try {
      const topicMap = {
        'order.created': 'order.created',
        'order.updated': 'order.updated',
        'order.deleted': 'order.updated',
        'customer.created': 'customer.created',
        'customer.updated': 'customer.updated',
        'product.created': 'checkout.updated',
        'product.updated': 'checkout.updated',
      };

      const eventType = topicMap[topic];

      if (!eventType || !payload) return null;

      if (eventType === 'order.created' || eventType === 'order.updated') {
        return {
          type: eventType,
          order: this.toInternalOrder({
            ...payload,
            storeId: payload.store_id?.toString(),
          }),
        };
      }

      if (eventType === 'customer.created' || eventType === 'customer.updated') {
        return {
          type: eventType,
          customer: this.toInternalCustomer({
            ...payload,
            storeId: payload.store_id?.toString(),
          }),
        };
      }

      return null;
    } catch (error) {
      logger.error(`[${this.platform}] Failed to normalize webhook`, {
        topic,
        error: error.message,
      });
      return null;
    }
  }
}

module.exports = { BigCommerceAdapter };