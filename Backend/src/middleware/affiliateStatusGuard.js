/**
 * Affiliate Status Guard Middleware
 * Enforces status-based access control for affiliate routes
 * Only APPROVED affiliates can access dashboard and protected resources
 */

const { prisma } = require('../services/prisma');
const logger = require('../utils/logger');

/**
 * Require specific affiliate status(es) to access route
 * @param {Array<string>} allowedStatuses - Array of allowed AffiliateStatus values
 */
function requireAffiliateStatus(allowedStatuses = ['APPROVED']) {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ 
          error: 'Authentication required',
          code: 'UNAUTHORIZED'
        });
      }

      // Check if user has affiliate profile
      const affiliateProfile = await prisma.affiliateProfile.findUnique({
        where: { userId: req.user.id },
        select: {
          id: true,
          status: true,
          username: true,
          rejectedReason: true,
          suspendedReason: true
        }
      });

      if (!affiliateProfile) {
        return res.status(403).json({
          error: 'Affiliate profile not found',
          code: 'NO_AFFILIATE_PROFILE'
        });
      }

      // Check if status is allowed
      if (!allowedStatuses.includes(affiliateProfile.status)) {
        logger.warn('Affiliate access denied due to status', {
          userId: req.user.id,
          affiliateId: affiliateProfile.id,
          currentStatus: affiliateProfile.status,
          requiredStatus: allowedStatuses
        });

        return res.status(403).json({
          error: 'Access denied',
          code: 'INSUFFICIENT_STATUS',
          currentStatus: affiliateProfile.status,
          requiredStatus: allowedStatuses,
          message: getStatusMessage(affiliateProfile)
        });
      }

      // Attach affiliate profile to request
      req.affiliateProfile = affiliateProfile;
      next();
    } catch (error) {
      logger.error('Affiliate status guard error', {
        error: error.message,
        userId: req.user?.id
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

/**
 * Get user-friendly message based on affiliate status
 */
function getStatusMessage(affiliateProfile) {
  switch (affiliateProfile.status) {
    case 'PENDING':
      return 'Your application is under review. You will be notified once approved.';
    case 'REJECTED':
      return affiliateProfile.rejectedReason || 'Your application was not approved.';
    case 'SUSPENDED':
      return affiliateProfile.suspendedReason || 'Your account has been suspended.';
    case 'APPROVED':
      return 'Your account is active.';
    default:
      return 'Your account status does not allow access to this resource.';
  }
}

/**
 * Check affiliate access and return status info
 * Non-blocking - returns status info for frontend routing
 */
async function checkAffiliateAccess(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      req.affiliateAccess = {
        hasAccess: false,
        status: null,
        reason: 'NOT_AUTHENTICATED'
      };
      return next();
    }

    const affiliateProfile = await prisma.affiliateProfile.findUnique({
      where: { userId: req.user.id },
      select: {
        id: true,
        status: true,
        username: true,
        rejectedReason: true,
        suspendedReason: true,
        approvedAt: true
      }
    });

    if (!affiliateProfile) {
      req.affiliateAccess = {
        hasAccess: false,
        status: null,
        reason: 'NO_AFFILIATE_PROFILE'
      };
      return next();
    }

    req.affiliateAccess = {
      hasAccess: affiliateProfile.status === 'APPROVED',
      status: affiliateProfile.status,
      affiliateId: affiliateProfile.id,
      username: affiliateProfile.username,
      message: getStatusMessage(affiliateProfile),
      approvedAt: affiliateProfile.approvedAt
    };

    req.affiliateProfile = affiliateProfile;
    next();
  } catch (error) {
    logger.error('Check affiliate access error', {
      error: error.message,
      userId: req.user?.id
    });
    req.affiliateAccess = {
      hasAccess: false,
      status: null,
      reason: 'ERROR'
    };
    next();
  }
}

/**
 * Middleware to ensure user is an affiliate (has affiliate profile)
 */
async function requireAffiliateProfile(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      });
    }

    const affiliateProfile = await prisma.affiliateProfile.findUnique({
      where: { userId: req.user.id }
    });

    if (!affiliateProfile) {
      return res.status(403).json({
        error: 'Affiliate profile required',
        code: 'NO_AFFILIATE_PROFILE'
      });
    }

    req.affiliateProfile = affiliateProfile;
    next();
  } catch (error) {
    logger.error('Require affiliate profile error', {
      error: error.message,
      userId: req.user?.id
    });
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  requireAffiliateStatus,
  checkAffiliateAccess,
  requireAffiliateProfile,
  getStatusMessage
};
