/**
 * Revluma Subscription Routes — Production Hardened
 *
 * Security notes:
 * - Webhook uses express.raw() body parsing — required for HMAC validation.
 *   If you use express.json() for webhooks the signature verification breaks.
 * - Checkout initialization is rate-limited to prevent automated abuse.
 * - Webhook endpoint is NOT rate-limited (Paystack retries legitimately).
 */

const express = require('express');
const router  = express.Router();
const rateLimit = require('express-rate-limit');

const subscriptionController = require('../controller/subscriptionController');
const { authenticateToken }  = require('../middlewares/authMiddleware');

// Rate limiter: max 5 payment initializations per 15 minutes per IP
// Prevents automated checkout spam and reference enumeration
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Too many payment attempts. Please wait 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

// Rate limiter: max 10 verification attempts per 15 minutes per IP
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many verification attempts. Please wait 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

// Webhook — raw body MUST come before any JSON parsing
// express.raw() preserves the exact byte sequence Paystack signed
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  subscriptionController.webhook
);

// Protected merchant endpoints
router.post('/initialize', authenticateToken, checkoutLimiter, subscriptionController.initialize);
router.get('/verify/:reference', authenticateToken, verifyLimiter, subscriptionController.verify);
router.get('/current', authenticateToken, subscriptionController.getCurrent);
router.post('/cancel', authenticateToken, subscriptionController.cancel);

module.exports = router;