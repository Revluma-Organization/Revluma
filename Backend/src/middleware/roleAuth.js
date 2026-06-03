const logger = require('../utils/logger');

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = req.user.role || req.user.user_role;

    if (!allowedRoles.includes(userRole)) {
      logger.warn('Role authorization failed', {
        userId: req.user.id,
        userRole,
        requiredRoles: allowedRoles,
        path: req.originalUrl
      });
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: userRole
      });
    }

    next();
  };
}

module.exports = { requireRole };
