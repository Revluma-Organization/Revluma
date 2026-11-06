'use strict';

const router = require('express').Router();
const { authenticateToken } = require('../middlewares/authMiddleware');
const { attachOrgMembership } = require('../middlewares/orgAuth');
const controller = require('../controller/merchantCapabilityController');

router.use(authenticateToken, attachOrgMembership);
router.get('/sidekick/extension-foundation', controller.sidekickFoundation);
router.get('/shopify/stores/:storeId/capabilities', controller.coverage);
router.get('/shopify/stores/:storeId/collections', controller.collections);

module.exports = router;
