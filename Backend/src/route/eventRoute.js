/**
 * Revluma Event Ingestion Routes
 *
 * POST /api/v1/events/ingest        — single pixel event (Shopify webhook)
 * POST /api/v1/events/ingest/batch  — bulk historical import (CSV)
 *
 * Both endpoints are public — no JWT required.
 * Protected by ingestLimiter (high-volume rate limiter).
 */

const express    = require('express');
const router     = express.Router();
const controller = require('../controller/eventController');
const { ingestLimiter } = require('../middlewares/rateLimiter');

// Single event — Shopify pixel fires this in real time
router.post('/ingest',       ingestLimiter, controller.ingest);

// Batch import — CSV export from Shopify Admin for offline training
router.post('/ingest/batch', ingestLimiter, controller.ingestBatch);

module.exports = router;
