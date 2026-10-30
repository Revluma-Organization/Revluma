const crypto = require('crypto');
const { prisma } = require('../configs/database');
const logger = require('../utils/logger');
const { rfmSync } = require('./mlService');
const { lastCheckoutActivity, nextCheckoutStatus } = require('./checkoutInactivity');

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
    if (error.code === 'P2002') {
      const retry = await prisma.webhook_deliveries.updateMany({
        where: { provider, delivery_id: deliveryId, status: 'failed' },
        data: { status: 'received', last_error: null, received_at: new Date() },
      });
      if (!retry.count) return null;
      return prisma.webhook_deliveries.findUnique({
        where: { provider_delivery_id: { provider, delivery_id: deliveryId } },
      });
    }
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

/**
 * Shopify orders/update webhooks retain the original total_price after refunds.
 * Refund transactions are authoritative for cash refunded; ignore pending or
 * failed transactions and do not subtract the order's current_total_price twice.
 * Return null for malformed refund evidence rather than inventing net revenue.
 */
function shopifyNetOrderTotal(payload) {
  const gross = Number(payload.total_price);
  if (!Number.isFinite(gross) || gross < 0) return null;
  if (!Array.isArray(payload.refunds) || payload.refunds.length === 0) return gross;
  let refunded = 0;
  for (const refund of payload.refunds) {
    if (!Array.isArray(refund.transactions)) return null;
    for (const transaction of refund.transactions) {
      if (String(transaction.kind || '').toLowerCase() !== 'refund') continue;
      if (String(transaction.status || '').toLowerCase() !== 'success') continue;
      const amount = Number(transaction.amount);
      if (!Number.isFinite(amount) || amount < 0) return null;
      refunded += amount;
    }
  }
  return Math.max(0, Math.round((gross - refunded) * 100) / 100);
}

// Task 025: safe, bounded diagnostic identity. Never persist customer details or raw payloads.
const RECONCILIATION_REASONS = new Set([
  'CHECKOUT_NOT_FOUND', 'MISSING_AUTHORITATIVE_IDENTIFIER', 'NO_VERIFIED_MATCH',
  'AMBIGUOUS_CANDIDATES', 'CONFLICTING_IDENTIFIERS', 'MERCHANT_MISMATCH',
]);
function reconciliationSourceIdentifier(values) {
  const value = values.find((v) => v !== null && v !== undefined && String(v).trim());
  return value === undefined ? null : String(value).slice(0, 255);
}
async function recordOrderReconciliationCase(tx, { storeId, orderId, reason, sourceIdentifier = null, candidateCount = 0, verifiedCheckoutId = null, preserveConflict = false }) {
  if (!RECONCILIATION_REASONS.has(reason)) throw new Error('Unsupported reconciliation reason');
  const order = await tx.orders.findFirst({ where: { id: orderId, store_id: storeId }, select: { id: true, abandoned_cart_id: true } });
  if (!order) throw new Error('Reconciliation order does not belong to store');
  if (verifiedCheckoutId) {
    if (order.abandoned_cart_id !== verifiedCheckoutId) throw new Error('Cannot resolve without persisted verified checkout');
    return tx.order_checkout_reconciliation_cases.updateMany({
      where: { store_id: storeId, order_id: orderId, status: 'UNRESOLVED' },
      data: { status: 'RESOLVED', resolved_at: new Date(), verified_checkout_id: verifiedCheckoutId, last_observed_at: new Date() },
    });
  }
  // Once verified, delayed unresolved webhook evidence must never reopen the case.
  if (order.abandoned_cart_id && !preserveConflict) return null;
  const now = new Date();
  return tx.order_checkout_reconciliation_cases.upsert({
    where: { store_id_order_id: { store_id: storeId, order_id: orderId } },
    create: { store_id: storeId, order_id: orderId, reason, source_identifier: sourceIdentifier, candidate_count: candidateCount, status: 'UNRESOLVED', first_observed_at: now, last_observed_at: now },
    update: { reason, source_identifier: sourceIdentifier, candidate_count: candidateCount, last_observed_at: now, attempt_count: { increment: 1 }, ...(preserveConflict ? { status: 'UNRESOLVED', resolved_at: null, verified_checkout_id: null } : {}) },
  });
}

function sourceIdentifiers(payload, kind = 'checkout') {
  // Do not coerce objects or unsafe JS numbers into invented Shopify identities.
  const valid = (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new Error('Unsafe Shopify identifier number');
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'bigint') throw new Error('Invalid Shopify identifier type');
    return String(v) || null;
  };
  return {
    source_checkout_id: valid(payload.checkout_id ?? (kind === 'checkout' ? payload.id : null)),
    source_checkout_token: valid(payload.checkout_token ?? (kind === 'checkout' ? payload.token : null)),
    source_cart_token: valid(payload.cart_token),
  };
}

function mergeSourceEvidence(existing, incoming) {
  const data = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null) continue;
    if (existing?.[key] && existing[key] !== value) {
      // Abort the transaction rather than silently overwriting evidence.
      const error = new Error('Conflicting Shopify source identifier');
      error.code = 'SOURCE_IDENTIFIER_CONFLICT';
      error.identifier_type = key;
      throw error;
    }
    if (!existing?.[key]) data[key] = value;
  }
  return data;
}

async function upsertOrder(store, provider, payload) {
  const customer = customerData(provider, payload);
  const orderExternalId = String(payload.id || payload.order_id);
  const orderDate = new Date(payload.created_at || payload.date_created || Date.now());
  const calculated = provider === 'shopify' ? shopifyNetOrderTotal(payload) : Number(payload.total_price ?? payload.total ?? 0);
  if (calculated === null || !Number.isFinite(calculated)) {
    const error = new Error('Order financial totals cannot be verified');
    error.code = 'ORDER_FINANCIAL_TOTAL_UNVERIFIED';
    throw error;
  }
  const total = calculated;
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

    const existingOrder = await tx.orders.findFirst({ where: { store_id: store.id, external_order_id: orderExternalId }, select: { source_checkout_id: true, source_checkout_token: true, source_cart_token: true } });
    const orderEvidence = sourceIdentifiers(payload, 'order');
    const safeOrderEvidence = mergeSourceEvidence(existingOrder, orderEvidence);
    const order = await tx.orders.upsert({
      where: { store_id_external_order_id: { store_id: store.id, external_order_id: orderExternalId } },
      create: {
        store_id: store.id,
        customer_id: dbCustomer.id,
        external_order_id: orderExternalId,
        ...orderEvidence,
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
        ...safeOrderEvidence,
        total,
        currency,
        ordered_at: orderDate,
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

    // Task 024: persist only an unambiguous merchant-scoped authoritative identity.
    // The checkout ingestion currently stores one identifier in external_cart_id;
    // do not infer a match from customer, email, amount, time, or coupon evidence.
    // Task 026: evaluate each identifier independently; never let a first match
    // hide contradictory checkout-ID / checkout-token evidence.
    const normalized = (value) => {
      if (value === null || value === undefined) return null;
      // Do not pass Shopify IDs through Number: large identifiers lose precision.
      const string = String(value).trim();
      return string || null;
    };
    const evidence = [
      ['checkout_id', normalized(payload.checkout_id)],
      ['checkout_token', normalized(payload.checkout_token)],
      ['cart_token', normalized(payload.cart_token)],
    ].filter(([, value]) => value);
    const lookups = new Map();
    const typedColumns = { checkout_id: 'source_checkout_id', checkout_token: 'source_checkout_token', cart_token: 'source_cart_token' };
    for (const [type, identifier] of evidence) {
      const rows = await tx.abandoned_carts.findMany({
        where: { store_id: store.id, [typedColumns[type]]: identifier },
        select: { id: true, store_id: true, session_id: true, external_cart_id: true },
        take: 2,
      });
      lookups.set(type, rows);
    }
    const strong = evidence.filter(([type]) => type !== 'cart_token');
    const evaluated = strong.length ? strong : evidence;
    const hits = evaluated.flatMap(([type]) => lookups.get(type) || []);
    const candidates = [...new Map(hits.map((row) => [row.id, row])).values()];
    const duplicateIdentity = evaluated.some(([type]) => (lookups.get(type) || []).length > 1);
    const strongResolved = strong.filter(([type]) => (lookups.get(type) || []).length === 1);
    const conflictingStrong = strongResolved.length > 1 &&
      new Set(strongResolved.map(([type]) => lookups.get(type)[0].id)).size > 1;
    const cartResolved = evidence.filter(([type]) => type === 'cart_token' && (lookups.get(type) || []).length === 1);
    const cartConflict = strongResolved.length && cartResolved.length && strongResolved.some(([type]) => cartResolved.some(([cartType]) => lookups.get(type)[0].id !== lookups.get(cartType)[0].id));
    const conflict = Boolean(conflictingStrong || cartConflict);
    const ambiguous = duplicateIdentity || (!conflict && candidates.length > 1);
    const candidate = !conflict && !ambiguous && candidates.length === 1 ? candidates[0] : null;
    const current = await tx.orders.findFirst({
      where: { id: order.id, store_id: store.id },
      select: { abandoned_cart_id: true },
    });
    const relationshipConflict = Boolean(candidate && current?.abandoned_cart_id && current.abandoned_cart_id !== candidate.id);
    const reason = conflict || relationshipConflict ? 'CONFLICTING_IDENTIFIERS'
      : ambiguous ? 'AMBIGUOUS_CANDIDATES'
      : !evidence.length ? 'MISSING_AUTHORITATIVE_IDENTIFIER'
      : 'CHECKOUT_NOT_FOUND';
    if (conflict || relationshipConflict) {
      await recordOrderReconciliationCase(tx, {
        storeId: store.id, orderId: order.id, reason: 'CONFLICTING_IDENTIFIERS',
        sourceIdentifier: reconciliationSourceIdentifier(evidence.map(([, value]) => value)),
        candidateCount: candidates.length, preserveConflict: true,
      });
    } else if (candidate) {
      // Task 027: serialize checkout claims in PostgreSQL before reading ownership.
      // Advisory transaction lock is scoped to the checkout UUID; it releases on
      // commit/rollback and prevents the read-then-write race between workers.
      // No blanket unique constraint until real Shopify cardinality and legacy
      // multi-claim data have been assessed (Task027 cardinality limitation).
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.id}::text, 0))::text AS lock_acquired`;
      const checkout = await tx.abandoned_carts.findFirst({
        where: { id: candidate.id, store_id: store.id }, select: { id: true },
      });
      if (!checkout) throw new Error('Checkout ownership merchant mismatch');
      const owners = await tx.orders.findMany({
        where: { store_id: store.id, abandoned_cart_id: candidate.id, id: { not: order.id } },
        select: { id: true, external_order_id: true }, take: 2,
      });
      // Even duplicate local representations of one Shopify order must not
      // create a second physical FK claim; preserve both records for review.
      if (owners.length) {
        await recordOrderReconciliationCase(tx, {
          storeId: store.id, orderId: order.id, reason: 'CONFLICTING_IDENTIFIERS',
          sourceIdentifier: reconciliationSourceIdentifier(evidence.map(([, value]) => value)),
          candidateCount: owners.length, preserveConflict: true,
        });
      } else {
      // Atomic compare-and-set prevents a competing worker overwriting the FK.
      const written = await tx.orders.updateMany({
        where: { id: order.id, store_id: store.id, abandoned_cart_id: null },
        data: { abandoned_cart_id: candidate.id, session_id: candidate.session_id },
      });
      if (!written.count) {
        const latest = await tx.orders.findFirst({
          where: { id: order.id, store_id: store.id }, select: { abandoned_cart_id: true },
        });
        if (latest?.abandoned_cart_id !== candidate.id) {
          await recordOrderReconciliationCase(tx, {
            storeId: store.id, orderId: order.id, reason: 'CONFLICTING_IDENTIFIERS',
            sourceIdentifier: reconciliationSourceIdentifier(evidence.map(([, value]) => value)),
            candidateCount: candidates.length, preserveConflict: true,
          });
        } else {
          await recordOrderReconciliationCase(tx, { storeId: store.id, orderId: order.id, reason: 'NO_VERIFIED_MATCH', verifiedCheckoutId: candidate.id });
        }
      } else {
        await recordOrderReconciliationCase(tx, { storeId: store.id, orderId: order.id, reason: 'NO_VERIFIED_MATCH', verifiedCheckoutId: candidate.id });
      }
      }
    } else if (!current?.abandoned_cart_id) {
      await recordOrderReconciliationCase(tx, {
        storeId: store.id, orderId: order.id, reason,
        sourceIdentifier: reconciliationSourceIdentifier(evidence.map(([, value]) => value)),
        candidateCount: candidates.length,
      });
    }
    // Do not mutate checkout lifecycle or claim recovered revenue here:
    // relationship persistence is independent from attribution (Tasks 029, 046–047).
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
  const externalId = String(payload.checkout_id || payload.id || payload.cart_token || payload.checkout_token || '');
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
  return prisma.$transaction(async (tx) => {
  // Serialize writes for the same store/checkout, even across parallel webhook workers.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${store.id}), hashtext(${externalId}))::text AS locked`;
  const existing = await tx.abandoned_carts.findFirst({
    where: { store_id: store.id, external_cart_id: externalId },
  });
  // Checkout webhooks describe activity, not abandonment. Wait 15 minutes after the last event.
  // Completed checkouts remain recovered and must never be reopened by delayed events.
  const activityAt = lastCheckoutActivity(payload);
  const isStaleEvent = existing?.updated_at && activityAt < existing.updated_at;
  if (isStaleEvent && !payload.completed_at) return existing;
  const safeCheckoutEvidence = mergeSourceEvidence(existing, sourceIdentifiers(payload, 'checkout'));
  const data = {
    store_id: store.id,
    customer_id: dbCustomer?.id || null,
    external_cart_id: externalId,
    ...safeCheckoutEvidence,
    recovery_url: payload.abandoned_checkout_url || payload.recovery_url || null,
    cart_value: Number(payload.total_price ?? payload.total ?? 0),
    currency: payload.currency || 'USD',
    status: nextCheckoutStatus({ completedAt: payload.completed_at, existingStatus: existing?.status, isStale: isStaleEvent }),
    abandoned_at: existing?.abandoned_at || new Date(payload.created_at || Date.now()),
    recovered_at: payload.completed_at ? new Date(payload.completed_at) : (existing?.recovered_at || null),
    updated_at: activityAt,
  };
  const cart = existing
    ? await tx.abandoned_carts.update({ where: { id: existing.id }, data })
    : await tx.abandoned_carts.create({ data });
  // Webhooks can arrive before the periodic Shopify sync. Persist available
  // product context immediately; an empty payload must not erase known items.
  const items = Array.isArray(payload.line_items) ? payload.line_items : [];
  if (items.length) {
    await tx.abandoned_cart_items.deleteMany({ where: { abandoned_cart_id: cart.id } });
    await tx.abandoned_cart_items.createMany({
      data: items.map((item) => ({
        abandoned_cart_id: cart.id,
        external_product_id: String(item.product_id || 'unknown'),
        external_variant_id: item.variant_id ? String(item.variant_id) : null,
        product_name: String(item.title || item.name || 'Unknown product'),
        price: Number(item.price || 0),
        quantity: Math.max(1, Number(item.quantity || 1)),
      })),
    });
  }
  return cart;
  });
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
    await prisma.stores.update({
      where: { id: store.id },
      data: { status: 'inactive', access_token: null, updated_at: new Date() },
    });
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
  shopifyNetOrderTotal,
  findStore,
  claimDelivery,
  markDelivery,
  processCommerceWebhook,
  cancelOrder,
  recalculateCustomerTotals,
  upsertAbandonedCart,
  upsertOrder,
  recordOrderReconciliationCase,
  verifyShopifySignature,
  verifyWooCommerceSignature,
};
