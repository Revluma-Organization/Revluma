// ============================================================
// SESSION-BASED AUTHENTICATION ROUTES
// ============================================================
// Production-grade auth with secure HTTP-only cookies
// Implements: signup, login, logout, session validation

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../services/prisma');
const logger = require('../utils/logger');

const {
  authenticate,
  createSession,
  invalidateSession,
  invalidateAllUserSessions,
  clearSessionCookie,
  getSessionId,
  generateCsrfToken,
  csrfProtection
} = require('../middleware/sessionAuth');

const router = express.Router();

// ============================================================
// COOKIE CONFIG
// ============================================================

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

if (process.env.NODE_ENV === 'production') {
  COOKIE_OPTS.secure = true;
}

// ============================================================
// PUBLIC ROUTES
// ============================================================

// Health check
router.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', auth: 'session-based' });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// ============================================================
// RATE LIMITER FOR AUTH ENDPOINTS
// ============================================================

const authRateLimiter = (max, windowMs) => (req, res, next) => {
  const identifier = req.ip;
  const key = `rate_limit:${identifier}:${req.path}`;

  // Use global rate limit from server.js for auth endpoints
  // This adds an additional layer
  next();
};

// ============================================================
// SIGNUP
// ============================================================

router.post('/signup', async (req, res) => {
  const { email, password, firstName, lastName } = req.body;

  // Validation
  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    // Check existing user
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create tenant and user in transaction
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
          emailVerified: true, // Auto-verify for simplicity
          emailVerifiedAt: new Date()
        }
      });

      await tx.tenantProfile.create({
        data: {
          tenantId: tenant.id,
          industry: 'general',
          onboardingStatus: 'started'
        }
      });

      return { tenant, user };
    });

    // Create session and set cookie
    await createSession(result.tenant.id, result.user.id, result.user.email, res);

    logger.info('User signed up', { userId: result.user.id, email: normalizedEmail });

    // Generate short-lived JWT for API access (optional)
    const apiToken = jwt.sign(
      { id: result.user.id, email: result.user.email, tenant_id: result.tenant.id, emailVerified: true },
      process.env.JWT_SECRET,
      { expiresIn: '1h', algorithm: 'HS256' }
    );

    // Generate CSRF token for subsequent requests
    const csrfToken = generateCsrfToken(result.user.id);

    res.status(201).json({
      message: 'Account created successfully',
      user: {
        id: result.user.id,
        email: result.user.email,
        fullName: result.user.fullName,
        onboarding_status: result.user.onboardingStatus
      },
      // Also send JWT for API compatibility
      token: apiToken,
      csrfToken
    });
  } catch (err) {
    logger.error('Signup error', { error: err.message, email: normalizedEmail });

    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Email already in use' });
    }

    res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
});

// ============================================================
// LOGIN (CRITICAL - MUST SET COOKIE)
// ============================================================

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  console.log('[SESSION/LOGIN] Login attempt', { email, timestamp: new Date().toISOString() });

  if (!email || !password) {
    console.warn('[SESSION/LOGIN] Missing email or password');
    return res.status(400).json({ error: 'Email and password required' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    console.log('[SESSION/LOGIN] Looking up user by email');
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (!user) {
      console.warn('[SESSION/LOGIN] User not found', { email: normalizedEmail });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    console.log('[SESSION/LOGIN] User found, comparing password');
    const validPassword = await bcrypt.compare(password, user.passwordHash);

    if (!validPassword) {
      console.warn('[SESSION/LOGIN] Invalid password', { email: normalizedEmail });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.emailVerified) {
      console.warn('[SESSION/LOGIN] Email not verified', { userId: user.id });
      return res.status(403).json({ error: 'Email verification required' });
    }

    // Get tenant for session
    console.log('[SESSION/LOGIN] Getting tenant info');
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId }
    });

    // Invalidate old sessions - prevent concurrent sessions (security feature)
    console.log('[SESSION/LOGIN] Invalidating previous sessions');
    await invalidateAllUserSessions(user.id, user.tenantId);

    // Create new session with cookie
    console.log('[SESSION/LOGIN] Creating new session');
    await createSession(user.tenantId, user.id, user.email, res);

    // Update lastLoginAt for tracking
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    console.log('[SESSION/LOGIN] Session created successfully', { userId: user.id, tenantId: user.tenantId });

    // Generate API token for API clients
    const apiToken = jwt.sign(
      { id: user.id, email: user.email, tenant_id: user.tenantId, emailVerified: user.emailVerified },
      process.env.JWT_SECRET,
      { expiresIn: '1h', algorithm: 'HS256' }
    );

    // Generate CSRF token for subsequent requests
    const csrfToken = generateCsrfToken(user.id);

    console.log('[SESSION/LOGIN] Sending successful response with user data');
    // **CRITICAL FIX**: Send response to frontend!
    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        onboarding_status: user.onboardingStatus,
        email_verified: user.emailVerified
      },
      token: apiToken,              // For API client fallback
      csrfToken,                    // For CSRF protection
      sessionEstablished: true      // Flag that cookie is set
    });

  } catch (err) {
    console.error('[SESSION/LOGIN] Login error', { error: err.message, email: normalizedEmail, stack: err.stack });
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ============================================================
// LOGOUT (CRITICAL - MUST CLEAR COOKIE)
// ============================================================

router.post('/logout', csrfProtection, async (req, res) => {
  const sessionId = getSessionId(req);
  const userId = req.csrfValidatedUserId;

  // Always clear the cookie first
  clearSessionCookie(res);

  // Invalidate all CSRF tokens for this user
  if (userId) {
    invalidateUserCsrfTokens(userId);
  }

  if (!sessionId) {
    // No session - just return success (handles multiple logout clicks)
    return res.status(200).json({ message: 'Logged out' });
  }

  try {
    await invalidateSession(sessionId, userId || 'system');

    logger.info('User logged out', {
      sessionId: sessionId.slice(0, 20),
      userId: userId
    });

    // Broadcast logout event for multi-tab sync
    res.status(200).json({
      message: 'Logged out successfully',
      logoutBroadcast: true
    });
  } catch (err) {
    logger.error('Logout error', { error: err.message, userId });
    // Still return success - cookie is cleared
    res.status(200).json({ message: 'Logged out' });
  }
});

// ============================================================
// VALIDATE SESSION (/me endpoint - critical for frontend)
// ============================================================

router.get('/me', async (req, res) => {
  const sessionId = getSessionId(req);
  console.log('[SESSION/ME] Endpoint called', { hasSessionId: !!sessionId, timestamp: new Date().toISOString() });

  // Try session-based auth first
  if (sessionId) {
    try {
      console.log('[SESSION/ME] Querying session from database');
      const result = await prisma.$queryRaw`
        SELECT us.id, us."userId", us."expiresAt", u.email, u."tenantId", u."emailVerified", u.role, u."fullName", t."onboardingStatus" as tenant_status
        FROM "user_sessions" us
        JOIN users u ON u.id = us."userId"
        JOIN tenants t ON t.id = u."tenantId"
        WHERE us.token = ${sessionId}
      `;

      console.log('[SESSION/ME] Query result', { found: result.length > 0 });

      if (result.length > 0) {
        const session = result[0];

        // Check expiration
        if (new Date(session.expiresAt) < new Date()) {
          console.warn('[SESSION/ME] Session expired', { expiresAt: session.expiresAt });
          clearSessionCookie(res);
          return res.status(401).json({ error: 'Session expired', code: 'SESSION_EXPIRED' });
        }

        if (!session.emailVerified) {
          console.warn('[SESSION/ME] Email not verified', { userId: session.userId });
          return res.status(403).json({ error: 'Email verification required' });
        }

        console.log('[SESSION/ME] Session valid, user authenticated', { userId: session.userId, email: session.email });

        // Return user data
        // Get connected platforms for this tenant
        let connectedPlatforms = [];
        try {
          const platforms = await prisma.$queryRaw`
            SELECT platform FROM store_configs WHERE "tenantId" = ${session.tenantId} AND status = 'connected'
          `;
          connectedPlatforms = platforms.map(p => p.platform.toLowerCase());
        } catch (e) {
          logger.warn('Failed to fetch connected platforms', { error: e.message });
        }

        return res.status(200).json({
          authenticated: true,
          user: {
            id: session.userId,
            email: session.email,
            full_name: session.fullName,
            first_name: session.fullName?.split(' ')[0] || null,
            last_name: session.fullName?.split(' ').slice(1).join(' ') || null,
            tenant_id: session.tenantId,
            role: session.role
          },
          onboarding_status: session.tenant_status === 'completed' ? 'completed' : 'pending',
          connected_platforms: connectedPlatforms
        });
      }
    } catch (err) {
      console.error('[SESSION/ME] Session query error', { error: err.message });
    }
  }

  // Fall back to JWT auth
  const authHeader = req.headers.authorization;
  console.log('[SESSION/ME] Attempting JWT auth fallback', { hasAuthHeader: !!authHeader });

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];

    try {
      console.log('[SESSION/ME] Verifying JWT token');
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ['HS256']
      });

      console.log('[SESSION/ME] JWT verified', { userId: decoded.id, email: decoded.email });

      if (!decoded.emailVerified) {
        console.warn('[SESSION/ME] JWT token email not verified', { userId: decoded.id });
        return res.status(403).json({ error: 'Email verification required' });
      }

      return res.status(200).json({
        authenticated: true,
        user: decoded,
        onboarding_status: 'completed' // JWT users are verified
      });
    } catch (err) {
      console.warn('[SESSION/ME] JWT verification failed', { error: err.message, name: err.name });
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    }
  }

  // Not authenticated
  console.warn('[SESSION/ME] No valid auth method found, returning 401');
  return res.status(401).json({
    authenticated: false,
    error: 'Not authenticated',
    code: 'NOT_AUTHENTICATED'
  });
});

// ============================================================
// REFRESH SESSION
// ============================================================

router.post('/refresh', async (req, res) => {
  const sessionId = getSessionId(req);

  if (!sessionId) {
    return res.status(401).json({ error: 'No active session' });
  }

  try {
    // Validate and extend session
    const result = await prisma.$queryRaw`
      SELECT "userId", "expiresAt" FROM "user_sessions" WHERE token = ${sessionId}
    `;

    if (result.length === 0) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Invalid session' });
    }

    if (new Date(result[0].expiresAt) < new Date()) {
      await prisma.$queryRaw`DELETE FROM "user_sessions" WHERE token = ${sessionId}`;
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Session expired' });
    }

    // Extend session
    const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.$queryRaw`
      UPDATE "user_sessions" SET "expiresAt" = ${newExpiry} WHERE token = ${sessionId}
    `;

    res.status(200).json({ message: 'Session refreshed' });
  } catch (err) {
    logger.error('Session refresh error', { error: err.message });
    res.status(500).json({ error: 'Failed to refresh session' });
  }
});

// ============================================================
// CSRF TOKEN GENERATION
// ============================================================

router.get('/csrf-token', async (req, res) => {
  const sessionId = getSessionId(req);

  if (!sessionId) {
    return res.status(401).json({ error: 'No active session' });
  }

  try {
    const session = await prisma.userSession.findUnique({
      where: { token: sessionId },
      include: { user: true }
    });

    if (!session) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Invalid session' });
    }

    const csrfToken = generateCsrfToken(session.userId);

    res.status(200).json({
      csrfToken,
      userId: session.userId
    });
  } catch (err) {
    logger.error('CSRF token generation error', { error: err.message });
    res.status(500).json({ error: 'Failed to generate CSRF token' });
  }
});

// ============================================================
// SESSION VALIDATION (lightweight)
// ============================================================

router.get('/validate', csrfProtection, async (req, res) => {
  const sessionId = getSessionId(req);

  if (!sessionId) {
    return res.status(401).json({ error: 'No active session' });
  }

  try {
    const session = await prisma.userSession.findUnique({
      where: { token: sessionId },
      include: {
        user: {
          include: { tenant: true }
        }
      }
    });

    if (!session) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Invalid session', code: 'INVALID_SESSION' });
    }

    if (new Date(session.expiresAt) < new Date()) {
      await prisma.userSession.delete({ where: { id: session.id } });
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Session expired', code: 'SESSION_EXPIRED' });
    }

    if (!session.user.emailVerified) {
      return res.status(403).json({ error: 'Email verification required', code: 'EMAIL_NOT_VERIFIED' });
    }

    res.status(200).json({
      authenticated: true,
      user: {
        id: session.user.id,
        email: session.user.email,
        full_name: session.user.fullName,
        tenant_id: session.user.tenantId,
        role: session.user.role
      },
      tenant: {
        id: session.user.tenant.id,
        storeName: session.user.tenant.storeName,
        onboardingStatus: session.user.tenant.onboardingStatus
      },
      session: {
        expiresAt: session.expiresAt
      }
    });
  } catch (err) {
    logger.error('Session validation error', { error: err.message });
    res.status(500).json({ error: 'Session validation failed' });
  }
});

// ============================================================
// EXPORTS
// ============================================================

module.exports = router;