/**
 * Affiliate Tracking Routes
 * Handles public referral link tracking and click attribution
 * Route: /api/affiliate/:code
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../../services/prisma');
const logger = require('../../utils/logger');

/**
 * GET /api/affiliate/:code
 * Public route - tracks referral click and redirects to waitlist
 * Format: /affiliate/username-uniqueid
 */
router.get('/:code', async (req, res) => {
  const { code } = req.params;
  
  try {
    // Find referral link by code
    const referralLink = await prisma.referralLink.findUnique({
      where: { referralCode: code },
      include: { affiliate: { select: { id: true, status: true } } }
    });

    if (!referralLink || !referralLink.affiliate || referralLink.affiliate.status !== 'APPROVED') {
      logger.warn('Invalid or inactive affiliate link accessed', { code });
      return res.status(404).json({ error: 'Affiliate link not found or affiliate is not active' });
    }

    // Record the click
    await prisma.referralClick.create({
      data: {
        referralLinkId: referralLink.id,
        affiliateId: referralLink.affiliate.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        referrer: req.headers['referer'],
        utmSource: req.query.utm_source,
        utmMedium: req.query.utm_medium,
        utmCampaign: req.query.utm_campaign
      }
    });

    // Increment click counter
    await prisma.referralLink.update({
      where: { id: referralLink.id },
      data: { clicksCount: { increment: 1 } }
    });

    logger.info('Affiliate link clicked', { code, affiliateId: referralLink.affiliate.id });

    // Store referral attribution in session/cookie for later signup
    res.cookie('referral_code', code, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    // Redirect to waitlist with referral code
    return res.redirect(`/waitlist?ref=${code}`);
  } catch (err) {
    logger.error('Affiliate tracking error', { error: err.message, code });
    return res.status(500).json({ error: 'Tracking failed' });
  }
});

/**
 * POST /api/affiliate/validate-code
 * Validates a referral code without redirecting
 * Used by frontend for form pre-fill
 */
router.post('/validate-code', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Referral code is required' });
  }

  try {
    const referralLink = await prisma.referralLink.findUnique({
      where: { referralCode: code },
      include: { affiliate: { select: { id: true, username: true, status: true } } }
    });

    if (!referralLink || referralLink.affiliate.status !== 'APPROVED') {
      return res.status(404).json({ error: 'Referral code does not exist or affiliate is not active' });
    }

    res.json({
      valid: true,
      affiliateUsername: referralLink.affiliate.username,
      affiliateId: referralLink.affiliate.id
    });
  } catch (err) {
    logger.error('Referral code validation error', { error: err.message });
    res.status(500).json({ error: 'Validation failed' });
  }
});

module.exports = router;
