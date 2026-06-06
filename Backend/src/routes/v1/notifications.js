const express = require('express');
const router = express.Router();
const { authenticate } = require("../../middleware/sessionAuth");
const { prisma } = require('../../services/prisma');
const logger = require('../../utils/logger');

// ============================================================
// Notifications API
// ============================================================

// GET /api/v1/notifications
router.get('/', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { limit = 20, unread, cursor } = req.query;

    const where = {
      tenantId,
      userId
    };

    if (unread === 'true') {
      where.read = false;
    }

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit) + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0
    });

    const hasMore = notifications.length > parseInt(limit);
    const items = hasMore ? notifications.slice(0, -1) : notifications;
    const nextCursor = hasMore ? items[items.length - 1]?.id : null;

    const unreadCount = await prisma.notification.count({
      where: {
        tenantId,
        userId,
        read: false
      }
    });

    res.json({
      success: true,
      data: items,
      meta: {
        total: items.length,
        unreadCount,
        nextCursor
      }
    });
  } catch (error) {
    logger.error('Notifications fetch failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// POST /api/v1/notifications/:id/read
router.post('/:id/read', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { id } = req.params;

    const notification = await prisma.notification.updateMany({
      where: {
        id,
        tenantId,
        userId,
        read: false
      },
      data: {
        read: true,
        readAt: new Date()
      }
    });

    if (notification.count === 0) {
      return res.status(404).json({ error: 'Notification not found or already read' });
    }

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    logger.error('Mark notification read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// POST /api/v1/notifications/read-all
router.post('/read-all', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;

    const result = await prisma.notification.updateMany({
      where: {
        tenantId,
        userId,
        read: false
      },
      data: {
        read: true,
        readAt: new Date()
      }
    });

    res.json({ 
      success: true, 
      message: `${result.count} notifications marked as read` 
    });
  } catch (error) {
    logger.error('Mark all notifications read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

// DELETE /api/v1/notifications/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { id } = req.params;

    await prisma.notification.delete({
      where: {
        id,
        tenantId,
        userId
      }
    });

    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    logger.error('Delete notification failed', { error: error.message });
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// GET /api/v1/notifications/unread-count
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;

    const count = await prisma.notification.count({
      where: {
        tenantId,
        userId,
        read: false
      }
    });

    res.json({ success: true, count });
  } catch (error) {
    logger.error('Get unread count failed', { error: error.message });
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// Internal: Create notification (called by other services)
async function createNotification(tenantId, userId, type, title, message, data = {}) {
  try {
    const notification = await prisma.notification.create({
      data: {
        tenantId,
        userId,
        type,
        title,
        message,
        data
      }
    });
    return notification;
  } catch (error) {
    logger.error('Create notification failed', { error: error.message, tenantId, userId });
    return null;
  }
}

module.exports = router;
module.exports.createNotification = createNotification;