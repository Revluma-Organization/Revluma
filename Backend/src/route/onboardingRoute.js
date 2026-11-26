const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/authMiddleware');
const onboardingController = require('../controller/onboardingController');

router.get('/', authenticateToken, onboardingController.getOnboarding);
router.put('/store', authenticateToken, onboardingController.saveStore);
router.put('/goals', authenticateToken, onboardingController.saveGoals);

module.exports = router;
