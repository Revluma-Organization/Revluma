const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { prisma } = require('../services/prisma');
const logger = require('../utils/logger');
const affiliateAuthService = require('../services/affiliateAuthService');
const { validatePasswordStrength, validateEmail, normalizeEmail } = require('../lib/auth-utils');
const { normalizeAffiliateStatusForClient } = require('../lib/affiliate-auth-security');

const router = express.Router();

const VERIFICATION_CODE_EXPIRY_MINUTES = 15;

function getCorrelationId(req) {
  return req.headers['x-correlation-id'] || crypto.randomBytes(4).toString('hex');
}

function sendError(res, statusCode, error, code = null, correlationId = null) {
  const body = { error };
  if (code) body.code = code;
  if (correlationId) body.correlationId = correlationId;
  return res.status(statusCode).json(body);
}

function sanitizeString(s, maxLen = 255) {
  if (typeof s !== 'string') return '';
  return s.trim().replace(/[<>]/g, '').slice(0, maxLen);
}

function getAuditContext(req) {
  return {
    ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null
  };
}

// Separate rate limiters per route — avoids throttling username checks
// while keeping strict limits on actual registration.
const checkUsernameLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many username checks - please slow down' },
  standardHeaders: true,
  legacyHeaders: false
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many registration attempts - please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * GET /api/affiliate-auth/health
 * Lightweight liveness probe — used by the frontend warm-up ping
 * so Render wakes up before the user submits their first form.
 */
router.get('/health', (_req, res) => {
  return res.status(200).json({ ok: true, ts: Date.now() });
});

async function resolveUsernameAvailability(username) {
  const normalized = sanitizeString(username, 50).toLowerCase();
  if (!normalized || normalized.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  const existing = await prisma.affiliateProfile.findUnique({ where: { username: normalized } });
  return { available: !existing, username: normalized };
}

router.get('/check-username/:username', checkUsernameLimiter, async (req, res) => {
  try {
    const username = sanitizeString(req.params.username || req.query.username, 50);
    const result = await resolveUsernameAvailability(username);
    if (result.valid === false) {
      return sendError(res, 400, result.error, 'VALIDATION_ERROR');
    }
    return res.json({ available: result.available, username: result.username });
  } catch (err) {
    logger.error('check-username failed', { error: err.message });
    return sendError(res, 500, 'Internal server error', 'SERVER_ERROR');
  }
});

router.get('/check-username', checkUsernameLimiter, async (req, res) => {
  try {
    const username = sanitizeString(req.params.username || req.query.username, 50);
    const result = await resolveUsernameAvailability(username);
    if (result.valid === false) {
      return sendError(res, 400, result.error, 'VALIDATION_ERROR');
    }
    return res.json({ available: result.available, username: result.username });
  } catch (err) {
    logger.error('check-username failed', { error: err.message });
    return sendError(res, 500, 'Internal server error', 'SERVER_ERROR');
  }
});

/**
 * POST /api/affiliate-auth/register
 */
router.post('/register', registerLimiter, async (req, res) => {
  const correlationId = getCorrelationId(req);

  try {
    const body = req.body || {};
    const required = [
      'email', 'password', 'firstName', 'lastName', 'username', 'phoneNumber',
      'country', 'audienceNiche', 'audienceSize', 'affiliateExperience', 'whyJoin'
    ];

    for (const k of required) {
      if (body[k] === undefined || body[k] === null || (typeof body[k] === 'string' && body[k].trim().length === 0)) {
        return sendError(res, 400, `Missing field: ${k}`, 'VALIDATION_ERROR', correlationId);
      }
    }

    if (!validateEmail(body.email)) {
      return sendError(res, 400, 'Please provide a valid email address.', 'INVALID_EMAIL', correlationId);
    }

    const pw = validatePasswordStrength(body.password);
    if (!pw.valid) {
      return sendError(res, 400, pw.error, 'INVALID_PASSWORD', correlationId);
    }

    const registerData = {
      email: normalizeEmail(body.email),
      password: body.password,
      firstName: sanitizeString(body.firstName, 100),
      lastName: sanitizeString(body.lastName, 100),
      username: sanitizeString(body.username, 50),
      phoneNumber: sanitizeString(body.phoneNumber, 30),
      country: sanitizeString(body.country, 2),
      twitterHandle: sanitizeString(body.twitterHandle, 100) || null,
      instagramHandle: sanitizeString(body.instagramHandle, 100) || null,
      linkedinProfile: sanitizeString(body.linkedinProfile, 200) || null,
      youtubeChannel: sanitizeString(body.youtubeChannel, 200) || null,
      tiktokHandle: sanitizeString(body.tiktokHandle, 100) || null,
      facebookProfile: sanitizeString(body.facebookProfile, 200) || null,
      website: sanitizeString(body.website, 200) || null,
      newsletterUrl: sanitizeString(body.newsletterUrl, 200) || null,
      communityUrl: sanitizeString(body.communityUrl, 200) || null,
      otherPlatform1: sanitizeString(body.otherPlatform1, 200) || null,
      otherPlatform2: sanitizeString(body.otherPlatform2, 200) || null,
      audienceNiche: sanitizeString(body.audienceNiche, 120),
      audienceSize: sanitizeString(body.audienceSize, 40),
      affiliateExperience: sanitizeString(body.affiliateExperience, 60),
      whyJoin: sanitizeString(body.whyJoin, 2000),
      referralSource: sanitizeString(body.referralSource, 250) || null
    };

    const result = await affiliateAuthService.registerAffiliate(registerData);
    return res.status(201).json({
      message: 'Verification code sent. Please check your email.',
      pendingRegistrationId: result.pendingRegistrationId,
      email: result.email,
      expiresAt: result.expiresAt,
      authState: result.authState
    });
  } catch (err) {
    if (String(err.message).includes('EMAIL_ALREADY_EXISTS')) {
      return sendError(res, 409, 'An account with this email already exists.', 'EMAIL_ALREADY_EXISTS', correlationId);
    }
    if (String(err.message).includes('USERNAME_ALREADY_EXISTS')) {
      return sendError(res, 409, 'That username is already taken.', 'USERNAME_ALREADY_EXISTS', correlationId);
    }
    if (String(err.message).includes('MINIMUM_TWO_DISTRIBUTION_CHANNELS_REQUIRED')) {
      return sendError(res, 400, 'Please provide at least two distribution channels (e.g., Twitter/X, Instagram, YouTube, TikTok, LinkedIn, etc.).', 'MINIMUM_TWO_DISTRIBUTION_CHANNELS_REQUIRED', correlationId);
    }
    if (String(err.message).includes('EMAIL_SEND_FAILED')) {
      return sendError(res, 503, 'Unable to send verification email. Please try again later.', 'EMAIL_SEND_FAILED', correlationId);
    }

    logger.error('affiliate-auth/register failed', { error: err.message, correlationId });
    return sendError(res, 500, 'Internal server error', 'SERVER_ERROR', correlationId);
  }
});

/**
 * POST /api/affiliate-auth/resend-verification
 */
router.post('/resend-verification', async (req, res) => {
  const correlationId = getCorrelationId(req);

  try {
    const { pendingRegistrationId, email } = req.body || {};
    if (!pendingRegistrationId) {
      return sendError(res, 400, 'pendingRegistrationId is required', 'VALIDATION_ERROR', correlationId);
    }

    const result = await affiliateAuthService.resendVerificationEmail(
      pendingRegistrationId,
      email ? normalizeEmail(email) : null
    );

    return res.json({
      message: result.message,
      expiresAt: result.expiresAt
    });
  } catch (err) {
    const map = {
      PENDING_REGISTRATION_NOT_FOUND: { status: 404, code: 'PENDING_REGISTRATION_NOT_FOUND', error: 'Pending registration not found' },
      EMAIL_ALREADY_VERIFIED: { status: 400, code: 'EMAIL_ALREADY_VERIFIED', error: 'Email is already verified' },
      RESEND_LIMIT_EXCEEDED: { status: 429, code: 'RESEND_LIMIT_EXCEEDED', error: 'Too many resend attempts' },
      EMAIL_MISMATCH: { status: 400, code: 'EMAIL_MISMATCH', error: 'Email does not match registration' }
    };

    if (map[err.message]) {
      const m = map[err.message];
      return sendError(res, m.status, m.error, m.code, correlationId);
    }

    logger.error('affiliate-auth/resend-verification failed', { error: err.message, correlationId });
    return sendError(res, 500, 'Internal server error', 'SERVER_ERROR', correlationId);
  }
});

/**
 * POST /api/affiliate-auth/verify-email
 */
router.post('/verify-email', async (req, res) => {
  const correlationId = getCorrelationId(req);

  try {
    const { pendingRegistrationId, code } = req.body || {};
    if (!pendingRegistrationId || !code) {
      return sendError(res, 400, 'pendingRegistrationId and code are required', 'VALIDATION_ERROR', correlationId);
    }

    const result = await affiliateAuthService.verifyAffiliateEmail(
      pendingRegistrationId,
      sanitizeString(code, 6)
    );

    return res.json({
      message: result.message,
      verified: true,
      authState: result.authState
    });
  } catch (err) {
    const map = {
      VERIFICATION_CODE_EXPIRED: { status: 400, code: 'VERIFICATION_CODE_EXPIRED', error: 'Verification code expired. Please request a new one.' },
      INVALID_VERIFICATION_CODE: { status: 400, code: 'INVALID_VERIFICATION_CODE', error: 'Invalid verification code. Please check and try again.' },
      PENDING_REGISTRATION_NOT_FOUND: { status: 404, code: 'PENDING_REGISTRATION_NOT_FOUND', error: 'Pending registration not found' }
    };

    if (map[err.message]) {
      const m = map[err.message];
      return sendError(res, m.status, m.error, m.code, correlationId);
    }

    logger.error('affiliate-auth/verify-email failed', { error: err.message, correlationId });
    return sendError(res, 500, 'Internal server error', 'SERVER_ERROR', correlationId);
  }
});

/**
 * POST /api/affiliate-auth/validate-access-token
 */
router.post('/validate-access-token', async (req, res) => {
  const correlationId = getCorrelationId(req);

  try {
    const { pendingRegistrationId, token } = req.body || {};

    if (!pendingRegistrationId) {
      return sendError(res, 400, 'pendingRegistrationId is required', 'VALIDATION_ERROR', correlationId);
    }
    if (!token || typeof token !== 'string') {
      return sendError(res, 400, 'Access token is required', 'MISSING_ACCESS_TOKEN', correlationId);
    }

    const result = await affiliateAuthService.validateAccessToken(
      pendingRegistrationId,
      sanitizeString(token, 200),
      getAuditContext(req)
    );

    return res.json({
      message: result.message,
      valid: true,
      authState: result.authState
    });
  } catch (err) {
    const map = {
      EMAIL_NOT_VERIFIED: { status: 403, code: 'EMAIL_NOT_VERIFIED', error: 'Email not verified' },
      INVALID_ACCESS_TOKEN: { status: 403, code: 'INVALID_ACCESS_TOKEN', error: 'Invalid access token' },
      RAPP_ACCESS_TOKEN_NOT_CONFIGURED: { status: 503, code: 'SERVER_MISCONFIGURED', error: 'Access token validation unavailable' },
      PENDING_REGISTRATION_NOT_FOUND: { status: 404, code: 'PENDING_REGISTRATION_NOT_FOUND', error: 'Pending registration not found' }
    };

    if (map[err.message]) {
      const m = map[err.message];
      return sendError(res, m.status, m.error, m.code, correlationId);
    }

    logger.error('affiliate-auth/validate-access-token failed', { error: err.message, correlationId });
    return sendError(res, 500, 'Internal server error', 'SERVER_ERROR', correlationId);
  }
});

/**
 * POST /api/affiliate-auth/complete-registration
 */
router.post('/complete-registration', async (req, res) => {
  const correlationId = getCorrelationId(req);

  try {
    const { pendingRegistrationId } = req.body || {};
    if (!pendingRegistrationId) {
      return sendError(res, 400, 'pendingRegistrationId is required', 'VALIDATION_ERROR', correlationId);
    }

    const result = await affiliateAuthService.completeAffiliateRegistration(pendingRegistrationId);

    return res.status(201).json({
      message: 'Account created successfully. Your application is submitted for review.',
      userId: result.user.id,
      affiliateProfileId: result.affiliateProfile.id,
      status: normalizeAffiliateStatusForClient(result.affiliateProfile.status),
      authState: result.affiliateProfile.status
    });
  } catch (err) {
    const map = {
      EMAIL_NOT_VERIFIED: { status: 403, code: 'EMAIL_NOT_VERIFIED', error: 'Email must be verified before completing registration' },
      ACCESS_TOKEN_NOT_VALIDATED: { status: 403, code: 'ACCESS_TOKEN_NOT_VALIDATED', error: 'A valid RAPP access token must be validated before completing registration' },
      REGISTRATION_EXPIRED: { status: 410, code: 'REGISTRATION_EXPIRED', error: 'Registration session has expired. Please start over.' },
      EMAIL_ALREADY_EXISTS: { status: 409, code: 'EMAIL_ALREADY_EXISTS', error: 'An account with this email already exists.' },
      PENDING_REGISTRATION_NOT_FOUND: { status: 404, code: 'PENDING_REGISTRATION_NOT_FOUND', error: 'Pending registration not found' }
    };

    if (map[err.message]) {
      const m = map[err.message];
      return sendError(res, m.status, m.error, m.code, correlationId);
    }

    logger.error('affiliate-auth/complete-registration failed', { error: err.message, correlationId });
    return sendError(res, 500, 'Internal server error', 'SERVER_ERROR', correlationId);
  }
});

/**
 * GET /api/affiliate-auth/application-status
 */
router.get('/application-status', async (req, res) => {
  const correlationId = getCorrelationId(req);

  try {
    const { pendingRegistrationId, userId } = req.query;
    const status = await affiliateAuthService.getApplicationStatus({
      pendingRegistrationId: pendingRegistrationId ? String(pendingRegistrationId) : null,
      userId: userId ? String(userId) : null
    });

    return res.json({
      ...status,
      authState: status.authState
        ? normalizeAffiliateStatusForClient(status.authState)
        : null
    });
  } catch (err) {
    const map = {
      PENDING_REGISTRATION_NOT_FOUND: { status: 404, code: 'PENDING_REGISTRATION_NOT_FOUND', error: 'Pending registration not found' },
      NO_AFFILIATE_PROFILE: { status: 404, code: 'NO_AFFILIATE_PROFILE', error: 'Affiliate profile not found' },
      IDENTIFIER_REQUIRED: { status: 400, code: 'VALIDATION_ERROR', error: 'pendingRegistrationId or userId is required' }
    };

    if (map[err.message]) {
      const m = map[err.message];
      return sendError(res, m.status, m.error, m.code, correlationId);
    }

    logger.error('affiliate-auth/application-status failed', { error: err.message, correlationId });
    return sendError(res, 500, 'Internal server error', 'SERVER_ERROR', correlationId);
  }
});

module.exports = router;