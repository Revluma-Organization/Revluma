/**
 * Affiliate Admin Routes
 * Admin-only endpoints for affiliate approval and management
 */

const express = require('express');
const { prisma } = require('../../services/prisma');
const logger = require('../../utils/logger');
const { requireRole } = require('../../middleware/roleAuth');

const router = express.Router();
const adminOnly = requireRole(['admin']);

/**
 * GET /api/affiliate/admin/pending-applications
 * Get all pending affiliate applications
 */
router.get('/pending-applications', adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 25 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [applications, total] = await Promise.all([
      prisma.affiliateProfile.findMany({
        where: { status: 'PENDING' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              emailVerified: true,
              emailVerifiedAt: true,
              createdAt: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.affiliateProfile.count({ where: { status: 'PENDING' } })
    ]);

    res.status(200).json({
      applications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    logger.error('Get pending applications failed', {
      error: error.message,
      adminId: req.user.id
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/affiliate/admin/approve/:affiliateId
 * Approve affiliate application
 */
router.patch('/approve/:affiliateId', adminOnly, async (req, res) => {
  try {
    const { affiliateId } = req.params;
    const { notes } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      // Get current profile
      const profile = await tx.affiliateProfile.findUnique({
        where: { id: affiliateId },
        include: { user: true }
      });

      if (!profile) {
        throw new Error('AFFILIATE_NOT_FOUND');
      }

      if (profile.status === 'APPROVED') {
        throw new Error('ALREADY_APPROVED');
      }

      // Update profile
      const updatedProfile = await tx.affiliateProfile.update({
        where: { id: affiliateId },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: req.user.id,
          reviewNotes: notes,
          statusUpdatedAt: new Date(),
          statusUpdatedBy: req.user.id
        }
      });

      // Log status change
      await tx.affiliateStatusAuditLog.create({
        data: {
          affiliateProfileId: affiliateId,
          previousStatus: profile.status,
          newStatus: 'APPROVED',
          changedBy: req.user.id,
          notes,
          metadata: {
            adminEmail: req.user.email,
            timestamp: new Date().toISOString()
          }
        }
      });

      // Generate referral link if doesn't exist
      const existingLink = await tx.referralLink.findFirst({
        where: { affiliateId }
      });

      if (!existingLink) {
        const crypto = require('crypto');
        const uniqueId = crypto.randomBytes(4).toString('hex');
        const referralCode = `${profile.username}-${uniqueId}`;

        await tx.referralLink.create({
          data: {
            affiliateId,
            username: profile.username,
            uniqueId,
            referralCode
          }
        });
      }

      return { profile: updatedProfile, user: profile.user };
    });

    logger.info('Affiliate approved by admin', {
      affiliateId,
      adminId: req.user.id,
      email: result.user.email
    });

    // Send welcome email (non-blocking)
    const emailService = require('../../services/emailService');
    const config = require('../../config/environment');
    const referralLink = await prisma.referralLink.findFirst({
      where: { affiliateId }
    });
    
    if (referralLink) {
      const fullLink = config.getAffiliateLink(result.profile.username, referralLink.uniqueId);
      emailService.sendAffiliateWelcomeEmail(
        result.user.email,
        result.profile.fullName,
        fullLink,
        result.profile.username
      ).catch(err => {
        logger.error('Failed to send welcome email', {
          error: err.message,
          affiliateId
        });
      });
    }

    res.status(200).json({
      message: 'Affiliate approved successfully',
      affiliateId: result.profile.id,
      status: result.profile.status,
      approvedAt: result.profile.approvedAt
    });
  } catch (error) {
    logger.error('Approve affiliate failed', {
      error: error.message,
      affiliateId: req.params.affiliateId,
      adminId: req.user.id
    });

    if (error.message === 'AFFILIATE_NOT_FOUND') {
      return res.status(404).json({ error: 'Affiliate not found' });
    }

    if (error.message === 'ALREADY_APPROVED') {
      return res.status(400).json({ error: 'Affiliate already approved' });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/affiliate/admin/reject/:affiliateId
 * Reject affiliate application
 */
router.patch('/reject/:affiliateId', adminOnly, async (req, res) => {
  try {
    const { affiliateId } = req.params;
    const { reason, notes } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const profile = await tx.affiliateProfile.findUnique({
        where: { id: affiliateId }
      });

      if (!profile) {
        throw new Error('AFFILIATE_NOT_FOUND');
      }

      const updatedProfile = await tx.affiliateProfile.update({
        where: { id: affiliateId },
        data: {
          status: 'REJECTED',
          rejectedAt: new Date(),
          rejectedBy: req.user.id,
          rejectedReason: reason,
          reviewNotes: notes,
          statusUpdatedAt: new Date(),
          statusUpdatedBy: req.user.id
        }
      });

      await tx.affiliateStatusAuditLog.create({
        data: {
          affiliateProfileId: affiliateId,
          previousStatus: profile.status,
          newStatus: 'REJECTED',
          changedBy: req.user.id,
          reason,
          notes,
          metadata: {
            adminEmail: req.user.email,
            timestamp: new Date().toISOString()
          }
        }
      });

      return updatedProfile;
    });

    logger.info('Affiliate rejected by admin', {
      affiliateId,
      adminId: req.user.id,
      reason
    });

    res.status(200).json({
      message: 'Affiliate rejected',
      affiliateId: result.id,
      status: result.status,
      rejectedAt: result.rejectedAt
    });
  } catch (error) {
    logger.error('Reject affiliate failed', {
      error: error.message,
      affiliateId: req.params.affiliateId,
      adminId: req.user.id
    });

    if (error.message === 'AFFILIATE_NOT_FOUND') {
      return res.status(404).json({ error: 'Affiliate not found' });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/affiliate/admin/suspend/:affiliateId
 * Suspend affiliate account
 */
router.patch('/suspend/:affiliateId', adminOnly, async (req, res) => {
  try {
    const { affiliateId } = req.params;
    const { reason, notes } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Suspension reason is required' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const profile = await tx.affiliateProfile.findUnique({
        where: { id: affiliateId }
      });

      if (!profile) {
        throw new Error('AFFILIATE_NOT_FOUND');
      }

      const updatedProfile = await tx.affiliateProfile.update({
        where: { id: affiliateId },
        data: {
          status: 'SUSPENDED',
          suspendedAt: new Date(),
          suspendedBy: req.user.id,
          suspendedReason: reason,
          reviewNotes: notes,
          statusUpdatedAt: new Date(),
          statusUpdatedBy: req.user.id
        }
      });

      await tx.affiliateStatusAuditLog.create({
        data: {
          affiliateProfileId: affiliateId,
          previousStatus: profile.status,
          newStatus: 'SUSPENDED',
          changedBy: req.user.id,
          reason,
          notes,
          metadata: {
            adminEmail: req.user.email,
            timestamp: new Date().toISOString()
          }
        }
      });

      return updatedProfile;
    });

    logger.info('Affiliate suspended by admin', {
      affiliateId,
      adminId: req.user.id,
      reason
    });

    res.status(200).json({
      message: 'Affiliate suspended',
      affiliateId: result.id,
      status: result.status,
      suspendedAt: result.suspendedAt
    });
  } catch (error) {
    logger.error('Suspend affiliate failed', {
      error: error.message,
      affiliateId: req.params.affiliateId,
      adminId: req.user.id
    });

    if (error.message === 'AFFILIATE_NOT_FOUND') {
      return res.status(404).json({ error: 'Affiliate not found' });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/affiliate/admin/status-audit/:affiliateId
 * Get status change audit log for affiliate
 */
router.get('/status-audit/:affiliateId', adminOnly, async (req, res) => {
  try {
    const { affiliateId } = req.params;

    const auditLog = await prisma.affiliateStatusAuditLog.findMany({
      where: { affiliateProfileId: affiliateId },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ auditLog });
  } catch (error) {
    logger.error('Get status audit failed', {
      error: error.message,
      affiliateId: req.params.affiliateId,
      adminId: req.user.id
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
