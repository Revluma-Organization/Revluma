/**
 * Affiliate API Routes
 * All routes require authentication (applied in server.js).
 * Role enforcement: 'affiliate' and 'admin' only unless noted.
 *
 * Prisma field name reference (from schema.prisma):
 *   AffiliateProfile  → partnerId FK on child tables, id PK
 *   AffiliateCampaign → partnerId (FK), tag, name, source
 *   AffiliateReferral → partnerId (FK), status (ReferralStatus enum), customerEmail
 *   AffiliateEarning  → partnerId (FK), status (EarningStatus enum: PENDING/CLEARED/WITHDRAWN)
 *   AffiliateNotification → partnerId (FK), isRead (not read), title, message, type
 *   AffiliateWithdrawal → partnerId (FK), amountUsd, payoutMethod, status, adminNotes
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
const adminOnly = requireRole(['admin']);

// GET /api/affiliate/dashboard-summary
router.get('/dashboard-summary', affiliateOrAdmin, async (req, res) => {
  try {
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return res.status(404).json({ error: 'Affiliate profile not found' });

    const [referrals, earnings, clicksResult] = await Promise.all([
      prisma.affiliateReferral.findMany({ where: { partnerId: profile.id } }),
      prisma.affiliateEarning.findMany({ where: { partnerId: profile.id } }),
      prisma.referralClick.count({ where: { affiliateId: profile.id } })
    ]);

    const activeReferrals = referrals.filter(r => r.status === 'ACTIVE_SUBSCRIBER').length;
    const trialReferrals = referrals.filter(r => r.status === 'TRIAL_STARTED').length;
    const waitlistReferrals = referrals.filter(r => r.status === 'WAITLIST_JOINED').length;
    const grossLtv = referrals.reduce((acc, r) => Number(acc) + Number(r.lifetimeValue || 0), 0);
    const monthlyCommission = referrals
      .filter(r => r.status === 'ACTIVE_SUBSCRIBER')
      .reduce((acc, r) => Number(acc) + Number(r.monthlyValue || 0), 0) * Number(profile.commissionRate);
    const pendingCommission = referrals
      .filter(r => r.status === 'TRIAL_STARTED')
      .reduce((acc, r) => Number(acc) + Number(r.monthlyValue || 0), 0) * Number(profile.commissionRate);

    res.json({
      totalClicks: clicksResult,
      activeReferrals,
      trialReferrals,
      waitlistReferrals,
      grossLtvRevenue: grossLtv,
      monthlyCommissionEarnings: monthlyCommission,
      pendingCommissionsBalance: pendingCommission,
      totalEarned: Number(profile.totalEarned || 0),
      tier: profile.tier,
      commissionRate: Number(profile.commissionRate || 0.20)
    });
  } catch (err) {
    logger.error('Dashboard summary failed', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/affiliate/invite - Invite a candidate to bypass vetting queue
router.post('/invite', affiliateOrAdmin, async (req, res) => {
  const { email, campaignTag } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  try {
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return res.status(404).json({ error: 'Affiliate profile not found' });

    const normalizedEmail = email.trim().toLowerCase();
    const maskedEmail = normalizedEmail.substring(0, 3) + '***@' + normalizedEmail.split('@')[1];

    const referral = await prisma.affiliateReferral.create({
      data: {
        partnerId: profile.id,
        customerEmail: maskedEmail,
        status: 'PENDING',
        campaignTag: campaignTag || 'manual_invite',
        ipAddress: req.ip
      }
    });

    logger.info('Manual referral invite created', { email: maskedEmail, affiliateId: profile.id });
    res.status(201).json({ referral });
  } catch (err) {
    logger.error('Invite referral failed', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// Affiliate Profile
// ============================================================

// GET /api/affiliate/profile
router.get('/profile', affiliateOrAdmin, async (req, res) => {
  try {
    const profile = await prisma.affiliateProfile.findUnique({
      where: { userId: req.user.id },
      include: { user: { select: { email: true, fullName: true } } }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Affiliate profile not found' });
    }

    const normalizedStatus = String(profile.status || 'PENDING_REVIEW').toLowerCase();
    res.json({
      profile: {
        ...profile,
        status: normalizedStatus === 'pending' ? 'pending_review' : normalizedStatus
      }
    });
  } catch (err) {
    logger.error('Get affiliate profile failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/affiliate/profile
router.patch('/profile', affiliateOrAdmin, async (req, res) => {
  const { websiteUrl, twitterHandle, instagramHandle, linkedinProfile, audienceNiche, audienceSize } = req.body;

  try {
    const profile = await prisma.affiliateProfile.update({
      where: { userId: req.user.id },
      data: {
        ...(websiteUrl !== undefined && { website: websiteUrl }),
        ...(twitterHandle !== undefined && { twitterHandle }),
        ...(instagramHandle !== undefined && { instagramHandle }),
        ...(linkedinProfile !== undefined && { linkedinProfile }),
        ...(audienceNiche !== undefined && { audienceNiche }),
        ...(audienceSize !== undefined && { audienceSize }),
        updatedAt: new Date()
      }
    });

    res.json({ profile });
  } catch (err) {
    logger.error('Update affiliate profile failed', { error: err.message, userId: req.user.id });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Profile not found' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// Campaigns
// ============================================================

// GET /api/affiliate/campaigns
router.get('/campaigns', affiliateOrAdmin, async (req, res) => {
  try {
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return res.status(404).json({ error: 'Affiliate profile not found' });

    const campaigns = await prisma.affiliateCampaign.findMany({
      where: { partnerId: profile.id },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ campaigns });
  } catch (err) {
    logger.error('Get campaigns failed', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/affiliate/campaigns
router.post('/campaigns', affiliateOrAdmin, async (req, res) => {
  const { name, tag, source } = req.body;

  if (!tag) {
    return res.status(400).json({ error: 'Campaign tag is required' });
  }

  try {
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return res.status(404).json({ error: 'Affiliate profile not found' });

    const normalizedTag = tag.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

    const campaign = await prisma.affiliateCampaign.create({
      data: {
        partnerId: profile.id,
        name: name || normalizedTag,
        tag: normalizedTag,
        source: source || 'direct'
      }
    });

    res.status(201).json({ campaign });
  } catch (err) {
    logger.error('Create campaign failed', { error: err.message, userId: req.user.id });
    if (err.code === 'P2002') return res.status(409).json({ error: 'Campaign tag already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// Referrals
// ============================================================

// GET /api/affiliate/referrals
router.get('/referrals', affiliateOrAdmin, async (req, res) => {
  const { status, page = '1', limit = '25' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, parseInt(limit, 10) || 25);

  try {
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return res.status(404).json({ error: 'Affiliate profile not found' });

    // Map API status strings to Prisma enum values
    const statusMap = {
      'Active Subscriber': 'ACTIVE_SUBSCRIBER',
      'Waitlist Joined': 'WAITLIST_JOINED',
      'Account Created': 'ACCOUNT_CREATED',
      'Trial Started': 'TRIAL_STARTED',
      'Cancelled': 'CANCELLED',
      'Pending': 'PENDING'
    };

    const where = {
      partnerId: profile.id,
      ...(status ? { status: statusMap[status] || status } : {})
    };

    const [referrals, total] = await Promise.all([
      prisma.affiliateReferral.findMany({
        where,
        include: { earnings: { select: { amount: true, status: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSize,
        take: pageSize
      }),
      prisma.affiliateReferral.count({ where })
    ]);

    res.json({ referrals, pagination: { page: pageNum, limit: pageSize, total, pages: Math.ceil(total / pageSize) } });
  } catch (err) {
    logger.error('Get referrals failed', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// Earnings
// ============================================================

// GET /api/affiliate/earnings
router.get('/earnings', affiliateOrAdmin, async (req, res) => {
  const { status, page = '1', limit = '25' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, parseInt(limit, 10) || 25);

  try {
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return res.status(404).json({ error: 'Affiliate profile not found' });

    const statusMap = { pending: 'PENDING', cleared: 'CLEARED', withdrawn: 'WITHDRAWN' };
    const where = {
      partnerId: profile.id,
      ...(status ? { status: statusMap[status.toLowerCase()] || status } : {})
    };

    const [earnings, total, summary, cleared] = await Promise.all([
      prisma.affiliateEarning.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSize,
        take: pageSize
      }),
      prisma.affiliateEarning.count({ where }),
      prisma.affiliateEarning.aggregate({
        where: { partnerId: profile.id },
        _sum: { amount: true }
      }),
      prisma.affiliateEarning.aggregate({
        where: { partnerId: profile.id, status: 'CLEARED' },
        _sum: { amount: true }
      })
    ]);

    res.json({
      earnings,
      pagination: { page: pageNum, limit: pageSize, total, pages: Math.ceil(total / pageSize) },
      summary: {
        totalEarned: Number(summary._sum.amount || 0),
        totalCleared: Number(cleared._sum.amount || 0),
        balance: Number(cleared._sum.amount || 0)
      }
    });
  } catch (err) {
    logger.error('Get earnings failed', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// Withdrawals
// ============================================================

// GET /api/affiliate/withdrawals
router.get('/withdrawals', affiliateOrAdmin, async (req, res) => {
  try {
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return res.status(404).json({ error: 'Affiliate profile not found' });

    const withdrawals = await prisma.affiliateWithdrawal.findMany({
      where: { partnerId: profile.id },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ withdrawals });
  } catch (err) {
    logger.error('Get withdrawals failed', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/affiliate/withdrawals
router.post('/withdrawals', affiliateOrAdmin, async (req, res) => {
  const { amountUsd, payoutMethod, payoutEmail, legalName, country, currency, bankName, accountNumber, iban, swiftBic } = req.body;

  if (!amountUsd || !payoutMethod || !legalName || !country || !currency) {
    return res.status(400).json({ error: 'Amount, payout method, legal name, country, and currency are required' });
  }
  if (Number(amountUsd) < 50) {
    return res.status(400).json({ error: 'Minimum withdrawal is $50' });
  }

  try {
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return res.status(404).json({ error: 'Affiliate profile not found' });

    // Verify available balance
    const [cleared, pendingWithdrawals] = await Promise.all([
      prisma.affiliateEarning.aggregate({
        where: { partnerId: profile.id, status: 'CLEARED' },
        _sum: { amount: true }
      }),
      prisma.affiliateWithdrawal.aggregate({
        where: { partnerId: profile.id, status: { notIn: ['Rejected', 'Cancelled'] } },
        _sum: { amountUsd: true }
      })
    ]);

    const balance = Number(cleared._sum.amount || 0) - Number(pendingWithdrawals._sum.amountUsd || 0);
    if (Number(amountUsd) > balance) {
      return res.status(422).json({ error: 'Insufficient balance', balance });
    }

    const withdrawal = await prisma.affiliateWithdrawal.create({
      data: {
        partnerId: profile.id,
        amountUsd: Number(amountUsd),
        payoutMethod,
        payoutEmail: payoutEmail || null,
        legalName,
        country,
        currency,
        bankName: bankName || null,
        accountNumber: accountNumber || null,
        iban: iban || null,
        swiftBic: swiftBic || null,
        status: 'Pending Review'
      }
    });

    logger.info('Withdrawal request created', { withdrawalId: withdrawal.id, userId: req.user.id, amount: amountUsd });
    res.status(201).json({ withdrawal });
  } catch (err) {
    logger.error('Create withdrawal failed', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// Notifications
// ============================================================

// GET /api/affiliate/notifications
router.get('/notifications', affiliateOrAdmin, async (req, res) => {
  const { unreadOnly = 'false' } = req.query;

  try {
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return res.status(404).json({ error: 'Affiliate profile not found' });

    const where = {
      partnerId: profile.id,
      ...(unreadOnly === 'true' ? { isRead: false } : {})
    };

    const [notifications, unreadCount] = await Promise.all([
      prisma.affiliateNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50
      }),
      prisma.affiliateNotification.count({
        where: { partnerId: profile.id, isRead: false }
      })
    ]);

    res.json({ notifications, unreadCount });
  } catch (err) {
    logger.error('Get notifications failed', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/affiliate/notifications/:id/read
router.patch('/notifications/:id/read', affiliateOrAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return res.status(404).json({ error: 'Affiliate profile not found' });

    const updated = await prisma.affiliateNotification.updateMany({
      where: { id, partnerId: profile.id },
      data: { isRead: true, readAt: new Date() }
    });

    if (updated.count === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    logger.error('Mark notification read failed', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/affiliate/notifications/mark-all-read
router.post('/notifications/mark-all-read', affiliateOrAdmin, async (req, res) => {
  try {
    const profile = await prisma.affiliateProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) return res.status(404).json({ error: 'Affiliate profile not found' });

    await prisma.affiliateNotification.updateMany({
      where: { partnerId: profile.id, isRead: false },
      data: { isRead: true, readAt: new Date() }
    });

    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    logger.error('Mark all notifications read failed', { error: err.message, userId: req.user.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// Leaderboard (approved affiliates only)
// ============================================================

// GET /api/affiliate/leaderboard
router.get('/leaderboard', affiliateOrAdmin, async (req, res) => {
  try {
    const leaderboard = await prisma.affiliateProfile.findMany({
      where: { status: 'APPROVED' },
      select: {
        id: true,
        username: true,
        tier: true,
        totalEarned: true,
        referrals: {
          select: { id: true },
          where: { status: 'ACTIVE_SUBSCRIBER' }
        }
      },
      orderBy: { totalEarned: 'desc' },
      take: 25
    });

    const ranked = leaderboard.map((p, idx) => ({
      rank: idx + 1,
      username: p.username,
      tier: p.tier,
      revenueGenerated: Number(p.totalEarned || 0),
      referralsCount: p.referrals.length,
      points: Math.round(Number(p.totalEarned || 0) * 10)
    }));

    res.json({ leaderboard: ranked });
  } catch (err) {
    logger.error('Get leaderboard failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// Admin endpoints
// ============================================================

// GET /api/affiliate/admin/list
router.get('/admin/list', adminOnly, async (req, res) => {
  const { status, page = '1', limit = '50' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, parseInt(limit, 10) || 50);

  try {
    const statusMap = { pending: 'PENDING', approved: 'APPROVED', rejected: 'REJECTED' };
    const where = status ? { status: statusMap[status.toLowerCase()] || status } : {};

    const [profiles, total] = await Promise.all([
      prisma.affiliateProfile.findMany({
        where,
        include: { user: { select: { email: true, fullName: true, createdAt: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSize,
        take: pageSize
      }),
      prisma.affiliateProfile.count({ where })
    ]);

    res.json({ affiliates: profiles, pagination: { page: pageNum, limit: pageSize, total } });
  } catch (err) {
    logger.error('Admin list affiliates failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/affiliate/admin/:id/status
router.patch('/admin/:id/status', adminOnly, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const validStatuses = ['PENDING', 'APPROVED', 'REJECTED'];

  if (!status || !validStatuses.includes(status.toUpperCase())) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    const profile = await prisma.affiliateProfile.update({
      where: { id },
      data: {
        status: status.toUpperCase(),
        ...(status.toUpperCase() === 'APPROVED' ? { approvedAt: new Date() } : {}),
        updatedAt: new Date()
      },
      include: { user: { select: { email: true, fullName: true } } }
    });

    logger.info('Affiliate status updated', { profileId: id, status, adminId: req.user.id });

    // If approved, ensure a ReferralLink exists for this affiliate
    if (status.toUpperCase() === 'APPROVED') {
      try {
        const existingLink = await prisma.referralLink.findFirst({ where: { affiliateId: profile.id } });
        if (!existingLink) {
          // Generate an id-safe suffix
          const generateSuffix = () => Math.random().toString(36).slice(2, 7);
          let suffix = generateSuffix();
          let referralCode = `${profile.username}-${suffix}`;
          // Ensure uniqueness
          let attempt = 0;
          while (attempt < 6) {
            const conflict = await prisma.referralLink.findUnique({ where: { referralCode } });
            if (!conflict) break;
            suffix = generateSuffix();
            referralCode = `${profile.username}-${suffix}`;
            attempt += 1;
          }

          await prisma.referralLink.create({
            data: {
              affiliateId: profile.id,
              username: profile.username,
              uniqueId: suffix,
              referralCode
            }
          });

          logger.info('Referral link generated for approved affiliate', { profileId: id, referralCode });
        }
      } catch (linkErr) {
        logger.error('Failed to create referral link on approval', { error: linkErr.message, profileId: id });
      }
    }

    res.json({ profile });
  } catch (err) {
    logger.error('Admin update affiliate status failed', { error: err.message, profileId: id });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Affiliate not found' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/affiliate/admin/withdrawals/:id
router.patch('/admin/withdrawals/:id', adminOnly, async (req, res) => {
  const { id } = req.params;
  const { status, adminNotes } = req.body;
  const validStatuses = ['Pending Review', 'Under Verification', 'Approved', 'Processing', 'Paid', 'Rejected', 'Cancelled'];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    const withdrawal = await prisma.affiliateWithdrawal.update({
      where: { id },
      data: {
        status,
        ...(adminNotes !== undefined && { adminNotes }),
        ...(status === 'Paid' ? { processedAt: new Date() } : {}),
        updatedAt: new Date()
      }
    });

    logger.info('Withdrawal status updated', { withdrawalId: id, status, adminId: req.user.id });
    res.json({ withdrawal });
  } catch (err) {
    logger.error('Admin update withdrawal failed', { error: err.message, withdrawalId: id });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Withdrawal not found' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
