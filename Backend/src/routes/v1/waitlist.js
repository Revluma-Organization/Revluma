/**
 * Waitlist Routes
 * Handles public waitlist form submissions with referral attribution
 * Fully functional with database persistence
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../../services/prisma');
const logger = require('../../utils/logger');
const { validateEmail, normalizeEmail } = require('../../lib/auth-utils');

// E-commerce platforms list (15 platforms as required)
const ECOMMERCE_PLATFORMS = [
  'Shopify',
  'WooCommerce',
  'Amazon',
  'Etsy',
  'BigCommerce',
  'Magento',
  'Wix',
  'Squarespace',
  'eBay',
  'TikTok Shop',
  'Facebook Shops',
  'Stripe Store',
  'Payhip',
  'Gumroad',
  'Custom Store'
];

/**
 * POST /api/waitlist
 * Submit to waitlist with optional referral code
 */
router.post('/', async (req, res) => {
  const {
    fullName,
    email,
    phoneNumber,
    monthlyRevenueRange,
    primaryPlatform,
    referralCode,
    biggestRevenueLeak,
    xHandle,
    tiktokHandle,
    instagramHandle
  } = req.body;

  // Validation
  const missingFields = [];
  if (!fullName) missingFields.push('fullName');
  if (!email) missingFields.push('email');
  if (!primaryPlatform) missingFields.push('primaryPlatform');

  if (missingFields.length > 0) {
    return res.status(400).json({
      error: 'Missing required fields',
      fields: missingFields
    });
  }

  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  if (!ECOMMERCE_PLATFORMS.includes(primaryPlatform)) {
    return res.status(400).json({
      error: 'Invalid platform',
      supportedPlatforms: ECOMMERCE_PLATFORMS
    });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    // Check for existing waitlist submission
    const existing = await prisma.waitlistSubmission.findUnique({
      where: { email: normalizedEmail }
    });

    if (existing) {
      return res.status(409).json({ error: 'Email already on waitlist' });
    }

    // Validate and resolve referral code if provided
    let affiliateId = null;
    if (referralCode) {
      const referralLink = await prisma.referralLink.findUnique({
        where: { referralCode },
        include: { affiliate: { select: { id: true, status: true } } }
      });

      if (!referralLink || referralLink.affiliate.status !== 'APPROVED') {
        return res.status(404).json({ error: 'Referral code does not exist' });
      }

      affiliateId = referralLink.affiliate.id;
    }

    // Create waitlist submission
    const submission = await prisma.waitlistSubmission.create({
      data: {
        fullName,
        email: normalizedEmail,
        phoneNumber: phoneNumber || null,
        monthlyRevenueRange,
        primaryPlatform,
        referralCode: referralCode || null,
        affiliateId,
        biggestRevenueLeak,
        xHandle,
        tiktokHandle,
        instagramHandle,
        status: 'PENDING'
      }
    });

    // Create linked AffiliateReferral if affiliated
    if (affiliateId) {
      await prisma.affiliateReferral.create({
        data: {
          partnerId: affiliateId,
          customerEmail: normalizedEmail,
          status: 'WAITLIST_JOINED',
          ipAddress: req.ip
        }
      });

      logger.info('Waitlist submission with referral', {
        submissionId: submission.id,
        affiliateId,
        email: normalizedEmail
      });
    } else {
      logger.info('Waitlist submission without referral', {
        submissionId: submission.id,
        email: normalizedEmail
      });
    }

    res.status(201).json({
      message: 'Successfully joined waitlist',
      submissionId: submission.id,
      email: normalizedEmail
    });
  } catch (err) {
    logger.error('Waitlist submission failed', { error: err.message, email: normalizedEmail });
    
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Email already on waitlist' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/waitlist/platforms
 * Get list of supported e-commerce platforms
 */
router.get('/platforms', (req, res) => {
  res.json({ platforms: ECOMMERCE_PLATFORMS });
});

/**
 * GET /api/waitlist/stats
 * Public stats (no auth required)
 */
router.get('/stats', async (req, res) => {
  try {
    const totalSubmissions = await prisma.waitlistSubmission.count();
    const pendingCount = await prisma.waitlistSubmission.count({
      where: { status: 'PENDING' }
    });

    res.json({
      totalSubmissions,
      pendingCount,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error('Waitlist stats error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
