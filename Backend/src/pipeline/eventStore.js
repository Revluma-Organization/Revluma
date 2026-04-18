// ============================================================
// EVENT STORE & INGESTION PIPELINE
// ============================================================
// Append-only event log for all customer interactions.
// Enables replay, analytics, ML feature extraction, and
// real-time behavior tracking.

const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const logger = require('../utils/logger');

// ============================================================
// EVENT TYPES (Standardized)
// ============================================================

const EVENT_TYPES = {
  // Cart/Checkout events
  CART_CREATED: 'cart_created',
  CART_UPDATED: 'cart_updated',
  CART_ABANDONED: 'cart_abandoned',
  CHECKOUT_STARTED: 'checkout_started',
  CHECKOUT_COMPLETED: 'checkout_completed',
  
  // Product events
  PRODUCT_VIEWED: 'product_viewed',
  PRODUCT_ADDED: 'product_added',
  PRODUCT_REMOVED: 'product_removed',
  
  // Customer events
  CUSTOMER_CREATED: 'customer_created',
  CUSTOMER_UPDATED: 'customer_updated',
  CUSTOMER_IDENTIFIED: 'customer_identified',
  
  // Engagement events (from Klaviyo)
  EMAIL_OPENED: 'email_opened',
  EMAIL_CLICKED: 'email_clicked',
  EMAIL_BOUNCED: 'email_bounced',
  SMS_SENT: 'sms_sent',
  SMS_DELIVERED: 'sms_delivered',
  SMS_OPENED: 'sms_opened',
  
  // Web events
  PAGE_VIEWED: 'page_viewed',
  SESSION_STARTED: 'session_started',
  SESSION_ENDED: 'session_ended',
  
  // Recovery events
  RECOVERY_SENT: 'recovery_sent',
  RECOVERY_OPENED: 'recovery_opened',
  RECOVERY_CLICKED: 'recovery_clicked',
  RECOVERY_RECOVERED: 'recovery_recovered',
  
  // System events
  WEBHOOK_RECEIVED: 'webhook_received',
  API_CALLED: 'api_called'
};

const EVENT_SOURCES = {
  SHOPIFY: 'shopify',
  TRACKING_SCRIPT: 'tracking_script',
  KLAVIYO: 'klaviyo',
  INTERNAL: 'internal',
  WEBHOOK: 'webhook'
};

// ============================================================
// EVENT STORE SERVICE
// ============================================================

class EventStore {
  // Write single event (synchronous path for low latency)
  async write(event) {
    const eventId = event.id || uuidv4();
    const timestamp = event.timestamp || new Date();

    try {
      await db.query(
        `INSERT INTO events (
          id, tenant_id, customer_id, event_type, event_source, 
          payload, session_id, anonymous_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          eventId,
          event.tenantId,
          event.customerId || null,
          event.eventType,
          event.source || EVENT_SOURCES.INTERNAL,
          JSON.stringify(event.payload || {}),
          event.sessionId || null,
          event.anonymousId || null,
          timestamp
        ],
        event.tenantId
      );

      return { eventId, timestamp };
    } catch (error) {
      logger.error('Event write failed', { eventType: event.eventType, error: error.message });
      throw error;
    }
  }

  // Batch write (for high-throughput)
  async writeBatch(events) {
    const results = [];
    const errors = [];

    for (const event of events) {
      try {
        const result = await this.write(event);
        results.push(result);
      } catch (error) {
        errors.push({ event, error: error.message });
      }
    }

    return { successful: results.length, failed: errors.length, results, errors };
  }

  // Query events
  async query(tenantId, filters = {}) {
    const { customerId, eventType, source, startDate, endDate, limit = 100, offset = 0 } = filters;

    let query = 'SELECT * FROM events WHERE tenant_id = $1';
    const params = [tenantId];
    let paramIndex = 2;

    if (customerId) {
      query += ` AND customer_id = $${paramIndex++}`;
      params.push(customerId);
    }

    if (eventType) {
      if (Array.isArray(eventType)) {
        query += ` AND event_type = ANY($${paramIndex++})`;
        params.push(eventType);
      } else {
        query += ` AND event_type = $${paramIndex++}`;
        params.push(eventType);
      }
    }

    if (source) {
      query += ` AND event_source = $${paramIndex++}`;
      params.push(source);
    }

    if (startDate) {
      query += ` AND created_at >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND created_at <= $${paramIndex++}`;
      params.push(endDate);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await db.query(query, params, tenantId);
    return result.rows;
  }

  // Get customer timeline (most recent events)
  async getCustomerTimeline(tenantId, customerId, limit = 50) {
    return this.query(tenantId, { customerId, limit });
  }

  // Aggregation queries (for analytics)
  async aggregate(tenantId, filters) {
    const { eventType, groupBy, startDate, endDate } = filters;
    // Placeholder for OLAP-style queries
    // In production, this would query ClickHouse or use materialized views
    return [];
  }
}

// ============================================================
// EVENT INGESTION PIPELINE
// ============================================================

class IngestionPipeline {
  constructor() {
    this.eventStore = new EventStore();
    this.handlers = new Map();
    this.queue = [];
    this.isProcessing = false;
  }

  // Register event type handlers
  on(eventType, handler) {
    this.handlers.set(eventType, handler);
  }

  // Process incoming event
  async process(event) {
    const correlationId = event.correlationId || uuidv4();
    
    // Add metadata
    event.correlationId = correlationId;
    event.timestamp = event.timestamp || new Date();
    event.source = event.source || EVENT_SOURCES.INTERNAL;

    try {
      // Write to event store
      const { eventId, timestamp } = await this.eventStore.write(event);

      // Trigger handler if exists
      const handler = this.handlers.get(event.eventType);
      if (handler) {
        await handler(event, { eventId, timestamp, correlationId });
      }

      // Publish to any subscribers
      await this.publish(event);

      return { success: true, eventId, timestamp };
    } catch (error) {
      logger.error('Event processing failed', { 
        correlationId, 
        eventType: event.eventType, 
        error: error.message 
      });
      
      // Write to dead letter queue
      await this.writeToDLQ(event, error);
      
      return { success: false, error: error.message };
    }
  }

  // Batch process events
  async processBatch(events) {
    const results = [];
    
    for (const event of events) {
      const result = await this.process(event);
      results.push(result);
    }

    return results;
  }

  // Publish event to subscribers (WebSocket, etc.)
  async publish(event) {
    // This would integrate with the WebSocket system
    // For now, just log
    logger.debug('Event published', { eventType: event.eventType, tenantId: event.tenantId });
  }

  // Dead letter queue
  async writeToDLQ(event, error) {
    try {
      await db.query(
        `INSERT INTO event_dlq (event_data, error_message, failed_at)
         VALUES ($1, $2, NOW())`,
        [JSON.stringify(event), error.message],
        event.tenantId || 'system'
      );
    } catch (dlqError) {
      logger.error('DLQ write failed', { error: dlqError.message });
    }
  }
}

// ============================================================
// SPECIFIC EVENT HANDLERS
// ============================================================

// Handle cart abandonment
async function handleCartAbandoned(event, context) {
  const { tenantId, customerId, payload } = event;
  
  logger.info('Processing cart abandonment', { 
    tenantId, 
    customerId, 
    cartId: payload?.cartId,
    correlationId: context.correlationId 
  });

  // This would trigger recovery workflow
  const { recoveryQueue } = require('../queue/recoveryQueue');
  await recoveryQueue.add('cart-recovery', {
    cartId: payload.cartId,
    touchNumber: 1,
    tenantId
  }, { delay: 15 * 60 * 1000 }); // 15 min delay
}

// Handle checkout completed (stop recovery)
async function handleCheckoutCompleted(event, context) {
  const { tenantId, customerId, payload } = event;
  
  logger.info('Processing checkout completion', { 
    tenantId, 
    customerId, 
    orderId: payload?.orderId 
  });

  // Cancel any pending recovery for this cart
  if (payload?.cartId) {
    const { prisma } = require('../services/prisma');
    await prisma.abandonedCart.update({
      where: { id: payload.cartId },
      data: { status: 'recovered' }
    });
  }
}

// Handle email engagement
async function handleEmailEngagement(event, context) {
  const { tenantId, payload } = event;
  
  // Record engagement event
  await db.query(
    `INSERT INTO recovery_events (tenant_id, event_type, channel, metadata)
     VALUES ($1, $2, 'email', $3)`,
    [tenantId, event.eventType, JSON.stringify(payload)],
    tenantId
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  EventStore,
  IngestionPipeline,
  EVENT_TYPES,
  EVENT_SOURCES,
  handleCartAbandoned,
  handleCheckoutCompleted,
  handleEmailEngagement
};