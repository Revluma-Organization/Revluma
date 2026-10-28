const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/authMiddleware');
const dashboardController = require('../controller/dashboardController');

// GET /api/v1/dashboard/kpis
router.get('/kpis', authenticateToken, dashboardController.getKpis);

// GET /api/v1/dashboard/chart
router.get('/chart', authenticateToken, dashboardController.getChart);

// GET /api/v1/dashboard/activity
router.get('/activity', authenticateToken, dashboardController.getActivity);

router.get('/cart-recovery', authenticateToken, dashboardController.getCartRecovery);

router.get('/operations', authenticateToken, require('../controller/operationalOverviewController').getOperationalOverview);

module.exports = router;