const crypto = require('crypto');
const { prisma } = require('../configs/database');
const logger = require('../utils/logger');

function safeCompareHex(actual, expected) {
  if (!actual || !expected || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function verifySignature(rawBody, signature, secret, encoding = 'base64') {
  if (!rawBody || !signature || !secret) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest(encoding);
  return encoding === 'hex' ? safeCompareHex(signature, digest) : safeCompareHex(Buffer.from(signature).toString('hex'), Buffer.from(digest).toString('hex'));
}

function verifyShopifySignature(rawBody, signature) {
  return verifySignature(rawBody, signature, process.env.SHOPIFY_API_SECRET, 'base64');
}

function verifyWooCommerceSignature(rawBody, signature) {
  return verifySignature(rawBody, signature, process.env.WOOCOMMERCE_WEBHOOK_SECRET, 'base64');
}

async function findStore(provider, domain) {
  if (!domain) return null;
  return prisma.stores.findFirst({
    where: {
      platform: provider,
      shop_domain: domain,
      status: { not: 'deleted' },
    },
  });
}

async function claimDelivery(provider, deliveryId, storeId, topic) {
  try {
    return await prisma.webhook_deliveries.create({
      data: { provider, delivery_id: deliveryId, store_id: storeId, topic },
    });
  } catch (error) {
    if (error.code === 'P2002') return null;
    throw error;
  }
}

function customerData(provider, payload) {
  const customer = payload.customer || {};
  const externalId = String(customer.id || payload.customer_id || `order:${payload.id}`);
  const email = customer.email || payload.email || `${externalId}@redacted.invalid`;
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || null;
  return { externalId, email, fullName: name, phone: customer.phone || null };
}

async function upsertOrder(store, provider, payload) {
  const customer = customerData(provider, payload);
  const orderExternalId = String(payload.id || payload.order_id);
  const orderDate = new Date(payload.created_at || payload.date_created || Date.now());
  const total = Number(payload.total_price ?? payload.total ?? 0);
  const currency = payload.currency || 'USD';
  const lineItems = payload.line_items || payload.products || [];

  return prisma.$transaction(async (tx) => {
    const dbCustomer = await tx.customers.upsert({
      where: { store_id_external_id: { store_id: store.id, external_id: customer.externalId } },
      create: {
        store_id: store.id,
        external_id: customer.externalId,
        email: customer.email,
        full_name: customer.fullName,
        phone: customer.phone,
      },
      update: {
        email: customer.email,
        full_name: customer.fullName,
        phone: customer.phone,
      },
    });

    const order = await tx.orders.upsert({
      where: { store_id_external_order_id: { store_id: store.id, external_order_id: orderExternalId } },
      create: {
        store_id: store.id,
        customer_id: dbCustomer.id,
        external_order_id: orderExternalId,
        total,
        subtotal: Number(payload.subtotal_price ?? payload.subtotal ?? total),
        discount_amount: Number(payload.total_discounts ?? payload.discount_total ?? 0),
        currency,
        coupon_used: Boolean(payload.discount_codes?.length || payload.coupon_lines?.length),
        ordered_at: orderDate,
      },
      update: {
        customer_id: dbCustomer.id,
        total,
        currency,
        ordered_at: orderDate,
      },
    });

    for (const item of lineItems) {
      const externalLineItemId = String(item.id || item.line_item_id || `${orderExternalId}:${item.product_id || item.name}`);
      const quantity = Math.max(1, Number(item.quantity || 1));
      const unitPrice = Number(item.price || item.unit_price || 0);
      await tx.order_items.upsert({
        where: { store_id_external_line_item_id: { store_id: store.id, external_line_item_id: externalLineItemId } },
        create: {
          order_id: order.id,
          store_id: store.id,
          external_line_item_id: externalLineItemId,
          external_product_id: item.product_id ? String(item.product_id) : null,
          external_variant_id: item.variant_id ? String(item.variant_id) : null,
          product_name: item.title || item.name || 'Unknown product',
          quantity,
          unit_price: unitPrice,
          line_total: unitPrice * quantity,
          ordered_at: orderDate,
        },
        update: { quantity, unit_price: unitPrice, line_total: unitPrice * quantity, ordered_at: orderDate },
      });
    }

    await tx.customers.update({
      where: { id: dbCustomer.id },
      data: { orders_count: { increment: 1 }, ltv: { increment: total } },
    });
    return order;
  });
}

async function upsertCustomer(store, payload) {
  const customer = customerData('provider', payload);
  return prisma.customers.upsert({
    where: { store_id_external_id: { store_id: store.id, external_id: customer.externalId } },
    create: { store_id: store.id, external_id: customer.externalId, email: customer.email, full_name: customer.fullName, phone: customer.phone },
    update: { email: customer.email, full_name: customer.fullName, phone: customer.phone },
  });
}

async function processCommerceWebhook({ provider, store, topic, payload }) {
  if (topic === 'app/uninstalled') {
    await prisma.stores.update({ where: { id: store.id }, data: { status: 'inactive', access_token: null } });
    return { action: 'store_deactivated' };
  }
  if (topic.includes('customers/') || topic.includes('customer.')) {
    await upsertCustomer(store, payload);
    return { action: 'customer_upserted' };
  }
  if (topic.includes('orders/') || topic.includes('order.')) {
    const order = await upsertOrder(store, provider, payload);
    return { action: 'order_upserted', orderId: order.id };
  }
  return { action: 'ignored_topic' };
}

async function markDelivery(deliveryId, status, errorMessage = null) {
  await prisma.webhook_deliveries.update({
    where: { id: deliveryId },
    data: { status, processed_at: status === 'processed' ? new Date() : null, last_error: errorMessage?.slice(0, 500) || null },
  });
}

module.exports = {
  findStore,
  claimDelivery,
  markDelivery,
  processCommerceWebhook,
  verifyShopifySignature,
  verifyWooCommerceSignature,
};
