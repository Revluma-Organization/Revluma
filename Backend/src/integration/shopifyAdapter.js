const { BaseAdapter } = require('./baseAdapter');
const crypto = require('crypto');
const logger = require('../utils/logger');

class ShopifyAdapter extends BaseAdapter {
  constructor(prisma) {
    super('shopify', prisma);
  }

  async healthCheckFromCredentials(credentials) {
    const start = Date.now();

    try {
      const response = await fetch(
        `https://${credentials.shopDomain}/admin/api/2024-01/shop.json`,
        {
          headers: {
            'X-Shopify-Access-Token': credentials.accessToken,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        return {
          healthy: false,
          latencyMs: Date.now() - start,
          error: `Shopify API error: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        storeName: data.shop?.name,
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

    let url = `https://${credentials.shopDomain}/admin/api/2024-01/customers.json?limit=250`;

    if (params.since) {
      url += `&updated_at_min=${params.since.toISOString()}`;
    }

    if (params.until) {
      url += `&updated_at_max=${params.until.toISOString()}`;
    }

    while (url) {
      await rateLimiter.acquire();

      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': credentials.accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch customers: ${response.status}`);
      }

      const data = await response.json();
      const customers = data.customers || [];

      for (const customer of customers) {
        yield this.toInternalCustomer({
          ...customer,
          storeId: credentials.shopDomain,
        });
      }

      const linkHeader = response.headers.get('Link');
      url = this.parseLinkHeader(linkHeader, 'next');
    }
  }

  async *fetchOrders(params) {
    const credentials = await this.getCredentials(params.storeId);
    const rateLimiter = await this.getOrCreateRateLimiter(params.storeId);

    let url = `https://${credentials.shopDomain}/admin/api/2024-01/orders.json?limit=250&status=any`;

    if (params.since) {
      url += `&updated_at_min=${params.since.toISOString()}`;
    }

    if (params.until) {
      url += `&updated_at_max=${params.until.toISOString()}`;
    }

    if (params.status && params.status !== 'any') {
      url += `&status=${params.status}`;
    }

    while (url) {
      await rateLimiter.acquire();

      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': credentials.accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch orders: ${response.status}`);
      }

      const data = await response.json();
      const orders = data.orders || [];

      for (const order of orders) {
        yield this.toInternalOrder({
          ...order,
          storeId: credentials.shopDomain,
        });
      }

      const linkHeader = response.headers.get('Link');
      url = this.parseLinkHeader(linkHeader, 'next');
    }
  }

  async *fetchCheckouts(params) {
    const credentials = await this.getCredentials(params.storeId);
    const rateLimiter = await this.getOrCreateRateLimiter(params.storeId);

    let url = `https://${credentials.shopDomain}/admin/api/2024-01/checkouts.json?limit=250`;

    if (params.since) {
      url += `&updated_at_min=${params.since.toISOString()}`;
    }

    if (params.until) {
      url += `&updated_at_max=${params.until.toISOString()}`;
    }

    while (url) {
      await rateLimiter.acquire();

      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': credentials.accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch checkouts: ${response.status}`);
      }

      const data = await response.json();
      const checkouts = data.checkouts || [];

      for (const checkout of checkouts) {
        yield this.toInternalCheckout({
          ...checkout,
          storeId: credentials.shopDomain,
        });
      }

      const linkHeader = response.headers.get('Link');
      url = this.parseLinkHeader(linkHeader, 'next');
    }
  }

  async *fetchProducts(params) {
    const credentials = await this.getCredentials(params.storeId);
    const rateLimiter = await this.getOrCreateRateLimiter(params.storeId);

    let url = `https://${credentials.shopDomain}/admin/api/2024-01/products.json?limit=250`;

    if (params.since) {
      url += `&updated_at_min=${params.since.toISOString()}`;
    }

    if (params.until) {
      url += `&updated_at_max=${params.until.toISOString()}`;
    }

    while (url) {
      await rateLimiter.acquire();

      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': credentials.accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch products: ${response.status}`);
      }

      const data = await response.json();
      const products = data.products || [];

      for (const product of products) {
        yield this.toInternalProduct({
          ...product,
          storeId: credentials.shopDomain,
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
      title: platformProduct.title,
      description: platformProduct.body_html || platformProduct.description,
      vendor: platformProduct.vendor,
      productType: platformProduct.product_type,
      status: platformProduct.status === 'active' ? 'active' : 'draft',
      variants: (platformProduct.variants || []).map(v => ({
        id: v.id,
        sku: v.sku,
        title: v.title,
        price: parseFloat(v.price) || 0,
        compareAtPrice: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
        inventoryQuantity: v.inventory_quantity,
        weight: v.weight,
        options: {
          option1: v.option1,
          option2: v.option2,
          option3: v.option3,
        },
      })),
      images: (platformProduct.images || []).map(img => img.src),
      createdAt: new Date(platformProduct.created_at),
      updatedAt: new Date(platformProduct.updated_at),
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

    const registered = [];

    for (const topic of topics) {
      await rateLimiter.acquire();

      const webhookTopics = {
        'orders/create': 'orders/create',
        'orders/update': 'orders/update',
        'orders/delete': 'orders/delete',
        'customers/create': 'customers/create',
        'customers/update': 'customers/update',
        'checkouts/create': 'checkouts/create',
        'checkouts/update': 'checkouts/update',
        'carts/create': 'carts/create',
        'carts/update': 'carts/update',
      };

      const shopifyTopic = webhookTopics[topic];
      if (!shopifyTopic) continue;

      const secret = crypto.randomBytes(32).toString('hex');

      try {
        const response = await fetch(
          `https://${credentials.shopDomain}/admin/api/2024-01/webhooks.json`,
          {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': credentials.accessToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              webhook: {
                topic: shopifyTopic,
                address: `${config.callbackUrl}/webhooks/${this.platform}`,
                format: 'json',
                secret,
              },
            }),
          }
        );

        if (response.ok) {
          const data = await response.json();
          const webhookId = data.webhook?.id;

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
    const hmacHeader = headers['x-shopify-hmac-sha256'];
    const shopDomain = headers['x-shopify-shop-domain'];

    if (!hmacHeader || !shopDomain) {
      return false;
    }

    const storedRegistration = await this.prisma.webhookRegistration.findFirst({
      where: {
        store: { storeUrl: { contains: shopDomain } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!storedRegistration?.secret) {
      return false;
    }

    const generatedHmac = crypto
      .createHmac('sha256', storedRegistration.secret)
      .update(rawBody)
      .digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(hmacHeader),
      Buffer.from(generatedHmac)
    );
  }

  normalizeWebhookEvent(topic, payload) {
    try {
      const topicMap = {
        'orders/create': 'order.created',
        'orders/update': 'order.updated',
        'orders/delete': 'order.updated',
        'customers/create': 'customer.created',
        'customers/update': 'customer.updated',
        'checkouts/create': 'checkout.updated',
        'checkouts/update': 'checkout.updated',
        'carts/create': 'checkout.updated',
        'carts/update': 'checkout.updated',
      };

      const eventType = topicMap[topic];

      if (!eventType || !payload) return null;

      if (eventType === 'order.created' || eventType === 'order.updated') {
        return {
          type: eventType,
          order: this.toInternalOrder({
            ...payload,
            storeId: payload.shop_domain,
          }),
        };
      }

      if (eventType === 'customer.created' || eventType === 'customer.updated') {
        return {
          type: eventType,
          customer: this.toInternalCustomer({
            ...payload,
            storeId: payload.shop_domain,
          }),
        };
      }

      if (eventType === 'checkout.updated') {
        return {
          type: 'checkout.abandoned',
          checkout: this.toInternalCheckout({
            ...payload,
            storeId: payload.shop_domain,
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

  formatDateForShopify(date) {
    return date.toISOString();
  }
}

module.exports = { ShopifyAdapter };