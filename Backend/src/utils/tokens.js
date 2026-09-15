/**
 * Token utilities for Revluma authentication system.
 *
 * Access tokens  — short-lived (15m), stateless JWT, strict claims
 * Refresh tokens — long-lived (7d), persisted hashed in DB, rotated on every use
 *
 * Security properties:
 * - Access tokens include jti, iss, aud, sub, sid, type, nbf
 * - Refresh tokens are 256-bit random values, stored as SHA-256 hash in DB
 * - Token rotation: each use invalidates the old token and issues a new one
 * - Reuse detection: if a revoked token in a family is used, entire family is revoked
 * - Algorithm locked to HS256 — no algorithm confusion possible
 */

const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { JWT_ISSUER, JWT_AUDIENCE, ALLOWED_ALGORITHMS } = require('../middlewares/authMiddleware');

const ACCESS_TOKEN_TTL  = '15m';
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const INVITE_TOKEN_TTL  = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Generate a hardened access token with all required claims.
 */
function generateAccessToken({ userId, email, tenantId, sessionId }) {
  const jti = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      // Standard JWT claims
      iss:  JWT_ISSUER,
      aud:  JWT_AUDIENCE,
      sub:  userId,
      jti:  jti,
      iat:  now,
      nbf:  now,
      // Custom claims
      email:    email,
      tenantId: tenantId || null,
      sid:      sessionId || null,
      type:     'access',
    },
    process.env.JWT_SECRET,
    {
      algorithm:  ALLOWED_ALGORITHMS[0],
      expiresIn:  ACCESS_TOKEN_TTL,
    }
  );
}

/**
 * Generate a raw refresh token (256-bit random hex string).
 * Returns both the raw token (sent to client) and its SHA-256 hash (stored in DB).
 */
function generateRefreshToken() {
  const raw  = crypto.randomBytes(32).toString('hex'); // 64 hex chars
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);
  return { raw, hash, expiresAt };
}

/**
 * Short-lived JWT authorizing a password reset after OTP verification.
 */
function generatePasswordResetToken({ userId, email }) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss:  JWT_ISSUER,
      aud:  JWT_AUDIENCE,
      sub:  userId,
      email,
      type: 'password_reset',
      jti:  uuidv4(),
      iat:  now,
      nbf:  now,
    },
    process.env.JWT_SECRET,
    {
      algorithm: ALLOWED_ALGORITHMS[0],
      expiresIn: '15m',
    }
  );
}

/**
 * Verify a password-reset JWT. Returns payload or null.
 */
function verifyPasswordResetToken(token) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ALLOWED_ALGORITHMS,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (payload.type !== 'password_reset') return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Hash a raw refresh token for database lookup.
 */
function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Generate a single-use invite token (raw + hash) with an expiry.
 */
function generateInviteToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL * 1000);
  return { raw, hash, expiresAt };
}

/**
 * Hash an invite token for database lookup.
 */
function hashInviteToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generatePasswordResetToken,
  verifyPasswordResetToken,
  hashRefreshToken,
  generateInviteToken,
  hashInviteToken,
  safeCompare,
  REFRESH_TOKEN_TTL,
};