const crypto = require('crypto');
const { prisma } = require('../configs/database');
const logger = require('../utils/logger');
const { rfmSync } = require('./mlService');
const { lastCheckoutActivity, nextCheckoutStatus } = require('./checkoutInactivity');
const { shopifyNetOrderTotal, shopifyRefundedAmount } = require('./shopifyOrderFinancials');
const {
  computeCustomerLifetimeValue,
  normalizeCurrency,
  reconcileOrderMoney,
  parseAmount,
  requireCurrency,
  resolveOrderRecoveryStatus,
} = require('./financialIntegrity');
const { isPrivacyTopic, handleShopifyPrivacyWebhook } = require('./privacyWebhookService');

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
  const normalized = String(domain).trim().toLowerCase();
  // WooCommerce store rows predate normalization and may keep the scheme
  // prefix, while provider headers may arrive scheme-stripped depending on the
  // caller. Match bare and https-prefixed candidate forms both directions;
  // the ambiguity check below still fails closed when more than one tenant wins.
  const stripped = normalized.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const candidates = [...new Set([normalized, stripped, `https://${stripped}`])];
  const matches = await prisma.stores.findMany({
    where: {
      platform: provider,
      shop_domain: { in: candidates },
      status: { not: 'deleted' },
    },
  });
  if (matches.length > 1) {
    // Cross-merchant domain collision: the domain alone cannot identify the
    // tenant, so any write would land in an arbitrary organization. Fail
    // closed instead of acknowledging data into the wrong tenant; the caller
    // returns an error so the provider retries once the conflict is resolved.
    logger.error('commerce_webhook_store_resolution_ambiguous', {
      provider,
      shop_domain: normalized,
      match_count: matches.length,
    });
    throw Object.assign(new Error('Webhook store resolution is ambiguous'), { code: 'WEBHOOK_STORE_AMBIGUOUS' });
  }
  return matches[0] || null;
}

async function claimDelivery(provider, deliveryId, storeId, topic) {
  try {
    return await prisma.webhook_deliveries.create({
      data: { provider, delivery_id: deliveryId, store_id: storeId, topic, last_attempt_at: new Date(), attempt_count: 1 },
    });
  } catch (error) {
    if (error.code === 'P2002') {
      const key = { provider_delivery_id: { provider, delivery_id: deliveryId } };
      const existing = await prisma.webhook_deliveries.findUnique({ where: key });
      if (!existing || existing.store_id !== storeId || existing.topic !== topic) {
        throw Object.assign(new Error('Webhook delivery identity does not match'), { code: 'WEBHOOK_DELIVERY_IDENTITY_MISMATCH' });
      }
      if (existing.status === 'processed') {
        const duplicateData = { duplicate_count: { increment: 1 }, last_attempt_at: new Date() };
        if (typeof prisma.webhook_deliveries.update === 'function') {
          await prisma.webhook_deliveries.update({ where: key, data: duplicateData });
        } else {
          await prisma.webhook_deliveries.updateMany({ where: { id: existing.id }, data: duplicateData });
        }
        return null;
      }
      if (existing.status === 'failed') {
        const retry = await prisma.webhook_deliveries.updateMany({
          where: { provider, delivery_id: deliveryId, store_id: storeId, topic, status: 'failed' },
          data: { status: 'received', last_error: null, failed_at: null, last_attempt_at: new Date(), attempt_count: { increment: 1 }, received_at: new Date() },
        });
        if (retry.count) {
          const claimed = await prisma.webhook_deliveries.findUnique({ where: key });
          if (!claimed || claimed.store_id !== storeId || claimed.topic !== topic || claimed.status !== 'received') {
            throw Object.assign(new Error('Webhook delivery claim could not be verified'), { code: 'WEBHOOK_DELIVERY_CLAIM_UNVERIFIED' });
          }
          return claimed;
        }
        const latest = await prisma.webhook_deliveries.findUnique({ where: key });
        if (latest?.store_id === storeId && latest.topic === topic && latest.status === 'processed') return null;
      }
      // A received/in-flight delivery is not proof of success. Returning 2xx
      // here can lose an event after a crash, so request a later retry instead.
      throw Object.assign(new Error('Webhook delivery is still pending'), { code: 'WEBHOOK_DELIVERY_PENDING' });
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
  // Lifetime value must never mix currencies. The aggregate is computed in
  // application code from currency-tagged orders; a mixed-currency customer is
  // stored with a null LTV and an explicit mixed-currency marker.
  const orders = await tx.orders.findMany({
    where: {
      customer_id: customerId,
      OR: [{ recovery_status: null }, { recovery_status: { not: 'cancelled' } }],
    },
    select: { total: true, currency: true, recovery_status: true },
  });
  const normalised = orders.map((order) => ({
    total: order.total == null ? null : String(order.total),
    currency: order.currency,
    recovery_status: order.recovery_status,
  }));
  const ltv = computeCustomerLifetimeValue(normalised);
  await tx.customers.update({
    where: { id: customerId },
    data: {
      orders_count: ltv.orders_count,
      ltv: ltv.ltv,
      ltv_currency: ltv.ltv_currency,
      ltv_mixed_currency: ltv.mixed_currency,
      updated_at: new Date(),
    },
  });
  return ltv;
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


function bestEffortOrderGid(payload) {
  // Shopify webhook bodies include admin_graphql_api_id; if absent, derive the
  // standard Order GID from the numeric resource id. Never guess for other gid kinds.
  const provided = payload?.admin_graphql_api_id;
  if (typeof provided === 'string' && provided.startsWith('gid://shopify/Order/')) return provided;
  const raw = payload?.id;
  if (/^\d{6,}$/.test(String(raw || ''))) return `gid://shopify/Order/${raw}`;
  return null;
}

async function upsertOrder(store, provider, payload) {
  const customer = customerData(provider, payload);
  const orderExternalId = String(payload.id || payload.order_id);
  const orderDate = new Date(payload.created_at || payload.date_created || Date.now());
  const calculated = provider === 'shopify'
    ? shopifyNetOrderTotal(payload)
    : parseAmount(payload.total_price ?? payload.total);
  if (calculated === null || !Number.isFinite(calculated)) {
    const error = new Error('Order financial totals cannot be verified');
    error.code = 'ORDER_FINANCIAL_TOTAL_UNVERIFIED';
    throw error;
  }
  const total = calculated;
  // Never substitute USD or zero for a missing currency/amount. A malformed
  // financial record fails closed rather than corrupting revenue or LTV.
  const currency = requireCurrency(payload.currency ?? payload.currency_code, {
    code: 'ORDER_CURRENCY_UNVERIFIED', context: 'order',
  });
  const rawSubtotal = payload.subtotal_price ?? payload.subtotal;
  const subtotalValue = rawSubtotal == null ? total : parseAmount(rawSubtotal);
  if (subtotalValue === null) {
    const error = new Error('Order subtotal cannot be verified');
    error.code = 'ORDER_SUBTOTAL_UNVERIFIED';
    throw error;
  }
  const rawDiscount = payload.total_discounts ?? payload.discount_total;
  const discountValue = rawDiscount == null ? 0 : parseAmount(rawDiscount);
  if (discountValue === null) {
    const error = new Error('Order discount cannot be verified');
    error.code = 'ORDER_DISCOUNT_UNVERIFIED';
    throw error;
  }
  const subtotal = subtotalValue;
  const discountAmount = Math.max(0, discountValue);
  const discountPct = subtotal > 0 ? Math.min(100, (discountAmount / subtotal) * 100) : 0;
  const couponCode = payload.discount_codes?.[0]?.code || payload.coupon_lines?.[0]?.code || null;
  const lineItems = payload.line_items || payload.products || [];
  // `orders.total` is net of refunds; the refunded amount is kept alongside it so
  // gross value can be reconstructed (net + refunded) instead of guessed. A null
  // here means the payload carried no verifiable refund evidence.
  const refundedTotal = shopifyRefundedAmount(payload);

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

    const existingOrder = await tx.orders.findFirst({
      where: { store_id: store.id, external_order_id: orderExternalId },
      select: {
        source_checkout_id: true, source_checkout_token: true, source_cart_token: true,
        recovery_status: true, total: true, refunded_total: true,
      },
    });
    // A cancellation observed before the order row existed is a tombstone.
    // It must survive a delayed create/update and keep the order out of revenue.
    const cancellationTombstone = await tx.order_cancellation_tombstones.findUnique({
      where: { store_id_external_order_id: { store_id: store.id, external_order_id: orderExternalId } },
      select: { observed_at: true },
    });
    const recoveryStatus = resolveOrderRecoveryStatus({
      existing: existingOrder, tombstone: cancellationTombstone,
    });
    const orderEvidence = sourceIdentifiers(payload, 'order');
    let sourceConflict = false;
    let safeOrderEvidence;
    try {
      safeOrderEvidence = mergeSourceEvidence(existingOrder, orderEvidence);
    } catch (error) {
      if (error.code !== 'SOURCE_IDENTIFIER_CONFLICT') throw error;
      // Keep original evidence and persist a reconciliation conflict in the
      // same transaction; do not lose the diagnostic to a rollback.
      sourceConflict = true;
      safeOrderEvidence = {};
    }
    const reconciled = reconcileOrderMoney({
      incomingNet: total,
      incomingRefunded: refundedTotal,
      storedRefunded: existingOrder?.refunded_total ?? null,
    });
    const order = await tx.orders.upsert({
      where: { store_id_external_order_id: { store_id: store.id, external_order_id: orderExternalId } },
      create: {
        store_id: store.id,
        customer_id: dbCustomer.id,
        external_order_id: orderExternalId,
        external_order_name: payload.name || null,
        source_updated_at: payload.updated_at ? new Date(payload.updated_at) : null,
        cancel_reason: payload.cancel_reason || null,
        display_fulfillment_status: payload.fulfillment_status || null,
        processed_at: payload.processed_at ? new Date(payload.processed_at) : null,
        closed_at: payload.closed_at ? new Date(payload.closed_at) : null,
        ...orderEvidence,
        total,
        refunded_total: refundedTotal,
        subtotal,
        discount_amount: discountAmount,
        discount_pct: discountPct,
        currency,
        coupon_used: Boolean(payload.discount_codes?.length || payload.coupon_lines?.length),
        coupon_code: couponCode,
        ordered_at: orderDate,
        recovery_status: recoveryStatus,
      },
      update: {
        customer_id: dbCustomer.id,
        external_order_name: payload.name || undefined,
        source_updated_at: payload.updated_at ? new Date(payload.updated_at) : undefined,
        cancel_reason: payload.cancel_reason || undefined,
        display_fulfillment_status: payload.fulfillment_status || undefined,
        processed_at: payload.processed_at ? new Date(payload.processed_at) : undefined,
        closed_at: payload.closed_at ? new Date(payload.closed_at) : undefined,
        ...safeOrderEvidence,
        // A delayed pre-refund snapshot must not resurrect refunded revenue:
        // the recorded refunded amount is monotonic and any refund this payload
        // has not seen yet is still deducted from its net total.
        total: reconciled.total,
        refunded_total: reconciled.refunded_total,
        currency,
        ordered_at: orderDate,
        subtotal,
        discount_amount: discountAmount,
        discount_pct: discountPct,
        coupon_used: Boolean(payload.discount_codes?.length || payload.coupon_lines?.length),
        coupon_code: couponCode,
        recovery_status: recoveryStatus,
      },
    });

    for (const item of lineItems) {
      const externalLineItemId = String(item.id || item.line_item_id || `${orderExternalId}:${item.product_id || item.name}`);
      const quantity = Number(item.quantity);
      const unitPrice = parseAmount(item.price ?? item.unit_price);
      const discountedPrice = item.discounted_price == null ? null : parseAmount(item.discounted_price);
      const originalLineTotal = item.original_total == null ? unitPrice * quantity : parseAmount(item.original_total);
      const discountedLineTotal = item.discounted_total == null ? null : parseAmount(item.discounted_total);
      const itemDiscount = parseAmount(item.discount_amount ?? 0);
      const fulfilledQuantity = item.fulfilled_quantity == null ? null : Number(item.fulfilled_quantity);
      const remainingQuantity = item.remaining_quantity == null ? null : Number(item.remaining_quantity);
      // A malformed line item is skipped rather than persisted as a zero-value
      // sale. The order's validated total is unaffected.
      if (!Number.isInteger(quantity) || quantity < 1 || unitPrice === null || itemDiscount === null ||
          originalLineTotal === null || (item.discounted_price != null && discountedPrice === null) ||
          (item.discounted_total != null && discountedLineTotal === null) ||
          (fulfilledQuantity !== null && (!Number.isInteger(fulfilledQuantity) || fulfilledQuantity < 0 || fulfilledQuantity > quantity)) ||
          (remainingQuantity !== null && (!Number.isInteger(remainingQuantity) || remainingQuantity < 0 || remainingQuantity > quantity))) {
        logger.warn('shopify_line_item_financials_unverified', {
          store_id: store.id, external_order_id: orderExternalId,
        });
        continue;
      }
      await tx.order_items.upsert({
        where: { store_id_external_line_item_id: { store_id: store.id, external_line_item_id: externalLineItemId } },
        create: {
          order_id: order.id,
          store_id: store.id,
          external_line_item_id: externalLineItemId,
          external_product_id: item.product_id ? String(item.product_id) : null,
          external_variant_id: item.variant_id ? String(item.variant_id) : null,
          product_name: item.title || item.name || 'Unknown product',
          variant_title: item.variant_title || null,
          sku: item.sku || null,
          quantity,
          quantity_fulfilled: fulfilledQuantity,
          quantity_remaining: remainingQuantity,
          unit_price: unitPrice,
          discounted_unit_price: discountedPrice,
          original_line_total: originalLineTotal,
          discount_amount: itemDiscount,
          currency: normalizeCurrency(item.currency) || currency,
          line_total: discountedLineTotal === null ? unitPrice * quantity : discountedLineTotal,
          ordered_at: orderDate,
        },
        update: {
          external_product_id: item.product_id ? String(item.product_id) : null,
          external_variant_id: item.variant_id ? String(item.variant_id) : null,
          product_name: item.title || item.name || 'Unknown product',
          variant_title: item.variant_title || null, sku: item.sku || null,
          quantity, quantity_fulfilled: fulfilledQuantity, quantity_remaining: remainingQuantity,
          unit_price: unitPrice, discounted_unit_price: discountedPrice,
          original_line_total: originalLineTotal, discount_amount: itemDiscount,
          currency: normalizeCurrency(item.currency) || currency,
          line_total: discountedLineTotal === null ? unitPrice * quantity : discountedLineTotal,
          ordered_at: orderDate,
        },
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
        where: {
          store_id: store.id,
          OR: [
            { [typedColumns[type]]: identifier },
            // Legacy records predate Task028 typed columns. Only consider
            // their exact original identity when *all* typed identities
            // are absent; never reinterpret a known token as another type.
            {
              external_cart_id: identifier,
              source_checkout_id: null,
              source_checkout_token: null,
              source_cart_token: null,
            },
          ],
        },
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
    // Cart tokens are weak and may be shared. Contradictory weak evidence
    // must never override an unambiguous checkout ID/token relationship.
    const conflict = Boolean(sourceConflict || conflictingStrong);
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
    // Task 029: only a durably verified, merchant-scoped order relationship
    // establishes order-based checkout completion. Keep recovery attribution separate.
    const verifiedOrder = await tx.orders.findFirst({
      where: { id: order.id, store_id: store.id },
      select: { abandoned_cart_id: true, ordered_at: true, recovery_status: true },
    });
    if (verifiedOrder?.abandoned_cart_id && verifiedOrder.recovery_status !== 'cancelled') {
      await tx.abandoned_carts.updateMany({
        where: { id: verifiedOrder.abandoned_cart_id, store_id: store.id, status: { not: 'recovered' } },
        data: { status: 'recovered', recovered_at: verifiedOrder.ordered_at, completed_at: verifiedOrder.ordered_at },
      });
    }
    await recalculateCustomerTotals(tx, dbCustomer.id);
    return order;
  }, {
    // Remote PostgreSQL plus line-item/reconciliation writes can exceed
    // Prisma's 5s default. Keep the financial operation atomic with an
    // explicit bounded budget instead of repeatedly rolling back at P2028.
    maxWait: 10000,
    timeout: 30000,
  });
}

async function cancelOrder(store, payload) {
  const externalOrderId = String(payload.id || payload.order_id || '');
  if (!externalOrderId) return null;
  const cancelledAt = payload.cancelled_at ? new Date(payload.cancelled_at) : null;
  const currency = normalizeCurrency(payload.currency ?? payload.currency_code);
  const total = parseAmount(payload.total_price ?? payload.total);
  return prisma.$transaction(async (tx) => {
    // Persist the cancellation before touching the order. If the cancellation
    // arrives before the order itself (delayed webhook / sync ordering), the
    // tombstone prevents the later create from resurrecting cancelled revenue.
    await tx.order_cancellation_tombstones.upsert({
      where: { store_id_external_order_id: { store_id: store.id, external_order_id: externalOrderId } },
      create: {
        store_id: store.id, external_order_id: externalOrderId,
        cancelled_at: cancelledAt, currency, total, observed_at: new Date(),
      },
      update: {
        observed_at: new Date(),
        cancelled_at: cancelledAt || undefined,
        currency: currency || undefined,
        total: total === null ? undefined : total,
      },
    });
    const order = await tx.orders.findUnique({
      where: { store_id_external_order_id: { store_id: store.id, external_order_id: externalOrderId } },
    });
    if (!order) return null;
    await tx.orders.update({ where: { id: order.id }, data: {
      recovery_status: 'cancelled',
      external_order_name: payload.name || order.external_order_name,
      source_updated_at: payload.updated_at ? new Date(payload.updated_at) : order.source_updated_at,
      cancel_reason: payload.cancel_reason || order.cancel_reason,
      display_fulfillment_status: payload.fulfillment_status || order.display_fulfillment_status,
      processed_at: payload.processed_at ? new Date(payload.processed_at) : order.processed_at,
      closed_at: payload.closed_at ? new Date(payload.closed_at) : order.closed_at,
    } });
    await recalculateCustomerTotals(tx, order.customer_id);
    return order;
  });
}

// Task031: reconcile an order delivered before its checkout. Never infer identity
// from customer, amount or time; only stored authoritative Shopify identifiers.
async function reconcileOrdersOnCheckoutArrival(store, cart) {
  if (store.platform !== 'shopify') return;
  const identities = [
    ['source_checkout_id', cart.source_checkout_id],
    ['source_checkout_token', cart.source_checkout_token],
    ['source_cart_token', cart.source_cart_token],
  ].filter(([, value]) => value);
  if (!identities.length) return;
  // Include cart-token-only orders even when the incoming checkout also has
  // its own strong identity. Each order is evaluated against its own strongest
  // available evidence below; a cart token cannot override contradictory IDs.
  // Page through every matching unresolved order. A fixed first-50 limit
  // silently strands later orders, especially when earlier rows are ambiguous.
  const pendingIds = [];
  let cursor;
  for (;;) {
    const batch = await prisma.orders.findMany({
      where: { store_id: store.id, abandoned_cart_id: null,
        OR: identities.map(([field, value]) => ({ [field]: value })) },
      select: { id: true }, orderBy: { id: 'asc' }, take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!batch.length) break;
    pendingIds.push(...batch.map(row => row.id));
    cursor = batch[batch.length - 1].id;
    if (batch.length < 50) break;
  }
  for (const id of pendingIds) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cart.id}::text, 0))::text AS lock_acquired`;
      const order = await tx.orders.findFirst({
        where: { id, store_id: store.id },
        select: { id:true, abandoned_cart_id:true, source_checkout_id:true,
          source_checkout_token:true, source_cart_token:true, ordered_at:true,
          recovery_status:true },
      });
      if (!order || order.abandoned_cart_id) return;
      const strongFields = ['source_checkout_id','source_checkout_token'];
      const effective = strongFields.some(field => order[field]) ? strongFields : ['source_cart_token'];
      const evidence = effective.filter(field => order[field]);
      if (!evidence.length) return;
      const candidates = new Map();
      for (const field of evidence) {
        const value = order[field];
        const rows = await tx.abandoned_carts.findMany({
          where: { store_id: store.id, OR: [
            { [field]: value },
            { external_cart_id: value, source_checkout_id: null,
              source_checkout_token: null, source_cart_token: null },
          ] },
          select: { id:true }, take:2,
        });
        if (rows.length > 1) {
          await recordOrderReconciliationCase(tx, { storeId:store.id, orderId:order.id,
            reason:'AMBIGUOUS_CANDIDATES', candidateCount:rows.length });
          return;
        }
        for (const row of rows) candidates.set(row.id,row);
      }
      if (candidates.size !== 1 || !candidates.has(cart.id)) {
        await recordOrderReconciliationCase(tx, { storeId:store.id, orderId:order.id,
          reason:candidates.size>1?'CONFLICTING_IDENTIFIERS':'CHECKOUT_NOT_FOUND',
          candidateCount:candidates.size, preserveConflict:candidates.size>1 });
        return;
      }
      const owners = await tx.orders.count({ where: { store_id:store.id,
        abandoned_cart_id:cart.id, id:{not:order.id} } });
      if (owners) {
        await recordOrderReconciliationCase(tx, { storeId:store.id, orderId:order.id,
          reason:'CONFLICTING_IDENTIFIERS', candidateCount:owners, preserveConflict:true });
        return;
      }
      const claimed = await tx.orders.updateMany({ where: { id:order.id,
        store_id:store.id, abandoned_cart_id:null },
        data: { abandoned_cart_id:cart.id } });
      if (claimed.count) {
        await recordOrderReconciliationCase(tx, { storeId:store.id, orderId:order.id,
          reason:'NO_VERIFIED_MATCH', verifiedCheckoutId:cart.id });
        if (order.recovery_status !== 'cancelled') {
          await tx.abandoned_carts.updateMany({ where: { id:cart.id,
            store_id:store.id, status:{not:'recovered'} },
            data: { status:'recovered', recovered_at:order.ordered_at, completed_at:order.ordered_at } });
        }
      }
    });
  }
}

async function upsertAbandonedCart(store, payload) {
  const externalId = String(payload.checkout_id || payload.id || payload.cart_token || payload.checkout_token || '');
  if (!externalId) return null;
  const sourceDate = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  };
  const completedAt = sourceDate(payload.completed_at);
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
  const savedCart = await prisma.$transaction(async (tx) => {
  // Serialize writes for the same store/checkout, even across parallel webhook workers.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${store.id}), hashtext(${externalId}))::text AS locked`;
  // Task030: order reconciliation (Task027) uses this checkout UUID lock.
  // Take the same transaction lock before reading lifecycle state so an order
  // completion cannot commit between our read and a stale checkout update.
  const identity = await tx.abandoned_carts.findFirst({
    where: { store_id: store.id, external_cart_id: externalId },
    select: { id: true },
  });
  if (identity) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity.id}::text, 0))::text AS lock_acquired`;
  }
  const existing = await tx.abandoned_carts.findFirst({
    where: { store_id: store.id, external_cart_id: externalId },
  });
  // Shopify updated_at is source activity time, not webhook arrival time.
  // A stale non-completion snapshot cannot replace independently verified state.
  const activityAt = lastCheckoutActivity(payload);
  const isStaleEvent = Boolean(existing?.updated_at && activityAt < existing.updated_at);
  if (isStaleEvent && !completedAt) return existing;
  const incomingCartValue = parseAmount(payload.total_price ?? payload.total);
  const incomingCartCurrency = normalizeCurrency(payload.currency ?? payload.currency_code);
  let cartValue;
  let cartCurrency;
  if (incomingCartValue !== null) {
    if (!incomingCartCurrency) {
      const error = new Error('Checkout currency cannot be verified');
      error.code = 'CART_CURRENCY_UNVERIFIED';
      throw error;
    }
    cartValue = incomingCartValue;
    cartCurrency = incomingCartCurrency;
  } else if (existing) {
    // Preserve previously verified financial evidence instead of writing zero.
    cartValue = parseAmount(String(existing.cart_value ?? ''));
    cartCurrency = normalizeCurrency(existing.currency);
    if (cartValue === null || !cartCurrency) {
      const error = new Error('Checkout financial evidence is unavailable');
      error.code = 'CART_VALUE_UNVERIFIED';
      throw error;
    }
  } else {
    const error = new Error('Checkout value cannot be verified');
    error.code = 'CART_VALUE_UNVERIFIED';
    throw error;
  }
  const safeCheckoutEvidence = mergeSourceEvidence(existing, sourceIdentifiers(payload, 'checkout'));
  const financialField = (incoming, previous) => incoming !== undefined && incoming !== null ? parseAmount(incoming) : (previous ?? null);
  const data = {
    store_id: store.id,
    customer_id: dbCustomer?.id || null,
    external_cart_id: externalId,
    ...safeCheckoutEvidence,
    external_checkout_name: payload.name || existing?.external_checkout_name || null,
    source_resource: payload.source_resource || existing?.source_resource || null,
    source_state: 'available',
    source_created_at: sourceDate(payload.created_at) || existing?.source_created_at || null,
    source_updated_at: sourceDate(payload.updated_at) || existing?.source_updated_at || null,
    completed_at: completedAt || existing?.completed_at || null,
    abandonment_observed_at: payload.source_abandoned ? (existing?.abandonment_observed_at || new Date()) : (existing?.abandonment_observed_at || null),
    retrieved_at: new Date(),
    recovery_url: payload.abandoned_checkout_url || payload.recovery_url || null,
    cart_value: cartValue,
    subtotal: financialField(payload.subtotal_price ?? payload.subtotal, existing?.subtotal),
    discount_amount: financialField(payload.discount_amount, existing?.discount_amount),
    tax_amount: financialField(payload.tax_amount, existing?.tax_amount),
    shipping_amount: financialField(payload.shipping_amount, existing?.shipping_amount),
    duties_amount: financialField(payload.duties_amount, existing?.duties_amount),
    taxes_included: typeof payload.taxes_included === 'boolean' ? payload.taxes_included : (existing?.taxes_included ?? null),
    currency: cartCurrency,
    status: nextCheckoutStatus({ completedAt, existingStatus: existing?.status, isStale: isStaleEvent, sourceAbandoned: payload.source_abandoned }),
    abandoned_at: existing?.abandoned_at || sourceDate(payload.created_at) || new Date(),
    recovered_at: completedAt || existing?.recovered_at || null,
    // Never move the activity watermark backwards, including for delayed
    // completion evidence whose Shopify source timestamp predates a newer update.
    updated_at: existing?.updated_at && existing.updated_at > activityAt ? existing.updated_at : activityAt,
  };
  const cart = existing
    ? await tx.abandoned_carts.update({ where: { id: existing.id }, data })
    : await tx.abandoned_carts.create({ data });
  // Webhooks can arrive before the periodic Shopify sync. Persist available
  // product context immediately; an empty payload must not erase known items.
  const items = Array.isArray(payload.line_items) ? payload.line_items : [];
  if (items.length) {
    await tx.abandoned_cart_items.deleteMany({ where: { abandoned_cart_id: cart.id } });
    const validatedItems = items.map((item) => {
      const price = parseAmount(item.price ?? item.unit_price);
      const quantity = Number(item.quantity);
      if (price === null || price < 0 || !Number.isInteger(quantity) || quantity < 1) {
        throw Object.assign(new Error('Checkout line-item financial evidence is invalid'), { code: 'CHECKOUT_LINE_FINANCIALS_UNVERIFIED' });
      }
      return {
        abandoned_cart_id: cart.id,
        external_line_item_id: item.id ? String(item.id) : null,
        external_product_id: String(item.product_id || 'unknown'),
        external_variant_id: item.variant_id ? String(item.variant_id) : null,
        product_name: String(item.title || item.name || 'Unknown product'),
        variant_name: item.variant_title ? String(item.variant_title) : null,
        sku: item.sku ? String(item.sku) : null,
        price,
        discounted_unit_price: financialField(item.discounted_price, null),
        original_line_total: financialField(item.original_total, null),
        discount_amount: financialField(item.discount_amount, null),
        line_subtotal: financialField(item.discounted_total, null),
        currency: item.currency || cart.currency || null,
        quantity,
      };
    });
    if (validatedItems.length) {
      await tx.abandoned_cart_items.createMany({ data: validatedItems });
    }
  }
  return cart;
  });
  if (savedCart) await reconcileOrdersOnCheckoutArrival(store, savedCart);
  return savedCart;
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

async function handleProductWebhook(store, topic, payload) {
  // Lazy-require: productSync pulls in the GraphQL client, which validates
  // SHOPIFY_TOKEN_ENCRYPTION_KEY at load time. Requiring it lazily keeps this
  // module loadable in maintenance/integration contexts that do not handle
  // Shopify traffic; the key is still enforced on the first real API call.
  const { syncProductById, deleteProduct } = require('./productSync');
  const rawId = payload?.id ?? payload?.product?.id ?? null;
  const id = rawId != null ? String(rawId) : '';
  if (!id) {
    throw Object.assign(new Error('Product webhook is missing an id'), { code: 'PRODUCT_WEBHOOK_MALFORMED' });
  }
  if (topic.includes('delete')) {
    const result = await deleteProduct(store, id);
    return { action: 'product_deleted', external_id: id, deleted: result?.count ?? null };
  }
  // products/create and products/update are change signals; the stored state
  // is always a fresh refetch, never the webhook body.
  try {
    return await syncProductById(store, id);
  } catch (error) {
    const denied = error.code === 'SHOPIFY_GRAPHQL_ERROR' &&
      Array.isArray(error.shopifyErrors) &&
      error.shopifyErrors.some((item) => Array.isArray(item.codes) && item.codes.includes('ACCESS_DENIED'));
    const ignorable = denied || error.code === 'SHOPIFY_PRODUCT_NOT_FOUND' || error.code === 'SHOPIFY_PRODUCT_MALFORMED';
    if (ignorable) {
      logger.warn('shopify_product_webhook_skipped', { store_id: store.id, topic, error_type: error.code });
      return { action: 'product_refetch_skipped', external_id: id };
    }
    throw error;
  }
}

async function processCommerceWebhook({ provider, store, topic, payload, occurredAt, eventReference }) {
  const normalizedTopic = String(topic || '').toLowerCase();
  // Mandatory Shopify privacy/compliance topics are handled by the dedicated
  // durable workflow: recorded in `privacy_requests`, processed idempotently,
  // tenant-scoped and audited. A processing failure throws so the delivery is
  // marked failed and Shopify retries — a privacy obligation must never be
  // silently acknowledged as processed.
  if (provider === 'shopify' && isPrivacyTopic(normalizedTopic)) {
    return handleShopifyPrivacyWebhook({ store, topic: normalizedTopic, payload });
  }
  if (normalizedTopic.startsWith('products/')) {
    return handleProductWebhook(store, normalizedTopic, payload);
  }
  if (normalizedTopic === 'app/uninstalled') {
    const { recordIntegrationEvent } = require('./integrationLifecycleStore');
    const transition = await recordIntegrationEvent({
      storeId: store.id,
      type: 'app_uninstalled',
      reasonCode: 'APP_UNINSTALLED',
      observedAt: occurredAt || new Date(),
      source: 'shopify_webhook',
      eventReference: eventReference || null,
    });
    if (!transition.accepted && !['stale_uninstall', 'stale_event', 'duplicate_event'].includes(transition.reason)) {
      throw Object.assign(new Error('Uninstall transition could not be persisted'), { code: 'INTEGRATION_TRANSITION_FAILED' });
    }
    return { action: transition.accepted ? 'store_deactivated' : 'stale_uninstall_ignored' };
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
    // Best-effort enrichment of the order's payment/fulfilment graph.
    // Fire-and-forget: a failed enrichment never marks the webhook undelivered.
    const orderGid = bestEffortOrderGid(payload);
    if (orderGid) {
      setImmediate(async () => {
        try {
          const { enrichOrder } = require('./orderEnrichment');
          await enrichOrder(store, orderGid);
        } catch (enrichmentError) {
          logger.warn('order_enrichment_webhook_deferred', {
            store_id: store.id,
            error_type: enrichmentError?.code || enrichmentError?.name || 'enrichment_error',
          });
        }
      });
    } else {
      logger.info('order_enrichment_webhook_skipped', { store_id: store.id, reason: 'no_resolvable_order_gid' });
    }
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
  const now = new Date();
  const existing = typeof prisma.webhook_deliveries.findUnique === 'function'
    ? await prisma.webhook_deliveries.findUnique({ where: { id: deliveryId }, select: { received_at: true } })
    : null;
  await prisma.webhook_deliveries.update({
    where: { id: deliveryId },
    data: {
      status,
      processed_at: status === 'processed' ? now : null,
      failed_at: status === 'failed' ? now : null,
      processing_latency_ms: status === 'processed' && existing?.received_at ? Math.max(0, now.getTime() - new Date(existing.received_at).getTime()) : null,
      last_error: errorMessage?.slice(0, 500) || null,
    },
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
