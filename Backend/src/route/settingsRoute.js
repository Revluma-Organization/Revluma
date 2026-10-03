const express = require("express");
const router = express.Router();

const settingsController = require("../controller/settingsController");
const { authenticateToken } = require("../middlewares/authMiddleware");
const { attachOrgMembership, requireRole } = require('../middlewares/orgAuth');


router.get("/branding",authenticateToken,settingsController.getBranding);
router.put("/branding",authenticateToken,settingsController.updateBranding);
router.get('/notifications',authenticateToken,settingsController.getNotificationPreferences);
router.put('/notifications',authenticateToken,settingsController.updateNotificationPreferences);
router.get(
  '/beta-automation/:storeId',
  authenticateToken,
  attachOrgMembership,
  requireRole('owner', 'admin'),
  settingsController.getBetaAutomation
);
router.put(
  '/beta-automation/:storeId',
  authenticateToken,
  attachOrgMembership,
  requireRole('owner', 'admin'),
  settingsController.updateBetaAutomation
);

module.exports = router;
