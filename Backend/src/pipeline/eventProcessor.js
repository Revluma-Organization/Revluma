// ============================================================
// EVENT PROCESSING WORKER
// ============================================================
// Central worker for processing all events from the ingestion pipeline.
// Handles cart abandonment detection, recovery scoring, and orchestration.

const { Worker } = require('bullmq');
const { redis: redisConnection } = require('../queue/redis');
const db = require('../config/db');
const logger = require('../utils/logger');

// Import intelligence modules
const { IdentityResolutionService, EVENT_TYPES } = require('../intelligence/identityResolution');
const { IngestionPipeline, handleCartAbandoned, handleCheckoutCompleted } = require('../pipeline/eventStore');
const { ActionEngine } = require('../intelligence/recoveryEngine');
const { recoveryQueue } = require('../queue/recoveryQueue');

// ============================================================
// PIPELINE SETUP
// ============================================================

const pipeline = new IngestionPipeline();

// Register event handlers
pipeline.on(EVENT_TYPES.CART_ABANDONED, handleCartAbandoned);
pipeline.on(EVENT_TYPES.CHECKOUT_COMPLETED, handleCheckoutCompleted);

// Initialize services
const identityService = new IdentityResolutionService();
const recoveryEngine = new ActionEngine();

// ============================================================
// WORKER PROCESSOR
// ============================================================

const eventWorker = new Worker('event-processor', async (job) => {
  const { eventType, tenantId, payload, identifiers } = job.data;

  const correlationId = job.id || `evt-${Date.now()}`;

  try {
    logger.info('Processing event', { eventType, tenantId, correlationId });

    // Step 1: Resolve or create customer identity
    let customerId = null;
    
    if (identifiers) {
      const identityResult = await identityService.identify(tenantId, identifiers);
      customerId = identityResult.customerId;
      logger.debug('Identity resolved', { customerId: identityResult.customerId, isNew: identityResult.isNew });
    }

    // Step 2: Build event object
    const event = {
      tenantId,
      customerId,
      eventType,
      source: payload.source || 'internal',
      payload,
      sessionId: payload.sessionId || null,
      anonymousId: identifiers?.anonymousId || null,
      timestamp: new Date(),
      correlationId
    };

    // Step 3: Process through pipeline
    const result = await pipeline.process(event);

    // Step 4: Handle specific event types
    switch (eventType) {
      case EVENT_TYPES.CART_ABANDONED:
        await handleAbandonmentDetection(tenantId, payload, customerId);
        break;

      case EVENT_TYPES.CHECKOUT_COMPLETED:
        await handleRecoveryCompletion(tenantId, payload);
        break;

      case EVENT_TYPES.EMAIL_OPENED:
      case EVENT_TYPES.EMAIL_CLICKED:
        await handleEngagementFeedback(tenantId, eventType, payload);
        break;

      default:
        logger.debug('Unhandled event type', { eventType });
    }

    return { success: true, correlationId, eventId: result.eventId };
  } catch (error) {
    logger.error('Event processing failed', {
      eventType,
      tenantId,
      correlationId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}, {
  connection: redisConnection,
  concurrency: 10,
  limiter: { max: 500, duration: 60000 } // 500 events/min
});

// Worker events
eventWorker.on('completed', (job) => {
  logger.debug('Event job completed', { jobId: job.id, eventType: job.data.eventType });
});

eventWorker.on('failed', (job, err) => {
  logger.error('Event job failed permanently', {
    jobId: job.id,
    attempts: job.attemptsMade,
    eventType: job.data?.eventType,
    error: err.message
  });
});

// ============================================================
// ABANDONMENT DETECTION LOGIC
// ============================================================

async function handleAbandonmentDetection(tenantId, payload, customerId) {
  const { cartId, cartValue, items } = payload;

  logger.info('Processing abandonment detection', { tenantId, cartId, cartValue });

  // Calculate intent score (from webhook or tracking script data)
  const intentScore = calculateIntentScore(payload);

  // Update cart in database
  await db.query(
    `UPDATE abandoned_carts 
     SET intent_score = $1, status = 'new'
     WHERE id = $2 AND tenant_id = $3`,
    [intentScore, cartId, tenantId],
    tenantId
  );

  // Run predictive scoring
  const evaluation = await recoveryEngine.evaluate(tenantId, cartId);

  logger.info('Recovery evaluation complete', {
    cartId,
    score: evaluation.score,
    action: evaluation.recommendation.action,
    timing: evaluation.timing.touch1
  });

  // Queue recovery with optimal timing
  if (evaluation.recommendation.action !== 'exclude') {
    const delay = evaluation.timing.touch1 * 60 * 1000; // Convert to ms

    await recoveryQueue.add('cart-recovery', {
      cartId,
      touchNumber: 1,
      tenantId,
      recommendation: evaluation.recommendation,
      score: evaluation.score
    }, {
      delay,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 }
    });

    logger.info('Recovery queued', { cartId, delay: `${delay / 60000} min` });
  } else {
    logger.info('Cart excluded from recovery', { cartId, score: evaluation.score });
  }
}

// Simple intent scoring (can be enhanced with ML)
function calculateIntentScore(payload) {
  let score = 30; // baseline

  const {
    sessionDurationSeconds = 0,
    scrollDepthPercentage = 0,
    addRemoveActions = 0,
    repeatVisits = 1,
    deviceType = 'unknown',
    cartValue = 0
  } = payload;

  // Session duration
  score += Math.min(30, sessionDurationSeconds / 60);

  // Scroll depth
  score += Math.min(20, scrollDepthPercentage / 5);

  // Add/remove actions (positive for adds, negative for removes)
  score += Math.min(15, addRemoveActions * 5);

  // Repeat visits
  score += Math.min(10, (repeatVisits - 1) * 3);

  // Device type (mobile = higher intent)
  if (deviceType === 'mobile') score += 10;

  // Cart value (logarithmic)
  if (cartValue > 100) score += 10;
  else if (cartValue > 50) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ============================================================
// RECOVERY COMPLETION
// ============================================================

async function handleRecoveryCompletion(tenantId, payload) {
  const { cartId, orderId, revenue } = payload;

  logger.info('Recovery completed', { tenantId, cartId, orderId, revenue });

  // Update cart status
  await db.query(
    `UPDATE abandoned_carts 
     SET status = 'recovered', recovered_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [cartId, tenantId],
    tenantId
  );

  // Cancel any pending recovery jobs
  // (In production, use BullMQ's ability to remove jobs by pattern)
  const { Queue } = require('bullmq');
  const recoveryQueueInstance = new Queue('cart-recovery', { connection: redisConnection });
  
  // Get active jobs and cancel those for this cart
  const activeJobs = await recoveryQueueInstance.getJobs(['active', 'waiting', 'delayed']);
  for (const job of activeJobs) {
    if (job.data.cartId === cartId) {
      await job.remove();
      logger.info('Cancelled pending recovery job', { jobId: job.id, cartId });
    }
  }

  // Record recovery event
  await db.query(
    `INSERT INTO recovery_events (tenant_id, abandoned_cart_id, event_type, channel, metadata)
     VALUES ($1, $2, 'recovered', 'automatic', $3)`,
    [tenantId, cartId, JSON.stringify({ orderId, revenue })],
    tenantId
  );

  // Update customer metrics if customer identified
  if (payload.customerId) {
    await db.query(
      `UPDATE customers 
       SET total_purchases = total_purchases + 1, 
           total_spent = total_spent + $1,
           last_purchase = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [revenue || 0, payload.customerId, tenantId],
      tenantId
    );
  }
}

// ============================================================
// ENGAGEMENT FEEDBACK
// ============================================================

async function handleEngagementFeedback(tenantId, eventType, payload) {
  const { cartId, channel, touchNumber } = payload;

  if (!cartId) return;

  // Record engagement event
  await db.query(
    `INSERT INTO recovery_events (tenant_id, abandoned_cart_id, event_type, channel, touch_number, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, cartId, eventType, channel, touchNumber, JSON.stringify(payload)],
    tenantId
  );

  logger.debug('Engagement recorded', { cartId, eventType, channel });

  // If opened, potentially adjust future send times
  if (eventType === EVENT_TYPES.EMAIL_OPENED) {
    // Update customer engagement timing preferences
    // (Simplified - would store in customer preferences)
  }
}

// ============================================================
// HELPER: ENQUEUE EVENTS
// ============================================================

const { Queue } = require('bullmq');
const eventQueue = new Queue('event-processor', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600 }, // 1 hour
    removeOnFail: { age: 86400 }     // 1 day
  }
});

async function enqueueEvent(tenantId, eventType, payload, identifiers = null) {
  return eventQueue.add('process-event', {
    tenantId,
    eventType,
    payload,
    identifiers
  }, {
    jobId: `evt-${tenantId}-${Date.now()}`,
    priority: eventType === EVENT_TYPES.CHECKOUT_COMPLETED ? 1 : 10
  });
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  eventWorker,
  eventQueue,
  enqueueEvent,
  pipeline,
  identityService,
  recoveryEngine
};