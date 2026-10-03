const crypto = require('crypto');
const { prisma } = require('../configs/database');
const logger = require('../utils/logger');

const ALLOWED_EVENT_TYPES = new Set([
  'PAGE_VIEW', 'SCROLL', 'PRODUCT_VIEW', 'ADD_TO_CART', 'REMOVE_FROM_CART',
  'CHECKOUT_STARTED', 'CHECKOUT_STEP', 'PURCHASE_COMPLETED', 'CUSTOMER_CREATED',
  'TEXT_COPIED', 'COUPON_REJECTED', 'TAB_SWITCH', 'EXIT_INTENT',
  'FAILED_PAYMENT', 'FIELD_FOCUS', 'FIELD_BLUR',
]);

function getTrackingSecret() {
  return process.env.EVENT_TRACKING_SECRET || process.env.JWT_SECRET;
}

function createStoreTrackingKey(storeId) {
  const secret = getTrackingSecret();
  if (!secret) throw new Error('EVENT_TRACKING_SECRET or JWT_SECRET is required.');
  const signature = crypto.createHmac('sha256', secret).update(storeId).digest('hex');
  return `${storeId}.${signature}`;
}

function resolveStoreId(trackingKey) {
  const secret = getTrackingSecret();
  if (typeof trackingKey !== 'string' || !secret) return null;
  const separator = trackingKey.lastIndexOf('.');
  if (separator <= 0) return null;
  const storeId = trackingKey.slice(0, separator);
  const signature = trackingKey.slice(separator + 1);
  const expected = crypto.createHmac('sha256', secret).update(storeId).digest('hex');
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return storeId;
}

function enrichPayload(event) {
  return {
    ...(event.payload || {}),
    ...(event.platform ? { platform: event.platform } : {}),
    ...(event.page?.url ? { page_url: event.page.url } : {}),
    ...(event.page?.referrer ? { referrer: event.page.referrer } : {}),
    ...(event.device?.type ? { device_type: event.device.type } : {}),
    ...(event.device?.user_agent ? { user_agent: event.device.user_agent } : {}),
    timestamp: event.timestamp,
  };
}

function validateEvent(event) {
  if (!event || typeof event !== 'object') return 'Event must be an object.';
  if (typeof event.id !== 'string' || !event.id.trim()) return 'Event id is required.';
  if (typeof event.session_id !== 'string' || !event.session_id.trim()) return 'session_id is required.';
  if (!ALLOWED_EVENT_TYPES.has(event.event_type)) return `Unsupported event type: ${event.event_type}`;
  if (typeof event.timestamp !== 'string' || Number.isNaN(Date.parse(event.timestamp))) {
    return 'Valid ISO 8601 timestamp is required.';
  }
  return null;
}

async function resolveStoreAndCustomer(storeTrackingKey, customerId, res) {
  const storeId = resolveStoreId(storeTrackingKey);
  const store = storeId
    ? await prisma.stores.findUnique({ where: { id: storeId }, select: { id: true } })
    : null;

  if (!store) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invalid store tracking key.' } });
    return null;
  }

  if (customerId) {
    const customer = await prisma.customers.findFirst({
      where: { id: customerId, store_id: store.id },
      select: { id: true },
    });
    if (!customer) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'customer_id does not belong to the receiving store.' },
      });
      return null;
    }
  }
  return store;
}

async function batchCustomersBelongToStore(storeId, events) {
  const customerIds = [...new Set(events.map((event) => event.customer_id).filter(Boolean))];
  if (customerIds.length === 0) return true;
  const count = await prisma.customers.count({
    where: { store_id: storeId, id: { in: customerIds } },
  });
  return count === customerIds.length;
}

async function findExistingEvent(storeId, sourceEventId) {
  return prisma.events.findFirst({
    where: { store_id: storeId, source: 'pixel', source_event_id: sourceEventId },
    select: { id: true },
  });
}

async function createEvent(tx, storeId, event) {
  return tx.events.create({
    data: {
      store_id: storeId,
      session_id: event.session_id,
      event_type: event.event_type,
      customer_id: event.customer_id || null,
      anonymous_id: event.anonymous_id || null,
      payload: enrichPayload(event),
      created_at: new Date(event.timestamp),
      source: 'pixel',
      source_event_id: event.id,
      received_at: new Date(),
    },
  });
}

exports.ingest = async (req, res, next) => {
  try {
    const event = req.body || {};
    const missing = ['store_tracking_key', 'id', 'session_id', 'event_type']
      .filter((field) => !event[field]);

    if (missing.length) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Missing required fields: ${missing.join(', ')}` },
      });
    }

    const validationError = validateEvent(event);
    if (validationError) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: validationError } });
    }

    const store = await resolveStoreAndCustomer(event.store_tracking_key, event.customer_id, res);
    if (!store) return;

    const existing = await findExistingEvent(store.id, event.id);
    if (existing) return res.status(200).json({ success: true, event_id: existing.id, duplicate: true });

    const created = await prisma.$transaction(async (tx) => {
      const persisted = await createEvent(tx, store.id, event);
      await tx.feature_jobs.create({
        data: {
          store_id: store.id,
          event_id: persisted.id,
          idempotency_key: `pixel:${store.id}:${event.id}`,
        },
      });
      return persisted;
    });
    logger.info('event_ingested', { event_id: created.id, store_id: store.id, event_type: event.event_type });
    return res.status(201).json({ success: true, event_id: created.id });
  } catch (error) {
    if (error.code === 'P2002') {
      const storeId = resolveStoreId(req.body?.store_tracking_key);
      const existing = await findExistingEvent(storeId, req.body?.id);
      return res.status(200).json({ success: true, event_id: existing?.id || null, duplicate: true });
    }
    next(error);
  }
};

exports.ingestBatch = async (req, res, next) => {
  try {
    const { store_tracking_key: trackingKey, events } = req.body || {};
    if (!trackingKey || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'store_tracking_key and events[] required.' } });
    }
    if (events.length > 1000) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Maximum 1000 events per batch.' } });
    }

    const store = await resolveStoreAndCustomer(trackingKey, null, res);
    if (!store) return;

    const invalidIndex = events.findIndex((event) => validateEvent(event));
    if (invalidIndex !== -1) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: `Invalid event at index ${invalidIndex}.` } });
    }

    if (!(await batchCustomersBelongToStore(store.id, events))) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'One or more customer_id values do not belong to the receiving store.',
        },
      });
    }

    const records = events.map((event) => ({
      store_id: store.id,
      session_id: event.session_id,
      event_type: event.event_type,
      customer_id: event.customer_id || null,
      anonymous_id: event.anonymous_id || null,
      payload: enrichPayload(event),
      created_at: new Date(event.timestamp),
      source: 'pixel',
      source_event_id: event.id,
      received_at: new Date(),
    }));

    const result = await prisma.$transaction(async (tx) => {
      const inserted = await tx.events.createMany({ data: records, skipDuplicates: true });
      const persistedEvents = await tx.events.findMany({
        where: {
          store_id: store.id,
          source: 'pixel',
          source_event_id: { in: events.map((event) => event.id) },
        },
        select: { id: true, source_event_id: true },
      });
      await tx.feature_jobs.createMany({
        data: persistedEvents.map((persisted) => ({
          store_id: store.id,
          event_id: persisted.id,
          idempotency_key: `pixel:${store.id}:${persisted.source_event_id}`,
        })),
        skipDuplicates: true,
      });
      return inserted;
    });
    logger.info('batch_ingested', { store_id: store.id, count: result.count });
    return res.status(201).json({ success: true, ingested: result.count, skipped: events.length - result.count });
  } catch (error) {
    next(error);
  }
};

exports.createStoreTrackingKey = createStoreTrackingKey;
