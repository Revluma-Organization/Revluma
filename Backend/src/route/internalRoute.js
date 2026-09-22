const express = require('express');

const internalController = require('../controller/internalController');
const { requireInternalKey } = require('../middlewares/internalAuth');

const router = express.Router();

router.use(requireInternalKey);

router.post('/business-state/rebuild', internalController.rebuildBusinessState);
router.post('/recommendation-outcomes/evaluate', internalController.evaluateRecommendationOutcomes);
router.post('/store-sync', internalController.syncStore);

module.exports = router;
