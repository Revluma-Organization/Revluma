// ============================================================
// SESSION-BASED AUTHENTICATION ROUTES
// ============================================================
// Production-grade auth with secure HTTP-only cookies

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { prisma } = require('../services/prisma');
const logger = require('../utils/logger');
const { validatePasswordStrength, validateEmail, normalizeEmail, checkPasswordHistory } = require('../lib/auth-utils');

const {
  createSession,
  invalidateSession,
  invalidateAllUserSessions,
  validateSession,
  getSessionId,
  generateCsrfToken,
  csrfProtection,
  setSessionCookie,
  clearSessionCookie,
  hashSessionToken
} = require('../middleware/sessionAuth');

const router = express.Router();

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Too many signup requests - please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many login attempts - please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { error: 'Too many refresh requests - please slow down' },
  standardHeaders: true,
  legacyHeaders: false
});

// FIX A-05: Reduced lockout threshold from 10 to 5 failed attempts
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const ACCOUNT_LOCKOUT_MINUTES = 15;

function sendErrorResponse(res, statusCode, message, code, detail = null) {
  const correlationId = res.getHeader('X-Correlation-ID') || 'unknown';
  const body = { error: message, code, correlationId };
  if (detail) body.detail = detail;
  return res.status(statusCode).json(body);
}

function buildUserPayload(user) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.fullName,
    role: user.role,
    tenant_id: user.tenantId,
    email_verified: user.emailVerified,
    onboarding_status: user.onboardingStatus
  };
}

async function recordPasswordHistory(userId, passwordHash) {
  try {
    await prisma.passwordHistory.create({ data: { userId, passwordHash } });
  } catch (error) {
    logger.warn('Failed to record password history', { error: error.message, userId });
  }
}

// Health check
router.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', auth: 'session-based' });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// SIGNUP — creates account directly with emailVerified=false and sends verification code
// Use /api/auth/register for the deferred-verification flow
router.post('/signup', signupLimiter, async (req, res) => {
  // Block affiliate registrations from using this route
  if (req.headers['x-affiliate-portal'] === 'true') {
    return sendErrorResponse(res, 400,
      'Affiliate registrations must use the affiliate registration endpoint.',
      'USE_AFFILIATE_AUTH');
  }
  const { email, password, firstName, lastName } = req.body;
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password || !firstName || !lastName) {
    return sendErrorResponse(res, 400, 'All signup fields are required', 'VALIDATION_ERROR');
  }
  if (!validateEmail(normalizedEmail)) {
    return sendErrorResponse(res, 400, 'Invalid email address', 'VALIDATION_ERROR');
  }

  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.valid) {
    return sendErrorResponse(res, 400, passwordValidation.error, 'VALIDATION_ERROR');
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return sendErrorResponse(res, 409, 'Email already in use', 'EMAIL_ALREADY_EXISTS');
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          storeName: `${firstName}'s Store`,
          industry: 'general',
          onboardingStatus: 'pending'
        }
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: normalizedEmail,
          passwordHash,
          fullName: `${firstName} ${lastName}`,
          onboardingStatus: 'pending',
          emailVerified: false,
          failedLoginAttempts: 0
        }
      });

      await tx.tenantProfile.create({
        data: { tenantId: tenant.id, industry: 'general', onboardingStatus: 'started' }
      });

      await recordPasswordHistory(user.id, passwordHash);

      return { tenant, user };
    });

    const sessionResult = await createSession(result.tenant.id, result.user.id, res, req);
    logger.info('Signup session created', { userId: result.user.id, sessionId: sessionResult?.sessionId });

    const csrfToken = generateCsrfToken(result.user.id);

    logger.info('User signed up', { userId: result.user.id, email: normalizedEmail });

    res.status(201).json({
      message: 'Account created successfully. Please verify your email.',
      user: buildUserPayload(result.user),
      csrfToken,
      sessionEstablished: true
    });
  } catch (err) {
    logger.error('Signup failed', { error: err.message, email: normalizedEmail });
    if (err.code === 'P2002') {
      return sendErrorResponse(res, 409, 'Email already in use', 'EMAIL_ALREADY_EXISTS');
    }
    return sendErrorResponse(res, 500, 'Signup failed. Please try again.', 'SERVER_ERROR');
  }
});

// LOGIN
// FIX A-05: Lockout threshold reduced to 5
// FIX B-05: Affiliate status check at login time
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password) {
    return sendErrorResponse(res, 400, 'Email and password required', 'VALIDATION_ERROR');
  }

  try {
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return sendErrorResponse(res, 401, 'Invalid email or password', 'INVALID_CREDENTIALS');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil((user.lockedUntil - new Date()) / (1000 * 60));
      return sendErrorResponse(
        res, 423,
        `Account locked due to too many failed attempts. Try again in ${remainingMinutes} minutes.`,
        'ACCOUNT_LOCKED'
      );
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      const newAttempts = (user.failedLoginAttempts || 0) + 1;
      const updateData = { failedLoginAttempts: newAttempts };
      // FIX A-05: Lock after 5 failed attempts (was 10)
      if (newAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        updateData.lockedUntil = new Date(Date.now() + ACCOUNT_LOCKOUT_MINUTES * 60 * 1000);
        updateData.failedLoginAttempts = 0;
        logger.warn('Account locked due to failed login attempts', { userId: user.id, email: normalizedEmail });
      }
      await prisma.user.update({ where: { id: user.id }, data: updateData });
      return sendErrorResponse(res, 401, 'Invalid email or password', 'INVALID_CREDENTIALS');
    }

    if (!user.emailVerified) {
      return sendErrorResponse(res, 403, 'Email verification required', 'EMAIL_NOT_VERIFIED');
    }

    // FIX B-05: Check affiliate status at login — suspended/rejected affiliates must be blocked
    if (user.role === 'affiliate') {
      const affiliateProfile = await prisma.affiliateProfile.findUnique({
        where: { userId: user.id },
        select: { status: true, rejectedReason: true, suspendedReason: true }
      });
      if (affiliateProfile) {
        if (affiliateProfile.status === 'SUSPENDED') {
          logger.warn('Suspended affiliate login attempt blocked', { userId: user.id, email: normalizedEmail });
          return sendErrorResponse(
            res, 403,
            affiliateProfile.suspendedReason || 'Your account has been suspended. Please contact support.',
            'ACCOUNT_SUSPENDED'
          );
        }
        if (affiliateProfile.status === 'REJECTED') {
          logger.warn('Rejected affiliate login attempt blocked', { userId: user.id, email: normalizedEmail });
          return sendErrorResponse(
            res, 403,
            affiliateProfile.rejectedReason || 'Your application was not approved.',
            'ACCOUNT_REJECTED'
          );
        }
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }
    });

    await invalidateAllUserSessions(user.id, user.tenantId);

    const sessionResult = await createSession(user.tenantId, user.id, res, req);
    logger.info('Login session created', { userId: user.id, sessionId: sessionResult?.sessionId });

    const csrfToken = generateCsrfToken(user.id);

    res.status(200).json({
      message: 'Login successful',
      user: buildUserPayload(user),
      csrfToken,
      sessionEstablished: true
    });
  } catch (err) {
    logger.error('Login failed', { error: err.message, email: normalizedEmail });
    return sendErrorResponse(res, 500, 'Login failed. Please try again.', 'SERVER_ERROR');
  }
});

// LOGOUT
router.post('/logout', csrfProtection, async (req, res) => {
  const { allSessions = false } = req.body || {};

  try {
    const sessionAuth = await validateSession(req, res);
    clearSessionCookie(res);

    if (!sessionAuth) {
      return res.status(200).json({ message: 'Logged out', logoutBroadcast: true, global: false });
    }

    if (allSessions) {
      const count = await invalidateAllUserSessions(sessionAuth.user.id, sessionAuth.user.tenantId);
      logger.info('User global logout', { userId: sessionAuth.user.id, invalidated: count });
      if (process.env.NODE_ENV === 'production') {
        res.setHeader('Clear-Site-Data', '"cache", "cookies", "storage"');
      }
      return res.status(200).json({ message: 'Logged out from all devices', logoutBroadcast: true, global: true });
    }

    const sessionId = getSessionId(req);
    if (sessionId) {
      await invalidateSession(sessionId, sessionAuth.user.id);
      logger.info('User logged out', { userId: sessionAuth.user.id });
    }

    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Clear-Site-Data', '"cache", "cookies", "storage"');
    }

    return res.status(200).json({ message: 'Logged out successfully', logoutBroadcast: true, global: false });
  } catch (err) {
    clearSessionCookie(res);
    logger.warn('Logout encountered error', { error: err.message });
    return res.status(200).json({ message: 'Logged out', logoutBroadcast: true, global: false });
  }
});

// ME — returns current session user
router.get('/me', async (req, res) => {
  const sessionAuth = await validateSession(req, res);

  if (sessionAuth) {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: sessionAuth.user.tenantId } });
      let connectedPlatforms = [];
      try {
        const platforms = await prisma.$queryRaw`
          SELECT platform FROM store_configs WHERE "tenantId" = ${sessionAuth.user.tenantId} AND status = 'connected'
        `;
        connectedPlatforms = platforms.map(p => p.platform.toLowerCase());
      } catch (innerErr) {
        logger.warn('Connected platforms lookup failed', { error: innerErr.message });
      }

      return res.status(200).json({
        authenticated: true,
        user: buildUserPayload(sessionAuth.user),
        onboarding_status: tenant?.onboardingStatus === 'completed' ? 'completed' : 'pending',
        connected_platforms: connectedPlatforms
      });
    } catch (err) {
      logger.error('Me endpoint failed', { error: err.message, userId: sessionAuth.user.id });
      return sendErrorResponse(res, 500, 'Failed to return user profile', 'SERVER_ERROR');
    }
  }

  return sendErrorResponse(res, 401, 'Not authenticated', 'NOT_AUTHENTICATED');
});

// REFRESH session sliding window
router.post('/refresh', refreshLimiter, async (req, res) => {
  const sessionAuth = await validateSession(req, res);
  if (!sessionAuth) {
    return sendErrorResponse(res, 401, 'No active session', 'SESSION_EXPIRED');
  }

  try {
    const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const sessionToken = getSessionId(req);
    await prisma.userSession.updateMany({
      where: { tokenHash: hashSessionToken(sessionToken) },
      data: { expiresAt: newExpiry }
    });
    setSessionCookie(res, sessionToken);
    return res.status(200).json({ message: 'Session refreshed', expiresAt: newExpiry.toISOString() });
  } catch (err) {
    logger.error('Session refresh failed', { error: err.message });
    return sendErrorResponse(res, 500, 'Failed to refresh session', 'SERVER_ERROR');
  }
});

// CSRF TOKEN — for clients that need a token before they have a session
router.get('/csrf-token', async (req, res) => {
  const sessionAuth = await validateSession(req, res);
  if (sessionAuth) {
    const csrfToken = generateCsrfToken(sessionAuth.user.id);
    return res.status(200).json({ csrfToken, authenticated: true });
  }
  const tempId = `anon_${crypto.randomBytes(8).toString('hex')}`;
  const csrfToken = generateCsrfToken(tempId);
  return res.status(200).json({ csrfToken, authenticated: false });
});

// SESSION VALIDATION
router.get('/validate', csrfProtection, async (req, res) => {
  const sessionAuth = await validateSession(req, res);
  if (!sessionAuth) {
    return sendErrorResponse(res, 401, 'Invalid session', 'INVALID_SESSION');
  }
  if (!sessionAuth.verified) {
    return sendErrorResponse(res, 403, 'Email verification required', 'EMAIL_NOT_VERIFIED');
  }

  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: sessionAuth.user.tenantId } });
    return res.status(200).json({
      authenticated: true,
      user: buildUserPayload(sessionAuth.user),
      tenant: { id: tenant?.id, storeName: tenant?.storeName, onboardingStatus: tenant?.onboardingStatus },
      session: { expiresAt: sessionAuth.expiresAt }
    });
  } catch (err) {
    logger.error('Session validation failed', { error: err.message, userId: sessionAuth.user.id });
    return sendErrorResponse(res, 500, 'Session validation failed', 'SERVER_ERROR');
  }
});

// VERIFY EMAIL (session-based flow)
// FIX A-03: Compare against SHA-256 hash of the stored code
router.post('/verify-email', csrfProtection, async (req, res) => {
  const sessionAuth = await validateSession(req, res);
  if (!sessionAuth) {
    return sendErrorResponse(res, 401, 'No active session', 'NO_SESSION');
  }

  const { code } = req.body;
  if (!code) {
    return sendErrorResponse(res, 400, 'Verification code required', 'MISSING_CODE');
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: sessionAuth.user.id },
      select: { id: true, email: true, emailVerified: true }
    });

    if (!user) return sendErrorResponse(res, 404, 'User not found', 'USER_NOT_FOUND');
    if (user.emailVerified) return res.json({ message: 'Email already verified', verified: true });

    const verificationCode = await prisma.emailVerificationCode.findFirst({
      where: { userId: user.id, used: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' }
    });

    if (!verificationCode) {
      return sendErrorResponse(res, 400, 'Verification code expired or not sent', 'CODE_EXPIRED');
    }

    // FIX A-03: Hash the provided code and compare against stored SHA-256 hash
    const providedHash = crypto.createHash('sha256').update(code.trim()).digest('hex');
    let isValid = false;
    try {
      isValid = crypto.timingSafeEqual(
        Buffer.from(providedHash, 'hex'),
        Buffer.from(verificationCode.code, 'hex')
      );
    } catch {
      isValid = false;
    }

    if (!isValid) {
      return sendErrorResponse(res, 400, 'Invalid verification code', 'INVALID_CODE');
    }

    await prisma.$transaction([
      prisma.emailVerificationCode.update({ where: { id: verificationCode.id }, data: { used: true } }),
      prisma.user.update({ where: { id: user.id }, data: { emailVerified: true, emailVerifiedAt: new Date() } })
    ]);

    logger.info('User email verified', { userId: user.id, email: user.email });
    res.json({ message: 'Email verified successfully', verified: true });
  } catch (err) {
    logger.error('Email verification failed', { error: err.message });
    return sendErrorResponse(res, 500, 'Verification failed', 'INTERNAL_ERROR');
  }
});

module.exports = router;
