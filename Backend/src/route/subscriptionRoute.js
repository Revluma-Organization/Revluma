const express = require('express');
const router  = express.Router();

const subscriptionController = require('../controller/subscriptionController');
const { authenticateToken }  = require('../middlewares/authMiddleware');

// Public — Paystack webhook (must be raw body, no auth)
router.post('/webhook', express.raw({ type: 'application/json' }), subscriptionController.webhook);

// Protected
router.post('/initialize', authenticateToken, subscriptionController.initialize);
router.get('/verify/:reference', authenticateToken, subscriptionController.verify);
router.get('/current', authenticateToken, subscriptionController.getCurrent);
router.post('/cancel', authenticateToken, subscriptionController.cancel);

module.exports = router;