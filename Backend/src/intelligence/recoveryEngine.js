// ============================================================
// PREDICTIVE RECOVERY ENGINE
// ============================================================
// ML-inspired scoring system for abandoned cart recovery.
// Determines recovery probability, optimal timing, and channel strategy.

const db = require('../config/db');
const logger = require('../utils/logger');

// ============================================================
// SCORING MODEL
// ============================================================

// Weight configurations (can be tuned)
const SCORING_WEIGHTS = {
  // Customer history (40%)
  purchaseHistory: 0.15,
  engagementScore: 0.15,
  ltvScore: 0.10,
  
  // Cart characteristics (30%)
  cartValue: 0.12,
  itemCount: 0.08,
  productCategories: 0.10,
  
  // Behavioral signals (20%)
  sessionDuration: 0.08,
  scrollDepth: 0.06,
  repeatVisits: 0.06,
  
  // Temporal factors (10%)
  timeSinceAbandonment: 0.05,
  dayOfWeek: 0.03,
  hourOfDay: 0.02
};

// Recovery probability thresholds
const RECOVERY_THRESHOLDS = {
  HIGH: 0.7,      // >70% - gentle reminder
  MEDIUM: 0.4,   // 40-70% - incentive needed
  LOW: 0.2,      // 20-40% - aggressive multi-channel
  VERY_LOW: 0.0   // <20% - consider excluding
};

// ============================================================
// SCORE CALCULATOR
// ============================================================

class RecoveryScorer {
  constructor() {
    this.weights = SCORING_WEIGHTS;
  }

  // Main scoring function
  async score(tenantId, cartId) {
    const startTime = Date.now();

    try {
      // Fetch cart data
      const cartResult = await db.query(
        `SELECT ac.*, 
                c.total_purchases, c.total_spent, c.ltv_score, c.intent_score,
                c.segment, c.last_purchase
         FROM abandoned_carts ac
         LEFT JOIN customers c ON c.email = ac.customer_email AND c.tenant_id = ac.tenant_id
         WHERE ac.id = $1 AND ac.tenant_id = $2`,
        [cartId, tenantId],
        tenantId
      );

      if (cartResult.rowCount === 0) {
        throw new Error('Cart not found');
      }

      const cart = cartResult.rows[0];

      // Calculate component scores
      const customerScore = this.calculateCustomerScore(cart);
      const cartScore = this.calculateCartScore(cart);
      const behavioralScore = this.calculateBehavioralScore(cart);
      const temporalScore = this.calculateTemporalScore(cart);

      // Weighted total
      const totalScore = (
        customerScore * 0.4 +
        cartScore * 0.3 +
        behavioralScore * 0.2 +
        temporalScore * 0.1
      );

      // Determine recommendation
      const recommendation = this.getRecommendation(totalScore, cart);

      // Calculate timing
      const optimalTiming = this.calculateOptimalTiming(totalScore, cart);

      // Log scoring
      const duration = Date.now() - startTime;
      logger.info('Recovery scoring completed', {
        cartId,
        totalScore: totalScore.toFixed(3),
        customerScore: customerScore.toFixed(3),
        cartScore: cartScore.toFixed(3),
        behavioralScore: behavioralScore.toFixed(3),
        temporalScore: temporalScore.toFixed(3),
        recommendation: recommendation.action,
        timing: optimalTiming.minutes,
        duration
      });

      return {
        score: totalScore,
        probability: totalScore,
        confidence: this.calculateConfidence(cart),
        recommendation,
        timing: optimalTiming,
        components: {
          customer: customerScore,
          cart: cartScore,
          behavioral: behavioralScore,
          temporal: temporalScore
        }
      };
    } catch (error) {
      logger.error('Scoring failed', { cartId, error: error.message });
      throw error;
    }
  }

  // Customer history score (0-1)
  calculateCustomerScore(cart) {
    let score = 0.3; // baseline

    // Purchase history
    if (cart.total_purchases) {
      score += Math.min(0.3, cart.total_purchases * 0.05);
    }

    // LTV score
    if (cart.ltv_score) {
      score += (cart.ltv_score / 100) * 0.2;
    }

    // Intent score
    if (cart.intent_score) {
      score += (cart.intent_score / 100) * 0.2;
    }

    // Segment bonus
    if (cart.segment === 'vip' || cart.segment === 'high-value') {
      score += 0.15;
    }

    return Math.min(1, Math.max(0, score));
  }

  // Cart characteristics score (0-1)
  calculateCartScore(cart) {
    let score = 0.4; // baseline

    // Cart value (logarithmic scale - higher value = higher intent but diminishing)
    const value = parseFloat(cart.cart_value) || 0;
    if (value > 0) {
      score += Math.min(0.3, Math.log10(value + 1) * 0.15);
    }

    // Item count (more items = more consideration)
    const items = cart.items || [];
    if (Array.isArray(items)) {
      if (items.length >= 2 && items.length <= 5) {
        score += 0.15;
      } else if (items.length > 5) {
        score += 0.1;
      }
    }

    return Math.min(1, Math.max(0, score));
  }

  // Behavioral signals score (0-1)
  calculateBehavioralScore(cart) {
    let score = 0.2; // baseline

    // Session duration (longer = more consideration)
    const duration = cart.session_duration_seconds || 0;
    if (duration > 180) { // >3 min
      score += 0.25;
    } else if (duration > 60) { // >1 min
      score += 0.15;
    }

    // Scroll depth
    const scroll = cart.scroll_depth_percentage || 0;
    if (scroll > 75) {
      score += 0.25;
    } else if (scroll > 50) {
      score += 0.15;
    }

    // Repeat visits
    const visits = cart.repeat_visits || 1;
    if (visits > 3) {
      score += 0.15;
    } else if (visits > 1) {
      score += 0.1;
    }

    return Math.min(1, Math.max(0, score));
  }

  // Temporal factors score (0-1)
  calculateTemporalScore(cart) {
    let score = 0.5; // baseline

    // Time since abandonment (decay curve)
    const abandonmentTime = new Date(cart.abandonment_at);
    const hoursAgo = (Date.now() - abandonmentTime.getTime()) / (1000 * 60 * 60);

    if (hoursAgo < 1) {
      score += 0.3;
    } else if (hoursAgo < 6) {
      score += 0.2;
    } else if (hoursAgo < 24) {
      score += 0.1;
    } else if (hoursAgo > 72) {
      score -= 0.2;
    }

    // Day of week (weekdays better for B2C)
    const day = abandonmentTime.getDay();
    if (day >= 1 && day <= 5) {
      score += 0.1;
    }

    // Hour of day (business hours better)
    const hour = abandonmentTime.getHours();
    if (hour >= 9 && hour <= 18) {
      score += 0.1;
    }

    return Math.min(1, Math.max(0, score));
  }

  // Get action recommendation based on score
  getRecommendation(score, cart) {
    if (score >= RECOVERY_THRESHOLDS.HIGH) {
      return {
        action: 'gentle_reminder',
        channel: 'email',
        discount: 0,
        message: 'Personalized reminder without discount'
      };
    } else if (score >= RECOVERY_THRESHOLDS.MEDIUM) {
      return {
        action: 'incentive',
        channel: 'email',
        discount: 5,
        message: 'Small discount to close the sale'
      };
    } else if (score >= RECOVERY_THRESHOLDS.LOW) {
      return {
        action: 'aggressive',
        channel: 'multi-channel',
        discount: 10,
        message: 'Stronger incentive across multiple channels'
      };
    } else {
      return {
        action: 'exclude',
        channel: null,
        discount: 0,
        message: 'Low probability - exclude from recovery'
      };
    }
  }

  // Calculate optimal timing
  calculateOptimalTiming(score, cart) {
    // Base delays from tenant profile
    const baseDelays = [15, 90, 1440, 2880, 4320]; // minutes: 15min, 1.5h, 24h, 48h, 72h

    // Adjust based on score
    let multiplier = 1;
    if (score >= RECOVERY_THRESHOLDS.HIGH) {
      multiplier = 1.5; // Slower for high probability
    } else if (score <= RECOVERY_THRESHOLDS.LOW) {
      multiplier = 0.7; // Faster for low probability
    }

    // Calculate per-touch timing
    const touchDelays = baseDelays.map(delay => Math.round(delay * multiplier));

    return {
      touch1: touchDelays[0],
      touch2: touchDelays[1],
      touch3: touchDelays[2],
      touch4: touchDelays[3],
      touch5: touchDelays[4],
      minutes: touchDelays[0]
    };
  }

  // Calculate confidence in the score
  calculateConfidence(cart) {
    let confidence = 0.5; // baseline

    // More data = higher confidence
    if (cart.customer_email) confidence += 0.1;
    if (cart.total_purchases > 0) confidence += 0.15;
    if (cart.session_duration_seconds > 0) confidence += 0.1;
    if (cart.repeat_visits > 1) confidence += 0.1;
    if (cart.scroll_depth_percentage > 0) confidence += 0.05;

    return Math.min(1, confidence);
  }
}

// ============================================================
// TIMING OPTIMIZER
// ============================================================

class TimingOptimizer {
  // Find best send time based on historical engagement
  async findOptimalSendTime(tenantId, customerId) {
    // Query historical engagement data
    const result = await db.query(
      `SELECT 
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as opens,
        AVG(CASE WHEN event_type = 'email_opened' THEN 1.0 ELSE 0 END) as open_rate
       FROM events 
       WHERE tenant_id = $1 
         AND customer_id = $2 
         AND event_type IN ('email_opened', 'email_sent')
       GROUP BY EXTRACT(HOUR FROM created_at)
       ORDER BY open_rate DESC
       LIMIT 5`,
      [tenantId, customerId],
      tenantId
    );

    if (result.rowCount > 0) {
      const bestHour = parseInt(result.rows[0].hour);
      return {
        hour: bestHour,
        dayOfWeek: 'optimal',
        reason: `Based on ${result.rows[0].opens} historical opens`
      };
    }

    // Default fallback
    return {
      hour: 10, // 10 AM
      dayOfWeek: 'weekday',
      reason: 'Default optimal time'
    };
  }

  // Check if in spam window
  isInSpamWindow(sendTime) {
    const hour = sendTime.getHours();
    // Avoid 11 PM - 6 AM
    return hour >= 23 || hour < 6;
  }

  // Adjust for spam avoidance
  adjustForSpamAvoidance(sendTime) {
    if (this.isInSpamWindow(sendTime)) {
      // Move to 10 AM next day
      sendTime.setHours(10, 0, 0, 0);
      sendTime.setDate(sendTime.getDate() + 1);
    }
    return sendTime;
  }
}

// ============================================================
// ACTION ENGINE
// ============================================================

class ActionEngine {
  constructor() {
    this.scorer = new RecoveryScorer();
    this.timingOptimizer = new TimingOptimizer();
  }

  // Main entry point - score and determine actions
  async evaluate(tenantId, cartId) {
    const scoring = await this.scorer.score(tenantId, cartId);

    // Get optimal timing
    const cartResult = await db.query(
      `SELECT customer_email FROM abandoned_carts WHERE id = $1`,
      [cartId],
      tenantId
    );

    let timing = { hour: 10, reason: 'default' };
    if (cartResult.rowCount > 0 && cartResult.rows[0].customer_email) {
      // Look up customer ID and get timing
      // (simplified for now)
    }

    return {
      ...scoring,
      timing: {
        ...scoring.timing,
        optimalHour: timing.hour
      }
    };
  }

  // Batch evaluate for all active carts
  async evaluateAll(tenantId) {
    const result = await db.query(
      `SELECT id FROM abandoned_carts 
       WHERE tenant_id = $1 AND status IN ('new', 'sent1', 'sent2')`,
      [tenantId],
      tenantId
    );

    const results = [];
    for (const cart of result.rows) {
      try {
        const evaluation = await this.evaluate(tenantId, cart.id);
        results.push({ cartId: cart.id, ...evaluation });
      } catch (error) {
        logger.error('Cart evaluation failed', { cartId: cart.id, error: error.message });
      }
    }

    return results;
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  RecoveryScorer,
  TimingOptimizer,
  ActionEngine,
  RECOVERY_THRESHOLDS,
  SCORING_WEIGHTS
};