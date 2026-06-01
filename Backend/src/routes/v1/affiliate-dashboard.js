/**
 * Affiliate Dashboard API Routes
 * Real-time metrics and analytics for affiliate dashboard
 * Requires authentication with 'affiliate' or 'admin' role
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../../services/prisma');
const logger = require('../../utils/logger');

function requireRole(roles) {
  return (req, res, next) => {
    const userRole = req.user?.role;
    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({ error: 'Access denied', required: roles });
    }
    next();
  };
}

const affiliateOrAdmin = requireRole(['affiliate', 'admin']);

/**
 * GET /api/affiliate/dashboard/metrics
 * Real-time dashboard metrics for an affiliate
 */
router.get('/metrics', affiliateOrAdmin, async (req, res) => {
  const { period = 'month' } = req.query;

  try {
    const profile = await prisma.affiliateProfile.findUnique({
      where: { userId: req.user.id }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Affiliate profile not found' });
    }

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
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case 'month':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    // Get referral links
    const referralLinks = await prisma.referralLink.findMany({
      where: { affiliateId: profile.id },
      select: {
        id: true,
        referralCode: true,
        clicksCount: true,
        createdAt: true
      }
    });

    // Get total clicks in period
    const totalClicks = await prisma.referralClick.count({
      where: {
        affiliateId: profile.id,
        createdAt: { gte: startDate }
      }
    });

    // Get total referrals in period
    const totalReferrals = await prisma.affiliateReferral.count({
      where: {
        partnerId: profile.id,
        createdAt: { gte: startDate }
      }
    });

    // Get conversions (non-waitlist statuses)
    const conversions = await prisma.affiliateReferral.count({
      where: {
        partnerId: profile.id,
        status: { in: ['ACCOUNT_CREATED', 'TRIAL_STARTED', 'ACTIVE_SUBSCRIBER'] },
        convertedAt: { gte: startDate }
      }
    });

    // Get earnings in period
    const earnings = await prisma.affiliateEarning.aggregate({
      where: {
        partnerId: profile.id,
        createdAt: { gte: startDate }
      },
      _sum: { amount: true }
    });

    // Referral status breakdown
    const statusBreakdown = await prisma.affiliateReferral.groupBy({
      by: ['status'],
      where: { partnerId: profile.id },
      _count: true
    });

    const conversionRate = totalClicks > 0 ? ((conversions / totalClicks) * 100).toFixed(2) : '0.00';

    res.json({
      period,
      dateRange: { start: startDate, end: now },
      metrics: {
        totalClicks,
        totalReferrals,
        conversions,
        conversionRate: parseFloat(conversionRate),
        earnings: Number(earnings._sum.amount || 0),
        referralLinks: referralLinks.length,
        status: {
          waitlistJoined: statusBreakdown.find(s => s.status === 'WAITLIST_JOINED')?._count || 0,
          accountCreated: statusBreakdown.find(s => s.status === 'ACCOUNT_CREATED')?._count || 0,
          trialStarted: statusBreakdown.find(s => s.status === 'TRIAL_STARTED')?._count || 0,
          activeSubscriber: statusBreakdown.find(s => s.status === 'ACTIVE_SUBSCRIBER')?._count || 0,
          cancelled: statusBreakdown.find(s => s.status === 'CANCELLED')?._count || 0
        }
      },
      profile: {
        username: profile.username,
        tier: profile.tier,
        commissionRate: Number(profile.commissionRate),
        totalEarned: Number(profile.totalEarned),
        status: profile.status
      }
    });
  } catch (err) {
    logger.error('Dashboard metrics error', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

/**
 * GET /api/affiliate/dashboard/referral-links
 * Get all referral links for an affiliate
 */
router.get('/referral-links', affiliateOrAdmin, async (req, res) => {
  try {
    const profile = await prisma.affiliateProfile.findUnique({
      where: { userId: req.user.id }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Affiliate profile not found' });
    }

    const links = await prisma.referralLink.findMany({
      where: { affiliateId: profile.id },
      orderBy: { createdAt: 'desc' }
    });

    // Construct absolute URLs using centralized BASE_URL config if available
    let configuredBase = null;
    try { configuredBase = require('../../config/baseUrl').BASE_URL; } catch (e) { configuredBase = null; }

    res.json({
      links: links.map(link => {
        const base = configuredBase || `${req.protocol}://${req.get('host')}`;
        return {
          id: link.id,
          referralCode: link.referralCode,
          clicksCount: link.clicksCount,
          createdAt: link.createdAt,
          updatedAt: link.updatedAt,
          url: `${base.replace(/\/$/, '')}/r/${link.referralCode}`
        };
      })
    });
  } catch (err) {
    logger.error('Referral links fetch error', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Failed to fetch referral links' });
  }
});

/**
 * GET /api/affiliate/dashboard/click-analytics
 * Get detailed click analytics
 */
router.get('/click-analytics', affiliateOrAdmin, async (req, res) => {
  const { days = 30 } = req.query;

  try {
    const profile = await prisma.affiliateProfile.findUnique({
      where: { userId: req.user.id }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Affiliate profile not found' });
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Get clicks by day
    const dailyClicks = await prisma.referralClick.groupBy({
      by: ['createdAt'],
      where: {
        affiliateId: profile.id,
        createdAt: { gte: startDate }
      },
      _count: true,
      orderBy: { createdAt: 'desc' }
    });

    // Get top referrers
    const topReferrers = await prisma.referralClick.groupBy({
      by: ['referrer'],
      where: {
        affiliateId: profile.id,
        createdAt: { gte: startDate }
      },
      _count: true,
      orderBy: { _count: { referrer: 'desc' } },
      take: 10
    });

    res.json({
      period: { days: parseInt(days), startDate, endDate: new Date() },
      dailyClicks: dailyClicks.map(d => ({
        date: d.createdAt,
        clicks: d._count
      })),
      topReferrers: topReferrers.map(r => ({
        referrer: r.referrer || '(direct)',
        clicks: r._count
      }))
    });
  } catch (err) {
    logger.error('Click analytics error', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Failed to fetch click analytics' });
  }
});

module.exports = router;
