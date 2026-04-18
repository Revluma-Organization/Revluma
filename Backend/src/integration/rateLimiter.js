// ============================================================
// RATE LIMITER
// ============================================================
// Token bucket rate limiter per store per platform
// Used to respect platform API limits while maximizing throughput

const logger = require('../utils/logger');

// Platform-specific rate limits
const PLATFORM_LIMITS = {
  shopify: {
    requestsPerSecond: 2,    // Conservative for Shopify (varies by plan)
    burstCapacity: 5
  },
  woocommerce: {
    requestsPerSecond: 10,   // Conservative (no official limit)
    burstCapacity: 20
  },
  bigcommerce: {
    requestsPerSecond: 6,    // 450/min = 7.5/sec, use 6 as safe ceiling
    burstCapacity: 12
  }
};

class RateLimiter {
  constructor(storeId, platform, customRps = null) {
    this.storeId = storeId;
    this.platform = platform;
    
    const limits = PLATFORM_LIMITS[platform] || PLATFORM_LIMITS.woocommerce;
    this.tokens = customRps ? customRps : limits.requestsPerSecond;
    this.burstCapacity = limits.burstCapacity;
    this.maxTokens = this.burstCapacity;
    this.lastRefill = Date.now();
    this.refillRate = this.tokens; // tokens per second
    
    // Waiting queue
    this.waitQueue = [];
    this.processing = false;
  }

  // Refill tokens based on time elapsed
  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = elapsed * this.refillRate;
    
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  // Try to acquire a token (non-blocking)
  tryAcquire() {
    this.refill();
    
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    
    return false;
  }

  // Calculate wait time in milliseconds
  getWaitTime() {
    this.refill();
    
    if (this.tokens >= 1) {
      return 0;
    }
    
    // Time to wait for 1 token
    return Math.ceil((1 - this.tokens) / this.refillRate * 1000);
  }

  // Acquire a token (blocking)
  async acquire() {
    this.refill();
    
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    
    const waitTime = this.getWaitTime();
    
    return new Promise((resolve) => {
      setTimeout(() => {
        this.refill();
        this.tokens = Math.max(0, this.tokens - 1);
        resolve();
      }, waitTime);
    });
  }

  // Wait and retry with exponential backoff (for rate limit responses)
  async waitWithBackoff(attempt = 0, maxAttempts = 5) {
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    
    logger.warn('Rate limit hit, waiting with backoff', {
      storeId: this.storeId,
      platform: this.platform,
      attempt,
      delayMs: delay
    });
    
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // Process queue of requests
  async processQueue() {
    if (this.processing) return;
    this.processing = true;
    
    while (this.waitQueue.length > 0) {
      const { resolve } = this.waitQueue.shift();
      await this.acquire();
      resolve();
    }
    
    this.processing = false;
  }

  // Add to queue (for batch processing)
  async enqueue() {
    return new Promise(async (resolve) => {
      this.waitQueue.push({ resolve });
      
      // Start processing if not already
      if (!this.processing) {
        this.processQueue();
      }
    });
  }
}

// Store for active limiters
const activeLimiters = new Map();

function getRateLimiter(storeId, platform, customRps = null) {
  const key = `${storeId}:${platform}`;
  
  if (!activeLimiters.has(key)) {
    activeLimiters.set(key, new RateLimiter(storeId, platform, customRps));
  }
  
  return activeLimiters.get(key);
}

function clearRateLimiter(storeId, platform) {
  const key = `${storeId}:${platform}`;
  activeLimiters.delete(key);
}

function clearAllLimiters() {
  activeLimiters.clear();
}

module.exports = {
  RateLimiter,
  getRateLimiter,
  clearRateLimiter,
  clearAllLimiters,
  PLATFORM_LIMITS
};