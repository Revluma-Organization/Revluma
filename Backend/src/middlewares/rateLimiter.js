const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { getRedisClient, isRedisReady } = require('../configs/redis');
const logger = require('../utils/logger');

/**
 * Rate limiters for Revluma API endpoints (single source of truth).
 *
 * Store selection:
 *   - If REDIS_URL / REDIS_HOST is configured and connected → RedisStore
 *     (shared state across instances, survives restarts)
 *   - Otherwise → in-memory Map (single-instance only)
 *
 * The store is resolved lazily per-request so a mid-flight Redis outage
 * gracefully degrades to in-memory without crashing.
 *
 * Strategy:
 * - Registration: 5 attempts per 30 minutes per IP
 * - Login: 10 attempts per 15 minutes per IP
 *   (account lockout at 5 per email is handled in authController)
 * - Refresh: 30 per 15 minutes per IP
 * - Resend verification: 3 per 10 minutes per IP
 * - General API: 60 per minute per IP
 * - Waitlist join / referral check: separate tighter limits
 */

function resolveStore() {
  if (isRedisReady()) {
    try {
      return new RedisStore({
        sendCommand: (...args) => getRedisClient().call(...args),
        prefix: 'rl:',
      });
    } catch (err) {
      logger.warn('rate_limit_redis_store_fallback', { message: err.message });
    }
  }
  return undefined; // default in-memory store
}

// Registration limiter
const registerLimiter = rateLimit({
  windowMs:       30 * 60 * 1000, // 30 minutes
  max:            5,
  store:          resolveStore(),
  standardHeaders: true,
  legacyHeaders:  false,
  message: {
    success: false,
    error:   'Too many registration attempts. Please try again in 30 minutes.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

// Login limiter (IP-based — per-email lockout is in authController)
const loginLimiter = rateLimit({
  windowMs:       15 * 60 * 1000, // 15 minutes
  max:            10,
  store:          resolveStore(),
  standardHeaders: true,
  legacyHeaders:  false,
  message: {
    success: false,
    error:   'Too many login attempts. Please try again in 15 minutes.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

// Refresh token limiter
const refreshLimiter = rateLimit({
  windowMs:       15 * 60 * 1000, // 15 minutes
  max:            30,
  store:          resolveStore(),
  standardHeaders: true,
  legacyHeaders:  false,
  message: {
    success: false,
    error:   'Too many token refresh requests. Please try again shortly.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

// Resend verification limiter
const resendLimiter = rateLimit({
  windowMs:       10 * 60 * 1000, // 10 minutes
  max:            3,
  store:          resolveStore(),
  standardHeaders: true,
  legacyHeaders:  false,
  message: {
    success: false,
    error:   'Too many verification requests. Please wait 10 minutes.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

// General API limiter — applied globally in app.js
const apiLimiter = rateLimit({
  windowMs:       60 * 1000, // 1 minute
  max:            60,
  store:          resolveStore(),
  standardHeaders: true,
  legacyHeaders:  false,
  message: {
    success: false,
    error:   'Too many requests. Please slow down.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

// Pixel event ingestion limiter — high volume endpoint, public
const ingestLimiter = rateLimit({
  windowMs:       60 * 1000, // 1 minute
  max:            100,
  store:          resolveStore(),
  standardHeaders: true,
  legacyHeaders:  false,
  message: {
    success: false,
    error:   'Too many requests. Please try again later.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

// Waitlist join — public lead capture
const waitlistJoinLimiter = rateLimit({
  windowMs:       15 * 60 * 1000, // 15 minutes
  max:            10,
  store:          resolveStore(),
  standardHeaders: true,
  legacyHeaders:  false,
  message: {
    success: false,
    error:   'Too many waitlist submissions. Please try again later.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

// Referral code live-check — typed as users fill the form
const referralCheckLimiter = rateLimit({
  windowMs:       60 * 1000, // 1 minute
  max:            30,
  store:          resolveStore(),
  standardHeaders: true,
  legacyHeaders:  false,
  message: {
    success: false,
    error:   'Too many referral checks. Please slow down.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

// Password reset / change — abuse protection
const passwordResetLimiter = rateLimit({
  windowMs:       15 * 60 * 1000, // 15 minutes
  max:            5,
  store:          resolveStore(),
  standardHeaders: true,
  legacyHeaders:  false,
  message: {
    success: false,
    error:   'Too many password reset attempts. Please try again later.',
  },
  skip: () => process.env.NODE_ENV === 'test',
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
};
