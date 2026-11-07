const express = require('express');
const router = express.Router();
const storeController = require('../controller/storeController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.get('/', authenticateToken, storeController.getStores);
router.get('/integration-states', authenticateToken, storeController.getIntegrationStates);
router.get('/shopify/diagnostics', authenticateToken, storeController.getShopifyDiagnostics);
router.get('/:storeId/integration-state', authenticateToken, storeController.getIntegrationState);
// Task 215 — authoritative sync-progress contract (rev-sync-progress-v1) and
// the idempotent, tenant-scoped manual sync-retry.
router.get('/:storeId/sync-progress', authenticateToken, storeController.getSyncProgress);
router.post('/:storeId/sync-retry', authenticateToken, storeController.requestSyncRetry);

module.exports = router;
