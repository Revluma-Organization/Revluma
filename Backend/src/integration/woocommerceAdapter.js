const { BaseAdapter } = require('./baseAdapter');
const crypto = require('crypto');
const logger = require('../utils/logger');

class WooCommerceAdapter extends BaseAdapter {
  constructor(prisma) {
    super('woocommerce', prisma);
    this.apiVersion = 'wc/v3';
  }

  buildApiUrl(credentials, endpoint, params = {}) {
    const url = new URL(`${credentials.storeUrl}/wp-json/${this.apiVersion}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.append(key, value);
    }
    return url.toString();
  }

  signRequest(credentials, method, url, body) {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(16).toString('hex');

    const requestUrl = new URL(url);
    const path = requestUrl.pathname + requestUrl.search;

    let message = `${method}${path}${timestamp}${nonce}`;
    if (body) {
      message += body;
    }

    const signature = crypto
      .createHmac('sha256', credentials.consumerSecret)
      .update(message)
      .digest('base64');

    return {
      headers: {
        'Woo-Commerce-Key': credentials.consumerKey,
        'Woo-Commerce-Timestamp': timestamp.toString(),
        'Woo-Commerce-Nonce': nonce,
        'Woo-Commerce-Signature': signature,
      },
    };
  }

  async healthCheckFromCredentials(credentials) {
    const start = Date.now();

    try {
      const url = this.buildApiUrl(credentials, 'system_status');
      const auth = this.signRequest(credentials, 'GET', url, null);

      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...auth.headers,
        },
      });

      if (!response.ok) {
        return {
          healthy: false,
          latencyMs: Date.now() - start,
          error: `WooCommerce API error: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        storeName: data.environment?.site_title || data.settings?.blog_title,
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

    let url = this.buildApiUrl(credentials, 'customers', { per_page: 100 });

    if (params.since) {
      url += `&after=${params.since.toISOString()}`;
    }

    if (params.until) {
      url += `&before=${params.until.toISOString()}`;
    }

    while (url) {
      await rateLimiter.acquire();

      const auth = this.signRequest(credentials, 'GET', url, null);

      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...auth.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch customers: ${response.status}`);
      }

      const data = await response.json();
      const customers = Array.isArray(data) ? data : [];

      for (const customer of customers) {
        yield this.toInternalCustomer({
          ...customer,
          storeId: credentials.storeUrl,
        });
      }

      const linkHeader = response.headers.get('Link');
      url = this.parseLinkHeader(linkHeader, 'next');
    }
  }

  async *fetchOrders(params) {
    const credentials = await this.getCredentials(params.storeId);
    const rateLimiter = await this.getOrCreateRateLimiter(params.storeId);

    const queryParams = { per_page: 100 };

    if (params.status) {
      queryParams.status = params.status;
    }

    if (params.since) {
      queryParams.after = params.since.toISOString();
    }

    if (params.until) {
      queryParams.before = params.until.toISOString();
    }

    let url = this.buildApiUrl(credentials, 'orders', queryParams);

    while (url) {
      await rateLimiter.acquire();

      const auth = this.signRequest(credentials, 'GET', url, null);

      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...auth.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch orders: ${response.status}`);
      }

      const data = await response.json();
      const orders = Array.isArray(data) ? data : [];

      for (const order of orders) {
        yield this.toInternalOrder({
          ...order,
          storeId: credentials.storeUrl,
        });
      }

      const linkHeader = response.headers.get('Link');
      url = this.parseLinkHeader(linkHeader, 'next');
    }
  }

  async *fetchProducts(params) {
    const credentials = await this.getCredentials(params.storeId);
    const rateLimiter = await this.getOrCreateRateLimiter(params.storeId);

    const queryParams = { per_page: 100 };

    if (params.since) {
      queryParams.after = params.since.toISOString();
    }

    if (params.until) {
      queryParams.before = params.until.toISOString();
    }

    let url = this.buildApiUrl(credentials, 'products', queryParams);

    while (url) {
      await rateLimiter.acquire();

      const auth = this.signRequest(credentials, 'GET', url, null);

      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...auth.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch products: ${response.status}`);
      }

      const data = await response.json();
      const products = Array.isArray(data) ? data : [];

      for (const product of products) {
        yield this.toInternalProduct({
          ...product,
          storeId: credentials.storeUrl,
        });
      }

      const linkHeader = response.headers.get('Link');
      url = this.parseLinkHeader(linkHeader, 'next');
    }
  }

  toInternalProduct(platformProduct) {
    return {
      id: platformProduct.id,
      ref: this.normalizeRef(platformProduct.id, platformProduct.storeId),
      title: platformProduct.name,
      description: platformProduct.description,
      vendor: platformProduct.short_description || null,
      productType: platformProduct.categories?.[0]?.name || null,
      status: platformProduct.status === 'publish' ? 'active' : 'draft',
      variants: (platformProduct.variations || []).map(v => ({
        id: v.id,
        sku: v.sku,
        title: v.attributes?.map(a => a.option).join(' / ') || '',
        price: parseFloat(v.price) || 0,
        compareAtPrice: v.regular_price ? parseFloat(v.regular_price) : null,
        inventoryQuantity: v.stock_quantity,
        weight: v.weight ? parseFloat(v.weight) : null,
        options: Object.fromEntries(
          (v.attributes || []).map(a => [a.name, a.option])
        ),
      })),
      images: (platformProduct.images || []).map(img => img.src),
      createdAt: new Date(platformProduct.date_created),
      updatedAt: new Date(platformProduct.date_modified),
    };
  }

  parseLinkHeader(linkHeader, rel) {
    if (!linkHeader) return null;

    const links = linkHeader.split(',').map(link => {
      const [urlPart, relPart] = link.split(';');
      const url = urlPart.trim().replace(/<|>/g, '');
      const relMatch = relPart?.trim().match(/rel="?(\w+)"?/);
      return { url, rel: relMatch?.[1] };
    });

    const nextLink = links.find(l => l.rel === rel);
    return nextLink?.url || null;
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
      const wooTopic = webhookTopics[topic];
      if (!wooTopic) continue;

      await rateLimiter.acquire();

      const secret = crypto.randomBytes(32).toString('hex');

      const url = this.buildApiUrl(credentials, 'webhooks', {
        topic: wooTopic,
        delivery_url: `${config.callbackUrl}/webhooks/${this.platform}`,
        secret,
      });

      const auth = this.signRequest(credentials, 'POST', url, JSON.stringify({
        topic: wooTopic,
        delivery_url: `${config.callbackUrl}/webhooks/${this.platform}`,
        secret,
      }));

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...auth.headers,
          },
          body: JSON.stringify({
            topic: wooTopic,
            delivery_url: `${config.callbackUrl}/webhooks/${this.platform}`,
            secret,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const webhookId = data.id;

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
    const signature = headers['x-wc-webhook-signature'];
    const eventId = headers['x-wc-webhook-event'];

    if (!signature || !eventId) {
      return false;
    }

    return true;
  }

  normalizeWebhookEvent(topic, payload) {
    try {
      const topicMap = {
        'orders/create': 'order.created',
        'orders/update': 'order.updated',
        'orders/delete': 'order.updated',
        'customers/create': 'customer.created',
        'customers/update': 'customer.updated',
      };

      const eventType = topicMap[topic];

      if (!eventType || !payload) return null;

      if (eventType === 'order.created' || eventType === 'order.updated') {
        return {
          type: eventType,
          order: this.toInternalOrder({
            ...payload,
            storeId: payload.site_url || payload.storeUrl,
          }),
        };
      }

      if (eventType === 'customer.created' || eventType === 'customer.updated') {
        return {
          type: eventType,
          customer: this.toInternalCustomer({
            ...payload,
            storeId: payload.site_url || payload.storeUrl,
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

module.exports = { WooCommerceAdapter };