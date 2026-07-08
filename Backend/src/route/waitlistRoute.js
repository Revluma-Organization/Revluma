const express = require('express');
const router = express.Router();
const { validateWaitlistJoin, validateWaitlistDetails } = require('../middlewares/validateWaitlist');
const { waitlistJoinLimiter, referralCheckLimiter } = require('../middlewares/rateLimiter');
const { requireAdminKey } = require('../middlewares/adminAuth');
const waitlistController = require('../controller/waitlistController');

// POST /api/v1/waitlist/join
// Step 1  "secure my spot". Creates the waitlist row with the minimal
// fields needed (name, email, phone, X handle, brand name, store URL,
// and an optional referred_by_code).
router.post('/join', waitlistJoinLimiter, validateWaitlistJoin, waitlistController.joinWaitlist);

// GET /api/v1/waitlist/referral/:code/check
// Live "does this referral code exist" check used by Step 1's optional
// referral field. Rate-limited separately from /join since it's hit as
// people type, and cached in-memory to keep DB load flat under traffic.
router.get('/referral/:code/check', referralCheckLimiter, waitlistController.checkReferralCode);

// PATCH /api/v1/waitlist/:id/details
// Step 2 — "tell us more". Optional, fills in the rest of the profile on
// the row already created by /join.
router.patch('/:id/details', validateWaitlistDetails, waitlistController.updateWaitlistDetails);

// GET /api/v1/waitlist/stats
// Admin-only lead dashboard data.
router.get('/stats', requireAdminKey, waitlistController.getWaitlistStats);

module.exports = router;