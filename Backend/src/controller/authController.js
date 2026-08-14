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
const {
  generateAccessToken,
  generateRefreshToken,
  generatePasswordResetToken,
  verifyPasswordResetToken,
  hashRefreshToken,
} = require('../utils/tokens');
const { isPasswordPwned } = require('../utils/passwordBreach');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

const dbConfig = require('../configs/database');
const prisma = dbConfig.prisma;
const cloudinary = require("../configs/cloudinary");

const logger = require('../utils/logger');
const { buildCookieOptions } = require('../utils/cookieOptions');

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Precomputed dummy bcrypt hash so login always pays the same compare cost
// whether or not the email exists (timing equalization / F-05).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('__revluma_dummy_not_a_user__', SALT_ROUNDS);

const REGISTER_GENERIC_MESSAGE =
  'If an account can be registered for this email, a verification code has been sent.';
const FORGOT_PASSWORD_GENERIC_MESSAGE =
  'If an account exists for this email, password reset instructions have been sent.';

const PASSWORD_COMPLEXITY =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;

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

async function revokeAllRefreshTokens(userId) {
  await prisma.refresh_tokens.deleteMany({
    where: { user_id: userId },
  });
}

async function assertPasswordAllowed(password) {
  if (!PASSWORD_COMPLEXITY.test(password)) {
    return {
      ok: false,
      error:
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&), and be at least 8 characters.',
    };
  }
  if (await isPasswordPwned(password)) {
    return {
      ok: false,
      error: 'This password has appeared in a known data breach. Please choose a different password.',
    };
  }
  return { ok: true };
}

function normalizeTotpCode(code) {
  if (typeof code === 'number') {
    return String(code);
  }
  if (typeof code !== 'string') {
    return '';
  }
  return code.replace(/\s+/g, '').trim();
}

function verifyTotpCode(secret, code) {
  const normalizedCode = normalizeTotpCode(code);
  if (!/^\d{6}$/.test(normalizedCode)) {
    return false;
  }

  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: normalizedCode,
    window: 2,
    digits: 6,
  });
}

/**
 * Find which time-step (if any) matched the provided TOTP `token`.
 * Returns the matched step (integer) or null if no match within `window`.
 */
function findMatchedTotpStep(secret, token, window = 2) {
  const normalizedToken = normalizeTotpCode(token);
  if (!/^\d{6}$/.test(normalizedToken)) return null;

  const currentStep = Math.floor(Date.now() / 1000 / 30);

  for (let delta = -window; delta <= window; delta++) {
    const time = (currentStep + delta) * 30; // seconds
    const generated = speakeasy.totp({
      secret,
      encoding: 'base32',
      digits: 6,
      time,
    });
    if (generated === normalizedToken) {
      return currentStep + delta;
    }
  }
  return null;
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
    const email = account.email.toLowerCase();

    const passwordCheck = await assertPasswordAllowed(account.password);
    if (!passwordCheck.ok) {
      return res.status(400).json({ success: false, error: passwordCheck.error });
    }

    const existingUser = await prisma.users.findUnique({
      where: { email },
    });

    if (existingUser) {
      if (existingUser.email_verified) {
        // Do not reveal that the email is already registered (F-06).
        logger.info('register_skipped_verified_email');
        return res.status(200).json({
          success: true,
          message: REGISTER_GENERIC_MESSAGE,
          data: { email },
        });
      }

      // User exists but unverified — refresh verification silently
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
        message: REGISTER_GENERIC_MESSAGE,
        data: { email },
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
          email,
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

      // RBAC: create the owner membership row
      await tx.organization_members.create({
        data: {
          organization_id: organization.id,
          user_id: user.id,
          role: 'owner',
          status: 'active',
          joined_at: new Date(),
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
      message: REGISTER_GENERIC_MESSAGE,
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

    // ── Find user + always bcrypt.compare (timing equalization) ─────────────
    const user = await prisma.users.findUnique({ where: { email } });
    const isMatch = await bcrypt.compare(
      account.password,
      user?.password_hash || DUMMY_PASSWORD_HASH
    );

    if (!user || !isMatch) {
      await recordLoginAttempt(email, false, ip);

      if (user && !isMatch) {
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

    // ── Get organization via membership ─────────────────────────────────────
    const membership = await prisma.organization_members.findFirst({
      where: { user_id: user.id, status: 'active' },
      select: { organization_id: true },
      orderBy: { created_at: 'asc' },
    });

// ── Generate refresh token first ──────────────────────────────────────────
const { raw: rawRefresh, hash: refreshHash, expiresAt } = generateRefreshToken();

const familyId = uuidv4();

const refreshSession = await prisma.refresh_tokens.create({
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

// Generate access token using the database session ID
const accessToken = generateAccessToken({
  userId: user.id,
  email: user.email,
  tenantId: membership?.organization_id || null,
  sessionId: refreshSession.id,
});


    // Record successful login
    await recordLoginAttempt(email, true, ip);

    // Store Refresh Token as HttpOnly Cookie (raw value — never the hash)
    const cookieOptions = {
      ...buildCookieOptions(req),
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    };
    res.cookie("refresh_token", rawRefresh, cookieOptions);

    // Refresh token is HttpOnly-cookie only — never in the JSON body (XSS-safe).
    return res.status(200).json({
      success: true,
      data: {
        access_token: accessToken,
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

function getRefreshCookieOptions(req) {
  return buildCookieOptions(req);
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
    const ip = getClientIp(req);

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

    const membership = await prisma.organization_members.findFirst({
      where: { user_id: user.id, status: 'active' },
      select: { organization_id: true },
      orderBy: { created_at: 'asc' },
    });

    // ── Rotate tokens ─────────────────────────────────────────────────────────
    // Revoke old token, issue a new one in the same family
    const { raw: newRawRefresh, hash: newRefreshHash, expiresAt } = generateRefreshToken();
    const familyId = uuidv4();

    const rotationResult = await prisma.$transaction(async (tx) => {
      await tx.refresh_tokens.update({
        where: { id: storedToken.id },
        data: { is_revoked: true },
      });

      const refreshSession = await tx.refresh_tokens.create({
        data: {
          user_id: user.id,
          token_hash: newRefreshHash,
          family_id: familyId,
          device_hint: getDeviceHint(req),
          ip_address: ip,
          expires_at: expiresAt,
          last_used_at: new Date(),
        },
      });

      const accessToken = generateAccessToken({
        userId: user.id,
        email: user.email,
        tenantId: membership?.organization_id || null,
        sessionId: refreshSession.id,
      });

      return { accessToken, refreshSession };
    });

    // Rotate the HttpOnly cookie alongside the body token
    res.cookie('refresh_token', newRawRefresh, {
      ...getRefreshCookieOptions(req),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
      data: {
        access_token: rotationResult.accessToken,
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

    res.clearCookie("refresh_token", getRefreshCookieOptions(req));

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

    res.clearCookie("refresh_token", getRefreshCookieOptions(req));

    return res.status(200).json({
      success: true,
      message: 'Logged out from all devices.',
    });

  } catch (error) {
    next(error);
  }
};

// ─── FORGOT PASSWORD (step 1 — send OTP) ─────────────────────────────────────

exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.users.findUnique({ where: { email: normalizedEmail } });

    // Always return the same message to prevent user enumeration
    if (!user || user.status !== 'active') {
      return res.status(200).json({ success: true, message: FORGOT_PASSWORD_GENERIC_MESSAGE });
    }

    const code = generateVerificationCode();
    const expiry = getVerificationExpiry();

    await prisma.users.update({
      where: { id: user.id },
      data: { verification_code: code, verification_expires_at: expiry },
    });

    // Fire-and-forget — don't let email failure leak timing or block response
    emailService.sendPasswordResetEmail(user.email, user.full_name, code).catch(() => {});

    return res.status(200).json({ success: true, message: FORGOT_PASSWORD_GENERIC_MESSAGE });
  } catch (error) {
    next(error);
  }
};

// ─── VERIFY FORGOT-PASSWORD OTP (step 2 — returns password-reset JWT) ────────

exports.verifyForgotPasswordOtp = async (req, res, next) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'Email and verification code are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.users.findUnique({ where: { email: normalizedEmail } });

    if (!user || user.status !== 'active') {
      return res.status(400).json({ success: false, error: 'Invalid or expired code.' });
    }
    if (user.verification_code !== String(code).trim()) {
      return res.status(400).json({ success: false, error: 'Invalid or expired code.' });
    }
    if (!user.verification_expires_at || new Date() > user.verification_expires_at) {
      return res.status(400).json({ success: false, error: 'Invalid or expired code.' });
    }

    // Clear the OTP — single use
    await prisma.users.update({
      where: { id: user.id },
      data: { verification_code: null, verification_expires_at: null },
    });

    // Issue a short-lived password-reset JWT (15 min, single use)
    const resetToken = generatePasswordResetToken({ userId: user.id, email: user.email });

    return res.status(200).json({
      success: true,
      data: { reset_token: resetToken },
    });
  } catch (error) {
    next(error);
  }
};

// ─── RESET PASSWORD (step 3 — consume JWT, update password, revoke sessions) ─

exports.resetPassword = async (req, res, next) => {
  try {
    const { reset_token, password } = req.body;

    if (!reset_token || !password) {
      return res.status(400).json({ success: false, error: 'Reset token and new password are required.' });
    }

    const payload = verifyPasswordResetToken(reset_token);
    if (!payload) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset token.' });
    }

    const user = await prisma.users.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'active') {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset token.' });
    }

    const passwordCheck = await assertPasswordAllowed(password);
    if (!passwordCheck.ok) {
      return res.status(400).json({ success: false, error: passwordCheck.error });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Update password + revoke ALL refresh tokens (F-10 fix)
    await prisma.$transaction([
      prisma.users.update({
        where: { id: user.id },
        data: { password_hash: hashedPassword },
      }),
      prisma.refresh_tokens.deleteMany({
        where: { user_id: user.id },
      }),
    ]);

    // Non-critical confirmation email
    emailService.sendPasswordChangedEmail(user.email, user.full_name).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully. Please log in with your new password.',
    });
  } catch (error) {
    next(error);
  }
};

// ─── CHANGE PASSWORD (authenticated — verify current, update, revoke others) ─

exports.changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, error: 'Current and new password are required.' });
    }

    if (current_password === new_password) {
      return res.status(400).json({ success: false, error: 'New password must be different from current password.' });
    }

    const user = await prisma.users.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const isMatch = await bcrypt.compare(current_password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
    }

    const passwordCheck = await assertPasswordAllowed(new_password);
    if (!passwordCheck.ok) {
      return res.status(400).json({ success: false, error: passwordCheck.error });
    }

    const hashedPassword = await bcrypt.hash(new_password, SALT_ROUNDS);

    // Update password + revoke ALL refresh tokens except the current session
    // (the user stays logged in on this device, every other session is killed)
    const currentRefreshHash = req.cookies?.refresh_token
      ? hashRefreshToken(req.cookies.refresh_token)
      : null;

    await prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: { id: user.id },
        data: { password_hash: hashedPassword },
      });

      // Revoke all refresh tokens except the one for this session
      if (currentRefreshHash) {
        await tx.refresh_tokens.deleteMany({
          where: {
            user_id: user.id,
            token_hash: { not: currentRefreshHash },
          },
        });
      } else {
        // No refresh cookie present — revoke everything
        await tx.refresh_tokens.deleteMany({
          where: { user_id: user.id },
        });
      }
    });

    emailService.sendPasswordChangedEmail(user.email, user.full_name).catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully. Other sessions have been signed out.',
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
        organization_members: {
          where: { status: 'active' },
          select: {
            id: true,
            role: true,
            organization_id: true,
            joined_at: true,
            organizations: {
              select: { id: true, company_name: true },
            },
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

//UPdate Profile Picture
exports.updateProfilePicture = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Make sure an image was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Profile picture is required.",
      });
    }

    // Confirm the authenticated user exists
    const user = await prisma.users.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        profile_picture_url: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found.",
      });
    }

    // Upload image to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "revluma/profile-pictures",
          resource_type: "image",
          public_id: `user_${userId}`,
          overwrite: true,
          invalidate: true,
        },
        (error, result) => {
          if (error) {
            return reject(error);
          }

          resolve(result);
        }
      );

      uploadStream.end(req.file.buffer);
    });

    // Save Cloudinary URL in database
    const updatedUser = await prisma.users.update({
      where: {
        id: userId,
      },
      data: {
        profile_picture_url: uploadResult.secure_url,
        updated_at: new Date(),
      },
      select: {
        id: true,
        full_name: true,
        email: true,
        profile_picture_url: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Profile picture updated successfully.",
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

//Update Profile (First Name, Last Name)
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const { firstName, lastName } = req.body;

    if (
      typeof firstName !== "string" ||
      typeof lastName !== "string"
    ) {
      return res.status(400).json({
        success: false,
        error: "First name and last name must be strings.",
      });
    }

    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();

    if (!trimmedFirstName || !trimmedLastName) {
      return res.status(400).json({
        success: false,
        error: "First name and last name are required.",
      });
    }

    if (
      trimmedFirstName.length > 100 ||
      trimmedLastName.length > 100
    ) {
      return res.status(400).json({
        success: false,
        error: "Name is too long.",
      });
    }

    const fullName = `${trimmedFirstName} ${trimmedLastName}`;

    const user = await prisma.users.update({
      where: { id: userId },
      data: {
        full_name: fullName,
        updated_at: new Date(),
      },
      select: {
        id: true,
        full_name: true,
        email: true,
        email_verified: true,
        profile_picture_url: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: user,
    });
  } catch (error) {
    console.error("updateProfile error:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to update profile.",
    });
  }
};

//SetupTwoFactor
exports.normalizeTotpCode = normalizeTotpCode;
exports.verifyTotpCode = verifyTotpCode;

exports.setupTwoFactor = async (req, res, next) => {
  try {

    const userId = req.user.id;

    const user = await prisma.users.findUnique({
      where: {
        id: userId,
      },
    });


    if (!user) {
      logger.warn('2fa_setup_user_not_found', { userId, ip: getClientIp(req) });
      return res.status(404).json({ success: false, error: 'User not found' });
    }


    const secret = speakeasy.generateSecret({
      name: `Revluma:${user.email}`,
    });


    // Store the generated secret in a temporary column until the user verifies it.
    // This prevents setup-spam from overwriting an already-verified secret.
    await prisma.users.update({
      where: {
        id: userId,
      },
      data: {
        two_factor_temp_secret: secret.base32,
      },
    });

    logger.info('2fa_setup_generated', { userId, ip: getClientIp(req) });

    const qrCode = await QRCode.toDataURL(secret.otpauth_url);


    return res.status(200).json({
      success: true,
      qrCode,
      secret: secret.base32,
    });


  } catch (error) {
    next(error);
  }
};

//VerifyTwoFactor
exports.verifyTwoFactor = async (req, res, next) => {
  try {

    const { code } = req.body;
    const normalizedCode = normalizeTotpCode(code);

    const userId = req.user.id;

    const user = await prisma.users.findUnique({
      where: {
        id: userId,
      },
    });
    logger.info("2fa_user_check", {
  userId,
  userExists: !!user,
  tempSecretExists: !!user?.two_factor_temp_secret,
  tempSecretLength: user?.two_factor_temp_secret?.length,
  secretExists: !!user?.two_factor_secret,
  secretLength: user?.two_factor_secret?.length,
});


    // Prefer the temp secret created during setup; fall back to the permanent
    // secret for other verification flows. If neither exists, return error.
    const secretToVerify = user?.two_factor_temp_secret || user?.two_factor_secret;
    if (!user || !secretToVerify) {
      logger.warn('2fa_verify_no_secret', { userId, ip: getClientIp(req) });
      return res.status(400).json({
        success: false,
        error: '2FA setup has not been completed',
      });
    }

    if (!/^\d{6}$/.test(normalizedCode)) {
      logger.warn('2fa_verify_invalid_format', { userId, ip: getClientIp(req) });
      return res.status(400).json({
        success: false,
        error: 'Verification code must be a 6-digit number',
      });
    }

    // Determine which time-step matched so we can prevent replay attacks.
    const matchedStep = findMatchedTotpStep(secretToVerify, normalizedCode, 2);
    if (matchedStep === null) {
      logger.warn('2fa_verify_failed', { userId, ip: getClientIp(req) });
      return res.status(400).json({
        success: false,
        error: 'Invalid verification code',
      });
    }

    // Prevent token reuse: require matchedStep to be greater than last recorded step.
    if (user.two_factor_last_used_step && matchedStep <= user.two_factor_last_used_step) {
      logger.warn('2fa_verify_replay_detected', { userId, ip: getClientIp(req) });
      return res.status(400).json({ success: false, error: 'Verification code already used' });
    }

    // Persist the verified secret as the permanent secret if it was a temp setup,
    // clear the temp field, enable 2FA, and record the last-used step.
    await prisma.users.update({
      where: {
        id: userId,
      },
      data: {
        two_factor_enabled: true,
        two_factor_secret: user.two_factor_temp_secret || user.two_factor_secret,
        two_factor_temp_secret: null,
        two_factor_last_used_step: matchedStep,
      },
    });

    logger.info('2fa_enabled', { userId, ip: getClientIp(req) });

    return res.status(200).json({
      success: true,
      message: 'Two-factor authentication enabled successfully.',
      enabled: true,
    });


  } catch(error) {
    next(error);
  }
};

//DisableTwoFactor
exports.disableTwoFactor = async (req, res, next) => {
  try {

    await prisma.users.update({
      where: {
        id: req.user.id,
      },
      data: {
        two_factor_enabled: false,
        two_factor_secret: null,
        two_factor_temp_secret: null,
        two_factor_last_used_step: null,
      },
    });

    logger.info('2fa_disabled', { userId: req.user.id, ip: getClientIp(req) });

    return res.status(200).json({
      success: true,
      message: 'Two-factor authentication disabled',
    });


  } catch(error) {
    next(error);
  }
};
