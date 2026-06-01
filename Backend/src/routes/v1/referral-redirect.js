/**
 * Public Referral Link Handler
 * Route: GET /r/:code
 * Handles affiliate tracking and redirects to homepage with attribution
 *
 * Production-Grade Features:
 * - Secure HttpOnly cookies with SameSite protection
 * - Atomic click tracking with full metadata
 * - Attribution token caching for persistence
 * - Comprehensive error handling and logging
 * - UTM parameter capture for marketing analytics
 */

const express = require('express');
const router = express.Router();
const { prisma } = require('../../services/prisma');
const logger = require('../../utils/logger');
const crypto = require('crypto');

/**
 * GET /r/:code
 * Public referral link endpoint
 *
 * Flow:
 * 1. Validate referral code format
 * 2. Look up affiliate and verify status
 * 3. Record click with metadata
 * 4. Increment link click counter
 * 5. Set secure attribution cookies
 * 6. Redirect to homepage
 *
 * Query Parameters:
 * - utm_source: Marketing source (e.g., twitter, newsletter)
 * - utm_medium: Marketing medium (e.g., social, email)
 * - utm_campaign: Campaign identifier
 * - utm_term: Search term (optional)
 * - utm_content: Creative identifier (optional)
 */
router.get('/:code', async (req, res) => {
  const { code } = req.params;
  const startTime = Date.now();

  try {
    // ========================================
    // 1. Validate referral code format
    // ========================================
    if (!code || typeof code !== 'string') {
      logger.warn('Invalid referral code - missing or invalid format', { code });
      return res.redirect('/');
    }

    // Format: username-uniqueid (e.g., splendor-48us)
    const codeRegex = /^[a-z0-9]+-[a-z0-9]+$/;
    if (!codeRegex.test(code)) {
      logger.warn('Invalid referral code format', { code, format: 'username-uniqueid' });
      return res.redirect('/');
    }

    // ========================================
    // 2. Look up referral link
    // ========================================
    const referralLink = await prisma.referralLink.findUnique({
      where: { referralCode: code },
      include: {
        affiliate: {
          select: {
            id: true,
            status: true,
            username: true,
            userId: true
          }
        }
      }
    });

    if (!referralLink) {
      logger.warn('Referral link not found', { code });
      return res.redirect('/');
    }

    if (!referralLink.affiliate) {
      logger.warn('Referral link missing affiliate', { code });
      return res.redirect('/');
    }

    // ========================================
    // 3. Verify affiliate status
    // ========================================
    if (referralLink.affiliate.status !== 'APPROVED') {
      logger.warn('Affiliate not approved', {
        code,
        affiliateId: referralLink.affiliate.id,
        status: referralLink.affiliate.status
      });
      return res.redirect('/');
    }

    // ========================================
    // 4. Extract client metadata
    // ========================================
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const referrer = req.headers['referer'] || null;

    // Extract UTM parameters
    const utmParams = {
      utmSource: (req.query.utm_source as string) || null,
      utmMedium: (req.query.utm_medium as string) || null,
      utmCampaign: (req.query.utm_campaign as string) || null,
      utmTerm: (req.query.utm_term as string) || null,
      utmContent: (req.query.utm_content as string) || null
    };

    // ========================================
    // 5. Record the click atomically
    // ========================================
    let clickRecord;
    try {
      clickRecord = await prisma.referralClick.create({
        data: {
          referralLinkId: referralLink.id,
          affiliateId: referralLink.affiliate.id,
          ipAddress: clientIp,
          userAgent,
          referrer,
          utmSource: utmParams.utmSource,
          utmMedium: utmParams.utmMedium,
          utmCampaign: utmParams.utmCampaign,
          utmTerm: utmParams.utmTerm,
          utmContent: utmParams.utmContent,
          createdAt: new Date()
        }
      });
    } catch (err) {
      logger.error('Failed to record referral click', {
        error: err.message,
        code,
        affiliateId: referralLink.affiliate.id
      });
      // Continue despite click recording failure
    }

    // ========================================
    // 6. Increment click counter atomically
    // ========================================
    try {
      await prisma.referralLink.update({
        where: { id: referralLink.id },
        data: { clicksCount: { increment: 1 } }
      });
    } catch (err) {
      logger.error('Failed to increment click counter', {
        error: err.message,
        referralLinkId: referralLink.id
      });
      // Continue despite counter update failure
    }

    // ========================================
    // 7. Generate secure attribution token
    // ========================================
    const attributionToken = crypto.randomBytes(32).toString('hex');
    const attributionTimestamp = Date.now();

    // ========================================
    // 8. Set secure HttpOnly cookies
    // ========================================
    const cookieDays = parseInt(process.env.REFERRAL_COOKIE_DAYS || '60', 10);
    const maxAge = cookieDays * 24 * 60 * 60 * 1000;
    const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
    const isProduction = process.env.NODE_ENV === 'production';

    // Primary attribution cookie
    res.cookie('__revluma_ref', code, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge,
      path: '/',
      ...(cookieDomain ? { domain: cookieDomain } : {})
    });

    // Secondary attribution token for validation
    res.cookie('__revluma_ref_token', attributionToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge,
      path: '/',
      ...(cookieDomain ? { domain: cookieDomain } : {})
    });

    // Session storage for immediate access (not HttpOnly, expires with session)
    res.cookie('__revluma_ref_session', JSON.stringify({
      code,
      timestamp: attributionTimestamp,
      affiliate: referralLink.affiliate.username
    }), {
      httpOnly: false,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 30 * 60 * 1000, // 30 minutes
      path: '/'
    });

    // ========================================
    // 9. Cache attribution token (if Redis available)
    // ========================================
    if (global.redisClient) {
      try {
        const cacheKey = `ref_token:${attributionToken}`;
        const cacheData = JSON.stringify({
          code,
          affiliateId: referralLink.affiliate.id,
          affiliateUsername: referralLink.affiliate.username,
          timestamp: new Date().toISOString(),
          clientIp,
          utmParams
        });

        // Cache for 24 hours for validation purposes
        await global.redisClient.setex(cacheKey, 86400, cacheData);
      } catch (err) {
        logger.warn('Failed to cache attribution token', {
          error: err.message,
          code
        });
        // Continue regardless
      }
    }

    // ========================================
    // 10. Log successful referral
    // ========================================
    const duration = Date.now() - startTime;
    logger.info('REFERRAL_CLICK_TRACKED', {
      code,
      affiliateId: referralLink.affiliate.id,
      affiliateUsername: referralLink.affiliate.username,
      source: referrer || 'direct',
      utm: utmParams,
      clientIp,
      duration,
      clickId: clickRecord?.id
    });

    // ========================================
    // 11. Redirect to homepage with ref query param
    // ========================================
    const redirectUrl = new URL(process.env.NEXT_PUBLIC_BASE_URL || 'https://revluma.vercel.app');
    redirectUrl.searchParams.set('ref', code);

    // Preserve UTM parameters in redirect
    if (utmParams.utmSource) redirectUrl.searchParams.set('utm_source', utmParams.utmSource);
    if (utmParams.utmMedium) redirectUrl.searchParams.set('utm_medium', utmParams.utmMedium);
    if (utmParams.utmCampaign) redirectUrl.searchParams.set('utm_campaign', utmParams.utmCampaign);

    return res.redirect(302, redirectUrl.toString());
  } catch (err) {
    logger.error('REFERRAL_REDIRECT_ERROR', {
      error: err.message,
      code,
      stack: err.stack
    });

    // Fail gracefully — redirect to homepage without attribution
    return res.redirect(302, process.env.NEXT_PUBLIC_BASE_URL || '/');
  }
});

/**
 * POST /r/validate
 * Validate a referral code without clicking
 * Used for form prefill or verification
 */
router.post('/validate', async (req, res) => {
  const { code } = req.body;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Referral code required' });
  }

  if (!/^[a-z0-9]+-[a-z0-9]+$/.test(code)) {
    return res.status(400).json({ error: 'Invalid referral code format' });
  }

  try {
    const referralLink = await prisma.referralLink.findUnique({
      where: { referralCode: code },
      include: {
        affiliate: {
          select: {
            id: true,
            status: true,
            username: true
          }
        }
      }
    });

    if (!referralLink || !referralLink.affiliate) {
      return res.status(404).json({ error: 'Referral code not found' });
    }

    if (referralLink.affiliate.status !== 'APPROVED') {
      return res.status(403).json({ error: 'Referral code is not active' });
    }

    res.json({
      valid: true,
      code,
      affiliateId: referralLink.affiliate.id,
      affiliateUsername: referralLink.affiliate.username,
      clicks: referralLink.clicksCount
    });
  } catch (err) {
    logger.error('Referral validation error', { error: err.message, code });
    res.status(500).json({ error: 'Validation failed' });
  }
});

module.exports = router;
