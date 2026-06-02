const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');
const { authenticate } = require('../middleware/sessionAuth');
const redis = require('../queue/redis').redis; 

const CACHE_TTL = 300; // 5 min
const CACHE_PREFIX = 'trending:';

// Rate limit suggestion (apply in server.js or here)
const limiter = require('express-rate-limit')({
  windowMs: 60 * 1000, // 1 min
  max: 100, // 100 req/min per IP
  message: { error: 'Too many requests – slow down' }
});

// Protect all routes
router.use(authenticate);
router.use(limiter);

// ====================== GET /api/trending ======================
router.get('/', async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { region, category, keyword, limit = 20, page = 1, sort = 'velocity_desc' } = req.query;

  // Validation
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const parsedPage = Math.max(1, parseInt(page) || 1);
  if (isNaN(parsedLimit) || isNaN(parsedPage)) {
    return res.status(400).json({ error: 'Invalid limit or page' });
  }

  // Cache key (tenant-specific)
  const cacheKey = `${CACHE_PREFIX}query:${tenant_id}:${JSON.stringify({ region, category, keyword, limit: parsedLimit, page: parsedPage, sort })}`;

  try {
    // Check Redis cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Build safe WHERE (parameterized)
    const whereParts = [];
    const params = [];
    let idx = 1;

    if (region) {
      whereParts.push(`top_regions->>$ ${idx} IS NOT NULL`);
      params.push(region);
      idx++;
    }
    if (category) {
      whereParts.push(`$${idx} = ANY(top_categories)`);
      params.push(category);
      idx++;
    }
    if (keyword) {
      whereParts.push(`name ILIKE $${idx}`);
      params.push(`%${keyword}%`);
      idx++;
    }

    const whereSql = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';

    // Sorting (safe enum)
    let orderBy = 'opportunity_score DESC';
    if (sort === 'velocity_desc') orderBy = 'velocity_score DESC';
    if (sort === 'sales_24h_desc') orderBy = 'units_sold_24h DESC';
    if (sort === 'price_asc') orderBy = 'avg_price ASC';

    // Pagination
    const offset = (parsedPage - 1) * parsedLimit;

    // Total count query (accurate pagination)
    const countQuery = `SELECT COUNT(*) FROM trending_products ${whereSql}`;
    const countRes = await db.query(countQuery, params, tenant_id);
    const total = parseInt(countRes.rows[0].count);

    // Data query
    const dataQuery = `
      SELECT id, product_key, name, description, image_urls, avg_price, currency,
             units_sold_24h, units_sold_7d, units_sold_30d, velocity_score,
             top_regions, top_categories, aggregated_reviews,
             opportunity_score, momentum_score, predicted_trend_status,
             sentiment_score, sentiment_summary, risk_flags,
             trending_since, last_updated
      FROM trending_products
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(parsedLimit, offset);

    const result = await db.query(dataQuery, params, tenant_id);

    const response = {
      data: result.rows,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    };

    // Cache in Redis
    await redis.set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL);

    logger.info('Trending query served', { tenant_id, params: req.query, count: result.rowCount });

    res.json(response);
  } catch (err) {
    logger.error('Trending query error', { tenant_id, error: err.message, params: req.query });
    res.status(500).json({ error: 'Failed to fetch trending products' });
  }
});

// ====================== POST /api/trending (Admin ingest – protected) ======================
router.post('/', authenticate, async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const {
    product_key, name, description, image_urls, avg_price, currency,
    units_sold_24h = 0, units_sold_7d = 0, units_sold_30d = 0,
    velocity_score, top_regions = {}, top_categories = [],
    external_sources = {}, aggregated_reviews = { avg_rating: null, count: 0 }
  } = req.body;

  if (!product_key || !name) {
    return res.status(400).json({ error: 'product_key and name required' });
  }

  try {
    const result = await db.query(`
      INSERT INTO trending_products (
        product_key, name, description, image_urls, avg_price, currency,
        units_sold_24h, units_sold_7d, units_sold_30d, velocity_score,
        top_regions, top_categories, external_sources, aggregated_reviews,
        trending_since, last_updated
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
      ON CONFLICT (product_key) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        image_urls = EXCLUDED.image_urls,
        avg_price = EXCLUDED.avg_price,
        units_sold_24h = EXCLUDED.units_sold_24h,
        units_sold_7d = EXCLUDED.units_sold_7d,
        units_sold_30d = EXCLUDED.units_sold_30d,
        velocity_score = EXCLUDED.velocity_score,
        top_regions = EXCLUDED.top_regions,
        top_categories = EXCLUDED.top_categories,
        aggregated_reviews = EXCLUDED.aggregated_reviews,
        last_updated = NOW()
      RETURNING id
    `, [
      product_key, name, description, image_urls, avg_price, currency,
      units_sold_24h, units_sold_7d, units_sold_30d, velocity_score,
      top_regions, top_categories, external_sources, aggregated_reviews
    ], tenant_id); // admin tenant or system

    // Invalidate cache for this product (precise)
    await redis.del(`${CACHE_PREFIX}query:${tenant_id}:*${product_key}*`);

    logger.info('Trending product upserted', { tenant_id, product_key });

    res.status(201).json({ message: 'Trending product upserted', id: result.rows[0].id });
  } catch (err) {
    logger.error('Trending ingest error', { tenant_id, error: err.message });
    res.status(400).json({ error: err.message.includes('duplicate') ? 'Product key already exists' : 'Invalid data' });
  }
});

// ====================== INTELLIGENCE ENDPOINT ======================
router.get('/intelligence', authenticate, async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { region, category, min_score = 70, status, limit = 50 } = req.query;

  const parsedMinScore = Math.min(100, Math.max(0, parseFloat(min_score) || 70));
  const parsedLimit = Math.min(200, Math.max(1, parseInt(limit) || 50));

  try {
    let query = `
      SELECT p.*,
             CASE WHEN w.id IS NOT NULL THEN true ELSE false END as is_watched,
             p.sentiment_summary
      FROM trending_products p
      LEFT JOIN watchlist w ON p.product_key = w.product_key AND w.tenant_id = $1
      WHERE p.opportunity_score >= $2
    `;
    let params = [tenant_id, parsedMinScore];
    let idx = 3;

    if (region) {
      query += ` AND p.top_regions->>$ ${idx} IS NOT NULL`;
      params.push(region);
      idx++;
    }
    if (category) {
      query += ` AND $${idx} = ANY(p.top_categories)`;
      params.push(category);
      idx++;
    }
    if (status) {
      query += ` AND p.predicted_trend_status = $${idx}`;
      params.push(status);
      idx++;
    }

    query += ` ORDER BY p.opportunity_score DESC LIMIT $${idx}`;
    params.push(parsedLimit);

    const result = await db.query(query, params, tenant_id);

    const response = {
      summary: `Found ${result.rowCount} high-potential products`,
      exploding: result.rows.filter(r => r.predicted_trend_status === 'exploding'),
      data: result.rows
    };

    res.json(response);
  } catch (err) {
    logger.error('Intelligence query error', { tenant_id, error: err.message });
    res.status(500).json({ error: 'Intelligence query failed' });
  }
});

// ====================== EXPORT & AD COPY ======================
router.get('/export', authenticate, async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { region, category, min_score = 50 } = req.query;

  const parsedMinScore = Math.max(0, parseFloat(min_score) || 50);

  try {
    const result = await db.query(
      `SELECT p.name, p.avg_price, p.units_sold_24h, p.opportunity_score, p.predicted_trend_status, p.sentiment_summary
       FROM trending_products p
       LEFT JOIN watchlist w ON p.product_key = w.product_key AND w.tenant_id = $1
       WHERE ($2::text IS NULL OR p.top_regions->>$2 IS NOT NULL)
         AND ($3::text IS NULL OR $3 = ANY(p.top_categories))
         AND p.opportunity_score >= $4
       ORDER BY p.opportunity_score DESC LIMIT 200`,
      [tenant_id, region, category, parsedMinScore],
      tenant_id
    );

    if (result.rowCount === 0) return res.status(200).send('No data');

    const csvRows = [
      'Name,Price (avg),Sales 24h,Opportunity Score,Trend Status,Sentiment Summary',
      ...result.rows.map(r => `"${r.name.replace(/"/g, '""')}",${r.avg_price},${r.units_sold_24h},${r.opportunity_score},${r.predicted_trend_status},"${(r.sentiment_summary || '').replace(/"/g, '""')}"`)
    ];

    res.header('Content-Type', 'text/csv');
    res.attachment('splendor_trending_export.csv');
    res.send(csvRows.join('\n'));
  } catch (err) {
    logger.error('CSV export failed', { tenant_id, error: err.message });
    res.status(500).json({ error: 'Export failed' });
  }
});

router.get('/ad-copy/:product_key', authenticate, async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { product_key } = req.params;

  if (!product_key) return res.status(400).json({ error: 'product_key required' });

  try {
    const result = await db.query(
      'SELECT * FROM trending_products WHERE product_key = $1',
      [product_key],
      tenant_id
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Product not found' });

    const p = result.rows[0];
    const copy = `
      🔥 HOT ALERT: ${p.name} is trending HARD!
      ${p.units_sold_24h}+ sold in last 24h • Score: ${p.opportunity_score}/100
      ${p.sentiment_summary || 'Customers loving it!'}
      Price: ${p.avg_price} ${p.currency}
      Add to your store NOW before stock runs out!
      #Trending #TikTokShop #EcommerceWins
    `.trim();

    res.json({ ad_copy: copy, product: p });
  } catch (err) {
    logger.error('Ad copy generation failed', { tenant_id, product_key, error: err.message });
    res.status(500).json({ error: 'Failed to generate ad copy' });
  }
});

module.exports = router;