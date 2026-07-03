const express = require('express');
const router = express.Router();
const waitlistController = require('../controller/waitlistController');
const { validateWaitlist } = require('../middlewares/validateWaitlist');
const { waitlistJoinLimiter } = require('../middlewares/rateLimiter');
const { requireAdminKey } = require('../middlewares/adminAuth');

router.post('/join', waitlistJoinLimiter, validateWaitlist, waitlistController.joinWaitlist);
router.get('/stats', requireAdminKey, waitlistController.getWaitlistStats);

module.exports = router;