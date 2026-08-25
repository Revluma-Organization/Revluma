/**
 * Revluma Rev Intelligence Routes
 *
 * All routes require authenticateToken.
 * Chat endpoint has dedicated rate limiting to protect against
 * AI cost abuse, accidental request storms, and API automation.
 *
 * POST /api/v1/rev/chat              — send message, get Rev response
 * GET  /api/v1/rev/conversations     — list conversation history (paginated)
 * GET  /api/v1/rev/conversation/:id  — load full conversation thread
 * POST /api/v1/memory                — write a merchant memory
 * GET  /api/v1/rev/health            — Python service health check
 */

const express    = require('express');
const rateLimit  = require('express-rate-limit');
const router     = express.Router();

const { authenticateToken } = require('../middlewares/authMiddleware');
const { chatLimiter }       = require('../middlewares/rateLimiter');
const revController          = require('../controller/revController');

// ── Rate limiter: chat endpoint ───────────────────────────────────────────────
// 30 messages per minute per IP — enough for active merchant usage,
// tight enough to prevent automated abuse and runaway AI costs.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down.',
    },
  },
  standardHeaders: true,
  legacyHeaders:   false,
  skip: () => process.env.NODE_ENV === 'test',
});

// ── Rate limiter: memory writes ───────────────────────────────────────────────
// 20 memory writes per 5 minutes per IP
const memoryLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many memory writes. Please wait a moment.',
    },
  },
  standardHeaders: true,
  legacyHeaders:   false,
  skip: () => process.env.NODE_ENV === 'test',
});

// ── Routes ────────────────────────────────────────────────────────────────────

// Chat — the primary Rev Intelligence endpoint
router.post('/chat',                      authenticateToken, chatLimiter,   revController.chat);

// Conversation history — sidebar list
router.get('/conversations',              authenticateToken,               revController.getConversations);

// Full conversation thread
router.get('/conversation/:id',           authenticateToken,               revController.getConversation);

// Delete a conversation
router.delete('/conversation/:id',        authenticateToken,               revController.deleteConversation);

// Rename a conversation
router.patch('/conversation/:id/title',   authenticateToken,               revController.renameConversation);

// Morning briefing — called on first dashboard load each day
router.get('/briefing',                   authenticateToken,               revController.getMorningBriefing);

// Anomaly alert check — called after every business state rebuild
router.post('/alerts/check',               authenticateToken,               revController.checkAndCreateAlerts);

// Python service health (authenticated — internal use)
router.get('/health',                     authenticateToken,               revController.intelligenceHealth);

module.exports = router;
