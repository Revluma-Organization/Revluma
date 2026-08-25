const prisma = require("../configs/database");

const { prisma }  = require('../configs/database');
const axios        = require('axios');
const logger       = require('../utils/logger');

const ALLOWED_EVENT_TYPES = [
  'PAGE_VIEW',
  'SCROLL',
  'PRODUCT_VIEW',
  'ADD_TO_CART',
  'REMOVE_FROM_CART',
  'CHECKOUT_STARTED',
  'CHECKOUT_STEP',
  'PURCHASE_COMPLETED',
  'CUSTOMER_CREATED',
  'TEXT_COPIED',
  'COUPON_REJECTED',
  'TAB_SWITCH',
  'EXIT_INTENT',
  'FAILED_PAYMENT',
];

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'https://revluma-python.onrender.com';
const ML_INTERNAL_KEY    = process.env.ML_INTERNAL_KEY    || '';

// ── POST /api/v1/events/ingest ────────────────────────────────────────────────
exports.ingest = async (req, res, next) => {
  try {
    const {
      store_id,
      session_id,
      event_type,
      customer_id,
      payload,
    } = req.body;

    // Validate required fields
    const missingFields = [];

    if (!store_id) missingFields.push("store_id");
    if (!session_id) missingFields.push("session_id");
    if (!event_type) missingFields.push("event_type");

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
    }

    if (!ALLOWED_EVENT_TYPES.includes(event_type)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Unsupported event type: ${event_type}`,
        },
      });
    }

    if (
      !timestamp ||
      typeof timestamp !== 'string' ||
      Number.isNaN(Date.parse(timestamp))
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Valid ISO 8601 timestamp is required.',
        },
      });
    }

    const eventTimestamp = new Date(timestamp);

    // ── Validate store exists ─────────────────────────────────────────────────
    const store = await prisma.stores.findUnique({ where: { id: store_id } });
    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found.",
      });
    }

    // ── Bundle platform/page/device into payload per David's spec ────────────
    // The events table has no columns for these — they live in payload JSONB.
    // The Python pipeline reads them from payload.referrer and payload.device_type.
    // ── Normalize page data ────────────────────────────────────────────────────

const pageUrl = page?.url || null;
const pageReferrer = page?.referrer || null;

// ── Normalize device data ──────────────────────────────────────────────────
const deviceType = device?.type || null;
const userAgent = device?.user_agent || null;

// ── Build ML-compatible payload ────────────────────────────────────────────
const enrichedPayload = {
  ...payload,

  ...(platform && { platform }),

  ...(pageUrl && { page_url: pageUrl }),
  ...(pageReferrer && { referrer: pageReferrer }),

  ...(deviceType && { device_type: deviceType }),
  ...(userAgent && { user_agent: userAgent }),

  // Preserve the original event timestamp
  timestamp,
};

    // ── Persist raw event ─────────────────────────────────────────────────────
    const event = await prisma.events.create({
      data: {
        store_id,
        session_id,
        event_type,
        customer_id:  customer_id  || null,
        anonymous_id: anonymous_id || null,
        payload:      enrichedPayload,
        // timestamp accepted as-is; Python pipeline accepts both timestamp and created_at
        created_at: eventTimestamp,
      },
    });

    logger.info('event_ingested', {
      event_id:   event.id,
      store_id,
      session_id,
      event_type,
      customer_id: customer_id || null,
    });

    // ── Trigger Python feature pipeline (non-blocking) ────────────────────────
    // Fire-and-forget — we respond to Shopify immediately.
    // The feature computation runs async and stores its output for ML training.
    // Only trigger when we have enough context for a meaningful prediction.
    let prediction = null;

    if (customer_id || anonymous_id) {
      try {
        const featureResponse = await axios.post(
          `${PYTHON_SERVICE_URL}/api/features/compute`,
          {
            customer_id:  customer_id  || null,
            anonymous_id: anonymous_id || null,
            session_id,
            store_id,
            merchant_id:  merchant_id || store.organization_id,
            timestamp,

          },
          {
            headers: {
              'Content-Type':  'application/json',
              'X-Internal-Key': ML_INTERNAL_KEY,
            },
            timeout: 4000, // 4s — fast enough for real-time pixel response
          }
        );

        if (featureResponse.data?.success) {
          prediction = featureResponse.data.prediction || null;
          logger.info('feature_pipeline_triggered', {
            session_id,
            store_id,
            show_offer:  prediction?.show_offer,
            offer_type:  prediction?.offer_type,
          });
        }
      } catch (pipelineErr) {
        // Never fail the ingestion because the pipeline errored.
        // Events are saved. The pipeline can be triggered retroactively.
        logger.warn('feature_pipeline_error', {
          session_id,
          error: pipelineErr.message,
        });
      }
    }

    // ── Respond to pixel ──────────────────────────────────────────────────────
    return res.status(201).json({
      success:    true,
      event_id:   event.id,
      prediction: prediction || null,
    });

  } catch (error) {
    next(error);
  }
};

// ── POST /api/v1/events/ingest/batch ─────────────────────────────────────────
// For bulk historical imports (CSV export from Shopify Admin)
exports.ingestBatch = async (req, res, next) => {
  try {
    const { store_id, events } = req.body;

    if (!store_id || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'store_id and events[] required.' },
      });
    }

    if (events.length > 1000) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Maximum 1000 events per batch.' },
      });
    }

    const store = await prisma.stores.findUnique({ where: { id: store_id } });
    if (!store) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Store not found.' },
      });
    }

    // Build records
    const invalidEventIndex = events.findIndex(e =>
      !e ||
      !e.session_id ||
      !ALLOWED_EVENT_TYPES.includes(e.event_type) ||
      typeof e.timestamp !== 'string' ||
      Number.isNaN(Date.parse(e.timestamp))
    );

    if (invalidEventIndex !== -1) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid event at index ${invalidEventIndex}. Each event requires a valid session_id, event_type, and timestamp.`,
        },
      });
    }

    const records = events.map(e => ({
      store_id,
      session_id:   e.session_id   || `batch-${Date.now()}-${Math.random()}`,
      event_type:   e.event_type   || 'unknown',
      customer_id:  e.customer_id  || null,
      anonymous_id: e.anonymous_id || null,
      payload: {
        ...(e.payload || {}),
        ...(e.platform && { platform: e.platform }),
        ...(e.page?.url && { page_url: e.page.url }),
        ...(e.page?.referrer && { referrer: e.page.referrer }),
        ...(e.device?.type && { device_type: e.device.type }),
        ...(e.device?.user_agent && { user_agent: e.device.user_agent }),
        ...(e.timestamp && { timestamp: e.timestamp }),
        _batch_import: true,
      },
      created_at: new Date(e.timestamp),
    }));

    const result = await prisma.events.createMany({
      data: records,
      skipDuplicates: true,
    });

    logger.info('batch_ingested', { store_id, count: result.count });

    return res.status(201).json({
      success: true,
      message: "Event ingested successfully.",
      data: event,
    });

  } catch (error) {
    next(error);
  }
};
