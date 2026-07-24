const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/authMiddleware');
const notificationController = require("../controller/notificationController");
const {validateGetNotifications, validateMarkNotificationRead } = require("..//middlewares/notificationValidator");


// GET /api/v1/notifications
router.get('/', authenticateToken, validateGetNotifications,notificationController.getNotifications )

// GET /api/v1/notifications/unread-count
router.get('/unread-count', authenticateToken, notificationController.getUnreadCount )

// PATCH /api/v1/notifications/:id/read
router.patch('/:id/read', authenticateToken, validateMarkNotificationRead, notificationController.markAsRead)

module.exports = router;