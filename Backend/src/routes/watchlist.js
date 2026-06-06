const express = require('express');
const router = express.Router();
const { authenticate } = require("../middleware/sessionAuth");
const db = require('../config/db');
const logger = require('../utils/logger');
const redisModule = require('../queue/redis');
const redis = redisModule.redis || redisModule.default || redisModule; // shared Redis client

const CACHE_PREFIX = 'watchlist:';
const CACHE_TTL = 60; // 1 min – watchlist changes infrequently

router.use(authenticate); // All endpoints protected

// POST /api/watchlist – Add or update watchlist entry
router.post('/', async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { product_key, notes } = req.body;

  if (!product_key || typeof product_key !== 'string' || product_key.length > 255) {
    return res.status(400).json({ error: 'Valid product_key required (string, max 255 chars)' });
  }

  if (notes && (typeof notes !== 'string' || notes.length > 1000)) {
    return res.status(400).json({ error: 'Notes must be string, max 1000 chars' });
  }

  const correlationId = req.headers['x-correlation-id'] || 'wl-' + Date.now();

  try {
    const result = await db.query(
      `INSERT INTO watchlist (tenant_id, product_key, notes) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (tenant_id, product_key) 
       DO UPDATE SET notes = EXCLUDED.notes, added_at = NOW()
       RETURNING id, product_key, notes, added_at`,
      [tenant_id, product_key, notes || null],
      tenant_id // RLS-safe
    );

    // Invalidate cache for this tenant
    await redis.del(`${CACHE_PREFIX}list:${tenant_id}`);

    logger.info('Watchlist entry added/updated', {
      correlationId,
      tenant_id,
      product_key,
      action: result.rowCount ? 'created' : 'updated'
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error('Watchlist POST failed', {
      correlationId,
      tenant_id,
      product_key,
      error: err.message,
      stack: err.stack
    });

    let status = 500;
    let message = 'Failed to add/update watchlist entry';

    if (err.code === '23505') { // unique violation
      status = 409;
      message = 'Product already in watchlist';
    }

    res.status(status).json({ error: message });
  }
});

// GET /api/watchlist – List user's watchlist (paginated)
router.get('/', async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { limit = 20, page = 1 } = req.query;

  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const parsedPage = Math.max(1, parseInt(page) || 1);
  const offset = (parsedPage - 1) * parsedLimit;

  const cacheKey = `${CACHE_PREFIX}list:${tenant_id}:${parsedLimit}:${parsedPage}`;

  try {
    // Check Redis cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Count total
    const countRes = await db.query(
      'SELECT COUNT(*) FROM watchlist WHERE tenant_id = $1',
      [tenant_id],
      tenant_id
    );
    const total = parseInt(countRes.rows[0].count);

    // Fetch paginated data with product details
    const result = await db.query(
      `SELECT w.id, w.product_key, w.notes, w.added_at, w.last_alerted_at,
              p.name, p.description, p.image_urls, p.avg_price, p.currency,
              p.units_sold_24h, p.opportunity_score, p.predicted_trend_status
       FROM watchlist w
       LEFT JOIN trending_products p ON w.product_key = p.product_key
       WHERE w.tenant_id = $1
       ORDER BY w.added_at DESC
       LIMIT $2 OFFSET $3`,
      [tenant_id, parsedLimit, offset],
      tenant_id
    );

    const response = {
      data: result.rows,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    };

    // Cache
    await redis.set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL);

    logger.debug('Watchlist fetched', {
      tenant_id,
      count: result.rowCount,
      page: parsedPage
    });

    res.json(response);
  } catch (err) {
    logger.error('Watchlist GET failed', {
      tenant_id,
      error: err.message,
      params: req.query
    });
    res.status(500).json({ error: 'Failed to fetch watchlist' });
  }
});

// DELETE /api/watchlist/:product_key
router.delete('/:product_key', async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { product_key } = req.params;

  if (!product_key) return res.status(400).json({ error: 'product_key required' });

  const correlationId = req.headers['x-correlation-id'] || 'wl-del-' + Date.now();

  try {
    const result = await db.query(
      'DELETE FROM watchlist WHERE tenant_id = $1 AND product_key = $2 RETURNING id',
      [tenant_id, product_key],
      tenant_id
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Product not in watchlist' });
    }

    // Invalidate cache
    await redis.del(`${CACHE_PREFIX}list:${tenant_id}`);

    logger.info('Watchlist entry deleted', { correlationId, tenant_id, product_key });

    res.json({ message: 'Removed from watchlist' });
  } catch (err) {
    logger.error('Watchlist DELETE failed', { correlationId, tenant_id, product_key, error: err.message });
    res.status(500).json({ error: 'Failed to remove from watchlist' });
  }
});

module.exports = router;