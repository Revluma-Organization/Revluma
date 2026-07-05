const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/authMiddleware');

// GET /api/v1/notifications
router.get('/', authenticateToken, (req, res) => {
  // Stub: returns empty array until notifications table migration runs
  res.json({ success: true, data: { notifications: [] } });
});

// GET /api/v1/notifications/unread-count
router.get('/unread-count', authenticateToken, (req, res) => {
  res.json({ success: true, data: { count: 0 } });
});

// PATCH /api/v1/notifications/:id/read
router.patch('/:id/read', authenticateToken, (req, res) => {
  res.json({ success: true });
});

module.exports = router;