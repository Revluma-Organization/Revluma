/**
 * Revluma Merchant Memory Route
 *
 * POST /api/v1/memory — write a merchant memory to Rev Intelligence
 */

const express    = require('express');
const rateLimit  = require('express-rate-limit');
const router     = express.Router();

const { authenticateToken } = require('../middlewares/authMiddleware');
const revController          = require('../controller/revController');

const memoryLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many memory writes. Please wait a moment.' },
  },
  standardHeaders: true,
  legacyHeaders:   false,
  skip: () => process.env.NODE_ENV === 'test',
});

router.post('/', authenticateToken, memoryLimiter, revController.createMemory);

module.exports = router;