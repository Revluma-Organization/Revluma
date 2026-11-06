'use strict';

const router = require('express').Router();
const { authenticateToken } = require('../middlewares/authMiddleware');
const { attachOrgMembership, requireRole } = require('../middlewares/orgAuth');
const controller = require('../controller/commerceActionController');

router.use(authenticateToken, attachOrgMembership);
router.get('/', controller.list);
router.get('/:id', controller.get);
router.post('/preview', requireRole('owner', 'admin'), controller.createPreview);
router.post('/:id/confirm', requireRole('owner', 'admin'), controller.confirm);
router.post('/:id/rollback', requireRole('owner', 'admin'), controller.rollback);
router.post('/:id/reconcile', requireRole('owner', 'admin'), controller.reconcile);

module.exports = router;
