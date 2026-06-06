// src/routes/newsletter.js
// ============================================================
// PRODUCTION-READY NEWSLETTER ROUTES
// - POST   /api/newsletter/subscribe     (public)
// - GET    /api/newsletter/verify        (token link)
// - GET    /api/newsletter/unsubscribe   (token link)
// - POST   /api/newsletter/send-update   (admin, protected)
// - GET    /api/newsletter/stats         (admin, protected)
// ============================================================

const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require("../middleware/sessionAuth");
const newsletterService = require('../services/newsletterService');
const logger = require('../utils/logger');

const router = express.Router();

// ====================== RATE LIMITER ======================

const subscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 requests per IP per window
  message: { error: 'Too many subscription attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip
});

const verifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const sendUpdateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,                    // 5 sends per hour
  message: { error: 'Send rate limit reached. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ====================== EMAIL VALIDATION ======================

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return re.test(trimmed);
}

// ====================== HTML RESPONSE PAGES ======================

function renderHTMLPage(title, message, isSuccess) {
  const color = isSuccess ? '#4ade80' : '#f87171';
  const icon = isSuccess
    ? '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    : '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Revluma</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background-color: #0a0a0a;
      color: #ffffff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: rgba(17,17,17,0.95);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 48px 40px;
      max-width: 480px;
      width: 100%;
      text-align: center;
    }
    .icon { margin-bottom: 24px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 12px; }
    p { color: #a0a0a0; font-size: 15px; line-height: 1.6; margin-bottom: 28px; }
    .back-link {
      color: #888;
      font-size: 13px;
      text-decoration: none;
      transition: color 0.2s;
    }
    .back-link:hover { color: #fff; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="${require('../config/baseUrl').BASE_URL}" class="back-link">&larr; Back to Revluma</a>
  </div>
</body>
</html>`;
}

// ====================== ROUTES ======================

/**
 * POST /api/newsletter/subscribe
 * Public endpoint — subscribe an email with double opt-in
 */
router.post('/subscribe', subscribeLimiter, async (req, res) => {
  console.log('newsletter subscribe request body:', req.body);
  try {
    const { email } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    // Sanitize
    const sanitized = String(email).trim().toLowerCase();

    const result = await newsletterService.subscribe(sanitized, {
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
      source: 'website_footer'
    });

    return res.status(result.status).json({ message: result.message });

  } catch (err) {
    console.error('Subscribe route error:', err.message, { error: err.message, stack: err.stack });
    logger.error('Subscribe route error', { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'An internal error occurred. Please try again.' });
  }
});

/**
 * GET /api/newsletter/verify?token=xxx
 * Public endpoint — verify subscription via email link
 * Returns HTML page for browser visits
 */
router.get('/verify', verifyLimiter, async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send(renderHTMLPage('Missing Token', 'No verification token was provided.', false));
    }

    const result = await newsletterService.verify(token);

    const statusCode = result.status;
    const isSuccess = statusCode === 200;

    // Return HTML for browser requests
    if (req.accepts('html')) {
      return res.status(statusCode).send(renderHTMLPage(
        isSuccess ? 'Email Verified' : 'Verification Failed',
        result.message,
        isSuccess
      ));
    }

    return res.status(statusCode).json({ message: result.message });

  } catch (err) {
    logger.error('Verify route error', { error: err.message, stack: err.stack });
    return res.status(500).send(renderHTMLPage('Error', 'An internal error occurred. Please try again.', false));
  }
});

/**
 * GET /api/newsletter/unsubscribe?token=xxx
 * Public endpoint — unsubscribe via email link
 * Returns HTML confirmation page
 */
router.get('/unsubscribe', verifyLimiter, async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send(renderHTMLPage('Missing Token', 'No unsubscribe token was provided.', false));
    }

    const result = await newsletterService.unsubscribe(token);

    if (result.status === 200 && result.html) {
      return res.status(200).send(result.html);
    }

    return res.status(result.status).send(renderHTMLPage(
      result.status === 200 ? 'Unsubscribed' : 'Unsubscribe Failed',
      result.message,
      result.status === 200
    ));

  } catch (err) {
    logger.error('Unsubscribe route error', { error: err.message, stack: err.stack });
    return res.status(500).send(renderHTMLPage('Error', 'An internal error occurred. Please try again.', false));
  }
});

/**
 * POST /api/newsletter/send-update
 * Admin-only — send newsletter to all verified subscribers
 * Body: { subject: string, content: string, contentText?: string }
 */
router.post('/send-update', sendUpdateLimiter, authenticate, async (req, res) => {
  try {
    const { subject, content, contentText } = req.body;

    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      return res.status(400).json({ error: 'Subject is required' });
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content (HTML) is required' });
    }

    if (subject.length > 500) {
      return res.status(400).json({ error: 'Subject must be under 500 characters' });
    }

    const sentBy = req.user?.email || req.user?.id || 'admin';

    // Process synchronously for now; for large lists, use BullMQ queue
    const result = await newsletterService.sendNewsletter(
      subject.trim(),
      content,
      contentText || '',
      sentBy
    );

    return res.status(200).json({
      message: 'Newsletter sent successfully',
      sendId: result.sendId,
      totalRecipients: result.total,
      sent: result.sent,
      failed: result.failed
    });

  } catch (err) {
    logger.error('Send-update route error', { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Failed to send newsletter. Check server logs.' });
  }
});

/**
 * GET /api/newsletter/stats
 * Admin-only — get subscriber statistics
 */
router.get('/stats', authenticate, async (req, res) => {
  try {
    const stats = await newsletterService.getStats();
    return res.status(200).json({ stats });
  } catch (err) {
    logger.error('Stats route error', { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;