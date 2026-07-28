const dbConfig = require('../configs/database');
const prisma = dbConfig.prisma;

/**GET /api/v1/auth/sessions Get all active sessions for the authenticated user */
exports.getSessions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const currentSessionId = req.user.sessionId || req.user.sid || null;
    const sessions = await prisma.refresh_tokens.findMany({
      where: {
        user_id: userId,
        is_revoked: false,
        expires_at: {
          gt: new Date(),
        },
      },
      select: {
        id: true,
        device_hint: true,
        ip_address: true,
        created_at: true,
        last_used_at: true,
        expires_at: true,
      },
      orderBy: {
        last_used_at: 'desc',
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        sessions: sessions.map((session) => ({
          id: session.id,
          device: session.device_hint,
          ipAddress: session.ip_address,
          createdAt: session.created_at,
          lastActive: session.last_used_at,
          expiresAt: session.expires_at,
          current: session.id === currentSessionId,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**DELETE /api/v1/auth/sessions/:id Revoke a specific session*/
exports.deleteSession = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const currentSessionId = req.user.sessionId;
    const { id } = req.params;

    // Prevent revoking the current session
    if (id === currentSessionId) {
      return res.status(400).json({
        success: false,
        error: "You cannot revoke your current session. Use the logout endpoint instead.",
      });
    }

    const session = await prisma.refresh_tokens.findFirst({
      where: {
        id,
        user_id: userId,
        is_revoked: false,
      },
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        error: "Session not found.",
      });
    }

    await prisma.refresh_tokens.update({
      where: {
        id: session.id,
      },
      data: {
        is_revoked: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Session revoked successfully.",
    });

  } catch (error) {
    next(error);
  }
};

exports.deleteOtherSessions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const currentSessionId = req.user.sessionId;

    const result = await prisma.refresh_tokens.updateMany({
      where: {
        user_id: userId,
        is_revoked: false,
        id: {
          not: currentSessionId,
        },
      },
      data: {
        is_revoked: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Logged out of all other devices.",
      revokedSessions: result.count,
    });

  } catch (error) {
    next(error);
  }
};