'use strict';

const router = require('express').Router();
const { authenticateToken } = require('../middlewares/authMiddleware');
const { attachOrgMembership, requireRole } = require('../middlewares/orgAuth');
const controller = require('../controller/merchantCapabilityController');

router.use(authenticateToken, attachOrgMembership);
router.get('/sidekick/extension-foundation', controller.sidekickFoundation);
router.get('/shopify/stores/:storeId/capabilities', controller.coverage);
router.get('/shopify/stores/:storeId/collections', controller.collections);
router.get('/shopify/stores/:storeId/resources/:resourceId', controller.resourcePage);
router.post('/shopify/stores/:storeId/resources/:resourceId/sync', requireRole('owner', 'admin'), controller.syncResource);

module.exports = router;
