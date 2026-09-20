const axios = require('axios');
const { prisma } = require('../configs/database');
const { decrypt } = require('../utils/encryption');
const { rfmSync } = require('./mlService');
const logger = require('../utils/logger');

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-01';
const PAGE_SIZE = 250;

function getAccessToken(store) {
  if (!store.access_token) throw new Error('Store does not have an access token.');
  return decrypt(store.access_token);
}

async function shopifyRequest(store, endpoint) {
  return axios.get(`https://${store.shop_domain}/admin/api/${API_VERSION}${endpoint}`, {
    headers: { 'X-Shopify-Access-Token': getAccessToken(store), 'Content-Type': 'application/json' },
    timeout: 30000,
    maxRedirects: 0,
  });
}

function nextPage(response) {
  const link = response.headers.link || '';
  const match = link.match(/<([^>]+)>;\s*rel="next"/);
  if (!match) return null;
  const url = new URL(match[1]);
  return `${url.pathname}${url.search}`;
}

async function fetchAll(store, endpoint, key) {
  const rows = [];
  let path = `${endpoint}${endpoint.includes('?') ? '&' : '?'}limit=${PAGE_SIZE}`;
  while (path) {
    const response = await shopifyRequest(store, path);
    rows.push(...(response.data?.[key] || []));
    path = nextPage(response);
  }
  return rows;
}

async function syncCustomers(store) {
  const customers = await fetchAll(store, '/customers.json', 'customers');
  for (const customer of customers) {
    await prisma.customers.upsert({
      where: { store_id_external_id: { store_id: store.id, external_id: String(customer.id) } },
      create: {
        store_id: store.id,
        external_id: String(customer.id),
        email: customer.email || `${customer.id}@redacted.invalid`,
        full_name: [customer.first_name, customer.last_name].filter(Boolean).join(' ') || null,
        phone: customer.phone || null,
        status: customer.state === 'disabled' ? 'inactive' : 'active',
      },
      update: {
        email: customer.email || `${customer.id}@redacted.invalid`,
        full_name: [customer.first_name, customer.last_name].filter(Boolean).join(' ') || null,
        phone: customer.phone || null,
        status: customer.state === 'disabled' ? 'inactive' : 'active',
      },
    });
  }
  return customers.length;
}

async function ensureCustomer(tx, store, customer) {
  const id = customer?.id ? String(customer.id) : `order-anonymous-${Date.now()}`;
  return tx.customers.upsert({
    where: { store_id_external_id: { store_id: store.id, external_id: id } },
    create: {
      store_id: store.id,
      external_id: id,
      email: customer?.email || `${id}@redacted.invalid`,
      full_name: [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || null,
      phone: customer?.phone || null,
    },
    update: {
      email: customer?.email || `${id}@redacted.invalid`,
      full_name: [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || null,
      phone: customer?.phone || null,
    },
  });
}

async function syncOrders(store) {
  const orders = await fetchAll(store, '/orders.json?status=any', 'orders');
  let completed = 0;
  for (const sourceOrder of orders) {
    if (sourceOrder.cancelled_at || ['cancelled', 'failed'].includes(sourceOrder.financial_status)) continue;
    const orderedAt = new Date(sourceOrder.created_at || Date.now());
    const total = Number(sourceOrder.total_price || 0);
    await prisma.$transaction(async (tx) => {
      const customer = await ensureCustomer(tx, store, sourceOrder.customer);
      const order = await tx.orders.upsert({
        where: { store_id_external_order_id: { store_id: store.id, external_order_id: String(sourceOrder.id) } },
        create: {
          store_id: store.id,
          customer_id: customer.id,
          external_order_id: String(sourceOrder.id),
          total,
          subtotal: Number(sourceOrder.subtotal_price || total),
          discount_amount: Number(sourceOrder.total_discounts || 0),
          currency: sourceOrder.currency || 'USD',
          coupon_used: Boolean(sourceOrder.discount_codes?.length),
          coupon_code: sourceOrder.discount_codes?.[0]?.code || null,
          ordered_at: orderedAt,
        },
        update: {
          customer_id: customer.id,
          total,
          subtotal: Number(sourceOrder.subtotal_price || total),
          discount_amount: Number(sourceOrder.total_discounts || 0),
          currency: sourceOrder.currency || 'USD',
          ordered_at: orderedAt,
        },
      });

      for (const item of sourceOrder.line_items || []) {
        const quantity = Math.max(1, Number(item.quantity || 1));
        const unitPrice = Number(item.price || 0);
        await tx.order_items.upsert({
          where: { store_id_external_line_item_id: { store_id: store.id, external_line_item_id: String(item.id) } },
          create: {
            order_id: order.id,
            store_id: store.id,
            external_line_item_id: String(item.id),
            external_product_id: item.product_id ? String(item.product_id) : null,
            external_variant_id: item.variant_id ? String(item.variant_id) : null,
            product_name: item.title || 'Unknown product',
            product_type: null,
            quantity,
            unit_price: unitPrice,
            line_total: unitPrice * quantity,
            ordered_at: orderedAt,
          },
          update: { quantity, unit_price: unitPrice, line_total: unitPrice * quantity, ordered_at: orderedAt },
        });
      }
    });
    completed++;
  }
  return completed;
}

async function syncAbandonedCheckouts() {
  return 0;
}

async function syncShopifyStore(store) {
  await prisma.stores.update({ where: { id: store.id }, data: { status: 'syncing' } });
  try {
    const customers = await syncCustomers(store);
    const orders = await syncOrders(store);
    const abandoned = await syncAbandonedCheckouts(store);
    await prisma.stores.update({ where: { id: store.id }, data: { status: 'active', last_synced_at: new Date() } });

    const rfm = await rfmSync({ storeId: store.id, correlationId: `shopify-sync-${store.id}-${Date.now()}` });
    if (!rfm.success) logger.warn('shopify_rfm_sync_deferred', { store_id: store.id, code: rfm.error?.code });
    logger.info('shopify_sync_completed', { store_id: store.id, customers, orders, abandoned });
    return { success: true, customers, orders, abandoned, rfm: rfm.success };
  } catch (error) {
    await prisma.stores.update({ where: { id: store.id }, data: { status: 'error' } }).catch(() => {});
    logger.error('shopify_sync_failed', { store_id: store.id, error_type: error.code || 'sync_error' });
    throw error;
  }
}

module.exports = { syncShopifyStore, syncCustomers, syncOrders };
