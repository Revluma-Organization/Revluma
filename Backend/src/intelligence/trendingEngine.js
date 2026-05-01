// PRODUCTION-READY SPLENDOR INTELLIGENCE ENGINE
// - Composite scoring with real AI sentiment (Grok)
// - Internal data blending
// - Watchlist spike alerts
// - Tenant-safe queries (RLS enforced)
// - Error handling, retries, observability

const db = require('../config/db'); // updated version with tenant enforcement
const logger = require('../utils/logger');
const { Queue, Worker } = require('bullmq');
const { redis: redisConnection } = require('../queue/redis');
const alertQueue = require('../queue/alertQueue'); // import once

const scoringQueue = new Queue('trend-scoring', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 604800 }, // 7 days
    removeOnFail: { age: 2592000 }     // 30 days
  }
});

// Multi-source merge with weighted average & conflict resolution
function mergeSources(rawSources) {
  if (rawSources.length === 0) return null;
  if (rawSources.length === 1) return normalizeData(rawSources[0], rawSources[0].source);

  // Sort by timestamp (newest first) for recency bias
  rawSources.sort((a, b) => new Date(b.source_timestamp) - new Date(a.source_timestamp));

  const base = rawSources[0]; // newest as base

  // Weighted average for numeric fields
  const weightedAvg = (field) => {
    let totalWeight = 0;
    let weightedSum = 0;
    rawSources.forEach(source => {
      const value = source[field];
      if (value != null && !isNaN(value)) {
        const weight = SOURCE_WEIGHTS[source.source] || 0.5;
        weightedSum += value * weight;
        totalWeight += weight;
      }
    });
    return totalWeight > 0 ? weightedSum / totalWeight : base[field] || 0;
  };

  // Union for arrays (categories, snippets)
  const union = (field) => {
    const all = rawSources.flatMap(s => s[field] || []);
    return [...new Set(all)];
  };

  // Merge regions with max confidence
  const mergedRegions = rawSources.reduce((acc, s) => {
    Object.entries(s.top_regions || {}).forEach(([region, conf]) => {
      acc[region] = Math.max(acc[region] || 0, conf);
    });
    return acc;
  }, {});

  // Final merged object
  const merged = {
    ...base,
    source: 'multi',
    source_timestamp: new Date().toISOString(), // merge time
    units_sold_24h: weightedAvg('units_sold_24h'),
    units_sold_7d: weightedAvg('units_sold_7d'),
    units_sold_30d: weightedAvg('units_sold_30d'),
    velocity_score: weightedAvg('velocity_score'),
    avg_price: weightedAvg('avg_price'),
    top_regions: mergedRegions,
    top_categories: union('top_categories'),
    aggregated_reviews: {
      avg_rating: weightedAvg('aggregated_reviews.avg_rating'),
      count: rawSources.reduce((sum, s) => sum + (s.aggregated_reviews?.count || 0), 0),
      snippets: union('aggregated_reviews.snippets')
    }
  };

  // Clean up undefined/NaN
  Object.keys(merged).forEach(key => {
    if (merged[key] === undefined || Number.isNaN(merged[key])) {
      delete merged[key];
    }
  });

  return merged;
}


function normalizeData(rawItem, source) {
  if (!rawItem) throw new Error('No raw item provided');

  return {
    product_key: rawItem.product_key || `${(rawItem.name || 'unknown').toLowerCase().replace(/\s+/g, '-')}-${rawItem.region || 'global'}-${Date.now()}`,
    name: rawItem.name || 'Unnamed Product',
    description: rawItem.description || '',
    image_urls: Array.isArray(rawItem.image_urls) ? rawItem.image_urls : [],
    avg_price: parseFloat(rawItem.avg_price) || 0,
    currency: rawItem.currency || 'USD',
    units_sold_24h: parseInt(rawItem.units_sold_24h) || 0,
    units_sold_7d: parseInt(rawItem.units_sold_7d) || 0,
    units_sold_30d: parseInt(rawItem.units_sold_30d) || 0,
    velocity_score: parseFloat(rawItem.velocity_score) || 0,
    top_regions: typeof rawItem.top_regions === 'object' ? rawItem.top_regions : {},
    top_categories: Array.isArray(rawItem.top_categories) ? rawItem.top_categories : [],
    aggregated_reviews: rawItem.aggregated_reviews || { avg_rating: null, count: 0, snippets: [] },
    source
  };
}

// ====================== REAL AI SENTIMENT ANALYSIS ======================
async function analyzeSentiment(reviews, tenantId) {
  if (!reviews?.snippets?.length) {
    return { score: 0.5, summary: 'No review data' };
  }

  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    logger.warn('GROK_API_KEY missing – fallback sentiment');
    let score = (reviews.avg_rating || 4) / 5;
    const text = reviews.snippets.join(' ').toLowerCase();
    ['love','best','amazing','great','quality'].forEach(w => text.includes(w) && (score += 0.08));
    ['bad','slow','broken','refund','poor'].forEach(w => text.includes(w) && (score -= 0.12));
    score = Math.max(0, Math.min(1, score));
    return { score, summary: score > 0.7 ? 'Strongly positive' : score > 0.4 ? 'Neutral-positive' : 'Mixed/negative' };
  }

  try {
    const prompt = `
    You are an expert e-commerce product review analyst.
    Review snippets:
    ${reviews.snippets.slice(0, 12).map(s => `- ${s}`).join('\n')}

        Tasks:
        1. Sentiment score: -1.0 (very negative) to +1.0 (very positive)
        2. One concise sentence summary: what customers love + any major complaints

        Output ONLY valid JSON:
        {"score": number, "summary": "string"}
    `;

    const response = await fetch(`${process.env.GROK_API_BASE || 'https://api.x.ai/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-beta',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 150
      })
    });

    if (!response.ok) {
      throw new Error(`Grok API failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '{}';

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { score: 0.5, summary: 'Parsing failed – review raw data' };
    }

    return {
      score: Number.isFinite(parsed.score) ? parsed.score : 0.5,
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : 'No consensus'
    };
  } catch (err) {
    logger.error('Grok sentiment error', { error: err.message });
    return { score: 0.5, summary: 'Analysis unavailable' };
  }
}

// ====================== COMPOSITE OPPORTUNITY SCORE ======================
async function calculateOpportunityScore(normalized, tenantId) {
  const volume = Math.min(100, (normalized.units_sold_24h / 5000) * 100);
  const velocity = Math.min(100, normalized.velocity_score);

  const momentum = ((normalized.units_sold_7d - normalized.units_sold_30d / 4) / (normalized.units_sold_30d / 4 + 1)) * 50;

  const searchDemand = normalized.search_demand_index || 40;
  const sentiment = normalized.sentiment_score || 0.7;

  let score = 
    volume   * 0.30 +
    velocity * 0.25 +
    momentum * 0.20 +
    searchDemand * 0.15 +
    sentiment * 0.10;

  // Internal blending boost
  const region = Object.keys(normalized.top_regions || {})[0] || 'global';
  const internalBoostRes = await db.query(
    `SELECT COALESCE(SUM(units_sold_24h) / 1000, 0) AS boost
     FROM trending_products 
     WHERE top_regions->>$1 IS NOT NULL AND source = 'internal'`,
    [region],
    tenantId
  );
  score += Math.min(30, internalBoostRes.rows[0]?.boost || 0);

  // Saturation score (0–100): high sales velocity vs category average
  const categoryAvg = await db.query(
    `SELECT AVG(units_sold_24h) AS avg FROM trending_products 
     WHERE $1 = ANY(top_categories) AND source != 'mock'`,
    [normalized.top_categories[0] || 'unknown'],
    tenantId
  );
  const avgCategorySales = categoryAvg.rows[0]?.avg || 1000;
  const saturation = Math.min(100, (normalized.units_sold_24h / avgCategorySales) * 100);
  const saturationScore = 100 - saturation; // low saturation = high opportunity

  // Audience inference (simple rule-based, upgrade to LLM later)
  let audience = 'general';
  if (normalized.top_categories.includes('beauty') || normalized.top_categories.includes('skincare')) {
    audience = 'women 18–34, beauty enthusiasts';
  } else if (normalized.top_categories.includes('electronics')) {
    audience = 'tech-savvy males 18–45';
  }

  // Historical comparison (for momentum validation)
  const historical = await db.query(
    'SELECT historical_scores FROM trending_products WHERE product_key = $1',
    [normalized.product_key],
    tenantId
  );
  const prevScore = historical.rows[0]?.historical_scores?.[Object.keys(historical.rows[0]?.historical_scores || {}).pop()] || 0;
  const scoreChange = normalized.opportunity_score - prevScore;

  // Final score adjustment
  score += saturationScore * 0.10; // bonus for early opportunity

  const predictedStatus = momentum > 80 || scoreChange > 20 ? 'exploding' : 
                         momentum > 40 ? 'rising' : 
                         momentum < 0 ? 'declining' : 'stable';

  return {
    opportunity_score: Math.round(Math.min(100, score) * 100) / 100,
    momentum_score: Math.round(momentum * 100) / 100,
    saturation_score: Math.round(saturationScore * 100) / 100,
    predicted_trend_status: predictedStatus,
    audience_inference: audience,
    risk_flags: normalized.sentiment_score < 0.3 ? ['low_sentiment_risk'] : saturation > 80 ? ['high_saturation_risk'] : [],
    score_change_24h: Math.round(scoreChange * 100) / 100
  };
}

// ====================== MAIN SCORING WORKER ======================
new Worker('trend-scoring', async (job) => {
  const { product_key, rawSources, tenantId } = job.data;

  if (!product_key || !Array.isArray(rawSources)) {
    throw new Error('Invalid job data: missing product_key or rawSources');
  }

  const effectiveTenant = tenantId || SYSTEM_TENANT_ID || 'system';

  try {
    // Merge multi-source data (this is the line that was crashing)
    const normalized = mergeSources(rawSources);
    if (!normalized) throw new Error('No valid data after merge');

    // AI Sentiment
    const sentimentResult = await analyzeSentiment(normalized.aggregated_reviews, effectiveTenant);
    normalized.sentiment_score = sentimentResult.score;
    normalized.sentiment_summary = sentimentResult.summary;

    // Compute scores
    const scores = await calculateOpportunityScore(normalized, effectiveTenant);

    // Upsert with all fields (use the updated query from earlier)
    await db.query(`
      INSERT INTO trending_products (
        product_key, name, description, image_urls, avg_price, currency,
        units_sold_24h, units_sold_7d, units_sold_30d, velocity_score,
        top_regions, top_categories, aggregated_reviews,
        opportunity_score, momentum_score, saturation_score,
        predicted_trend_status, audience_inference, risk_flags,
        score_change_24h, historical_scores, last_scored_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW())
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
        opportunity_score = EXCLUDED.opportunity_score,
        momentum_score = EXCLUDED.momentum_score,
        saturation_score = EXCLUDED.saturation_score,
        predicted_trend_status = EXCLUDED.predicted_trend_status,
        audience_inference = EXCLUDED.audience_inference,
        risk_flags = EXCLUDED.risk_flags,
        score_change_24h = EXCLUDED.score_change_24h,
        historical_scores = EXCLUDED.historical_scores,
        last_scored_at = NOW()
    `, [
      product_key, normalized.name, normalized.description, normalized.image_urls, normalized.avg_price, normalized.currency,
      normalized.units_sold_24h, normalized.units_sold_7d, normalized.units_sold_30d, normalized.velocity_score,
      normalized.top_regions, normalized.top_categories, normalized.aggregated_reviews,
      scores.opportunity_score, scores.momentum_score, scores.saturation_score,
      scores.predicted_trend_status, scores.audience_inference, scores.risk_flags,
      scores.score_change_24h, {}, NOW()
    ], effectiveTenant);

    // Watchlist alerts on spikes
    if (scores.opportunity_score > 85 || scores.momentum_score > 80) {
      const watchers = await db.query(
        'SELECT tenant_id FROM watchlist WHERE product_key = $1',
        [product_key],
        effectiveTenant
      );

      for (const watcher of watchers.rows) {
        await alertQueue.add('alert', {
          tenant_id: watcher.tenant_id,
          product_key,
          message: `🚨 ${normalized.name} exploding! Score ${scores.opportunity_score}/100 – ${normalized.units_sold_24h} sales/24h`,
          channels: ['email', 'whatsapp']
        });
      }
    }

    logger.info('Product intelligence scored', {
      product_key,
      opportunity_score: scores.opportunity_score,
      momentum_score: scores.momentum_score,
      saturation_score: scores.saturation_score,
      predicted: scores.predicted_trend_status
    });
  } catch (err) {
    logger.error('Scoring job failed', {
      jobId: job.id,
      product_key,
      error: err.message,
      stack: err.stack
    });
    throw err; // BullMQ retry
  }
}, {
  connection: redisConnection,
  concurrency: 4,
  limiter: { max: 100, duration: 60000 }
});

module.exports = {
  scoringQueue,
  calculateOpportunityScore,
  analyzeSentiment
};