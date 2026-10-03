/**
 * Storefront pixel ingestion routes.
 *
 * POST /api/v1/events/ingest       - single real-time pixel event
 * POST /api/v1/events/ingest/batch - bounded pixel event batch
 *
 * Both endpoints use a signed store tracking key and a dedicated rate limiter.
 */

const express = require('express');
const controller = require('../controller/eventController');
const { ingestLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

router.post('/ingest', ingestLimiter, controller.ingest);
router.post('/ingest/batch', ingestLimiter, controller.ingestBatch);

module.exports = router;
