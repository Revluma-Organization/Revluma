const express = require('express');
const router = express.Router();
const {
  referralCheckLimiter,
  waitlistApplicationLimiter,
  waitlistResumeLimiter,
  waitlistCodeRequestLimiter,
  waitlistCodeVerifyLimiter,
} = require('../middlewares/rateLimiter');
const { requireAdminKey } = require('../middlewares/adminAuth');
const waitlistController = require('../controller/waitlistController');
const application = require('../controller/waitlistApplicationController');

// ── Founding Merchants application (/waitlist page) ─────────────────────────
// The page calls these through the site's same-origin proxy
// (api/waitlist/application.js on Vercel), so the HttpOnly resume cookie is
// first-party. The cookie is the only credential: an email never unlocks an
// application on its own.

// POST /api/v1/waitlist/application/start
// Step 1 for a browser without an application: validates, creates the one
// row for this application and sets the resume cookie. Honors Idempotency-Key.
router.post('/application/start', waitlistApplicationLimiter, application.start);

// PUT /api/v1/waitlist/application/steps/:step  (1, 2 or 3)
// Saves one step. Confirmed by the response before the page moves on.
router.put('/application/steps/:step', waitlistApplicationLimiter, application.saveStep);

// GET /api/v1/waitlist/application/resume
// Saved answers and the step to pick up from; rotates the resume token.
router.get('/application/resume', waitlistResumeLimiter, application.resume);

// GET /api/v1/waitlist/application/status
router.get('/application/status', waitlistResumeLimiter, application.status);

// POST /api/v1/waitlist/application/submit
// Final submission. Only succeeds once every step's saved answers validate.
router.post('/application/submit', waitlistApplicationLimiter, application.submit);

// POST /api/v1/waitlist/application/resume/request-code
// POST /api/v1/waitlist/application/resume/verify-code
// Continue on another device with a one-time code sent to the email.
router.post('/application/resume/request-code', waitlistCodeRequestLimiter, application.requestResumeCode);
router.post('/application/resume/verify-code', waitlistCodeVerifyLimiter, application.verifyResumeCode);

// DELETE /api/v1/waitlist/application/session
// "Not you?" Forgets the application in this browser.
router.delete('/application/session', waitlistResumeLimiter, application.endSession);

// GET /api/v1/waitlist/referral/:code/check
// Whether a referral code exists. Rate-limited and cached in memory.
router.get('/referral/:code/check', referralCheckLimiter, waitlistController.checkReferralCode);

// GET /api/v1/waitlist/stats
// Admin-only lead dashboard data.
router.get('/stats', requireAdminKey, waitlistController.getWaitlistStats);

module.exports = router;
