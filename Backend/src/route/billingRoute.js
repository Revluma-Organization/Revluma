const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/authMiddleware');
const subscriptionController = require('../controller/subscriptionController');

router.post('/start-trial', authenticateToken, subscriptionController.startTrial);

module.exports = router;