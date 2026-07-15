/**
 * Revluma Authentication Controller — Sprint 1 Security Hardening
 *
 * Changes from prototype:
 * - JWT tokens now include jti, iss, aud, sub, sid, type, nbf — strict validation
 * - Refresh tokens are 256-bit random values stored as SHA-256 hashes in DB
 * - Token rotation: every refresh invalidates the old token and issues a new one
 * - Reuse detection: using a revoked token revokes the entire token family
 * - Logout: deletes the refresh token from DB — stolen tokens become useless
 * - Logout all devices: deletes ALL refresh tokens for the user
 * - Account lockout: 5 failed attempts = 15 minute lockout per email
 * - All failed login attempts are logged to login_attempts table
 */

const { validationResult } = require('express-validator');
const { generateVerificationCode, getVerificationExpiry } = require('../utils/otp');
const emailService = require('../utils/emailService');
const { generateAccessToken, generateRefreshToken, hashRefreshToken } = require('../utils/tokens');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const dbConfig = require('../configs/database');
const prisma = dbConfig.prisma;

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if an email is currently locked out due to too many failed attempts.
 * Returns { locked: bool, remainingMinutes: number }
 */
async function checkAccountLockout(email) {
  const since = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000);
  const failedCount = await prisma.login_attempts.count({
    where: {
      email: email.toLowerCase(),
      success: false,
      attempted_at: { gte: since },
    },
  });
  if (failedCount >= MAX_LOGIN_ATTEMPTS) {
    return { locked: true, remainingMinutes: LOCKOUT_MINUTES };
  }
  return { locked: false, remainingMinutes: 0 };
}

/**
 * Record a login attempt (success or failure) for rate limiting and audit.
 */
async function recordLoginAttempt(email, success, ipAddress) {
  await prisma.login_attempts.create({
    data: {
      email: email.toLowerCase(),
      ip_address: ipAddress || null,
      success: success,
    },
  }).catch(() => { }); // Never let audit logging crash the auth flow
}

/**
 * Get client IP from request (handles reverse proxy).
 */
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

/**
 * Get device hint from User-Agent for "active sessions" display.
 */
function getDeviceHint(req) {
  const ua = req.headers['user-agent'] || '';
  return ua.slice(0, 200); // Cap to prevent large strings
}

// ─── REGISTER ─────────────────────────────────────────────────────────────────

exports.register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array().map((err) => err.msg),
      });
    }

    const { account, storeSetup, preferences } = req.body;

    const existingUser = await prisma.users.findUnique({
      where: { email: account.email },
    });

    if (existingUser) {
      // If the user has already verified their email, don't allow another registration.
      if (existingUser.email_verified) {
        return res.status(400).json({
          success: false,
          error: 'Email already registered',
        });
      }

      // User exists but unverified — resend verification
      const code = generateVerificationCode();
      const expiry = getVerificationExpiry();

      await prisma.users.update({
        where: { id: existingUser.id },
        data: {
          full_name: `${account.firstName} ${account.lastName}`.trim(),
          password_hash: await bcrypt.hash(account.password, SALT_ROUNDS),
          verification_code: code,
          verification_expires_at: expiry,
          accepted_terms: account.termsAgreed,
          accepted_privacy_policy: account.termsAgreed,
        },
      });

      await emailService.sendVerificationEmail(
        existingUser.email,
        `${account.firstName} ${account.lastName}`.trim(),
        code
      );

      return res.status(200).json({
        success: true,
        message: 'Verification code sent to your email.',
        data: { email: existingUser.email },
      });
    }

    // Create new user + organization in a single transaction
    const hashedPassword = await bcrypt.hash(account.password, SALT_ROUNDS);
    const code = generateVerificationCode();
    const expiry = getVerificationExpiry();

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.users.create({
        data: {
          full_name: `${account.firstName} ${account.lastName}`.trim(),
          email: account.email,
          password_hash: hashedPassword,
          email_verified: false,
          verification_code: code,
          verification_expires_at: expiry,
          accepted_terms: account.termsAgreed,
          accepted_privacy_policy: account.termsAgreed,
        },
      });

      const organization = await tx.organizations.create({
        data: {
          owner_id: user.id,
          company_name: storeSetup.brand_name,
          website_url: storeSetup.storeUrl || null,
          store_url: storeSetup.storeUrl || null,
          industry: storeSetup.storeCategory,
          country: storeSetup.country,
          state_region: storeSetup.state || null,
          monthly_revenue_range: preferences?.monthlyRevenue || null,
        },
      });

      return { user, organization };
    });

    await emailService.sendVerificationEmail(
      result.user.email,
      result.user.full_name,
      code
    );

    return res.status(201).json({
      success: true,
      message: 'Verification code sent to your email.',
      data: { email: result.user.email },
    });

  } catch (error) {
    next(error);
  }
};

// ─── VERIFY EMAIL ─────────────────────────────────────────────────────────────

exports.verifyEmail = async (req, res, next) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        error: 'Email and verification code are required.',
      });
    }

    const user = await prisma.users.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    if (user.email_verified) {
      return res.status(400).json({ success: false, error: 'Email already verified.' });
    }
    if (user.verification_code !== code.trim()) {
      return res.status(400).json({ success: false, error: 'Invalid verification code.' });
    }
    if (!user.verification_expires_at || new Date() > user.verification_expires_at) {
      return res.status(400).json({ success: false, error: 'Verification code has expired.' });
    }

    await prisma.users.update({
      where: { id: user.id },
      data: {
        email_verified: true,
        verification_code: null,
        verification_expires_at: null,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully.',
    });

  } catch (error) {
    next(error);
  }
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────

exports.login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array().map((err) => err.msg),
      });
    }

    const { account } = req.body;
    const ip = getClientIp(req);
    const email = account.email.toLowerCase();

    // ── Account lockout check ─────────────────────────────────────────────────
    const lockout = await checkAccountLockout(email);
    if (lockout.locked) {
      return res.status(429).json({
        success: false,
        error: `Account temporarily locked. Try again in ${lockout.remainingMinutes} minutes.`,
      });
    }

    // ── Find user ─────────────────────────────────────────────────────────────
    const user = await prisma.users.findUnique({ where: { email } });

    if (!user) {
      // Record failed attempt before returning — prevents user enumeration timing
      await recordLoginAttempt(email, false, ip);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // ── Password check ────────────────────────────────────────────────────────
    const isMatch = await bcrypt.compare(account.password, user.password_hash);
    if (!isMatch) {
      await recordLoginAttempt(email, false, ip);

      // Warn if one attempt away from lockout
      const failedCount = await prisma.login_attempts.count({
        where: {
          email: email,
          success: false,
          attempted_at: { gte: new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000) },
        },
      });

      if (failedCount >= MAX_LOGIN_ATTEMPTS - 1) {
        return res.status(401).json({
          success: false,
          error: `Invalid credentials. One more failed attempt will lock your account for ${LOCKOUT_MINUTES} minutes.`,
        });
      }

      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // ── Email verification check ──────────────────────────────────────────────
    if (!user.email_verified) {
      return res.status(403).json({
        success: false,
        error: 'Please verify your email before logging in.',
      });
    }

    // ── Account status check ──────────────────────────────────────────────────
    if (user.status === 'suspended') {
      return res.status(403).json({ success: false, error: 'Account suspended. Contact support.' });
    }
    if (user.status === 'deleted') {
      return res.status(403).json({ success: false, error: 'Account not found.' });
    }

    // ── Get organization ──────────────────────────────────────────────────────
    const organization = await prisma.organizations.findFirst({
      where: { owner_id: user.id },
      select: { id: true },
    });

    // ── Generate tokens ───────────────────────────────────────────────────────
    const sessionId = uuidv4();
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      tenantId: organization?.id || null,
      sessionId: sessionId,
    });

    const { raw: rawRefresh, hash: refreshHash, expiresAt } = generateRefreshToken();
    const familyId = uuidv4(); // New family for this login session

    await prisma.refresh_tokens.create({
      data: {
        user_id: user.id,
        token_hash: refreshHash,
        family_id: familyId,
        device_hint: getDeviceHint(req),
        ip_address: ip,
        expires_at: expiresAt,
        last_used_at: new Date(),
      },
    });

    // Record successful login
    await recordLoginAttempt(email, true, ip);

    // Store Refresh Token as HttpOnly Cookie (raw value — never the hash)
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/",
    };
    res.cookie("refresh_token", rawRefresh, cookieOptions);

    return res.status(200).json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: rawRefresh,
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
        },
      },
    });

  } catch (error) {
    next(error);
  }
};

function getRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  };
}

function readRefreshTokenFromRequest(req) {
  return (
    req.body?.refresh_token ||
    req.cookies?.refresh_token ||
    null
  );
}

// ─── REFRESH TOKEN ────────────────────────────────────────────────────────────

exports.refresh = async (req, res, next) => {
  try {
    const refresh_token = readRefreshTokenFromRequest(req);

    if (!refresh_token) {
      return res.status(400).json({ success: false, error: 'Refresh token required.' });
    }

    const tokenHash = hashRefreshToken(refresh_token);

    // Look up token in DB
    const storedToken = await prisma.refresh_tokens.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!storedToken) {
      return res.status(401).json({ success: false, error: 'Invalid refresh token.' });
    }

    // ── Reuse detection ───────────────────────────────────────────────────────
    // If the token has already been revoked but someone is trying to use it,
    // this means the token was stolen. Revoke the entire family.
    if (storedToken.is_revoked) {
      await prisma.refresh_tokens.updateMany({
        where: { family_id: storedToken.family_id },
        data: { is_revoked: true },
      });
      return res.status(401).json({
        success: false,
        error: 'Token reuse detected. All sessions invalidated. Please log in again.',
      });
    }

    // ── Expiry check ──────────────────────────────────────────────────────────
    if (new Date() > storedToken.expires_at) {
      await prisma.refresh_tokens.delete({ where: { id: storedToken.id } });
      return res.status(401).json({ success: false, error: 'Refresh token expired.' });
    }

    // ── Get user ──────────────────────────────────────────────────────────────
    const user = await prisma.users.findUnique({ where: { id: storedToken.user_id } });

    if (!user || !user.email_verified || user.status !== 'active') {
      await prisma.refresh_tokens.delete({ where: { id: storedToken.id } });
      return res.status(401).json({ success: false, error: 'Account unavailable.' });
    }

    const organization = await prisma.organizations.findFirst({
      where: { owner_id: user.id },
      select: { id: true },
    });

    // ── Rotate tokens ─────────────────────────────────────────────────────────
    // Revoke old token, issue new one in same family
    const { raw: newRawRefresh, hash: newRefreshHash, expiresAt } = generateRefreshToken();

    await prisma.$transaction([
      // Revoke old token
      prisma.refresh_tokens.update({
        where: { id: storedToken.id },
        data: { is_revoked: true },
      }),
      // Create new token in same family
      prisma.refresh_tokens.create({
        data: {
          user_id: user.id,
          token_hash: newRefreshHash,
          family_id: storedToken.family_id, // Same family — maintains reuse detection
          device_hint: storedToken.device_hint,
          ip_address: getClientIp(req),
          expires_at: expiresAt,
          last_used_at: new Date(),
        },
      }),
    ]);

    const sessionId = uuidv4();
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      tenantId: organization?.id || null,
      sessionId: sessionId,
    });

    // Rotate the HttpOnly cookie alongside the body token
    res.cookie("refresh_token", newRawRefresh, {
      ...getRefreshCookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: newRawRefresh,
      },
    });

  } catch (error) {
    next(error);
  }
};

// ─── LOGOUT ───────────────────────────────────────────────────────────────────

/**
 * Logout current session.
 * Accepts refresh token from JSON body or HttpOnly cookie so logout still
 * works when the access token has already expired.
 * Always clears the refresh_token cookie and returns 200 when local cleanup
 * succeeds — clients must never see a 404 from this endpoint.
 */
exports.logout = async (req, res, next) => {
  try {
    const refresh_token = readRefreshTokenFromRequest(req);

    if (refresh_token) {
      const tokenHash = hashRefreshToken(refresh_token);
      const where = { token_hash: tokenHash };
      // If a valid access token identified the user, scope the revoke to them.
      if (req.user?.id) {
        where.user_id = req.user.id;
      }
      await prisma.refresh_tokens.deleteMany({ where }).catch(() => { });
    } else if (req.user?.id) {
      // No refresh token supplied — revoke nothing specific, but still clear cookie.
    }

    res.clearCookie("refresh_token", getRefreshCookieOptions());

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Logout from ALL devices — revokes every refresh token for this user.
 * Used when a user suspects their account has been compromised.
 * Requires a valid access token.
 */
exports.logoutAll = async (req, res, next) => {
  try {
    await prisma.refresh_tokens.deleteMany({
      where: { user_id: req.user.id },
    });

    res.clearCookie("refresh_token", getRefreshCookieOptions());

    return res.status(200).json({
      success: true,
      message: 'Logged out from all devices.',
    });

  } catch (error) {
    next(error);
  }
};

// ─── RESEND VERIFICATION ──────────────────────────────────────────────────────

exports.resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    const user = await prisma.users.findUnique({ where: { email } });

    // Deliberately vague to prevent user enumeration
    if (!user || user.email_verified) {
      return res.status(200).json({
        success: true,
        message: 'If that email exists and is unverified, a new code has been sent.',
      });
    }

    const code = generateVerificationCode();
    const expiry = getVerificationExpiry();

    await prisma.users.update({
      where: { id: user.id },
      data: { verification_code: code, verification_expires_at: expiry },
    });

    await emailService.sendVerificationEmail(user.email, user.full_name, code);

    return res.status(200).json({
      success: true,
      message: 'If that email exists and is unverified, a new code has been sent.',
    });

  } catch (error) {
    next(error);
  }
};

// ─── GET PROFILE ──────────────────────────────────────────────────────────────

exports.getProfile = async (req, res) => {
  try {
    const user = await prisma.users.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        full_name: true,
        email: true,
        email_verified: true,
        onboarding_completed: true,
        status: true,
        created_at: true,
        organizations: {
          select: {
            id: true,
            company_name: true,
            website_url: true,
            store_url: true,
            industry: true,
            country: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    return res.status(200).json({ success: true, data: user });

  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to fetch profile.' });
  }
};
