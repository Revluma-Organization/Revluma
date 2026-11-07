const express = require('express');
const router = express.Router();
const storeController = require('../controller/storeController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.get('/', authenticateToken, storeController.getStores);
// Task 213 — canonical integration state (rev-integration-state-v1). The
// /integration-states route must be declared before the parameterized
// /:storeId route so Express matches it literally.
router.get('/integration-states', authenticateToken, storeController.getIntegrationStates);
// Task 214 — tenant-scoped integration diagnostics (lifecycle + webhook + sync).
router.get('/shopify/diagnostics', authenticateToken, storeController.getShopifyDiagnostics);
router.get('/:storeId/integration-state', authenticateToken, storeController.getIntegrationState);

module.exports = router;
