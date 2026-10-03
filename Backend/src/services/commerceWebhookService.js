const crypto = require('crypto');
const { prisma } = require('../configs/database');
const logger = require('../utils/logger');
const { rfmSync } = require('./mlService');

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
  const emailConsent = customer.email_marketing_consent?.state || customer.emailMarketingConsent?.marketingState;
  const smsConsent = customer.sms_marketing_consent?.state || customer.smsMarketingConsent?.marketingState;
  return {
    externalId,
    email,
    fullName: name,
    phone: customer.phone || null,
    consentEmail: emailConsent == null ? null : ['subscribed', 'SUBSCRIBED'].includes(emailConsent),
    consentSms: smsConsent == null ? null : ['subscribed', 'SUBSCRIBED'].includes(smsConsent),
  };
}

async function recalculateCustomerTotals(tx, customerId) {
  const aggregate = await tx.orders.aggregate({
    where: {
      customer_id: customerId,
      OR: [{ recovery_status: null }, { recovery_status: { not: 'cancelled' } }],
    },
    _count: { id: true },
    _sum: { total: true },
  });
  await tx.customers.update({
    where: { id: customerId },
    data: {
      orders_count: aggregate._count.id,
      ltv: aggregate._sum.total || 0,
      updated_at: new Date(),
    },
  });
}

async function upsertOrder(store, provider, payload) {
  const customer = customerData(provider, payload);
  const orderExternalId = String(payload.id || payload.order_id);
  const orderDate = new Date(payload.created_at || payload.date_created || Date.now());
  const total = Number(payload.total_price ?? payload.total ?? 0);
  const subtotal = Number(payload.subtotal_price ?? payload.subtotal ?? total);
  const discountAmount = Math.max(0, Number(payload.total_discounts ?? payload.discount_total ?? 0));
  const discountPct = subtotal > 0 ? Math.min(100, (discountAmount / subtotal) * 100) : 0;
  const couponCode = payload.discount_codes?.[0]?.code || payload.coupon_lines?.[0]?.code || null;
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
        consent_email: customer.consentEmail ?? false,
        consent_sms: customer.consentSms ?? false,
        consent_updated_at: customer.consentEmail == null && customer.consentSms == null ? null : new Date(),
      },
      update: {
        email: customer.email,
        full_name: customer.fullName,
        phone: customer.phone,
        ...(customer.consentEmail == null ? {} : { consent_email: customer.consentEmail }),
        ...(customer.consentSms == null ? {} : { consent_sms: customer.consentSms }),
        ...(customer.consentEmail == null && customer.consentSms == null ? {} : { consent_updated_at: new Date() }),
      },
    });

    const order = await tx.orders.upsert({
      where: { store_id_external_order_id: { store_id: store.id, external_order_id: orderExternalId } },
      create: {
        store_id: store.id,
        customer_id: dbCustomer.id,
        external_order_id: orderExternalId,
        total,
        subtotal,
        discount_amount: discountAmount,
        discount_pct: discountPct,
        currency,
        coupon_used: Boolean(payload.discount_codes?.length || payload.coupon_lines?.length),
        coupon_code: couponCode,
        ordered_at: orderDate,
        recovery_status: 'completed',
      },
      update: {
        customer_id: dbCustomer.id,
        total,
        currency,
        ordered_at: orderDate,
        recovery_status: 'completed',
        subtotal,
        discount_amount: discountAmount,
        discount_pct: discountPct,
        coupon_used: Boolean(payload.discount_codes?.length || payload.coupon_lines?.length),
        coupon_code: couponCode,
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

    const externalCartId = payload.checkout_id || payload.cart_token || payload.checkout_token;
    let cart = null;
    if (externalCartId) {
      cart = await tx.abandoned_carts.findFirst({
        where: { store_id: store.id, external_cart_id: String(externalCartId) },
        select: { id: true, session_id: true },
      });
    }
    if (!cart && couponCode) {
      const recoverySend = await tx.sequence_sends.findFirst({
        where: {
          store_id: store.id,
          metadata: { path: ['discount_code'], equals: couponCode },
        },
        orderBy: { sent_at: 'desc' },
        select: { metadata: true },
      });
      const cartId = recoverySend?.metadata?.abandoned_cart_id;
      if (cartId) {
        cart = await tx.abandoned_carts.findFirst({
          where: { id: cartId, store_id: store.id },
          select: { id: true, session_id: true },
        });
      }
    }
    if (cart) {
      await tx.abandoned_carts.update({
        where: { id: cart.id },
        data: { status: 'recovered', recovered_at: orderDate, updated_at: new Date() },
      });
      await tx.orders.update({
        where: { id: order.id },
        data: {
          abandoned_cart_id: cart.id,
          session_id: cart.session_id,
          recovery_status: 'recovered',
        },
      });
    }
    await recalculateCustomerTotals(tx, dbCustomer.id);
    return order;
  });
}

async function cancelOrder(store, payload) {
  const externalOrderId = String(payload.id || payload.order_id || '');
  if (!externalOrderId) return null;
  return prisma.$transaction(async (tx) => {
    const order = await tx.orders.findUnique({
      where: { store_id_external_order_id: { store_id: store.id, external_order_id: externalOrderId } },
    });
    if (!order) return null;
    await tx.orders.update({ where: { id: order.id }, data: { recovery_status: 'cancelled' } });
    await recalculateCustomerTotals(tx, order.customer_id);
    return order;
  });
}

async function upsertAbandonedCart(store, payload) {
  const externalId = String(payload.id || payload.checkout_id || payload.cart_token || '');
  if (!externalId) return null;
  const customer = payload.customer ? customerData(store.platform, payload) : null;
  const dbCustomer = customer
    ? await prisma.customers.upsert({
        where: { store_id_external_id: { store_id: store.id, external_id: customer.externalId } },
        create: {
          store_id: store.id, external_id: customer.externalId, email: customer.email,
          full_name: customer.fullName, phone: customer.phone,
          consent_email: customer.consentEmail ?? false, consent_sms: customer.consentSms ?? false,
        },
        update: {
          email: customer.email, full_name: customer.fullName, phone: customer.phone,
          ...(customer.consentEmail == null ? {} : { consent_email: customer.consentEmail }),
          ...(customer.consentSms == null ? {} : { consent_sms: customer.consentSms }),
        },
      })
    : null;
  const existing = await prisma.abandoned_carts.findFirst({
    where: { store_id: store.id, external_cart_id: externalId },
  });
  const data = {
    store_id: store.id,
    customer_id: dbCustomer?.id || null,
    external_cart_id: externalId,
    recovery_url: payload.abandoned_checkout_url || payload.recovery_url || null,
    cart_value: Number(payload.total_price ?? payload.total ?? 0),
    currency: payload.currency || 'USD',
    status: payload.completed_at ? 'recovered' : 'abandoned',
    abandoned_at: new Date(payload.created_at || Date.now()),
    recovered_at: payload.completed_at ? new Date(payload.completed_at) : null,
    updated_at: new Date(),
  };
  return existing
    ? prisma.abandoned_carts.update({ where: { id: existing.id }, data })
    : prisma.abandoned_carts.create({ data });
}

async function upsertCustomer(store, payload) {
  const customer = customerData('provider', payload);
  return prisma.customers.upsert({
    where: { store_id_external_id: { store_id: store.id, external_id: customer.externalId } },
    create: {
      store_id: store.id, external_id: customer.externalId, email: customer.email,
      full_name: customer.fullName, phone: customer.phone,
      consent_email: customer.consentEmail ?? false, consent_sms: customer.consentSms ?? false,
    },
    update: {
      email: customer.email, full_name: customer.fullName, phone: customer.phone,
      ...(customer.consentEmail == null ? {} : { consent_email: customer.consentEmail }),
      ...(customer.consentSms == null ? {} : { consent_sms: customer.consentSms }),
      ...(customer.consentEmail == null && customer.consentSms == null ? {} : { consent_updated_at: new Date() }),
    },
  });
}

async function processCommerceWebhook({ provider, store, topic, payload }) {
  const normalizedTopic = String(topic || '').toLowerCase();
  if (normalizedTopic === 'app/uninstalled') {
    await prisma.stores.update({ where: { id: store.id }, data: { status: 'inactive', access_token: null } });
    return { action: 'store_deactivated' };
  }
  if (normalizedTopic.includes('customers/') || normalizedTopic.includes('customer.')) {
    await upsertCustomer(store, payload);
    return { action: 'customer_upserted' };
  }
  if (normalizedTopic.includes('checkouts/') || normalizedTopic.includes('cart.')) {
    const cart = await upsertAbandonedCart(store, payload);
    return { action: 'cart_upserted', cartId: cart?.id || null };
  }
  if (normalizedTopic.includes('orders/cancelled') || normalizedTopic.includes('orders/delete') ||
      normalizedTopic.includes('order.deleted') || payload.cancelled_at) {
    const order = await cancelOrder(store, payload);
    return { action: 'order_cancelled', orderId: order?.id || null };
  }
  if (normalizedTopic.includes('orders/') || normalizedTopic.includes('order.')) {
    const order = await upsertOrder(store, provider, payload);
    const rfm = await rfmSync({
      storeId: store.id,
      correlationId: `commerce-webhook-${store.id}-${order.id}`,
    });
    if (!rfm.success) logger.warn('commerce_rfm_sync_deferred', { store_id: store.id, code: rfm.error?.code });
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
  cancelOrder,
  recalculateCustomerTotals,
  upsertAbandonedCart,
  upsertOrder,
  verifyShopifySignature,
  verifyWooCommerceSignature,
};
