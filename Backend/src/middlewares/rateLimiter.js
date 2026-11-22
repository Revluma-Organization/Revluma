const rateLimit = require('express-rate-limit');
const { MemoryStore } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { getRedisClient, isRedisReady } = require('../configs/redis');
const logger = require('../utils/logger');

/**
 * Rate limiters for Revluma API endpoints (single source of truth).
 *
 * Store selection — resolved per request, never fixed at boot:
 *   - Redis configured, connected and answering → shared Redis counters
 *     (consistent across instances, survive restarts).
 *   - Redis absent, disconnected, erroring or slow → a per-instance in-memory
 *     store, so limiting keeps working (single-instance accuracy) instead of
 *     failing the request.
 *
 * Production incident (2026-11): every limiter was bound to a RedisStore once,
 * at module load. server.js connects Redis before requiring the app, so a boot
 * with Redis up pinned every limiter to Redis for the life of the process.
 * express-rate-limit defaults to `passOnStoreError: false`, so when Redis then
 * accepted connections but failed commands, every request under /api/ —
 * including POST /auth/login — returned 500 "An unexpected server error
 * occurred" from the global apiLimiter, before any controller ran. /ready still
 * reported redis_ready because it reflects connection state, not command
 * success. A rate limiter's backing store must never take authentication down.
 *
 * A second defect is also fixed here: all limiters shared the Redis prefix
 * `rl:` with the same per-IP key, so the global apiLimiter (60/min) and the
 * login limiter (10/15min) incremented one counter, and ordinary dashboard
 * traffic consumed the login budget. Every limiter now has its own namespace.
 *
 * Strategy:
 * - Registration: 5 attempts per 30 minutes per IP
 * - Login: 10 attempts per 15 minutes per IP
 *   (account lockout at 5 per email is handled in authController and is
 *   database-backed, so it holds even while Redis is degraded)
 * - Refresh: 30 per 15 minutes per IP
 * - Resend verification: 3 per 10 minutes per IP
 * - General API: 60 per minute per IP
 * - Waitlist join / referral check: separate tighter limits
 */

// A rate-limit check must cost milliseconds; a hung Redis must not hang auth.
const REDIS_COMMAND_TIMEOUT_MS = 750;
// After a Redis failure, serve from memory for this long before retrying Redis,
// so a broken Redis does not add a timeout to every request.
const REDIS_COOLDOWN_MS = 30 * 1000;

class RateLimitStoreTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`rate limit store did not answer within ${timeoutMs}ms`);
    this.name = 'RateLimitStoreTimeoutError';
    this.code = 'RATE_LIMIT_STORE_TIMEOUT';
  }
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    // Deliberately not unref'd: it is short-lived and always cleared, and an
    // unref'd timer would let a pending check outlive its own timeout.
    timer = setTimeout(() => reject(new RateLimitStoreTimeoutError(timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * express-rate-limit Store that prefers Redis and degrades to memory.
 *
 * Implements the Store interface (init/get/increment/decrement/resetKey). Any
 * Redis error or timeout opens a short circuit breaker and the operation is
 * served by the in-memory store; Redis is retried after the cooldown and used
 * again as soon as it answers. Errors are never propagated to the limiter.
 */
class ResilientRateLimitStore {
  constructor({
    prefix,
    redisReady = isRedisReady,
    redisClient = getRedisClient,
    createRedisStore = (options) => new RedisStore(options),
    now = Date.now,
    timeoutMs = REDIS_COMMAND_TIMEOUT_MS,
    cooldownMs = REDIS_COOLDOWN_MS,
    log = logger,
  } = {}) {
    if (!prefix) throw new TypeError('ResilientRateLimitStore requires a unique prefix');
    // Read by express-rate-limit's double-count validation; unique per limiter.
    this.prefix = prefix;
    // Keys may be shared across instances through Redis.
    this.localKeys = false;
    this.memory = new MemoryStore();
    this.redisReady = redisReady;
    this.redisClient = redisClient;
    this.createRedisStore = createRedisStore;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.cooldownMs = cooldownMs;
    this.log = log;
    this.options = null;
    this.redis = null;
    this.redisFor = null;
    this.openUntil = 0;
    this.degraded = false;
  }

  init(options) {
    this.options = options;
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  /** The Redis-backed store to use for this call, or null to use memory. */
  activeRedisStore() {
    if (this.now() < this.openUntil) return null;
    let client;
    try {
      if (!this.redisReady()) return null;
      client = this.redisClient();
    } catch {
      return null;
    }
    if (!client || typeof client.call !== 'function') return null;

    // Rebuild when the underlying client object changes.
    if (!this.redis || this.redisFor !== client) {
      try {
        const store = this.createRedisStore({
          sendCommand: (...args) => client.call(...args),
          prefix: this.prefix,
        });
        if (this.options && typeof store.init === 'function') {
          // Script loading failures are retried by the store on first use and
          // surface through the operation below; never as an unhandled rejection.
          Promise.resolve(store.init(this.options)).catch(() => {});
        }
        this.redis = store;
        this.redisFor = client;
      } catch (error) {
        this.trip(error);
        return null;
      }
    }
    return this.redis;
  }

  trip(error) {
    this.openUntil = this.now() + this.cooldownMs;
    // Drop the store so the next attempt reloads its Lua scripts.
    this.redis = null;
    this.redisFor = null;
    if (!this.degraded) {
      this.degraded = true;
      this.log.warn('rate_limit_store_degraded', {
        prefix: this.prefix,
        error_type: error?.code || error?.name || 'redis_store_error',
        fallback: 'memory',
        retry_after_ms: this.cooldownMs,
      });
    }
  }

  recovered() {
    if (this.degraded) {
      this.degraded = false;
      this.log.info('rate_limit_store_recovered', { prefix: this.prefix });
    }
  }

  async run(redisOperation, memoryOperation) {
    const redis = this.activeRedisStore();
    if (redis) {
      try {
        const result = await withTimeout(Promise.resolve().then(() => redisOperation(redis)), this.timeoutMs);
        this.recovered();
        return result;
      } catch (error) {
        this.trip(error);
      }
    }
    return memoryOperation(this.memory);
  }

  get(key) {
    return this.run((store) => store.get(key), (store) => store.get(key));
  }

  increment(key) {
    return this.run((store) => store.increment(key), (store) => store.increment(key));
  }

  decrement(key) {
    return this.run((store) => store.decrement(key), (store) => store.decrement(key));
  }

  resetKey(key) {
    return this.run((store) => store.resetKey(key), (store) => store.resetKey(key));
  }
}

const notInTests = () => process.env.NODE_ENV === 'test';

/**
 * Build a limiter with its own store namespace. `passOnStoreError` is a final
 * safety net: the resilient store already absorbs Redis failures, and a store
 * fault must never turn into a 500 for the merchant.
 */
function createLimiter(name, { windowMs, max, error, skip = notInTests, storeOptions = {} }) {
  return rateLimit({
    windowMs,
    max,
    store: new ResilientRateLimitStore({ prefix: `rl:${name}:`, ...storeOptions }),
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    message: { success: false, error },
    skip,
  });
}

// Registration limiter
const registerLimiter = createLimiter('register', {
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 5,
  error: 'Too many registration attempts. Please try again in 30 minutes.',
});

// Login limiter (IP-based — per-email lockout is in authController)
const loginLimiter = createLimiter('login', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  error: 'Too many login attempts. Please try again in 15 minutes.',
});

// Refresh token limiter
const refreshLimiter = createLimiter('refresh', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  error: 'Too many token refresh requests. Please try again shortly.',
});

// Resend verification limiter
const resendLimiter = createLimiter('resend', {
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 3,
  error: 'Too many verification requests. Please wait 10 minutes.',
});

// General API limiter — applied globally in app.js
const apiLimiter = createLimiter('api', {
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  error: 'Too many requests. Please slow down.',
  // Pixel ingestion has its own dedicated limiter; do not charge Redis twice.
  skip: (req) => process.env.NODE_ENV === 'test' || /^\/v1\/events\/ingest(?:\/batch)?\/?(?:\?|$)/.test(req.originalUrl.replace(/^\/api/, '')),
});

// Pixel event ingestion limiter — high volume endpoint, public
const ingestLimiter = createLimiter('ingest', {
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  error: 'Too many requests. Please try again later.',
});

// Waitlist join — public lead capture
const waitlistJoinLimiter = createLimiter('waitlist-join', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  error: 'Too many waitlist submissions. Please try again later.',
});

// Referral code live-check — typed as users fill the form
const referralCheckLimiter = createLimiter('referral-check', {
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  error: 'Too many referral checks. Please slow down.',
});

// Password reset / change — abuse protection
const passwordResetLimiter = createLimiter('password-reset', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  error: 'Too many password reset attempts. Please try again later.',
});


// Rev Intelligence chat limiter is defined inline in revRoute.js
// to avoid the express-rate-limit IPv6 keyGenerator validation error

module.exports = {
  registerLimiter,
  loginLimiter,
  refreshLimiter,
  resendLimiter,
  apiLimiter,
  ingestLimiter,
  waitlistJoinLimiter,
  referralCheckLimiter,
  passwordResetLimiter,
  // Exported for tests and diagnostics.
  ResilientRateLimitStore,
  createLimiter,
  REDIS_COMMAND_TIMEOUT_MS,
  REDIS_COOLDOWN_MS,
};
