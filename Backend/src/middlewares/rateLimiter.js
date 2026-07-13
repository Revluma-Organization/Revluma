const rateLimit = require('express-rate-limit');

/**
 * Rate limiters for Revluma auth endpoints.
 *
 * Strategy:
 * - Registration: 5 attempts per 30 minutes per IP
 * - Login: 10 attempts per 15 minutes per IP
 *   (account lockout at 5 per email is handled in authController)
 * - Refresh: 30 per 15 minutes per IP
 * - Resend verification: 3 per 10 minutes per IP
 * - General API: 60 per minute per IP
 */

// Registration limiter
const registerLimiter = rateLimit({
  windowMs:       30 * 60 * 1000, // 30 minutes
  max:            5,
  standardHeaders: true,
  legacyHeaders:  false,
  keyGenerator:   (req) => req.ip,
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
  standardHeaders: true,
  legacyHeaders:  false,
  keyGenerator:   (req) => req.ip,
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
  standardHeaders: true,
  legacyHeaders:  false,
  keyGenerator:   (req) => req.ip,
  message: {
    success: false,
    error:   'Rate limit exceeded.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

module.exports = {
  registerLimiter,
  loginLimiter,
  refreshLimiter,
  resendLimiter,
  apiLimiter,
  ingestLimiter,
};