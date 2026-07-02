const express = require('express');
const router = express.Router();
const waitlistController = require('../controller/waitlistController');
const { validateWaitlist } = require('../middlewares/validateWaitlist');

router.post('/join', validateWaitlist, waitlistController.joinWaitlist);
router.get('/stats', waitlistController.getWaitlistStats);

module.exports = router;