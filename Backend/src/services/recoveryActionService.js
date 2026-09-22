const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');
const { prisma } = require('../configs/database');
const logger = require('../utils/logger');
const { predictSendTime } = require('./mlService');
const { shopifyGraphql } = require('./shopifyGraphql');

const DEFAULT_POLICY = Object.freeze({
  enabled: false,
  allowed_actions: [],
  allowed_channels: [],
  max_discount_pct: 0,
  max_messages_per_customer_24h: 0,
  max_actions_per_store_24h: 0,
  kill_switch: true,
});

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function normalizePolicy(settings) {
  const value = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings
    : {};
  return {
    enabled: value.enabled === true,
    allowed_actions: Array.isArray(value.allowed_actions) ? value.allowed_actions.filter((item) => typeof item === 'string') : [],
    allowed_channels: Array.isArray(value.allowed_channels) ? value.allowed_channels.filter((item) => typeof item === 'string') : [],
    max_discount_pct: boundedInteger(value.max_discount_pct, 0, 0, 25),
    max_messages_per_customer_24h: boundedInteger(value.max_messages_per_customer_24h, 0, 0, 10),
    max_actions_per_store_24h: boundedInteger(value.max_actions_per_store_24h, 0, 0, 1000),
    kill_switch: value.kill_switch !== false,
  };
}

async function getBetaPolicy(storeId) {
  const row = await prisma.store_settings.findUnique({
    where: { store_id_settings_group: { store_id: storeId, settings_group: 'beta_automation' } },
  });
  return row ? normalizePolicy(row.settings) : { ...DEFAULT_POLICY };
}

function automationPermitted(policy, customer, discountPct) {
  // Fail closed: real actions are enabled only when an operator explicitly opens
  // the global gate and the store-level policy also permits the action.
  if (process.env.BETA_AUTOMATION_KILL_SWITCH !== 'false') return false;
  if (!policy.enabled || policy.kill_switch) return false;
  if (!policy.allowed_actions.includes('cart_recovery_message')) return false;
  if (!policy.allowed_channels.includes('email') || customer.consent_email !== true) return false;
  if (discountPct > 0 && !policy.allowed_actions.includes('percentage_discount')) return false;
  return true;
}

async function findOrCreateEmailSequence(storeId) {
  const existing = await prisma.sequences.findFirst({
    where: { store_id: storeId, channel: 'email', status: 'active' },
    orderBy: { created_at: 'asc' },
  });
  if (existing) return existing;
  return prisma.sequences.create({
    data: {
      store_id: storeId,
      name: 'Controlled beta cart recovery',
      channel: 'email',
      status: 'active',
      delay_mins: 30,
    },
  });
}

function stableActionKey(storeId, cartId) {
  return crypto.createHash('sha256').update(`${storeId}:${cartId}:cart-recovery:v1`).digest('hex');
}

function sendTimePayload(features, sensitivity, cart) {
  const value = Number(cart.cart_value || 0);
  const cartValueTier = value >= 500 ? 'premium' : value >= 200 ? 'high' : value >= 75 ? 'medium' : 'low';
  return {
    local_hour_of_session: features.local_hour_of_session,
    day_of_week_session: features.day_of_week_session,
    channel: 'email',
    recovery_action: sensitivity.recovery_action || 'SOFT_NUDGE',
    cart_value_tier: cartValueTier,
    customer_timezone_offset: 0,
    historical_open_probabilities: null,
    history_data_points: 0,
    days_since_last_purchase: Math.max(0, Number(features.days_since_last_purchase || 0)),
    failed_payment_attempt: Boolean(features.failed_payment_attempt),
    risk_score: 0,
    sequence_message_number: 1,
    previous_message_sent_at: null,
    previous_message_opened: false,
    previous_message_clicked: false,
    last_sms_sent_at: null,
    secondary_channel: null,
  };
}

async function withinActionLimits(storeId, customerId, policy) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [storeCount, customerCount] = await Promise.all([
    prisma.sequence_sends.count({ where: { store_id: storeId, created_at: { gte: since } } }),
    prisma.sequence_sends.count({ where: { customer_id: customerId, created_at: { gte: since } } }),
  ]);
  return storeCount < policy.max_actions_per_store_24h &&
    customerCount < policy.max_messages_per_customer_24h;
}

async function enqueueRecoveryAction({
  store, customer, cart, snapshot, features, abandonment, sensitivity, offer, correlationId,
}) {
  const policy = await getBetaPolicy(store.id);
  const discountPct = Math.max(0, Math.min(
    25,
    policy.max_discount_pct,
    Number(offer.discount_pct || 0)
  ));
  if (store.status !== 'active' || cart.status !== 'abandoned') return { queued: false, reason: 'inactive_source' };
  if (!automationPermitted(policy, customer, discountPct)) return { queued: false, reason: 'policy_denied' };
  if (!(await withinActionLimits(store.id, customer.id, policy))) return { queued: false, reason: 'rate_limit' };

  const timing = await predictSendTime({
    payload: sendTimePayload(features, sensitivity, cart),
    customerId: customer.id,
    merchantId: store.id,
    correlationId,
  });
  if (!timing.success) return { queued: false, reason: timing.error?.code || 'timing_failed' };

  const sequence = await findOrCreateEmailSequence(store.id);
  const actionKey = stableActionKey(store.id, cart.id);
  const queuedMessageId = `queued:${actionKey}`;
  const metadata = {
    action_key: actionKey,
    available_at: timing.data.send_at_utc || timing.data.send_at,
    abandoned_cart_id: cart.id,
    feature_snapshot_id: snapshot.id,
    discount_pct: discountPct,
    offer_expires_hours: Number(offer.offer_expires_hours || 24),
    minimum_order_value: Number(offer.minimum_order_value || 0),
    recovery_action: sensitivity.recovery_action,
    model_evidence: {
      abandonment: { model_version: abandonment.model_version, fallback: abandonment.fallback },
      sensitivity: { model_version: sensitivity.model_version, fallback: sensitivity.fallback },
      offer: { model_version: offer.model_version, fallback: offer.fallback },
      timing: { fallback: timing.data.fallback, reasoning_layer: timing.data.reasoning_layer },
    },
  };
  try {
    const send = await prisma.sequence_sends.create({
      data: {
        sequence_id: sequence.id,
        store_id: store.id,
        customer_id: customer.id,
        external_message_id: queuedMessageId,
        channel: 'email',
        status: 'queued',
        metadata,
      },
    });
    await prisma.audit_logs.create({
      data: {
        organization_id: store.organization_id,
        entity_type: 'sequence_send',
        entity_id: send.id,
        action: 'beta_recovery_queued',
        context: { action_key: actionKey, cart_id: cart.id, discount_pct: discountPct },
      },
    });
    return { queued: true, sendId: send.id };
  } catch (error) {
    if (error.code === 'P2002') return { queued: false, reason: 'duplicate' };
    throw error;
  }
}

function recoveryCode(actionKey) {
  return `REV-${actionKey.slice(0, 10).toUpperCase()}`;
}

async function createShopifyDiscount(store, customer, metadata) {
  const discountPct = Number(metadata.discount_pct || 0);
  if (discountPct <= 0) return null;
  const code = recoveryCode(metadata.action_key);
  const externalCustomerId = String(customer.external_id || '');
  if (!/^\d+$/.test(externalCustomerId)) {
    throw new Error('shopify_customer_id_invalid');
  }
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + Number(metadata.offer_expires_hours || 24) * 60 * 60 * 1000);
  const query = `
    mutation CreateRecoveryDiscount($input: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $input) {
        codeDiscountNode { id }
        userErrors { field message code }
      }
    }
  `;
  const input = {
    title: 'Revluma cart recovery',
    code,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    context: { customers: { add: [`gid://shopify/Customer/${externalCustomerId}`] } },
    customerGets: { value: { percentage: discountPct / 100 }, items: { all: true } },
    minimumRequirement: {
      subtotal: { greaterThanOrEqualToSubtotal: String(Number(metadata.minimum_order_value || 0)) },
    },
    usageLimit: 1,
    appliesOncePerCustomer: true,
  };
  const data = await shopifyGraphql(store, query, { input });
  const result = data.discountCodeBasicCreate;
  if (result?.userErrors?.length) {
    const alreadyExists = result.userErrors.some((item) => /already|taken|exists/i.test(item.message || ''));
    if (!alreadyExists) throw new Error('shopify_discount_create_failed');
  }
  return { id: result?.codeDiscountNode?.id || null, code };
}

function safeRecoveryUrl(store, cart) {
  try {
    const candidate = new URL(cart.recovery_url);
    const expectedHost = String(store.shop_domain || '').trim().toLowerCase();
    const isShopDomain = candidate.hostname.toLowerCase() === expectedHost;
    const isShopifyRecoveryPath = candidate.pathname.includes('/checkouts/') &&
      candidate.pathname.endsWith('/recover') && candidate.searchParams.has('key');
    return candidate.protocol === 'https:' && (isShopDomain || isShopifyRecoveryPath)
      ? candidate.toString()
      : null;
  } catch {
    return null;
  }
}

async function sendRecoveryEmail(store, customer, cart, metadata, discount) {
  if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
    throw new Error('sendgrid_not_configured');
  }
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  const discountLine = discount
    ? `<p>Use code <strong>${discount.code}</strong> for ${Number(metadata.discount_pct)}% off.</p>`
    : '';
  const recoveryUrl = safeRecoveryUrl(store, cart);
  const recoveryLink = recoveryUrl
    ? `<p><a href="${recoveryUrl.replace(/"/g, '&quot;')}">Return to your checkout</a></p>`
    : '<p>Return to the store to complete checkout.</p>';
  const response = await sgMail.send({
    to: customer.email,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: 'Your cart is waiting',
    html: `<p>You left items in your cart.</p>${discountLine}${recoveryLink}`,
    customArgs: { sequence_send_id: metadata.sequence_send_id, action_key: metadata.action_key },
  });
  return response?.[0]?.headers?.['x-message-id'] || `sendgrid:${metadata.action_key}`;
}

async function processRecoverySend(send) {
  const [store, customer] = await Promise.all([
    prisma.stores.findUnique({ where: { id: send.store_id } }),
    send.customer_id ? prisma.customers.findUnique({ where: { id: send.customer_id } }) : null,
  ]);
  const metadata = send.metadata && typeof send.metadata === 'object' ? send.metadata : {};
  if (!store || !customer) throw new Error('recovery_context_missing');
  const policy = await getBetaPolicy(store.id);
  if (!automationPermitted(policy, customer, Number(metadata.discount_pct || 0))) {
    await prisma.sequence_sends.update({ where: { id: send.id }, data: { status: 'cancelled' } });
    return { cancelled: true };
  }
  const cart = await prisma.abandoned_carts.findFirst({
    where: { id: metadata.abandoned_cart_id, store_id: store.id, status: 'abandoned' },
  });
  if (!cart) {
    await prisma.sequence_sends.update({ where: { id: send.id }, data: { status: 'cancelled' } });
    return { cancelled: true };
  }

  const discount = store.platform === 'shopify'
    ? await createShopifyDiscount(store, customer, metadata)
    : null;
  const externalMessageId = await sendRecoveryEmail(store, customer, cart, {
    ...metadata,
    sequence_send_id: send.id,
  }, discount);
  await prisma.$transaction([
    prisma.sequence_sends.update({
      where: { id: send.id },
      data: {
        status: 'sent',
        sent_at: new Date(),
        metadata: {
          ...metadata,
          provider_message_id: externalMessageId,
          discount_provider_id: discount?.id || null,
          discount_code: discount?.code || null,
        },
      },
    }),
    prisma.audit_logs.create({
      data: {
        organization_id: store.organization_id,
        entity_type: 'sequence_send',
        entity_id: send.id,
        action: 'beta_recovery_sent',
        context: { action_key: metadata.action_key, provider: 'sendgrid', discount_created: Boolean(discount) },
      },
    }),
  ]);
  return { sent: true };
}

async function runRecoveryActions({ limit = 25 } = {}) {
  await prisma.sequence_sends.updateMany({
    where: {
      status: 'processing',
      updated_at: { lt: new Date(Date.now() - 10 * 60 * 1000) },
    },
    data: { status: 'failed', updated_at: new Date() },
  });
  const candidates = await prisma.sequence_sends.findMany({
    where: { status: 'queued', channel: 'email' },
    orderBy: { created_at: 'asc' },
    take: Math.min(limit * 4, 100),
  });
  let processed = 0;
  let failed = 0;
  for (const send of candidates) {
    if (processed + failed >= limit) break;
    const metadata = send.metadata && typeof send.metadata === 'object' ? send.metadata : {};
    const availableAt = Date.parse(metadata.available_at || '');
    if (Number.isFinite(availableAt) && availableAt > Date.now()) continue;
    const claim = await prisma.sequence_sends.updateMany({
      where: { id: send.id, status: 'queued' },
      data: { status: 'processing', updated_at: new Date() },
    });
    if (claim.count !== 1) continue;
    try {
      await processRecoverySend({ ...send, status: 'processing' });
      processed += 1;
    } catch (error) {
      failed += 1;
      const attemptCount = Number(metadata.attempt_count || 0) + 1;
      const providerStatus = Number(error.response?.statusCode || error.code || 0);
      const retryable = attemptCount < 3 && (providerStatus === 429 || providerStatus >= 500);
      await prisma.sequence_sends.update({
        where: { id: send.id },
        data: {
          status: retryable ? 'queued' : 'failed',
          metadata: {
            ...metadata,
            attempt_count: attemptCount,
            available_at: retryable
              ? new Date(Date.now() + Math.min(15 * 60 * 1000, 30 * 1000 * (2 ** attemptCount))).toISOString()
              : metadata.available_at,
            failure_type: error.code || error.name || 'provider_error',
          },
          updated_at: new Date(),
        },
      });
      logger.warn('beta_recovery_action_failed', {
        sequence_send_id: send.id,
        error_type: error.code || error.name || 'provider_error',
      });
    }
  }
  return { processed, failed };
}

module.exports = {
  DEFAULT_POLICY,
  automationPermitted,
  enqueueRecoveryAction,
  getBetaPolicy,
  normalizePolicy,
  processRecoverySend,
  runRecoveryActions,
  safeRecoveryUrl,
};
