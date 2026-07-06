const express = require('express');
const router = express.Router();
const { validateWaitlistJoin, validateWaitlistDetails } = require('../middlewares/validateWaitlist');
const { waitlistJoinLimiter } = require('../middlewares/rateLimiter');
const { requireAdminKey } = require('../middlewares/adminAuth');
const waitlistController = require('../controller/waitlistController');

// POST /api/v1/waitlist/join
// Step 1  "secure my spot". Creates the waitlist row with the minimal
// fields needed (name, email, phone, X handle, brand name, store URL).
router.post('/join', waitlistJoinLimiter, validateWaitlistJoin, waitlistController.joinWaitlist);

// PATCH /api/v1/waitlist/:id/details
// Step 2 — "tell us more". Optional, fills in the rest of the profile on
// the row already created by /join.
router.patch('/:id/details', validateWaitlistDetails, waitlistController.updateWaitlistDetails);

// GET /api/v1/waitlist/stats
// Admin-only lead dashboard data.
router.get('/stats', requireAdminKey, waitlistController.getWaitlistStats);

module.exports = router;