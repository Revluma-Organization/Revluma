/**
 * Referral Attribution Middleware
 * Extracts and validates affiliate attribution from cookies/query params
 *
 * Used during signup/registration to link new users to referral sources.
 * Provides defense-in-depth with multiple attribution sources.
 */

const logger = require('../utils/logger');

/**
 * Extract referral code from request
 * Priority: query param > session cookie > persistent cookie > token
 */
function extractReferralCode(req) {
  // 1. Check URL query parameter (highest priority)
  if (req.query.ref && typeof req.query.ref === 'string') {
    return req.query.ref;
  }

  // 2. Check session cookie (expires after 30 minutes)
  if (req.cookies?.__revluma_ref_session) {
    try {
      const session = JSON.parse(req.cookies.__revluma_ref_session);
      if (session.code && typeof session.code === 'string') {
        return session.code;
      }
    } catch (err) {
      logger.debug('Failed to parse session cookie', { error: err.message });
    }
  }

  // 3. Check persistent cookie (expires after 60 days)
  if (req.cookies?.__revluma_ref && typeof req.cookies.__revluma_ref === 'string') {
    return req.cookies.__revluma_ref;
  }

  // 4. Check token (requires Redis validation in real implementation)
  if (req.cookies?.__revluma_ref_token && typeof req.cookies.__revluma_ref_token === 'string') {
    // Token itself isn't the code, but we could validate it against cached data
    // For now, this is a placeholder for future Redis validation
    return null;
  }

  return null;
}

/**
 * Validate referral code format
 */
function isValidReferralCodeFormat(code) {
  if (!code || typeof code !== 'string') {
    return false;
  }
  // Format: username-uniqueid (e.g., splendor-48us)
  return /^[a-z0-9]+-[a-z0-9]+$/.test(code);
}

/**
 * Middleware: Extract and attach referral code to request
 * Attaches: req.affiliateCode, req.affiliateCodeSource
 */
async function referralAttributionMiddleware(req, res, next) {
  try {
    const code = extractReferralCode(req);

    if (!code) {
      req.affiliateCode = null;
      req.affiliateCodeSource = null;
      return next();
    }

    // Validate format
    if (!isValidReferralCodeFormat(code)) {
      logger.warn('Invalid referral code format detected', {
        code,
        userId: req.user?.id,
        ip: req.ip
      });
      req.affiliateCode = null;
      req.affiliateCodeSource = null;
      return next();
    }

    req.affiliateCode = code;

    // Determine source for logging
    if (req.query.ref === code) {
      req.affiliateCodeSource = 'url_param';
    } else if (req.cookies?.__revluma_ref_session && req.cookies.__revluma_ref_session.includes(code)) {
      req.affiliateCodeSource = 'session_cookie';
    } else if (req.cookies?.__revluma_ref === code) {
      req.affiliateCodeSource = 'persistent_cookie';
    } else {
      req.affiliateCodeSource = 'unknown';
    }

    logger.debug('Referral code extracted', {
      code,
      source: req.affiliateCodeSource,
      endpoint: req.path
    });

    next();
  } catch (err) {
    logger.error('Referral attribution extraction failed', {
      error: err.message,
      endpoint: req.path
    });
    // Continue regardless of error
    req.affiliateCode = null;
    req.affiliateCodeSource = null;
    next();
  }
}

/**
 * Create referral attribution record in database
 * Called during signup to link new user to affiliate
 */
async function createReferralAttribution(prisma, {
  affiliateCode,
  affiliateUsername,
  userId,
  userEmail,
  ipAddress,
  userAgent
}) {
  try {
    // Look up referral link
    const referralLink = await prisma.referralLink.findUnique({
      where: { referralCode: affiliateCode },
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
      logger.warn('Referral code not found during attribution', {
        code: affiliateCode,
        userId
      });
      return { success: false, error: 'Invalid referral code' };
    }

    // Verify affiliate is approved
    if (referralLink.affiliate.status !== 'APPROVED') {
      logger.warn('Affiliate not approved during attribution', {
        code: affiliateCode,
        affiliateId: referralLink.affiliate.id,
        affiliateStatus: referralLink.affiliate.status
      });
      return { success: false, error: 'Affiliate not active' };
    }

    // Prevent self-referrals
    if (affiliateUsername && affiliateUsername.toLowerCase() === userEmail.split('@')[0].toLowerCase()) {
      logger.warn('Self-referral attempt detected', {
        code: affiliateCode,
        userId,
        userEmail
      });
      return { success: false, error: 'Self-referrals not allowed' };
    }

    // Create referral attribution record
    const referralRecord = await prisma.affiliateReferral.create({
      data: {
        partnerId: referralLink.affiliate.id,
        customerEmail: userEmail.toLowerCase(),
        status: 'ACCOUNT_CREATED',
        campaignTag: 'organic_referral',
        referralCode: affiliateCode,
        ipAddress,
        userAgent,
        createdAt: new Date(),
        convertedAt: new Date()
      }
    });

    logger.info('REFERRAL_ATTRIBUTION_CREATED', {
      referralId: referralRecord.id,
      userId,
      userEmail,
      affiliateId: referralLink.affiliate.id,
      affiliateUsername: referralLink.affiliate.username,
      code: affiliateCode
    });

    return {
      success: true,
      referralId: referralRecord.id,
      affiliateId: referralLink.affiliate.id,
      affiliateUsername: referralLink.affiliate.username
    };
  } catch (err) {
    logger.error('Failed to create referral attribution', {
      error: err.message,
      code: affiliateCode,
      userId,
      userEmail
    });
    return {
      success: false,
      error: 'Attribution failed (non-blocking)'
    };
  }
}

module.exports = {
  referralAttributionMiddleware,
  extractReferralCode,
  isValidReferralCodeFormat,
  createReferralAttribution
};
