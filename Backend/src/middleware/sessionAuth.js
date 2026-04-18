// ============================================================
// SESSION-BASED AUTHENTICATION MIDDLEWARE
// ============================================================
// Production-grade session management with secure cookies
// Follows security best practices from the requirements

const jwt = require('jsonwebtoken');
const { prisma } = require('../services/prisma');
const logger = require('../utils/logger');

// Cookie configuration
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict',
  path: '/'
};

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  COOKIE_OPTIONS.secure = true;
}

// Session expiration: 7 days with rolling refresh
const SESSION_EXPIRY_DAYS = 7;

// ============================================================
// COOKIE HELPERS
// ============================================================

function setSessionCookie(res, sessionId) {
  res.cookie('session_id', sessionId, {
    ...COOKIE_OPTIONS,
    maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    expires: new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
  });
}

function clearSessionCookie(res) {
  res.cookie('session_id', '', {
    ...COOKIE_OPTIONS,
    maxAge: 0,
    expires: new Date(0)
  });
}

function getSessionId(req) {
  return req.cookies?.session_id || null;
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================

async function createSession(tenantId, userId, userEmail, res) {
  const sessionId = `sess_${require('uuid').v4()}`;
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  
  try {
    // Store session in database using Prisma
    await prisma.userSession.create({
      data: {
        id: sessionId,
        userId: userId,
        token: sessionId,
        expiresAt: expiresAt
      }
    });
    
    // Set HTTP-only cookie
    setSessionCookie(res, sessionId);
    
    logger.info('Session created', { userId, tenantId, sessionId: sessionId.slice(0, 20) });
    
    return sessionId;
  } catch (error) {
    logger.error('Failed to create session', { error: error.message, userId });
    throw error;
  }
}

async function validateSession(req, res) {
  const sessionId = getSessionId(req);
  
  if (!sessionId) {
    logger.debug('No session cookie found');
    return null;
  }
  
  try {
    // Query session from database using Prisma
    const session = await prisma.userSession.findUnique({
      where: { token: sessionId },
      include: {
        user: {
          include: {
            tenant: true
          }
        }
      }
    });
    
    if (!session) {
      logger.debug('Session not found in database', { sessionId: sessionId.slice(0, 20) });
      clearSessionCookie(res);
      return null;
    }
    
    // Check expiration
    if (new Date(session.expiresAt) < new Date()) {
      logger.debug('Session expired', { sessionId: sessionId.slice(0, 20) });
      
      // Clean up expired session
      await prisma.userSession.delete({ where: { id: session.id } });
      
      clearSessionCookie(res);
      return null;
    }
    
    // Check user is verified
    if (!session.user.emailVerified) {
      logger.warn('Session for unverified user', { userId: session.userId });
      return { verified: false, user: session.user };
    }
    
    // Extend session on activity (rolling session)
    const newExpiry = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    await prisma.userSession.update({
      where: { id: session.id },
      data: { expiresAt: newExpiry }
    });
    
    logger.debug('Session validated', { userId: session.userId, sessionId: sessionId.slice(0, 20) });
    
    return {
      verified: true,
      user: {
        id: session.user.id,
        email: session.user.email,
        tenant_id: session.user.tenantId,
        role: session.user.role || 'user',
        email_verified: session.user.emailVerified,
        full_name: session.user.fullName
      }
    };
  } catch (error) {
    logger.error('Session validation error', { error: error.message });
    return null;
  }
}

async function invalidateSession(sessionId, tenantId) {
  try {
    await prisma.userSession.delete({
      where: { token: sessionId }
    });
    logger.info('Session invalidated', { sessionId: sessionId?.slice(0, 20) });
    return true;
  } catch (error) {
    logger.error('Failed to invalidate session', { error: error.message });
    return false;
  }
}

async function invalidateAllUserSessions(userId, tenantId) {
  try {
    await prisma.userSession.deleteMany({
      where: { userId: userId }
    });
    logger.info('All user sessions invalidated', { userId });
    return true;
  } catch (error) {
    logger.error('Failed to invalidate all sessions', { error: error.message });
    return false;
  }
}

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

// ============================================================
// EXPORTS
// ============================================================

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
  COOKIE_OPTIONS
};