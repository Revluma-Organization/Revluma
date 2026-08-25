/**
 * Revluma Event Ingestion Controller
 *
 * Receives raw Shopify pixel events, validates them, persists to DB,
 * then triggers the Python feature pipeline for ML inference.
 *
 * Security:
 *   - Public endpoint (Shopify webhooks are not authenticated users)
 *   - store_id validated against DB before processing
 *   - Rate limited at the router level (ingestLimiter)
 *   - platform/page/device bundled into payload per Python pipeline spec
 *
 * Pipeline:
 *   Shopify pixel → POST /api/v1/events/ingest → save to events table
 *   → POST /api/features/compute → Python ML pipeline → prediction
 *   → return prediction to pixel for real-time offer display
 */

const { prisma }  = require('../configs/database');
const axios        = require('axios');
const logger       = require('../utils/logger');

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
      anonymous_id,
      merchant_id,
      timestamp,
      payload = {},
      // These come from the pixel root — must be bundled into payload
      platform,
      page,
      device,
    } = req.body;

    // ── Validate required fields ──────────────────────────────────────────────
    const missing = [];
    if (!store_id)   missing.push('store_id');
    if (!session_id) missing.push('session_id');
    if (!event_type) missing.push('event_type');

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Missing required fields: ${missing.join(', ')}` },
      });
    }

    // ── Validate store exists ─────────────────────────────────────────────────
    const store = await prisma.stores.findUnique({ where: { id: store_id } });
    if (!store) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Store not found.' },
      });
    }

    // ── Bundle platform/page/device into payload per David's spec ────────────
    // The events table has no columns for these — they live in payload JSONB.
    // The Python pipeline reads them from payload.referrer and payload.device_type.
    const enrichedPayload = {
      ...payload,
      ...(platform && { platform }),
      ...(page     && { referrer: page }),
      ...(device   && { device_type: device }),
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
        ...(timestamp && { created_at: new Date(timestamp) }),
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
    const records = events.map(e => ({
      store_id,
      session_id:   e.session_id   || `batch-${Date.now()}-${Math.random()}`,
      event_type:   e.event_type   || 'unknown',
      customer_id:  e.customer_id  || null,
      anonymous_id: e.anonymous_id || null,
      payload: {
        ...((e.payload) || {}),
        ...(e.platform && { platform: e.platform }),
        ...(e.page     && { referrer: e.page }),
        ...(e.device   && { device_type: e.device }),
        _batch_import: true,
      },
      ...(e.timestamp && { created_at: new Date(e.timestamp) }),
    }));

    const result = await prisma.events.createMany({
      data: records,
      skipDuplicates: true,
    });

    logger.info('batch_ingested', { store_id, count: result.count });

    return res.status(201).json({
      success: true,
      ingested: result.count,
      skipped:  events.length - result.count,
    });

  } catch (error) {
    next(error);
  }
};
