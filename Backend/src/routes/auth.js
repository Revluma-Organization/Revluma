const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../services/prisma');
const logger = require('../utils/logger');
const { authenticatePending, createPendingToken } = require('../middleware/pendingAuth');
const { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/messaging');
const { redis: redisConnection } = require('../queue/redis');
const { validatePasswordStrength, validateEmail, normalizeEmail, checkPasswordHistory } = require('../lib/auth-utils');

const router = express.Router();

const VERIFICATION_CODE_EXPIRY_MINUTES = 15;
const PENDING_REGISTRATION_TTL_HOURS = 24;
const PASSWORD_RESET_CODE_HASH_COST = 12;
const LOCKOUT_WINDOW_SECONDS = 15 * 60;
const MAX_RESET_CODE_ATTEMPTS = 10;
const MAX_RESET_PASSWORD_ATTEMPTS = 5;
const MAX_VERIFY_EMAIL_ATTEMPTS = 10;

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

    const existingPending = await prisma.pendingRegistration.findUnique({ where: { email: normalizedEmail } });

    if (existingPending && !existingPending.emailVerified && new Date(existingPending.expiresAt) > new Date()) {
      logger.info('Existing valid pending registration found, resending code', { email: normalizedEmail, correlationId });
      try {
        const otp = crypto.randomInt(100000, 999999).toString();
        const verificationCodeHash = await bcrypt.hash(otp, 12);
        const verificationExpiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000);

        await prisma.pendingRegistration.update({
          where: { email: normalizedEmail },
          data: { verificationCodeHash, verificationExpiresAt, updatedAt: new Date() }
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
      where: { email: normalizedEmail },
      update: {
        firstName: resolvedFirstName, lastName: resolvedLastName,
        passwordHash, verificationCodeHash, verificationExpiresAt,
        emailVerified: false, emailVerifiedAt: null,
        expiresAt, onboardingData: {}, step: 1, updatedAt: new Date()
      },
      create: {
        email: normalizedEmail, firstName: resolvedFirstName, lastName: resolvedLastName,
        passwordHash, verificationCodeHash, verificationExpiresAt, expiresAt, onboardingData: {}, step: 1
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

// SEND EMAIL VERIFICATION CODE
router.post('/send-verification', async (req, res) => {
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

    await prisma.emailVerificationCode.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true }
    });

    await prisma.emailVerificationCode.create({
      data: { userId: user.id, email: normalizedEmail, code, expiresAt }
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
router.post('/verify-email', authenticatePending, async (req, res) => {
  const { code } = req.body;
  const { id: pendingId } = req.pending;

  if (!code) return res.status(400).json({ error: 'Verification code is required' });

  try {
    const pending = await prisma.pendingRegistration.findUnique({ where: { id: pendingId } });
    if (!pending) return res.status(404).json({ error: 'Pending registration not found' });
    if (pending.emailVerified) return res.status(200).json({ message: 'Email already verified', verified: true });
    if (new Date(pending.verificationExpiresAt) < new Date()) {
      return res.status(400).json({ error: 'Verification code expired' });
    }

    const isValidCode = await bcrypt.compare(code, pending.verificationCodeHash);
    if (!isValidCode) return res.status(400).json({ error: 'Invalid verification code' });

    await prisma.pendingRegistration.update({
      where: { id: pendingId },
      data: { emailVerified: true, emailVerifiedAt: new Date(), step: 6, updatedAt: new Date() }
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
    const codeHash = await bcrypt.hash(code, PASSWORD_RESET_CODE_HASH_COST);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id, token, code: codeHash, expiresAt,
        ipAddress: req.ip, userAgent: req.headers['user-agent']
      }
    });

    await sendPasswordResetEmail(normalizedEmail, code, user.fullName || 'there');

    logger.info('Password reset requested', { email: normalizedEmail, userId: user.id });
    res.status(200).json({ message: 'If that email exists, a reset code has been sent', token });
  } catch (err) {
    logger.error('Forgot password failed', { error: err.message, email: normalizedEmail });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// RESET PASSWORD
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

    const isValidCode = await bcrypt.compare(code, resetToken.code);
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

module.exports = router;
