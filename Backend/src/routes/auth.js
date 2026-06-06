const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../services/prisma');
const logger = require('../utils/logger');
const { authenticatePending, createPendingToken } = require('../middleware/pendingAuth');
const { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/messaging');
const { redis: redisConnection } = require('../queue/redis');
const { validatePasswordStrength, validateEmail, normalizeEmail, checkPasswordHistory } = require('../lib/auth-utils');
const { authenticate, invalidateAllUserSessions } = require('../middleware/sessionAuth');

const router = express.Router();

const VERIFICATION_CODE_EXPIRY_MINUTES = 15;
const PENDING_REGISTRATION_TTL_HOURS = 24;
const LOCKOUT_WINDOW_SECONDS = 15 * 60;
const MAX_RESET_CODE_ATTEMPTS = 5;
const MAX_RESET_PASSWORD_ATTEMPTS = 5;
const MAX_VERIFY_EMAIL_ATTEMPTS = 5;
const PASSWORD_HISTORY_LOOKBACK = 5;

// FIX A-09: Rate limit on resend-verification (3 per 10 minutes per IP)
const resendVerificationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: { error: 'Too many verification code requests. Please wait 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

function getCorrelationId(req) {
  return req.headers['x-correlation-id'] || uuidv4().slice(0, 8);
}

function sendAuthError(res, statusCode, error, code = null, correlationId = null, detail = null) {
  const payload = { error };
  if (code) payload.code = code;
  if (correlationId) payload.correlationId = correlationId;
  if (detail) payload.detail = detail;
  return res.status(statusCode).json(payload);
}

function buildPendingProfileData(onboardingData) {
  return {
    industry: onboardingData.industry || 'general',
    businessModel: onboardingData.businessModel || null,
    targetMarket: onboardingData.targetMarket || null,
    aov: onboardingData.aov || null,
    purchaseFrequency: onboardingData.purchaseFrequency || null,
    salesChannels: onboardingData.salesChannels || null,
    paymentMethods: onboardingData.paymentMethods || null,
    teamSize: onboardingData.teamSize || null,
    inventorySize: onboardingData.inventorySize || null,
    fulfillmentSpeed: onboardingData.fulfillmentSpeed || null,
    growthGoals: onboardingData.growthGoals || null,
    brandTone: onboardingData.brandTone || null,
    maturityScore: onboardingData.maturityScore || 0,
    preferredChannel: onboardingData.preferredRecoveryChannel || onboardingData.preferredChannel || 'whatsapp',
    touch1Delay: onboardingData.touch1Delay || 15,
    touch2Delay: onboardingData.touch2Delay || 90,
    discountThreshold: onboardingData.discountThreshold || 0.1,
    platform: onboardingData.platform || null,
    storeUrl: onboardingData.storeUrl || null,
    monthlyTraffic: onboardingData.monthlyTraffic || null,
    monthlyRevenue: onboardingData.monthlyRevenue || null,
    goals: onboardingData.goals || null,
    preferredRecoveryChannel: onboardingData.preferredRecoveryChannel || null
  };
}

async function cleanupUnverifiedUser(email) {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await prisma.user.findFirst({
      where: { email: normalizedEmail, emailVerified: false }
    });
    if (!existingUser) return;
    try {
      await prisma.tenant.delete({ where: { id: existingUser.tenantId } });
      logger.info('Removed stale unverified user and tenant', {
        email: normalizedEmail, userId: existingUser.id, tenantId: existingUser.tenantId
      });
    } catch (tenantErr) {
      logger.warn('Could not delete tenant during cleanup', {
        email: normalizedEmail, tenantId: existingUser.tenantId, error: tenantErr.message
      });
    }
  } catch (err) {
    logger.warn('Error during unverified user cleanup', { email, error: err.message });
  }
}

async function bumpLockoutAttempt(key, maxAttempts, windowSeconds) {
  try {
    if (!redisConnection) return { locked: false, attempts: 0, ttlSeconds: null };
    const current = await redisConnection.incr(key);
    if (current === 1) await redisConnection.expire(key, windowSeconds);
    const ttlSeconds = await redisConnection.ttl(key);
    return { locked: current >= maxAttempts, attempts: current, ttlSeconds: ttlSeconds > 0 ? ttlSeconds : null };
  } catch (error) {
    logger.warn('Lockout attempt bump failed', { error: error.message, key });
    return { locked: false, attempts: 0, ttlSeconds: null };
  }
}

async function isLockedOut(key, maxAttempts) {
  try {
    if (!redisConnection) return false;
    const currentRaw = await redisConnection.get(key);
    return parseInt(currentRaw || '0', 10) >= maxAttempts;
  } catch (error) {
    logger.warn('Lockout check failed', { error: error.message, key });
    return false;
  }
}

// Health check
router.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', database: 'disconnected', error: err.message });
  }
});

// REGISTER — Step 1: deferred account creation in pending_registrations
router.post('/register', async (req, res) => {
  const correlationId = getCorrelationId(req);
  res.setHeader('X-Correlation-ID', correlationId);

  const { email, password, first_name, last_name, firstName, lastName, full_name, fullName } = req.body;

  let resolvedFirstName = (first_name || firstName || '').trim();
  let resolvedLastName  = (last_name  || lastName  || '').trim();
  const fullNameValue   = (full_name  || fullName  || '').trim();
  const rawEmail        = (email || '').trim();

  if ((!resolvedFirstName || !resolvedLastName) && fullNameValue.length > 0) {
    const nameParts = fullNameValue.split(/\s+/).filter(p => p.length > 0);
    if (nameParts.length >= 2) {
      resolvedFirstName = resolvedFirstName || nameParts[0];
      resolvedLastName  = resolvedLastName  || nameParts.slice(1).join(' ');
    } else if (nameParts.length === 1) {
      resolvedFirstName = resolvedFirstName || nameParts[0];
    }
  }

  const missingFields = [];
  if (!rawEmail)            missingFields.push('email address');
  if (!password)            missingFields.push('password');
  if (!resolvedFirstName)   missingFields.push('first name');
  if (!resolvedLastName)    missingFields.push('last name');

  if (missingFields.length > 0) {
    const fieldText = missingFields.length === 1
      ? missingFields[0]
      : `${missingFields.slice(0, -1).join(', ')} and ${missingFields.slice(-1)}`;
    return res.status(400).json({ error: `Please provide ${fieldText}.`, correlationId });
  }

  if (!validateEmail(rawEmail)) {
    return res.status(400).json({ error: 'Please provide a valid email address.', correlationId });
  }

  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.valid) {
    return res.status(400).json({ error: passwordValidation.error, correlationId });
  }

  if (resolvedFirstName.length > 100 || resolvedLastName.length > 100) {
    return res.status(400).json({ error: 'Name is too long.', correlationId });
  }

  const normalizedEmail = rawEmail.toLowerCase();

  logger.info('Starting registration process', { email: normalizedEmail, correlationId, firstName: resolvedFirstName });

  try {
    await cleanupUnverifiedUser(normalizedEmail);

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      logger.warn('Registration attempt with existing email', { email: normalizedEmail, correlationId });
      return res.status(409).json({ error: 'Email already in use', correlationId });
    }

    const existingPending = await prisma.pendingRegistration.findUnique({ where: { email_accountType: { email: normalizedEmail, accountType: 'USER' } } });

    if (existingPending && !existingPending.emailVerified && new Date(existingPending.expiresAt) > new Date()) {
      logger.info('Existing valid pending registration found, resending code', { email: normalizedEmail, correlationId });
      try {
        const otp = crypto.randomInt(100000, 999999).toString();
        const verificationCodeHash = await bcrypt.hash(otp, 12);
        const verificationExpiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000);

        await prisma.pendingRegistration.update({
          where: { email_accountType: { email: normalizedEmail, accountType: 'USER' } },
          data: {
            verificationCodeHash,
            verificationExpiresAt,
            verificationAttempts: 0,
            updatedAt: new Date()
          }
        });

        await sendVerificationEmail(normalizedEmail, otp, resolvedFirstName);
        const pendingToken = createPendingToken(existingPending.id, normalizedEmail);

        return res.status(201).json({
          message: 'Verification code sent. Please check your email.',
          pendingRegistrationId: existingPending.id,
          pendingToken,
          expiresAt: existingPending.expiresAt,
          correlationId
        });
      } catch (emailErr) {
        logger.error('Failed to resend verification email', { error: emailErr.message, email: normalizedEmail, correlationId });
        return res.status(502).json({ error: 'Unable to send verification email. Please try again later.', correlationId });
      }
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);
    const otp = crypto.randomInt(100000, 999999).toString();
    const verificationCodeHash = await bcrypt.hash(otp, 12);
    const verificationExpiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000);
    const expiresAt = new Date(Date.now() + PENDING_REGISTRATION_TTL_HOURS * 60 * 60 * 1000);

    const pendingRegistration = await prisma.pendingRegistration.upsert({
      where: { email_accountType: { email: normalizedEmail, accountType: 'USER' } },
      update: {
        firstName: resolvedFirstName, lastName: resolvedLastName,
        passwordHash, verificationCodeHash, verificationExpiresAt,
        emailVerified: false, emailVerifiedAt: null,
        verificationAttempts: 0,
        expiresAt, onboardingData: {}, step: 1, updatedAt: new Date()
      },
      create: {
        accountType: 'USER',
        email: normalizedEmail, firstName: resolvedFirstName, lastName: resolvedLastName,
        passwordHash, verificationCodeHash, verificationExpiresAt,
        verificationAttempts: 0,
        expiresAt, onboardingData: {}, step: 1
      }
    });

    try {
      await sendVerificationEmail(normalizedEmail, otp, resolvedFirstName);
    } catch (emailErr) {
      logger.error('Failed to send verification email', { error: emailErr.message, email: normalizedEmail, correlationId });
      return res.status(502).json({ error: 'Unable to send verification email. Please try again later.', correlationId });
    }

    const pendingToken = createPendingToken(pendingRegistration.id, normalizedEmail);

    logger.info('Registration completed successfully', { email: normalizedEmail, pendingRegistrationId: pendingRegistration.id, correlationId });

    res.status(201).json({
      message: 'Verification code sent. Please check your email.',
      pendingRegistrationId: pendingRegistration.id,
      pendingToken,
      expiresAt: pendingRegistration.expiresAt,
      correlationId
    });
  } catch (err) {
    const errorContext = {
      error: err.message, stack: err.stack, email: normalizedEmail,
      correlationId, code: err.code, meta: err.meta, timestamp: new Date().toISOString()
    };

    if (err.code === 'P2002' || err.code === '23505') {
      logger.warn('Pending registration email conflict', errorContext);
      return res.status(409).json({ error: 'Email already in use', correlationId });
    }
    if (err.code === 'P1001' || err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      logger.error('Database connection failed during registration', errorContext);
      return res.status(503).json({ error: 'Service temporarily unavailable. Please try again in a moment.', correlationId });
    }
    if (err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
      logger.error('Database timeout during registration', errorContext);
      return res.status(504).json({ error: 'Request timeout. Please try again.', correlationId });
    }

    logger.error('Pending registration failed', errorContext);
    res.status(500).json({ error: 'Internal server error', correlationId });
  }
});

// SEND EMAIL VERIFICATION CODE — FIX A-03: hash OTP before storing + FIX A-09: rate limited
router.post('/send-verification', resendVerificationLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string' || !validateEmail(email)) {
    return res.status(400).json({ error: 'Valid email address is required' });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(200).json({ message: 'If that email exists, a verification code has been sent' });
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000);

    // FIX A-03: Invalidate prior codes
    await prisma.emailVerificationCode.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true }
    });

    // FIX A-03: Hash OTP with SHA-256 before storing (fast, appropriate for short-lived OTPs)
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    await prisma.emailVerificationCode.create({
      data: { userId: user.id, email: normalizedEmail, code: codeHash, expiresAt }
    });

    const emailSent = await sendVerificationEmail(normalizedEmail, code, user.fullName || 'there');
    if (!emailSent) throw new Error('Verification email was not accepted by the mail provider');

    logger.info('Verification code sent', { email: normalizedEmail, userId: user.id });
    res.status(200).json({ message: 'Verification code sent to your email' });
  } catch (err) {
    logger.error('Failed to send verification code', { error: err.message, email: normalizedEmail });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// VERIFY EMAIL CODE (pending registration flow)
// FIX A-02: Add attempt counter + lockout on OTP verification
router.post('/verify-email', authenticatePending, async (req, res) => {
  const { code } = req.body;
  const { id: pendingId } = req.pending;

  if (!code) return res.status(400).json({ error: 'Verification code is required' });

  try {
    const pending = await prisma.pendingRegistration.findUnique({ where: { id: pendingId } });
    if (!pending) return res.status(404).json({ error: 'Pending registration not found' });
    if (pending.emailVerified) return res.status(200).json({ message: 'Email already verified', verified: true });
    if (new Date(pending.verificationExpiresAt) < new Date()) {
      return res.status(400).json({ error: 'Verification code expired. Please request a new code.' });
    }

    // FIX A-02: Brute-force protection — lock after MAX_VERIFY_EMAIL_ATTEMPTS failures
    const attempts = pending.verificationAttempts || 0;
    if (attempts >= MAX_VERIFY_EMAIL_ATTEMPTS) {
      return res.status(429).json({
        error: 'Too many failed attempts. Please request a new verification code.',
        code: 'TOO_MANY_ATTEMPTS'
      });
    }

    const isValidCode = await bcrypt.compare(code, pending.verificationCodeHash);
    if (!isValidCode) {
      // Increment attempt counter
      await prisma.pendingRegistration.update({
        where: { id: pendingId },
        data: { verificationAttempts: { increment: 1 }, updatedAt: new Date() }
      });
      const remaining = MAX_VERIFY_EMAIL_ATTEMPTS - (attempts + 1);
      return res.status(400).json({
        error: remaining > 0
          ? `Invalid verification code. ${remaining} attempt(s) remaining.`
          : 'Invalid verification code. Please request a new code.',
        attemptsRemaining: Math.max(0, remaining)
      });
    }

    await prisma.pendingRegistration.update({
      where: { id: pendingId },
      data: { emailVerified: true, emailVerifiedAt: new Date(), step: 6, verificationAttempts: 0, updatedAt: new Date() }
    });

    logger.info('Pending registration email verified', { pendingId, email: pending.email });
    res.status(200).json({ message: 'Email verified successfully', verified: true });
  } catch (err) {
    logger.error('Email verification failed', { error: err.message, pendingId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// COMPLETE REGISTRATION — creates the actual User + Tenant from a verified pending registration
router.post('/complete-registration', authenticatePending, async (req, res) => {
  const { id: pendingId } = req.pending;
  const onboardingData = req.body.onboardingData || {};
  const correlationId = getCorrelationId(req);

  try {
    const pending = await prisma.pendingRegistration.findUnique({ where: { id: pendingId } });
    if (!pending) return res.status(404).json({ error: 'Pending registration not found', correlationId });
    if (!pending.emailVerified) {
      return res.status(403).json({ error: 'Email must be verified before completing registration', correlationId });
    }
    if (new Date(pending.expiresAt) < new Date()) {
      return res.status(410).json({ error: 'Registration session has expired. Please start over.', correlationId });
    }

    const existingUser = await prisma.user.findUnique({ where: { email: pending.email } });
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists', correlationId });
    }

    const profileData = buildPendingProfileData(onboardingData);

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          id: uuidv4(),
          storeName: `${pending.firstName}'s Store`,
          industry: profileData.industry || 'general',
          onboardingStatus: 'pending'
        }
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: pending.email,
          passwordHash: pending.passwordHash,
          fullName: `${pending.firstName} ${pending.lastName}`,
          onboardingStatus: 'pending',
          emailVerified: true,
          emailVerifiedAt: pending.emailVerifiedAt,
          failedLoginAttempts: 0
        }
      });

      await tx.tenantProfile.create({
        data: { tenantId: tenant.id, ...profileData }
      });

      await tx.passwordHistory.create({
        data: { userId: user.id, passwordHash: pending.passwordHash }
      });

      await tx.pendingRegistration.delete({ where: { id: pendingId } });

      return { tenant, user };
    });

    try {
      await sendWelcomeEmail(result.user.email, result.user.fullName);
    } catch (emailErr) {
      logger.warn('Welcome email failed (non-blocking)', { error: emailErr.message, userId: result.user.id });
    }

    logger.info('Registration completed', {
      userId: result.user.id, tenantId: result.tenant.id, email: result.user.email, correlationId
    });

    res.status(201).json({
      message: 'Account created successfully. Please log in.',
      userId: result.user.id,
      correlationId
    });
  } catch (err) {
    logger.error('Complete registration failed', { error: err.message, pendingId, correlationId });
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'An account with this email already exists', correlationId });
    }
    res.status(500).json({ error: 'Internal server error', correlationId });
  }
});

// REQUEST PASSWORD RESET
// FIX A-01: Remove `token` from response body
// FIX A-11: Use SHA-256 for OTP hash (fast; OTP is already high-entropy and short-lived)
// FIX: Invalidate all previous open reset tokens before creating a new one
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email || !validateEmail(email)) {
    return res.status(400).json({ error: 'Valid email address required' });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(200).json({ message: 'If that email exists, a reset code has been sent' });
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const token = crypto.randomBytes(32).toString('hex');

    // FIX A-11: SHA-256 is sufficient for short-lived OTPs (no need for bcrypt cost)
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // FIX: Invalidate all previous open reset tokens for this user
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() }
    });

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id, token, code: codeHash, expiresAt,
        ipAddress: req.ip, userAgent: req.headers['user-agent']
      }
    });

    await sendPasswordResetEmail(normalizedEmail, code, user.fullName || 'there');

    logger.info('Password reset requested', { email: normalizedEmail, userId: user.id });

    // FIX A-01: Do NOT return `token` in the response — it must arrive via email only
    res.status(200).json({ message: 'If that email exists, a reset code has been sent' });
  } catch (err) {
    logger.error('Forgot password failed', { error: err.message, email: normalizedEmail });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// RESET PASSWORD
// FIX A-11: Compare with SHA-256 (matching the new storage format)
router.post('/reset-password', async (req, res) => {
  const { token, code, newPassword } = req.body;

  if (!token || !code || !newPassword) {
    return res.status(400).json({ error: 'Token, code, and new password are required' });
  }

  const passwordValidation = validatePasswordStrength(newPassword);
  if (!passwordValidation.valid) {
    return res.status(400).json({ error: passwordValidation.error });
  }

  try {
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true }
    });

    if (!resetToken || resetToken.usedAt || new Date(resetToken.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // FIX A-11: Compare with SHA-256 (constant-time)
    const providedHash = crypto.createHash('sha256').update(code).digest('hex');
    let isValidCode = false;
    try {
      isValidCode = crypto.timingSafeEqual(
        Buffer.from(providedHash, 'hex'),
        Buffer.from(resetToken.code, 'hex')
      );
    } catch {
      isValidCode = false;
    }

    if (!isValidCode) {
      return res.status(400).json({ error: 'Invalid reset code' });
    }

    const historyCheck = await checkPasswordHistory(prisma, resetToken.userId, newPassword, bcrypt, logger);
    if (!historyCheck.valid) {
      return res.status(400).json({ error: historyCheck.error });
    }

    const salt = await bcrypt.genSalt(12);
    const newHash = await bcrypt.hash(newPassword, salt);

    await prisma.$transaction([
      prisma.passwordResetToken.update({ where: { token }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash: newHash, failedLoginAttempts: 0, lockedUntil: null } }),
      prisma.passwordHistory.create({ data: { userId: resetToken.userId, passwordHash: newHash } })
    ]);

    logger.info('Password reset successful', { userId: resetToken.userId });
    res.status(200).json({ message: 'Password reset successful. Please log in with your new password.' });
  } catch (err) {
    logger.error('Reset password failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// CHANGE PASSWORD — authenticated users (both regular and affiliate)
// ============================================================

const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many password change attempts. Please wait 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * POST /api/auth/change-password
 * Allows an authenticated user to change their own password.
 *
 * Security properties:
 *  - Requires a valid session (authenticate middleware)
 *  - Verifies current password before accepting the new one
 *  - Enforces password strength policy
 *  - Blocks reuse of the last PASSWORD_HISTORY_LOOKBACK passwords (password history check)
 *  - Hashes with bcrypt cost 12
 *  - Invalidates ALL user sessions after change (force re-login everywhere)
 *  - Rate-limited to 5 attempts per 15 minutes per IP
 */
router.post('/change-password', changePasswordLimiter, authenticate, async (req, res) => {
  const userId = req.user?.id;
  const tenantId = req.user?.tenantId;

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
  }

  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      error: 'currentPassword and newPassword are required',
      code: 'VALIDATION_ERROR'
    });
  }

  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Invalid input', code: 'VALIDATION_ERROR' });
  }

  // Reject if new password is identical to current (before hitting the full history check)
  if (currentPassword === newPassword) {
    return res.status(400).json({
      error: 'New password must be different from your current password.',
      code: 'PASSWORD_UNCHANGED'
    });
  }

  // Strength policy
  const strengthCheck = validatePasswordStrength(newPassword);
  if (!strengthCheck.valid) {
    return res.status(400).json({ error: strengthCheck.error, code: 'WEAK_PASSWORD' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tenantId: true, passwordHash: true, failedLoginAttempts: true, lockedUntil: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    }

    // Verify current password
    const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      logger.warn('change-password: incorrect current password', { userId });
      return res.status(401).json({
        error: 'Current password is incorrect.',
        code: 'INVALID_CURRENT_PASSWORD'
      });
    }

    // Password re-use check — blocks the last PASSWORD_HISTORY_LOOKBACK passwords
    const historyCheck = await checkPasswordHistory(prisma, userId, newPassword, bcrypt, logger);
    if (!historyCheck.valid) {
      return res.status(400).json({ error: historyCheck.error, code: 'PASSWORD_REUSED' });
    }

    // Hash new password (cost 12, consistent with the rest of the codebase)
    const newHash = await bcrypt.hash(newPassword, 12);

    // Atomically: update password, reset lockout, record history
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: newHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date()
        }
      }),
      prisma.passwordHistory.create({
        data: { userId, passwordHash: newHash }
      })
    ]);

    // Invalidate all active sessions — user must re-authenticate after changing password
    try {
      const count = await invalidateAllUserSessions(userId, tenantId || user.tenantId);
      logger.info('change-password: sessions invalidated', { userId, count });
    } catch (sessionErr) {
      // Non-fatal: password is already changed, log but don't fail the request
      logger.error('change-password: failed to invalidate sessions', {
        error: sessionErr.message, userId
      });
    }

    logger.info('Password changed successfully', { userId });

    return res.status(200).json({
      message: 'Password changed successfully. Please log in again with your new password.',
      sessionInvalidated: true
    });
  } catch (err) {
    logger.error('change-password failed', { error: err.message, userId });
    return res.status(500).json({ error: 'Internal server error', code: 'SERVER_ERROR' });
  }
});

module.exports = router;