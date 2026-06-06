// FIX B-04: Brute-force protection on verify-email (verificationAttempts counter in service)
// FIX B-06: Strip rejectedReason/suspendedReason from unauthenticated application-status
// FIX B-11: Replaced sanitizeString's strip-only approach with proper HTML entity escaping
// FIX B-14: Added CSRF token fetch + forwarding on complete-registration
// FIX B (reserved usernames): Error code USERNAME_RESERVED surfaced to client

const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { prisma } = require('../services/prisma');
const logger = require('../utils/logger');
const emailService = require('../services/emailService');
const affiliateAuthService = require('../services/affiliateAuthService');
const { validatePasswordStrength, validateEmail, normalizeEmail } = require('../lib/auth-utils');
const { normalizeAffiliateStatusForClient } = require('../lib/affiliate-auth-security');
const {
  createSession,
  generateCsrfToken,
  invalidateAllUserSessions,
  validateSession,
  csrfProtection
} = require('../middleware/sessionAuth');

const router = express.Router();

function getCorrelationId(req) {
  return req.headers['x-correlation-id'] || crypto.randomBytes(4).toString('hex');
}

function sendError(res, statusCode, error, code = null, correlationId = null) {
  const body = { error };
  if (code) body.code = code;
  if (correlationId) body.correlationId = correlationId;
  return res.status(statusCode).json(body);
}

// FIX B-11: Proper HTML entity escaping (replaces the previous strip-only approach)
// The old implementation used .replace(/[<>]/g, '') which silently strips characters.
// Proper HTML escaping ensures the data renders safely in any HTML context.
function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeString(s, maxLen = 255) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, maxLen);
}

function getAuditContext(req) {
  return {
    ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null
  };
}

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

// FIX B-04: Rate limit on verify-email endpoint (was missing)
const verifyEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many verification attempts - please wait 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false
});

// FIX B-06: Rate limit on application-status to prevent enumeration
const applicationStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many status requests - please slow down' },
  standardHeaders: true,
  legacyHeaders: false
});

async function resolveUsernameAvailability(username) {
  const normalized = sanitizeString(username, 50).toLowerCase();
  if (!normalized || normalized.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  const start = Date.now();
  let existing;
  try {
    existing = await prisma.affiliateProfile.findUnique({ where: { username: normalized } });
  } catch (err) {
    logger.error('Username availability DB check failed', { error: err.message, username: normalized, ms: Date.now() - start });
    throw err;
  }
  const ms = Date.now() - start;
  logger.info('Username availability resolved', { username: normalized, available: !existing, ms });
  return { available: !existing, username: normalized };
}

router.get('/check-username', checkUsernameLimiter, async (req, res) => {
  const start = Date.now();
  try {
    const username = sanitizeString(req.query.username, 50);
    const result = await resolveUsernameAvailability(username);
    if (result.valid === false) {
      return sendError(res, 400, result.error, 'VALIDATION_ERROR');
    }
    return res.json({ available: result.available, username: result.username });
  } catch (err) {
    logger.error('check-username endpoint error', { error: err.message, ms: Date.now() - start });
    return sendError(res, 500, 'Could not check username availability. Please try again.', 'SERVER_ERROR');
  }
});

router.get('/check-username/:username', checkUsernameLimiter, async (req, res) => {
  const start = Date.now();
  try {
    const username = sanitizeString(req.params.username, 50);
    const result = await resolveUsernameAvailability(username);
    if (result.valid === false) {
      return sendError(res, 400, result.error, 'VALIDATION_ERROR');
    }
    return res.json({ available: result.available, username: result.username });
  } catch (err) {
    logger.error('check-username endpoint error', { error: err.message, ms: Date.now() - start });
    return sendError(res, 500, 'Could not check username availability. Please try again.', 'SERVER_ERROR');
  }
});

router.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', checkedAt: new Date().toISOString() });
  } catch (err) {
    logger.error('affiliate-auth/health failed', { error: err.message });
    res.status(503).json({ status: 'degraded', error: 'Database unreachable' });
  }
});

const checkEmailLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many email checks - please slow down' },
  standardHeaders: true,
  legacyHeaders: false
});

router.get('/check-email', checkEmailLimiter, async (req, res) => {
  const start = Date.now();
  try {
    const raw = req.query.email;
    if (!raw || typeof raw !== 'string') {
      return sendError(res, 400, 'Email parameter is required', 'VALIDATION_ERROR');
    }
    const email = raw.toLowerCase().trim();
    if (!validateEmail(email)) {
      return sendError(res, 400, 'Invalid email format', 'VALIDATION_ERROR');
    }
    const [existingUser, existingPending] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true } }),
      prisma.pendingRegistration.findFirst({ where: { email, accountType: 'AFFILIATE' }, select: { id: true } })
    ]);
    const taken = !!(existingUser || existingPending);
    logger.info('check-email completed', { email, taken, ms: Date.now() - start });
    return res.json({ available: !taken, email });
  } catch (err) {
    logger.error('check-email failed', { error: err.message, ms: Date.now() - start });
    return sendError(res, 500, 'Internal server error', 'SERVER_ERROR');
  }
});

router.post('/register', registerLimiter, async (req, res) => {
  const correlationId = getCorrelationId(req);
  res.setHeader('X-Correlation-ID', correlationId);
  const start = Date.now();

  const required = [
    'email', 'password', 'firstName', 'lastName', 'username', 'phoneNumber',
    'country', 'audienceNiche', 'audienceSize', 'affiliateExperience', 'whyJoin'
  ];

  try {
    const body = req.body || {};

    const missing = required.filter(k =>
      body[k] === undefined || body[k] === null || (typeof body[k] === 'string' && body[k].trim().length === 0)
    );
    if (missing.length > 0) {
      logger.warn('register: missing fields', { missing, correlationId, ms: Date.now() - start });
      return sendError(res, 400, `Missing field: ${missing[0]}`, 'VALIDATION_ERROR', correlationId);
    }

    const emailRaw = body.email.trim();
    const pw = body.password;

    if (!validateEmail(emailRaw)) {
      return sendError(res, 400, 'Please provide a valid email address.', 'INVALID_EMAIL', correlationId);
    }

    const passwordValidation = validatePasswordStrength(pw);
    if (!passwordValidation.valid) {
      return sendError(res, 400, passwordValidation.error, 'INVALID_PASSWORD', correlationId);
    }

    const verificationCode = crypto.randomInt(100000, 999999).toString();

    const registerData = {
      email: normalizeEmail(emailRaw),
      password: pw,
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
      referralSource: sanitizeString(body.referralSource, 250) || null,
      verificationCode
    };

    const serviceStart = Date.now();
    const result = await affiliateAuthService.registerAffiliate(registerData);
    logger.info('register: service completed', {
      email: result.email,
      pendingId: result.pendingRegistrationId,
      serviceMs: Date.now() - serviceStart,
      totalMs: Date.now() - start,
      correlationId
    });

    emailService.sendVerificationEmail(result.email, verificationCode, result.firstName)
      .then(() => {
        logger.info('affiliate-auth/register verification email sent', { email: result.email, correlationId, ms: Date.now() - start });
      })
      .catch(err => {
        logger.error('Background verification email failed', {
          error: err.message, email: result.email, correlationId, pendingId: result.pendingRegistrationId
        });
      });

    return res.status(201).json({
      message: 'Verification code sent. Please check your email.',
      pendingRegistrationId: result.pendingRegistrationId,
      email: result.email,
      expiresAt: result.expiresAt,
      authState: result.authState
    });
  } catch (err) {
    const errorMsg = err.message || 'Unknown error';
    logger.error('affiliate-auth/register FAILED', {
      error: errorMsg,
      correlationId,
      ms: Date.now() - start
    });

    if (String(errorMsg).includes('EMAIL_ALREADY_EXISTS')) {
      return sendError(res, 409, 'An account with this email already exists.', 'EMAIL_ALREADY_EXISTS', correlationId);
    }
    if (String(errorMsg).includes('USERNAME_ALREADY_EXISTS')) {
      return sendError(res, 409, 'That username is already taken.', 'USERNAME_ALREADY_EXISTS', correlationId);
    }
    // FIX B (reserved usernames): Surface reserved username error to client
    if (String(errorMsg).includes('USERNAME_RESERVED')) {
      return sendError(res, 400, 'That username is reserved and cannot be used.', 'USERNAME_RESERVED', correlationId);
    }
    if (String(errorMsg).includes('MINIMUM_TWO_DISTRIBUTION_CHANNELS_REQUIRED')) {
      return sendError(res, 400, 'Please provide at least two distribution channels (e.g., Twitter/X, Instagram, YouTube, TikTok, LinkedIn, etc.).', 'MINIMUM_TWO_DISTRIBUTION_CHANNELS_REQUIRED', correlationId);
    }
    if (err.code === 'P1001' || String(errorMsg).includes('ECONNREFUSED') || String(errorMsg).includes('database')) {
      return sendError(res, 503, 'Database is temporarily unavailable. Please try again in a moment.', 'DATABASE_UNAVAILABLE', correlationId);
    }
    if (err.code === 'P2025' || String(errorMsg).includes('Record to update not found')) {
      return sendError(res, 409, 'Record conflict. Please try again.', 'RECORD_NOT_FOUND', correlationId);
    }

    return sendError(res, 500, 'Registration failed. Please try again.', 'SERVER_ERROR', correlationId);
  }
});

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

    emailService.sendVerificationEmail(result.email, result.verificationCode, result.firstName)
      .catch(err => logger.error('Background resend email failed', {
        error: err.message, pendingId: pendingRegistrationId, email: result.email
      }));

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

// FIX B-04: Added verifyEmailLimiter and TOO_MANY_ATTEMPTS error handling
router.post('/verify-email', verifyEmailLimiter, async (req, res) => {
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
      PENDING_REGISTRATION_NOT_FOUND: { status: 404, code: 'PENDING_REGISTRATION_NOT_FOUND', error: 'Pending registration not found' },
      // FIX B-04: Proper error response for brute-force lockout
      TOO_MANY_ATTEMPTS: { status: 429, code: 'TOO_MANY_ATTEMPTS', error: 'Too many failed attempts. Please request a new verification code.' }
    };

    if (map[err.message]) {
      const m = map[err.message];
      return sendError(res, m.status, m.error, m.code, correlationId);
    }

    logger.error('affiliate-auth/verify-email failed', { error: err.message, correlationId });
    return sendError(res, 500, 'Internal server error', 'SERVER_ERROR', correlationId);
  }
});

// FIX B-14: complete-registration now fetches an anon CSRF token internally and
// validates the submitted CSRF token via csrfProtection middleware.
// The frontend must:
//   1. GET /api/session/csrf-token to obtain a token (returns csrfToken for anon users)
//   2. Include it as X-CSRF-Token header in the POST /complete-registration request
router.post('/complete-registration', csrfProtection, async (req, res) => {
  const correlationId = getCorrelationId(req);

  try {
    const { pendingRegistrationId } = req.body || {};
    if (!pendingRegistrationId) {
      return sendError(res, 400, 'pendingRegistrationId is required', 'VALIDATION_ERROR', correlationId);
    }

    const result = await affiliateAuthService.completeAffiliateRegistration(pendingRegistrationId);

    await invalidateAllUserSessions(result.user.id, result.tenant.id);
    await createSession(result.tenant.id, result.user.id, res, req);
    const csrfToken = generateCsrfToken(result.user.id);

    return res.status(201).json({
      message: 'Account created successfully.',
      user: {
        id: result.user.id,
        email: result.user.email,
        full_name: result.user.fullName,
        role: result.user.role
      },
      affiliateProfileId: result.affiliateProfile.id,
      status: normalizeAffiliateStatusForClient(result.affiliateProfile.status),
      csrfToken,
      sessionEstablished: true
    });
  } catch (err) {
    const map = {
      EMAIL_NOT_VERIFIED: { status: 403, code: 'EMAIL_NOT_VERIFIED', error: 'Email must be verified before completing registration' },
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

// FIX B-06: Strip rejectedReason/suspendedReason from unauthenticated application-status responses.
// When querying by pendingRegistrationId (pre-login, unauthenticated), sensitive reasons are not returned.
// When querying by userId, the request must be authenticated; the authenticated user can only see their own profile.
router.get('/application-status', applicationStatusLimiter, async (req, res) => {
  const correlationId = getCorrelationId(req);

  try {
    const { pendingRegistrationId, userId } = req.query;

    // FIX B-06: If querying by userId, require the request to be authenticated
    // and enforce the user can only see their own status
    if (userId && !pendingRegistrationId) {
      const sessionAuth = await validateSession(req, res);
      if (!sessionAuth) {
        return sendError(res, 401, 'Authentication required to query by userId', 'UNAUTHORIZED', correlationId);
      }
      // Ensure users can only query their own status (not another user's)
      if (sessionAuth.user.id !== String(userId)) {
        return sendError(res, 403, 'Forbidden', 'FORBIDDEN', correlationId);
      }
    }

    const status = await affiliateAuthService.getApplicationStatus({
      pendingRegistrationId: pendingRegistrationId ? String(pendingRegistrationId) : null,
      userId: userId ? String(userId) : null
    });

    // FIX B-06: For unauthenticated pendingRegistrationId queries, never expose sensitive fields
    const isSensitiveQuery = !userId && pendingRegistrationId;
    const responsePayload = {
      ...status,
      authState: status.authState
        ? normalizeAffiliateStatusForClient(status.authState)
        : null
    };
    if (isSensitiveQuery) {
      delete responsePayload.rejectedReason;
      delete responsePayload.suspendedReason;
    }

    return res.json(responsePayload);
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