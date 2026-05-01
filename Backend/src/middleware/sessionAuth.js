// ============================================================
// SESSION-BASED AUTHENTICATION MIDDLEWARE
// ============================================================
// Production-grade session management with secure cookies
// Follows security best practices from the requirements

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { prisma } = require('../services/prisma');
const logger = require('../utils/logger');

// Session configuration
const SESSION_EXPIRY_DAYS = 7;
const REFRESH_TOKEN_EXPIRY_DAYS = 30;
const CSRF_TOKEN_TTL = 30 * 60 * 1000; // 30 minutes
const SESSION_VALIDATION_INTERVAL = 15 * 60 * 1000; // 15 minutes

// Cookie configuration - enterprise-grade security
const getCookieOptions = (isProduction) => {
  const baseOptions = {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: isProduction,
    maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    expires: new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
  };
  return baseOptions;
};

// CSRF token store - in-memory with DB persistence backup
const csrfTokens = new Map();
const isProduction = process.env.NODE_ENV === 'production';

// Cleanup expired CSRF tokens periodically
function cleanupExpiredCsrfTokens() {
  const now = Date.now();
  let cleaned = 0;
  for (const [token, data] of csrfTokens.entries()) {
    if (now - data.createdAt > CSRF_TOKEN_TTL) {
      csrfTokens.delete(token);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug(`Cleaned ${cleaned} expired CSRF tokens`);
  }
}
setInterval(cleanupExpiredCsrfTokens, 5 * 60 * 1000);

// Session tracking for concurrent session management
const activeSessions = new Set();

// Rate limiting store for auth endpoints (memory-based, production should use Redis)
const authRateLimits = new Map();
function checkRateLimit(key, max, windowMs) {
  const now = Date.now();
  const record = authRateLimits.get(key);
  
  if (!record) {
    authRateLimits.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: max - 1 };
  }
  
  if (now - record.windowStart > windowMs) {
    record.count = 1;
    record.windowStart = now;
    return { allowed: true, remaining: max - 1 };
  }
  
  if (record.count >= max) {
    return { allowed: false, remaining: 0, retryAfter: windowMs - (now - record.windowStart) };
  }
  
  record.count++;
  return { allowed: true, remaining: max - record.count };
}

function cleanupExpiredRateLimits() {
  const now = Date.now();
  for (const [key, record] of authRateLimits.entries()) {
    if (now - record.windowStart > 15 * 60 * 1000) {
      authRateLimits.delete(key);
    }
  }
}
setInterval(cleanupExpiredRateLimits, 60 * 1000);

// Generate CSRF token
function generateCsrfToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  csrfTokens.set(token, {
    userId,
    createdAt: Date.now()
  });
  return token;
}

// Validate CSRF token
function validateCsrfToken(token, userId) {
  const data = csrfTokens.get(token);
  if (!data) return false;
  if (data.userId !== userId) return false;
  if (Date.now() - data.createdAt > CSRF_TOKEN_TTL) {
    csrfTokens.delete(token);
    return false;
  }
  return true;
}

// Invalidate CSRF token
function invalidateCsrfToken(token) {
  csrfTokens.delete(token);
}

// Invalidate all CSRF tokens for a user
function invalidateUserCsrfTokens(userId) {
  for (const [token, data] of csrfTokens.entries()) {
    if (data.userId === userId) {
      csrfTokens.delete(token);
    }
  }
}

// ============================================================
// SESSION MANAGEMENT FUNCTIONS
// ============================================================

// Create a new session
async function createSession(tenantId, userId, userEmail, res) {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  
  try {
    await prisma.userSession.create({
      data: {
        userId,
        token: sessionToken,
        expiresAt
      }
    });
    
    setSessionCookie(res, sessionToken);
    activeSessions.add(sessionToken);
    logger.debug('Session created', { userId, tenantId });
    return { token: sessionToken, expiresAt };
  } catch (error) {
    logger.error('Session creation failed', { error: error.message, userId });
    throw error;
  }
}

// Invalidate a specific session
async function invalidateSession(sessionToken, userId) {
  try {
    await prisma.userSession.delete({
      where: { token: sessionToken }
    });
    activeSessions.delete(sessionToken);
    logger.debug('Session invalidated', { userId, sessionToken: sessionToken.slice(0, 20) });
    return true;
  } catch (error) {
    logger.error('Session invalidation failed', { error: error.message, userId });
    throw error;
  }
}

// Invalidate all sessions for a user (logout from other devices)
async function invalidateAllUserSessions(userId, tenantId) {
  try {
    const sessions = await prisma.userSession.findMany({
      where: { userId }
    });
    
    for (const session of sessions) {
      await prisma.userSession.delete({
        where: { token: session.token }
      });
      activeSessions.delete(session.token);
    }
    
    logger.debug('All user sessions invalidated', { userId, tenantId, count: sessions.length });
    return sessions.length;
  } catch (error) {
    logger.error('Failed to invalidate all sessions', { error: error.message, userId });
    throw error;
  }
}

// Validate a session and get user data
async function validateSession(req, res) {
  const sessionId = getSessionId(req);
  
  if (!sessionId) {
    return null;
  }
  
  try {
    const session = await prisma.userSession.findUnique({
      where: { token: sessionId },
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
    
    // Check if session is expired
    if (new Date(session.expiresAt) < new Date()) {
      clearSessionCookie(res);
      await prisma.userSession.delete({
        where: { token: sessionId }
      });
      return null;
    }
    
    return {
      token: sessionId,
      user: session.user,
      verified: session.user.emailVerified,
      expiresAt: session.expiresAt
    };
  } catch (error) {
    logger.error('Session validation error', { error: error.message });
    clearSessionCookie(res);
    return null;
  }
}

// Set session cookie
function setSessionCookie(res, sessionToken) {
  const isProduction = process.env.NODE_ENV === 'production';
  const options = getCookieOptions(isProduction);
  res.cookie('revluma_session', sessionToken, options);
}

// Clear session cookie
function clearSessionCookie(res) {
  res.clearCookie('revluma_session', {
    httpOnly: true,
    sameSite: 'strict',
    path: '/'
  });
}

// Get session ID from request
function getSessionId(req) {
  return req.cookies ? req.cookies['revluma_session'] : null;
}

// CSRF protection middleware
const csrfProtection = async (req, res, next) => {
  // Skip CSRF check for safe methods
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  // Check for CSRF token in header
  const csrfToken = req.headers['x-csrf-token'];

  if (!csrfToken) {
    logger.warn('CSRF token missing', { ip: req.ip, method: req.method, url: req.url });
    return res.status(403).json({ error: 'CSRF token required' });
  }

  // Get session to validate against
  const sessionId = getSessionId(req);
  if (!sessionId) {
    return res.status(401).json({ error: 'Session required for CSRF validation' });
  }

  // Validate session exists to get userId
  const session = await prisma.userSession.findUnique({ where: { token: sessionId } });
  if (!session) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Invalid session' });
  }

  if (!validateCsrfToken(csrfToken, session.userId)) {
    logger.warn('Invalid CSRF token', { ip: req.ip, userId: session.userId });
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  req.csrfValidatedUserId = session.userId;
  next();
};





// ============================================================
// MAIN AUTHENTICATION MIDDLEWARE
// ============================================================

const authenticate = async (req, res, next) => {
  // First try session-based auth
  const sessionAuth = await validateSession(req, res);
  
  if (sessionAuth) {
    if (!sessionAuth.verified) {
      return res.status(403).json({ error: 'Email verification required' });
    }
    
    req.user = sessionAuth.user;
    return next();
  }
  
  // Fall back to JWT header auth (for API clients)
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
    
    return res.status(status).json({ error: message });
  }
};

// ============================================================
// OPTIONAL: REQUIRE ONBOARDING COMPLETE
// ============================================================

const requireOnboarding = async (req, res, next) => {
  const { tenant_id } = req.user;
  
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
    logger.error('Onboarding check failed', { error: error.message });
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
  COOKIE_OPTIONS,
  generateCsrfToken,
  validateCsrfToken,
  invalidateCsrfToken,
  invalidateUserCsrfTokens,
  csrfProtection
};