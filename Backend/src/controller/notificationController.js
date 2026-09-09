const dbConfig = require("../configs/database");
const prisma = dbConfig.prisma;
const logger = require("../utils/logger");

/* GET /api/v1/notifications
 * Returns notifications belonging to the authenticated user.*/
exports.getNotifications = async (req, res, next) => {
  try {
    const limit = Number(req.query.limit || 20);

    const notifications = await prisma.notifications.findMany({
      where: {
        user_id: req.user.id,
      },
      orderBy: {
        created_at: "desc",
      },
      take: limit,
      select: {
        id: true,
        type: true,
        message: true,
        action_url: true,
        read_at: true,
        created_at: true,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        notifications: notifications.map((notification) => ({
          id: notification.id,
          type: notification.type,
          message: notification.message,
          action_url: notification.action_url,
          unread: notification.read_at === null,
          created_at: notification.created_at,
        })),
      },
    });
  } catch (error) {
    logger.error("get_notifications_failed", {
      userId: req.user?.id,
      message: error.message,
      stack: error.stack,
    });

    next(error);
  }
};

/* GET /api/v1/notifications/unread-count */
exports.getUnreadCount = async (req, res, next) => {
  try {
    const count = await prisma.notifications.count({
      where: {
        user_id: req.user.id,
        read_at: null,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        count,
      },
    });
  } catch (error) {
    logger.error("get_unread_notification_count_failed", {
      userId: req.user?.id,
      message: error.message,
      stack: error.stack,
    });

    next(error);
  }
};

/* PATCH /api/v1/notifications/:id/read */
exports.markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    const notification = await prisma.notifications.findFirst({
      where: {
        id,
        user_id: req.user.id,
      },
      select: {
        id: true,
        read_at: true,
      },
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: "Notification not found.",
      });
    }

    if (!notification.read_at) {
      await prisma.notifications.update({
        where: {
          id,
        },
        data: {
          read_at: new Date(),
        },
      });
    }

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    logger.error("mark_notification_read_failed", {
      userId: req.user?.id,
      notificationId: req.params?.id,
      message: error.message,
      stack: error.stack,
    });

    next(error);
  }
};
// ── Internal: create anomaly alert from business state ────────────────────────
// Called by the Python service (via revController) when an anomaly is detected.
// Uses existing notifications infrastructure — no new tables needed.
exports.createAnomalyAlert = async ({ userId, orgId, type, message, actionUrl }) => {
  try {
    await prisma.notifications.create({
      data: {
        user_id:    userId,
        type:       type || "anomaly_alert",
        message:    message,
        action_url: actionUrl || "/dashboard/rev-intell",
        read_at:    null,
      },
    });
  } catch (err) {
    // Never crash the business state pipeline over a notification failure
    console.error("createAnomalyAlert failed:", err.message);
  }
};
