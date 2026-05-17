const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { prisma } = require('../services/prisma');
const logger = require('../utils/logger');

const SESSION_EXPIRY_DAYS = Number(process.env.SESSION_EXPIRY_DAYS || '7');
const CSRF_TOKEN_TTL_MS = 30 * 60 * 1000;
const isProduction = process.env.NODE_ENV === 'production';
const CSRF_SECRET = process.env.CSRF_SECRET || process.env.JWT_SECRET;
const COOKIE_NAME = 'revluma_session';
const COOKIE_PATH = '/';

if (!CSRF_SECRET) {
  logger.error('CSRF_SECRET or JWT_SECRET is required for CSRF token generation');
  throw new Error('CSRF_SECRET or JWT_SECRET must be configured for auth middleware');
}

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    path: COOKIE_PATH,
    secure: isProduction,
    maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    expires: new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
  };
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateCsrfToken(userId) {
  const timestamp = Date.now().toString();
  const payload = `${userId}:${timestamp}`;
  const mac = crypto.createHmac('sha256', CSRF_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${mac}`, 'utf8').toString('base64url');
}

function validateCsrfToken(token, userId) {
  if (!token || !userId) {
    return false;
  }

  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [tokenUserId, timestamp, signature] = decoded.split(':');

    if (!tokenUserId || !timestamp || !signature) {
      return false;
    }

    if (tokenUserId !== userId) {
      return false;
    }

    if (Date.now() - Number(timestamp) > CSRF_TOKEN_TTL_MS) {
      return false;
    }

    const expected = crypto.createHmac('sha256', CSRF_SECRET).update(`${tokenUserId}:${timestamp}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch (err) {
    logger.warn('CSRF token validation failed', { error: err.message });
    return false;
  }
}

async function createSession(tenantId, userId, res, req = null) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  try {
    // Attempt to create the session row and capture the created record for diagnostics
    const created = await prisma.userSession.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        ipAddress: req?.ip || 'unknown',
        userAgent: req?.headers['user-agent'] || 'unknown',
        lastSeenAt: new Date()
      }
    });

    // Set cookie for the raw token so the browser stores the session identifier (HTTP-only)
    setSessionCookie(res, rawToken);

    // Log an abbreviated tokenHash for traceability without leaking secrets
    logger.info('AUTH_EVENT', {
      event: 'session_created',
      userId,
      tenantId,
      sessionId: created.id,
      tokenHashPrefix: tokenHash.slice(0, 16),
      ip: req?.ip || 'unknown',
      userAgent: req?.headers['user-agent'] || 'unknown'
    });

    // Return the raw token to be used by the caller (note: raw token is not persisted)
    return { token: rawToken, expiresAt, sessionId: created.id };
  } catch (error) {
    // Log full error details for debugging (avoid leaking sensitive token material)
    logger.error('Session creation failed', { error: error.message, userId, tenantId });
    throw error;
  }
}

async function invalidateSession(sessionToken, actorId) {
  if (!sessionToken) {
    return false;
  }

  const tokenHash = hashSessionToken(sessionToken);
  try {
    await prisma.userSession.deleteMany({ where: { tokenHash } });
    logger.debug('Session invalidated', { actorId, sessionHash: tokenHash.slice(0, 16) });
    return true;
  } catch (error) {
    logger.error('Session invalidation failed', { error: error.message, actorId });
    throw error;
  }
}

async function invalidateAllUserSessions(userId, tenantId) {
  try {
    const result = await prisma.userSession.deleteMany({ where: { userId } });
    logger.debug('All user sessions invalidated', { userId, tenantId, count: result.count });
    return result.count;
  } catch (error) {
    logger.error('Failed to invalidate all sessions', { error: error.message, userId, tenantId });
    throw error;
  }
}

async function validateSession(req, res) {
  const sessionId = getSessionId(req);
  if (!sessionId) {
    return null;
  }

  const tokenHash = hashSessionToken(sessionId);
  try {
    const session = await prisma.userSession.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            emailVerified: true,
            role: true,
            tenantId: true
          }
        }
      }
    });

    if (!session) {
      clearSessionCookie(res);
      return null;
    }

    if (session.expiresAt < new Date()) {
      clearSessionCookie(res);
      await prisma.userSession.deleteMany({ where: { tokenHash } });
      return null;
    }

    // Sliding window: extend session by 7 days on successful validation
    const newExpiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    await prisma.userSession.update({
      where: { tokenHash },
      data: {
        expiresAt: newExpiresAt
      }
    });

    // Reset cookie with new expiry
    setSessionCookie(res, sessionId);

    return {
      token: sessionId,
      user: session.user,
      verified: session.user.emailVerified,
      expiresAt: newExpiresAt
    };
  } catch (error) {
    logger.error('Session validation error', { error: error.message });
    clearSessionCookie(res);
    return null;
  }
}

function setSessionCookie(res, sessionToken) {
  res.cookie(COOKIE_NAME, sessionToken, getCookieOptions());
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    path: COOKIE_PATH
  });
}

function getSessionId(req) {
  return req.cookies ? req.cookies[COOKIE_NAME] : null;
}

const csrfProtection = async (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const csrfToken = req.headers['x-csrf-token'];
  if (!csrfToken) {
    logger.warn('CSRF token missing', { ip: req.ip, method: req.method, url: req.originalUrl });
    return res.status(403).json({ error: 'CSRF token required' });
  }

  // Try session-based authentication first
  const sessionId = getSessionId(req);
  if (sessionId) {
    const session = await prisma.userSession.findUnique({
      where: { tokenHash: hashSessionToken(sessionId) }
    });

    if (session) {
      if (!validateCsrfToken(csrfToken, session.userId)) {
        logger.warn('Invalid CSRF token', { ip: req.ip, userId: session.userId, url: req.originalUrl });
        return res.status(403).json({ error: 'Invalid CSRF token' });
      }
      req.csrfValidatedUserId = session.userId;
      return next();
    } else {
      clearSessionCookie(res);
    }
  }

  // Fallback to JWT token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Session or Bearer token required for CSRF validation' });
  }

  const token = authHeader.slice('Bearer '.length);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    // For JWT tokens, validate CSRF based on user ID in token
    if (!validateCsrfToken(csrfToken, decoded.id)) {
      logger.warn('Invalid CSRF token for JWT user', { ip: req.ip, userId: decoded.id, url: req.originalUrl });
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    req.csrfValidatedUserId = decoded.id;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token has expired' });
    }
    logger.warn('Invalid JWT token in CSRF validation', { ip: req.ip, error: err.message });
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const authenticate = async (req, res, next) => {
  const sessionAuth = await validateSession(req, res);

  if (sessionAuth) {
    if (!sessionAuth.verified) {
      return res.status(403).json({ error: 'Email verification required' });
    }

    req.user = sessionAuth.user;
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      ignoreExpiration: false
    });

    if (!decoded.id || !decoded.tenant_id || !decoded.email) {
      throw new Error('Invalid token claims');
    }

    if (decoded.emailVerified !== true) {
      return res.status(403).json({ error: 'Email verification required' });
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      tenant_id: decoded.tenant_id,
      role: decoded.role || 'user',
      email_verified: decoded.emailVerified
    };

    next();
  } catch (err) {
    let status = 401;
    let message = 'Invalid or expired token';

    if (err.name === 'TokenExpiredError') {
      message = 'Token has expired';
    } else if (err.name === 'JsonWebTokenError') {
      message = 'Malformed token';
    }

    logger.warn('JWT authentication failed', { error: err.message, ip: req.ip });
    return res.status(status).json({ error: message });
  }
};

const requireOnboarding = async (req, res, next) => {
  const tenant_id = req.user?.tenant_id;

  if (!tenant_id) {
    return res.status(400).json({ error: 'Tenant information is missing' });
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenant_id }
    });

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    if (tenant.onboardingStatus !== 'completed') {
      return res.status(403).json({
        error: 'Onboarding required',
        redirect: '/onboarding',
        status: tenant.onboardingStatus
      });
    }

    next();
  } catch (error) {
    logger.error('Onboarding check failed', { error: error.message, tenant_id });
    next();
  }
};

module.exports = {
  authenticate,
  requireOnboarding,
  createSession,
  validateSession,
  invalidateSession,
  invalidateAllUserSessions,
  setSessionCookie,
  clearSessionCookie,
  getSessionId,
  generateCsrfToken,
  validateCsrfToken,
  csrfProtection,
  hashSessionToken
};
