'use strict';
/**
 * Shopify mandatory privacy / compliance webhook workflow.
 *
 * Topics handled (mandatory for App Store apps):
 *   customers/data_request — compile the data held for a customer and store a
 *                            durable, tenant-scoped export artifact.
 *   customers/redact      — erase the customer's personal data from this store.
 *   shop/redact           — erase ALL store data 48h after uninstall.
 *
 * Design rules:
 *   * Durable first: the request is recorded in `privacy_requests` before any
 *     work happens, so a worker crash between receive and completion never
 *     loses the obligation (the delivery is marked failed and Shopify retries).
 *   * Idempotent: a repeat delivery of the same request resumes safely and a
 *     completed request is never processed twice.
 *   * Tenant isolation: every read/write is scoped by `store_id` from the
 *     verified webhook's store; no payload value can redirect the operation
 *     to another store.
 *   * Auditability: every completion writes an `audit_logs` row with counts,
 *     never customer values.
 *   * Least privilege: payloads and artifacts live in `privacy_requests`
 *     (RLS-enabled, no API-role grants). Logs carry identifiers and counts
 *     only — never customer PII, never access tokens.
 */
const crypto = require('crypto');
const { prisma } = require('../configs/database');
const logger = require('../utils/logger');

const PRIVACY_TOPICS = Object.freeze(['customers/data_request', 'customers/redact', 'shop/redact']);

function isPrivacyTopic(topic) {
  return PRIVACY_TOPICS.includes(String(topic || '').trim().toLowerCase());
}

function normalizeTopic(topic) {
  return String(topic || '').trim().toLowerCase();
}

function requestKeyMaterial(topic, payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const customer = body.customer && typeof body.customer === 'object' ? body.customer : null;
  const material = {
    topic,
    customerId: customer?.id != null ? String(customer.id) : null,
    customerEmail: customer?.email != null ? String(customer.email).trim().toLowerCase() : null,
    shopId: body.shop_id != null ? String(body.shop_id) : null,
    shopDomain: body.shop_domain != null ? String(body.shop_domain).trim().toLowerCase() : null,
    ordersRequested: Array.isArray(body.orders_requested) ? body.orders_requested.map(String).sort() : null,
  };
  return JSON.stringify(material);
}

function requestKey(topic, payload) {
  return crypto.createHash('sha256').update(requestKeyMaterial(topic, payload)).digest('hex');
}

function customerLocator(payload) {
  const customer = payload && typeof payload === 'object' && payload.customer && typeof payload.customer === 'object'
    ? payload.customer
    : null;
  const externalId = customer?.id != null ? String(customer.id).trim() : '';
  const email = customer?.email != null ? String(customer.email).trim().toLowerCase() : '';
  const or = [];
  if (externalId) or.push({ external_id: externalId });
  if (email) or.push({ email });
  return { externalId: externalId || null, email: email || null, or };
}

function redactedEmail(internalId) {
  const digest = crypto.createHash('sha256').update(String(internalId)).digest('hex').slice(0, 24);
  return `redacted-${digest}@redacted.invalid`;
}

function customerSnapshotGids(rows, locator) {
  const externalIds = new Set(rows.map((row) => String(row.external_id)).filter(Boolean));
  if (locator.externalId) externalIds.add(locator.externalId);
  return [...externalIds].map((id) => id.startsWith('gid://') ? id : `gid://shopify/Customer/${id}`);
}

function customerSnapshotWhere(storeId, customerGids) {
  return {
    store_id: storeId,
    OR: [
      { resource_id: { in: ['customer.addresses', 'customer.metafields'] }, payload: { path: ['id'], in: customerGids } },
      { resource_id: 'metafields.customers', payload: { path: ['owner', 'id'], in: customerGids } },
    ],
  };
}

async function beginRequest({ store, provider, topic, payload }) {
  const key = requestKey(topic, payload);
  const where = {
    store_id_provider_topic_request_key: {
      store_id: store.id,
      provider,
      topic,
      request_key: key,
    },
  };
  try {
    const existing = await prisma.privacy_requests.findUnique({ where });
    if (existing?.status === 'completed') {
      return { id: existing.id, alreadyCompleted: true };
    }
    if (existing) {
      const updated = await prisma.privacy_requests.update({
        where: { id: existing.id },
        data: {
          status: 'processing',
          attempts: { increment: 1 },
          last_error: null,
          updated_at: new Date(),
        },
      });
      return { id: updated.id, alreadyCompleted: false };
    }
    const created = await prisma.privacy_requests.create({
      data: {
        store_id: store.id,
        provider,
        topic,
        request_key: key,
        status: 'processing',
        attempts: 1,
        payload,
        updated_at: new Date(),
      },
    });
    return { id: created.id, alreadyCompleted: false };
  } catch (error) {
    // Two deliveries of the same request raced on insert. One of them owns the
    // work; the loser must not acknowledge success, it must retry later.
    if (error?.code === 'P2002') {
      const pending = Object.assign(new Error('Privacy request is already in flight'), {
        code: 'PRIVACY_REQUEST_PENDING',
      });
      throw pending;
    }
    throw error;
  }
}

async function finishRequest(id, { status, result = null, errorCode = null }) {
  await prisma.privacy_requests.update({
    where: { id },
    data: {
      status,
      result: result ?? undefined,
      last_error: errorCode ? String(errorCode).slice(0, 500) : null,
      processed_at: status === 'completed' ? new Date() : null,
      updated_at: new Date(),
    },
  });
}

async function audit({ store, topic, action, context }) {
  try {
    if (!store?.organization_id) return;
    await prisma.audit_logs.create({
      data: {
        organization_id: store.organization_id,
        entity_type: 'privacy_request',
        entity_id: store.id,
        action,
        context: { topic, ...context },
      },
    });
  } catch (error) {
    // Auditing must not mask the compliance outcome; the durable
    // privacy_requests row remains the system of record.
    logger.warn('privacy_audit_log_failed', {
      store_id: store?.id,
      topic,
      error_type: error?.code || error?.name || 'audit_error',
    });
  }
}

async function findCustomerRows(storeId, locator) {
  if (!locator.or.length) return [];
  return prisma.customers.findMany({
    where: { store_id: storeId, OR: locator.or },
    select: { id: true, external_id: true, email: true, orders_count: true, ltv: true, created_at: true },
  });
}

async function handleDataRequest({ store, payload }) {
  const locator = customerLocator(payload);
  const rows = await findCustomerRows(store.id, locator);
  const ids = rows.map((row) => row.id);
  let orders = [];
  let orderItems = [];
  let carts = [];
  let authorizedSnapshots = [];
  const snapshotGids = customerSnapshotGids(rows, locator);
  if (snapshotGids.length) {
    authorizedSnapshots = await prisma.commerce_resource_records.findMany({
      where: customerSnapshotWhere(store.id, snapshotGids),
      select: { resource_id: true, external_id: true, payload: true },
      orderBy: [{ resource_id: 'asc' }, { external_id: 'asc' }],
    });
  }
  if (ids.length) {
    orders = await prisma.orders.findMany({
      where: { store_id: store.id, customer_id: { in: ids } },
      select: {
        id: true, external_order_id: true, ordered_at: true, total: true, currency: true,
        refunded_total: true, discount_amount: true, recovery_status: true, coupon_code: true,
      },
      orderBy: { ordered_at: 'desc' },
      take: 1000,
    });
    orderItems = await prisma.order_items.findMany({
      where: { store_id: store.id, order_id: { in: orders.map((o) => o.id) } },
      select: { order_id: true, product_name: true, quantity: true, unit_price: true, line_total: true, ordered_at: true },
      take: 5000,
    });
    carts = await prisma.abandoned_carts.findMany({
      where: { store_id: store.id, customer_id: { in: ids } },
      select: { external_cart_id: true, cart_value: true, currency: true, status: true, abandoned_at: true, recovered_at: true },
      take: 1000,
    });
  }
  const artifact = {
    schema: 'revluma-privacy-data-request-v1',
    generated_at: new Date().toISOString(),
    store: { shop_domain: payload?.shop_domain ?? null },
    subject: { customer_id: locator.externalId, customer_email: locator.email },
    authorized_resource_snapshots: authorizedSnapshots,
    located_customers: rows.map((row) => ({
      external_id: row.external_id,
      email: row.email,
      orders_count: row.orders_count ?? null,
      lifetime_value: row.ltv != null ? String(row.ltv) : null,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    })),
    orders: orders.map((o) => ({
      external_order_id: o.external_order_id,
      ordered_at: o.ordered_at ? new Date(o.ordered_at).toISOString() : null,
      total: o.total != null ? String(o.total) : null,
      currency: o.currency ?? null,
      refunded_total: o.refunded_total != null ? String(o.refunded_total) : null,
      discount_amount: o.discount_amount != null ? String(o.discount_amount) : null,
      recovery_status: o.recovery_status ?? null,
      coupon_code: o.coupon_code ?? null,
    })),
    order_items: orderItems.map((item) => ({
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price != null ? String(item.unit_price) : null,
      line_total: item.line_total != null ? String(item.line_total) : null,
      ordered_at: item.ordered_at ? new Date(item.ordered_at).toISOString() : null,
    })),
    abandoned_carts: carts.map((cart) => ({
      external_cart_id: cart.external_cart_id ?? null,
      cart_value: cart.cart_value != null ? String(cart.cart_value) : null,
      currency: cart.currency ?? null,
      status: cart.status ?? null,
      abandoned_at: cart.abandoned_at ? new Date(cart.abandoned_at).toISOString() : null,
      recovered_at: cart.recovered_at ? new Date(cart.recovered_at).toISOString() : null,
    })),
  };
  return {
    action: 'privacy_data_request_compiled',
    artifact,
    summary: {
      customers_located: rows.length,
      orders_exported: orders.length,
      line_items_exported: orderItems.length,
      carts_exported: carts.length,
      authorized_snapshots_exported: authorizedSnapshots.length,
    },
  };
}

async function handleCustomerRedact({ store, payload }) {
  const locator = customerLocator(payload);
  const rows = await findCustomerRows(store.id, locator);
  const ids = rows.map((row) => row.id);
  const counts = {
    customers_redacted: 0, events_deleted: 0, session_features_deleted: 0,
    churn_observations_deleted: 0, sensitivity_observations_deleted: 0,
    carts_scrubbed: 0, sequence_sends_unlinked: 0, authorized_snapshots_deleted: 0,
  };
  const snapshotGids = customerSnapshotGids(rows, locator);
  if (snapshotGids.length) {
    counts.authorized_snapshots_deleted = (await prisma.commerce_resource_records.deleteMany({
      where: customerSnapshotWhere(store.id, snapshotGids),
    })).count;
  }
  if (!ids.length) {
    return { action: 'privacy_customer_redacted', artifact: null, summary: counts };
  }
  counts.events_deleted = (await prisma.events.deleteMany({ where: { store_id: store.id, customer_id: { in: ids } } })).count;
  counts.session_features_deleted = (await prisma.ml_session_features.deleteMany({ where: { store_id: store.id, customer_id: { in: ids } } })).count;
  counts.churn_observations_deleted = (await prisma.churn_training_observations.deleteMany({ where: { store_id: store.id, customer_id: { in: ids } } })).count;
  counts.sensitivity_observations_deleted = (await prisma.sensitivity_training_observations.deleteMany({ where: { store_id: store.id, customer_id: { in: ids } } })).count;
  counts.carts_scrubbed = (await prisma.abandoned_carts.updateMany({
    where: { store_id: store.id, customer_id: { in: ids } },
    data: { recovery_url: null, session_id: null, source_cart_token: null, source_checkout_token: null, source_checkout_id: null },
  })).count;
  counts.sequence_sends_unlinked = (await prisma.sequence_sends.updateMany({
    where: { store_id: store.id, customer_id: { in: ids } },
    data: { customer_id: null },
  })).count;
  for (const id of ids) {
    // Orders keep their financial rows (legal/accounting necessity) but carry no
    // PII beyond the internal customer link, which is unlinked by redaction.
    await prisma.customers.update({
      where: { id },
      data: {
        email: redactedEmail(id),
        full_name: null,
        phone: null,
        anonymous_id: null,
        consent_email: false,
        consent_sms: false,
        consent_updated_at: new Date(),
        churn_tier: null,
        primary_churn_signal: null,
        recommended_channel: null,
      },
    });
    counts.customers_redacted += 1;
  }
  return { action: 'privacy_customer_redacted', artifact: null, summary: counts };
}

async function handleShopRedact({ store }) {
  const storeId = store.id;
  const counts = {};
  const cartRows = await prisma.abandoned_carts.findMany({ where: { store_id: storeId }, select: { id: true } });
  const cartIds = cartRows.map((row) => row.id);
  const sendRows = await prisma.sequence_sends.findMany({ where: { store_id: storeId }, select: { id: true } });
  const sendIds = sendRows.map((row) => row.id);
  // Ordered, idempotent single-statement steps — deliberately NOT an
  // interactive multi-statement transaction. This environment's pooler does
  // not pin one server backend to one client transaction (root cause of the
  // 2026-11-06 business-state persistence incident), so a wrapping transaction
  // would provide no atomicity while hiding the true failure point. Each
  // statement below commits on its own; ordering is children-before-parents;
  // every step is idempotent, so a failure is marked failed and a retry
  // converges without double-erasing anything.
  const steps = [
    ['commerce_resource_records', () => prisma.commerce_resource_records.deleteMany({ where: { store_id: storeId } })],
    ['commerce_action_requests', () => prisma.commerce_action_requests.deleteMany({ where: { store_id: storeId } })],
    ['sequence_events', () => sendIds.length
      ? prisma.sequence_events.deleteMany({ where: { sequence_send_id: { in: sendIds } } })
      : { count: 0 }],
    ['order_items', () => prisma.order_items.deleteMany({ where: { store_id: storeId } })],
    ['order_checkout_reconciliation_cases', () => prisma.order_checkout_reconciliation_cases.deleteMany({ where: { store_id: storeId } })],
    ['order_cancellation_tombstones', () => prisma.order_cancellation_tombstones.deleteMany({ where: { store_id: storeId } })],
    ['orders', () => prisma.orders.deleteMany({ where: { store_id: storeId } })],
    ['abandoned_cart_items', () => cartIds.length
      ? prisma.abandoned_cart_items.deleteMany({ where: { abandoned_cart_id: { in: cartIds } } })
      : { count: 0 }],
    ['abandoned_carts', () => prisma.abandoned_carts.deleteMany({ where: { store_id: storeId } })],
    ['feature_jobs', () => prisma.feature_jobs.deleteMany({ where: { store_id: storeId } })],
    ['events', () => prisma.events.deleteMany({ where: { store_id: storeId } })],
    ['ml_session_features', () => prisma.ml_session_features.deleteMany({ where: { store_id: storeId } })],
    ['churn_training_observations', () => prisma.churn_training_observations.deleteMany({ where: { store_id: storeId } })],
    ['sensitivity_training_observations', () => prisma.sensitivity_training_observations.deleteMany({ where: { store_id: storeId } })],
    ['sequence_sends', () => prisma.sequence_sends.deleteMany({ where: { store_id: storeId } })],
    ['sequences', () => prisma.sequences.deleteMany({ where: { store_id: storeId } })],
    ['coupons', () => prisma.coupons.deleteMany({ where: { store_id: storeId } })],
    ['intelligence_findings', () => prisma.intelligence_findings.deleteMany({ where: { store_id: storeId } })],
    ['intelligence_order_coverage', () => prisma.intelligence_order_coverage.deleteMany({ where: { store_id: storeId } })],
    ['product_images', () => prisma.product_images.deleteMany({ where: { store_id: storeId } })],
    ['product_tag_links', () => prisma.product_tag_links.deleteMany({ where: { store_id: storeId } })],
    ['product_category_links', () => prisma.product_category_links.deleteMany({ where: { store_id: storeId } })],
    ['product_attributes', () => prisma.product_attributes.deleteMany({ where: { store_id: storeId } })],
    ['product_tags', () => prisma.product_tags.deleteMany({ where: { store_id: storeId } })],
    ['product_categories', () => prisma.product_categories.deleteMany({ where: { store_id: storeId } })],
    ['products', () => prisma.products.deleteMany({ where: { store_id: storeId } })],
    ['store_settings', () => prisma.store_settings.deleteMany({ where: { store_id: storeId } })],
    ['webhook_deliveries', () => prisma.webhook_deliveries.deleteMany({ where: { store_id: storeId } })],
    ['webhook_registrations', () => prisma.webhook_registrations.deleteMany({ where: { store_id: storeId } })],
    ['customers', () => prisma.customers.deleteMany({ where: { store_id: storeId } })],
  ];
  for (const [name, run] of steps) {
    try {
      counts[name] = (await run()).count;
    } catch (error) {
      const tagged = Object.assign(new Error(`shop/redact failed at step '${name}'`), {
        code: 'SHOP_REDACT_STEP_FAILED',
        failed_step: name,
        cause: error,
      });
      throw tagged;
    }
  }
  await prisma.stores.update({
    where: { id: storeId },
    data: {
      status: 'redacted',
      access_token: null,
      granted_scopes: null,
      public_tracking_key: null,
      updated_at: new Date(),
    },
  });
  return { action: 'privacy_shop_redacted', artifact: null, summary: counts };
}

async function handleShopifyPrivacyWebhook({ store, topic, payload }) {
  const normalizedTopic = normalizeTopic(topic);
  if (!isPrivacyTopic(normalizedTopic)) {
    throw Object.assign(new Error('Unsupported privacy topic'), { code: 'PRIVACY_TOPIC_UNSUPPORTED' });
  }
  if (!store?.id) {
    throw Object.assign(new Error('Verified store is required for privacy processing'), { code: 'PRIVACY_STORE_REQUIRED' });
  }
  const begin = await beginRequest({ store, provider: 'shopify', topic: normalizedTopic, payload });
  if (begin.alreadyCompleted) {
    return { action: 'privacy_request_already_completed', topic: normalizedTopic, duplicate: true };
  }
  try {
    let outcome;
    if (normalizedTopic === 'customers/data_request') outcome = await handleDataRequest({ store, payload });
    else if (normalizedTopic === 'customers/redact') outcome = await handleCustomerRedact({ store, payload });
    else outcome = await handleShopRedact({ store });
    await finishRequest(begin.id, {
      status: 'completed',
      result: { schema: 'revluma-privacy-result-v1', ...outcome.summary, artifact: outcome.artifact ?? undefined },
    });
    await audit({ store, topic: normalizedTopic, action: outcome.action, context: outcome.summary });
    logger.info('privacy_request_completed', { store_id: store.id, topic: normalizedTopic, action: outcome.action, ...outcome.summary });
    const { artifact, ...publicOutcome } = outcome;
    return publicOutcome;
  } catch (error) {
    const errorType = error?.failed_step
      ? `${error.code || 'PRIVACY_ERROR'}:${error.failed_step}`
      : (error?.code || error?.name || 'privacy_processing_error');
    await finishRequest(begin.id, { status: 'failed', errorCode: errorType });
    logger.error('privacy_request_failed', { store_id: store.id, topic: normalizedTopic, error_type: errorType, failed_step: error?.failed_step || null });
    throw error;
  }
}

module.exports = {
  PRIVACY_TOPICS,
  isPrivacyTopic,
  requestKey,
  handleShopifyPrivacyWebhook,
};
