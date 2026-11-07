const express = require('express');
const router = express.Router();
const storeController = require('../controller/storeController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.get('/', authenticateToken, storeController.getStores);
router.get('/integration-states', authenticateToken, storeController.getIntegrationStates);
router.get('/shopify/diagnostics', authenticateToken, storeController.getShopifyDiagnostics);
router.get('/:storeId/integration-state', authenticateToken, storeController.getIntegrationState);

module.exports = router;
