/**
 * Affiliate Service
 * 
 * Core business logic for affiliate system:
 * - Referral link generation and management
 * - Click tracking
 * - Conversion tracking
 * - Earnings calculation
 * 
 * Usage:
 *   const affiliateService = require('./affiliateService');
 *   const link = await affiliateService.generateReferralLink(userId, username);
 */

const { v4: uuid } = require('uuid');
const { prisma } = require('./prisma');
const logger = require('../utils/logger');

/**
 * Generate unique referral code (5 alphanumeric chars)
 * Format: username-uniqueId (e.g., splendor-95d3e)
 * @returns {string} Unique ID (5 chars)
 */
function generateUniqueId() {
  return uuid().split('-')[0].substring(0, 5);
}

/**
 * Create referral link for new affiliate
 * @param {string} userId - User ID
 * @param {string} username - Affiliate username
 * @returns {Promise<{code: string, url: string, id: string}>}
 */
async function generateReferralLink(userId, username) {
  try {
    // Get affiliate profile
    const affiliate = await prisma.affiliateProfile.findUnique({
      where: { userId }
    });

    if (!affiliate) {
      throw new Error('Affiliate profile not found');
    }

    // Generate unique ID
    const uniqueId = generateUniqueId();
    const referralCode = `${username}-${uniqueId}`;

    // Check if code already exists (unlikely but safe)
    const existingLink = await prisma.referralLink.findUnique({
      where: { referralCode }
    });

    if (existingLink) {
      // Recursively try again
      return generateReferralLink(userId, username);
    }

    // Create referral link
    const link = await prisma.referralLink.create({
      data: {
        affiliateId: affiliate.id,
        username,
        uniqueId,
        referralCode
      }
    });

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://revluma.vercel.app';
    const url = `${baseUrl}/affiliate/${referralCode}`;

    logger.info('Referral link created', { affiliateId: affiliate.id, referralCode, url });

    return {
      id: link.id,
      code: referralCode,
      url
    };
  } catch (err) {
    logger.error('Failed to generate referral link', { error: err.message, userId });
    throw err;
  }
}

/**
 * Track click on referral link
 * @param {string} referralCode - Referral code (e.g., splendor-95d3e)
 * @param {Object} metadata - Click metadata
 * @returns {Promise<{success: boolean, affiliateId?: string, error?: string}>}
 */
async function trackReferralClick(referralCode, metadata = {}) {
  try {
    // Find referral link
    const referralLink = await prisma.referralLink.findUnique({
      where: { referralCode },
      include: { affiliate: true }
    });

    if (!referralLink) {
      logger.warn('Click tracked for non-existent referral link', { referralCode });
      return {
        success: false,
        error: 'Invalid referral code'
      };
    }

    // Record click
    await prisma.referralClick.create({
      data: {
        referralLinkId: referralLink.id,
        affiliateId: referralLink.affiliateId,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        referrer: metadata.referrer,
        utmSource: metadata.utmSource,
        utmMedium: metadata.utmMedium,
        utmCampaign: metadata.utmCampaign
      }
    });

    // Increment clicks count
    await prisma.referralLink.update({
      where: { id: referralLink.id },
      data: { clicksCount: { increment: 1 } }
    });

    logger.info('Referral click tracked', { referralCode, affiliateId: referralLink.affiliateId });

    return {
      success: true,
      affiliateId: referralLink.affiliateId
    };
  } catch (err) {
    logger.error('Failed to track referral click', { error: err.message, referralCode });
    return {
      success: false,
      error: 'Failed to track click'
    };
  }
}

/**
 * Record waitlist submission as referral
 * @param {string} waitlistSubmissionId - Waitlist submission ID
 * @param {string} referralCode - Referral code (optional)
 * @returns {Promise<{success: boolean, affiliateId?: string, error?: string}>}
 */
async function recordWaitlistReferral(waitlistSubmissionId, referralCode = null) {
  try {
    // Get waitlist submission
    const waitlist = await prisma.waitlistSubmission.findUnique({
      where: { id: waitlistSubmissionId }
    });

    if (!waitlist) {
      throw new Error('Waitlist submission not found');
    }

    let affiliateId = waitlist.affiliateId;

    // If referral code provided, resolve it
    if (referralCode && !affiliateId) {
      const referralLink = await prisma.referralLink.findUnique({
        where: { referralCode }
      });

      if (!referralLink) {
        return {
          success: false,
          error: 'Invalid referral code'
        };
      }

      affiliateId = referralLink.affiliateId;

      // Update waitlist with affiliate
      await prisma.waitlistSubmission.update({
        where: { id: waitlistSubmissionId },
        data: {
          referralCode,
          affiliateId
        }
      });
    }

    // Create affiliate referral record if affiliate exists
    if (affiliateId) {
      const referral = await prisma.affiliateReferral.create({
        data: {
          partnerId: affiliateId,
          customerEmail: waitlist.email,
          status: 'WAITLIST_JOINED',
          ipAddress: metadata?.ipAddress
        }
      });

      logger.info('Waitlist referral recorded', { affiliateId, referralId: referral.id });

      return {
        success: true,
        affiliateId,
        referralId: referral.id
      };
    }

    return {
      success: true,
      affiliateId: null
    };
  } catch (err) {
    logger.error('Failed to record waitlist referral', { error: err.message });
    return {
      success: false,
      error: 'Failed to record referral'
    };
  }
}

/**
 * Update referral status (e.g., WAITLIST → ACCOUNT_CREATED → ACTIVE_SUBSCRIBER)
 * @param {string} referralId - Affiliate referral ID
 * @param {string} newStatus - New status
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function updateReferralStatus(referralId, newStatus) {
  const validStatuses = ['WAITLIST_JOINED', 'ACCOUNT_CREATED', 'TRIAL_STARTED', 'ACTIVE_SUBSCRIBER', 'CANCELLED'];

  if (!validStatuses.includes(newStatus)) {
    return {
      success: false,
      error: `Invalid status: ${newStatus}`
    };
  }

  try {
    const referral = await prisma.affiliateReferral.update({
      where: { id: referralId },
      data: {
        status: newStatus,
        convertedAt: ['ACCOUNT_CREATED', 'TRIAL_STARTED', 'ACTIVE_SUBSCRIBER'].includes(newStatus)
          ? new Date()
          : undefined
      }
    });

    logger.info('Referral status updated', { referralId, newStatus });

    return { success: true };
  } catch (err) {
    logger.error('Failed to update referral status', { error: err.message, referralId });
    return {
      success: false,
      error: 'Failed to update status'
    };
  }
}

/**
 * Calculate affiliate metrics for dashboard
 * @param {string} affiliateId - Affiliate ID
 * @param {string} period - 'today', 'week', 'month', or 'all'
 * @returns {Promise<Object>} Metrics object
 */
async function getAffiliateMetrics(affiliateId, period = 'month') {
  try {
    // Calculate date range
    const now = new Date();
    let startDate;

    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'all':
        startDate = new Date('2000-01-01');
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    // Query metrics in parallel
    const [
      totalClicks,
      referrals,
      earnings,
      referralLinks,
      statusBreakdown
    ] = await Promise.all([
      prisma.referralClick.count({
        where: { affiliateId, createdAt: { gte: startDate } }
      }),
      prisma.affiliateReferral.findMany({
        where: { partnerId: affiliateId, createdAt: { gte: startDate } }
      }),
      prisma.affiliateEarning.aggregate({
        where: { partnerId: affiliateId, createdAt: { gte: startDate } },
        _sum: { amount: true }
      }),
      prisma.referralLink.findMany({
        where: { affiliateId },
        select: { id: true, referralCode: true, clicksCount: true, createdAt: true }
      }),
      prisma.affiliateReferral.groupBy({
        by: ['status'],
        where: { partnerId: affiliateId },
        _count: true
      })
    ]);

    const conversions = referrals.filter(r => 
      ['ACCOUNT_CREATED', 'TRIAL_STARTED', 'ACTIVE_SUBSCRIBER'].includes(r.status)
    ).length;

    const conversionRate = totalClicks > 0 ? ((conversions / totalClicks) * 100).toFixed(2) : '0.00';

    const statusMap = {};
    statusBreakdown.forEach(item => {
      statusMap[item.status] = item._count;
    });

    return {
      period,
      totalClicks,
      conversions,
      conversionRate: parseFloat(conversionRate),
      referralLinks: referralLinks.map(link => ({
        code: link.referralCode,
        clicks: link.clicksCount,
        createdAt: link.createdAt
      })),
      statusBreakdown: statusMap,
      totalEarnings: parseFloat(earnings._sum.amount || 0),
      totalReferrals: referrals.length,
      activeReferrals: statusMap['ACTIVE_SUBSCRIBER'] || 0,
      trialReferrals: statusMap['TRIAL_STARTED'] || 0,
      waitlistReferrals: statusMap['WAITLIST_JOINED'] || 0
    };
  } catch (err) {
    logger.error('Failed to calculate affiliate metrics', { error: err.message, affiliateId });
    throw err;
  }
}

/**
 * Get leaderboard of top affiliates
 * @param {string} period - 'today', 'week', 'month', 'all'
 * @param {number} limit - Max results (default 50)
 * @returns {Promise<Array>} Leaderboard
 */
async function getLeaderboard(period = 'month', limit = 50) {
  try {
    // Calculate date range
    const now = new Date();
    let startDate;

    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'all':
        startDate = new Date('2000-01-01');
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    // Get all affiliates with their metrics
    const affiliates = await prisma.affiliateProfile.findMany({
      select: {
        id: true,
        username: true,
        tier: true,
        referrals: {
          where: {
            createdAt: { gte: startDate },
            status: { in: ['ACCOUNT_CREATED', 'TRIAL_STARTED', 'ACTIVE_SUBSCRIBER'] }
          },
          select: { id: true }
        },
        earnings: {
          where: { createdAt: { gte: startDate }, status: { in: ['CLEARED', 'WITHDRAWN'] } },
          select: { amount: true }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Transform and sort by conversions
    const leaderboard = affiliates
      .map((aff, index) => ({
        rank: index + 1,
        username: aff.username,
        tier: aff.tier,
        conversions: aff.referrals.length,
        totalEarned: aff.earnings.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0)
      }))
      .sort((a, b) => b.conversions - a.conversions)
      .slice(0, limit)
      .map((item, index) => ({
        ...item,
        rank: index + 1
      }));

    return leaderboard;
  } catch (err) {
    logger.error('Failed to fetch leaderboard', { error: err.message });
    throw err;
  }
}

module.exports = {
  generateReferralLink,
  trackReferralClick,
  recordWaitlistReferral,
  updateReferralStatus,
  getAffiliateMetrics,
  getLeaderboard
};
