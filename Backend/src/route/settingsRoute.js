const express = require("express");
const router = express.Router();

const settingsController = require("../controller/settingsController");
const { authenticateToken } = require("../middlewares/authMiddleware");


router.get("/branding",authenticateToken,settingsController.getBranding);
router.put("/branding",authenticateToken,settingsController.updateBranding);
router.get('/notifications',authenticateToken,settingsController.getNotificationPreferences);
router.put('/notifications',authenticateToken,settingsController.updateNotificationPreferences);

module.exports = router;