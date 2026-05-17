// ============================================================
// SESSION-BASED AUTHENTICATION ROUTES
// ============================================================
// Production-grade auth with secure HTTP-only cookies
// Implements: signup, login, logout, session validation

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { prisma } = require('../services/prisma');
const logger = require('../utils/logger');

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

// ============================================================
// ERROR RESPONSE HELPER
// ============================================================
function sendErrorResponse(res, statusCode, message, code, detail = null) {
  const correlationId = res.getHeader('X-Correlation-ID') || 'unknown';
  const errorResponse = {
    error: message,
    code: code,
    correlationId
  };
  if (detail) {
    errorResponse.detail = detail;
  }
  return res.status(statusCode).json(errorResponse);
}

// ============================================================
// PASSWORD VALIDATION
// ============================================================
function validatePasswordStrength(password) {
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password must be a string' };
  }

  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }

  if (password.length > 128) {
    return { valid: false, error: 'Password must be no more than 128 characters long' };
  }

  // Check for common weak patterns
  const weakPatterns = [
    /^12345678/,
    /^password/i,
    /^qwerty/i,
    /^abc123/i,
    /^admin/i,
    /^user/i,
    /^login/i,
    /^welcome/i,
    /^letmein/i,
    /^monkey/i,
    /^dragon/i,
    /^passw0rd/i,
    /^p@ssw0rd/i
  ];

  for (const pattern of weakPatterns) {
    if (pattern.test(password)) {
      return { valid: false, error: 'Password contains common patterns that are easily guessed' };
    }
  }

  // Check for sequential characters
  if (/(.)\1{2,}/.test(password)) {
    return { valid: false, error: 'Password cannot contain repeated characters' };
  }

  // Check for sequential numbers/letters
  if (/123|234|345|456|567|678|789|890|abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz/i.test(password)) {
    return { valid: false, error: 'Password cannot contain sequential characters' };
  }

  return { valid: true };
}

async function checkPasswordHistory(userId, newPasswordHash) {
  try {
    const recentPasswords = await prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    for (const history of recentPasswords) {
      const isSame = await bcrypt.compare(newPasswordHash, history.passwordHash);
      if (isSame) {
        return { valid: false, error: 'Password cannot be the same as recently used passwords' };
      }
    }

    return { valid: true };
  } catch (error) {
    logger.warn('Password history check failed', { error: error.message, userId });
    // Allow password change if history check fails (fail open for security)
    return { valid: true };
  }
}

async function recordPasswordHistory(userId, passwordHash) {
  try {
    await prisma.passwordHistory.create({
      data: {
        userId,
        passwordHash
      }
    });
  } catch (error) {
    logger.warn('Failed to record password history', { error: error.message, userId });
    // Don't fail the operation if history recording fails
  }
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.toLowerCase().trim() : '';
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

// Health check
router.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', auth: 'session-based' });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// SIGNUP
router.post('/signup', signupLimiter, async (req, res) => {
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
          emailVerified: true,
          emailVerifiedAt: new Date(),
          failedLoginAttempts: 0
        }
      });

      await tx.tenantProfile.create({
        data: {
          tenantId: tenant.id,
          industry: 'general',
          onboardingStatus: 'started'
        }
      });

      // Record initial password in history
      await recordPasswordHistory(user.id, passwordHash);

      return { tenant, user };
    });

    let sessionResult;
    try {
      sessionResult = await createSession(result.tenant.id, result.user.id, res, req);
      logger.info('Signup session created', { userId: result.user.id, sessionId: sessionResult?.sessionId });
    } catch (sessionErr) {
      logger.error('Signup: session creation failed after user creation', {
        error: sessionErr.message,
        userId: result.user.id,
        email: normalizedEmail,
        code: sessionErr.code
      });
      throw new Error(`Session creation failed: ${sessionErr.message}`);
    }

    const csrfToken = generateCsrfToken(result.user.id);

    logger.info('User signed up', { userId: result.user.id, email: normalizedEmail });

    res.status(201).json({
      message: 'Account created successfully',
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

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil((user.lockedUntil - new Date()) / (1000 * 60));
      return sendErrorResponse(res, 423, `Account locked due to too many failed attempts. Try again in ${remainingMinutes} minutes.`, 'ACCOUNT_SUSPENDED');
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      // Increment failed attempts
      const newAttempts = (user.failedLoginAttempts || 0) + 1;
      const updateData = { failedLoginAttempts: newAttempts };

      // Lock account after 10 failed attempts for 15 minutes
      if (newAttempts >= 10) {
        updateData.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
        updateData.failedLoginAttempts = 0; // Reset counter after lock
        logger.warn('Account locked due to failed login attempts', { userId: user.id, email: normalizedEmail });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: updateData
      });

      return sendErrorResponse(res, 401, 'Invalid email or password', 'INVALID_CREDENTIALS');
    }

    if (!user.emailVerified) {
      return sendErrorResponse(res, 403, 'Email verification required', 'EMAIL_NOT_VERIFIED');
    }

    // Successful login - reset failed attempts and unlock if needed
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date()
      }
    });

    await invalidateAllUserSessions(user.id, user.tenantId);

    let sessionResult;
    try {
      sessionResult = await createSession(user.tenantId, user.id, res, req);
      logger.info('Login session created', { userId: user.id, sessionId: sessionResult?.sessionId });
    } catch (sessionErr) {
      logger.error('Login: session creation failed', {
        error: sessionErr.message,
        userId: user.id,
        email: normalizedEmail,
        code: sessionErr.code
      });
      throw new Error(`Session creation failed: ${sessionErr.message}`);
    }

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
  const sessionId = getSessionId(req);
  clearSessionCookie(res);

  if (!sessionId) {
    return res.status(200).json({ message: 'Logged out' });
  }

  try {
    await invalidateSession(sessionId, req.csrfValidatedUserId || 'system');
    logger.info('User logged out', { sessionId: sessionId.slice(0, 20), userId: req.csrfValidatedUserId });
    return res.status(200).json({ message: 'Logged out successfully', logoutBroadcast: true });
  } catch (err) {
    logger.error('Logout error', { error: err.message });
    return res.status(200).json({ message: 'Logged out successfully' });
  }
});

// ME
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

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendErrorResponse(res, 401, 'Not authenticated', 'NOT_AUTHENTICATED');
  }

  const token = authHeader.slice('Bearer '.length);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded.emailVerified) {
      return sendErrorResponse(res, 403, 'Email verification required', 'EMAIL_NOT_VERIFIED');
    }
    return res.status(200).json({ authenticated: true, user: decoded, onboarding_status: 'completed' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return sendErrorResponse(res, 401, 'Token has expired', 'TOKEN_EXPIRED');
    }
    return sendErrorResponse(res, 401, 'Invalid token', 'INVALID_TOKEN');
  }
});

// REFRESH
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
    sendErrorResponse(res, 500, 'Failed to refresh session', 'SERVER_ERROR');
  }
});

// CSRF TOKEN GENERATION — public endpoint, no session required
router.get('/csrf-token', (req, res) => {
  const tempUserId = `temp_${crypto.randomBytes(8).toString('hex')}`;
  const csrfToken = generateCsrfToken(tempUserId);
  res.status(200).json({ csrfToken, userId: tempUserId, authenticated: false });
});

// DEBUG: return server-side session info for current cookie (useful for client validation)
router.get('/debug/session-check', async (req, res) => {
  try {
    const sessionAuth = await validateSession(req, res);
    if (!sessionAuth) {
      return res.status(200).json({ session: null, authenticated: false });
    }

    return res.status(200).json({
      session: {
        token: sessionAuth.token,
        expiresAt: sessionAuth.expiresAt
      },
      user: buildUserPayload(sessionAuth.user),
      authenticated: true,
      verified: sessionAuth.verified
    });
  } catch (err) {
    logger.error('Debug session-check failed', { error: err.message });
    return res.status(500).json({ error: 'Debug session-check failed' });
  }
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
      tenant: {
        id: tenant?.id,
        storeName: tenant?.storeName,
        onboardingStatus: tenant?.onboardingStatus
      },
      session: {
        expiresAt: sessionAuth.expiresAt
      }
    });
  } catch (err) {
    logger.error('Session validation failed', { error: err.message, userId: sessionAuth.user.id });
    sendErrorResponse(res, 500, 'Session validation failed', 'SERVER_ERROR');
  }
});

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

    if (!user) {
      return sendErrorResponse(res, 404, 'User not found', 'USER_NOT_FOUND');
    }

    if (user.emailVerified) {
      return res.json({ message: 'Email already verified', verified: true });
    }

    // Find the latest unused verification code for this user
    const verificationCode = await prisma.emailVerificationCode.findFirst({
      where: {
        userId: user.id,
        used: false,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!verificationCode) {
      return sendErrorResponse(res, 400, 'Verification code expired or not sent', 'CODE_EXPIRED');
    }

    const isValidCode = code === verificationCode.code;
    if (!isValidCode) {
      return sendErrorResponse(res, 400, 'Invalid verification code', 'INVALID_CODE');
    }

    // Mark code as used and verify user
    await prisma.$transaction([
      prisma.emailVerificationCode.update({
        where: { id: verificationCode.id },
        data: { used: true }
      }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerified: true,
          emailVerifiedAt: new Date()
        }
      })
    ]);

    logger.info('User email verified', { userId: user.id, email: user.email });
    res.json({ message: 'Email verified successfully', verified: true });

  } catch (err) {
    logger.error('Email verification failed', { error: err.message });
    sendErrorResponse(res, 500, 'Verification failed', 'INTERNAL_ERROR');
  }
});

module.exports = router;
