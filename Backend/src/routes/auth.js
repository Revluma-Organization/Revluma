const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { prisma } = require('../services/prisma');
const logger = require('../utils/logger');
const authenticate = require('../middleware/auth');
const { authenticatePending, createPendingToken } = require('../middleware/pendingAuth');
const { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/messaging');
const router = express.Router();

const VERIFICATION_CODE_EXPIRY_MINUTES = 15;
const PENDING_REGISTRATION_TTL_HOURS = 24;

function isEmailValid(email) {
  return typeof email === 'string' && email.includes('@');
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
  const existingUser = await prisma.user.findFirst({
    where: {
      email: { equals: email.trim().toLowerCase(), mode: 'insensitive' },
      emailVerified: false
    }
  });

  if (!existingUser) {
    return;
  }

  await prisma.tenant.delete({ where: { id: existingUser.tenantId } });
  logger.info('Removed stale unverified user and tenant', { email, userId: existingUser.id, tenantId: existingUser.tenantId });
}

// REGISTER - Step 1: Deferred account creation in pending registration
router.post('/register', async (req, res) => {
  const { email, password, first_name, last_name, full_name } = req.body;

  let resolvedFirstName = first_name;
  let resolvedLastName = last_name;

  if ((!resolvedFirstName || !resolvedLastName) && typeof full_name === 'string') {
    const nameParts = full_name.trim().split(/\s+/);
    if (nameParts.length >= 2) {
      resolvedFirstName = resolvedFirstName || nameParts[0];
      resolvedLastName = resolvedLastName || nameParts.slice(1).join(' ');
    }
  }

  const missingFields = [];
  if (!email) missingFields.push('email address');
  if (!password) missingFields.push('password');
  if (!resolvedFirstName) missingFields.push('first name');
  if (!resolvedLastName) missingFields.push('last name');

  if (missingFields.length > 0) {
    const fieldText = missingFields.length === 1
      ? missingFields[0]
      : `${missingFields.slice(0, -1).join(', ')} and ${missingFields.slice(-1)}`;

    return res.status(400).json({ error: `Please provide ${fieldText}.` });
  }

  if (!isEmailValid(email)) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    await cleanupUnverifiedUser(normalizedEmail);

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Email already in use' });
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
        firstName: resolvedFirstName,
        lastName: resolvedLastName,
        passwordHash,
        verificationCodeHash,
        verificationExpiresAt,
        emailVerified: false,
        emailVerifiedAt: null,
        expiresAt,
        onboardingData: {},
        step: 1,
        updatedAt: new Date()
      },
      create: {
        email: normalizedEmail,
        firstName: resolvedFirstName,
        lastName: resolvedLastName,
        passwordHash,
        verificationCodeHash,
        verificationExpiresAt,
        expiresAt,
        onboardingData: {},
        step: 1
      }
    });

    await sendVerificationEmail(normalizedEmail, otp, resolvedFirstName);

    const pendingToken = createPendingToken(pendingRegistration.id, normalizedEmail);

    logger.info('Pending registration created', { email: normalizedEmail, pendingRegistrationId: pendingRegistration.id });

    res.status(201).json({
      message: 'Verification code sent. Please check your email.',
      pendingRegistrationId: pendingRegistration.id,
      pendingToken,
      expiresAt: pendingRegistration.expiresAt
    });
  } catch (err) {
    logger.error('Pending registration failed', { error: err.message, email: normalizedEmail });
    res.status(500).json({ error: 'Registration failed' });
  }
});

// SEND EMAIL VERIFICATION CODE
router.post('/send-verification', authenticate, async (req, res) => {
  const { id: user_id, email, tenant_id } = req.user;

  try {
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000);

    // Invalidate existing codes
    await prisma.emailVerificationCode.updateMany({
      where: { userId: user_id, used: false },
      data: { used: true }
    });

    await prisma.emailVerificationCode.create({
      data: {
        userId: user_id,
        email,
        code,
        expiresAt
      }
    });

    const user = await prisma.user.findUnique({ where: { id: user_id } });
    const userName = user?.full_name || 'there';

    await sendVerificationEmail(email, code, userName);

    logger.info('Verification code sent', { user_id, email });

    res.status(200).json({ message: 'Verification code sent to your email' });
  } catch (err) {
    logger.error('Failed to send verification code', { error: err.message, user_id });
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// VERIFY EMAIL CODE
router.post('/verify-email', authenticatePending, async (req, res) => {
  const { code } = req.body;
  const { id: pendingId } = req.pending;

  if (!code) {
    return res.status(400).json({ error: 'Verification code is required' });
  }

  try {
    const pending = await prisma.pendingRegistration.findUnique({ where: { id: pendingId } });

    if (!pending) {
      return res.status(404).json({ error: 'Pending registration not found' });
    }

    if (pending.emailVerified) {
      return res.status(200).json({ message: 'Email already verified', verified: true });
    }

    if (new Date(pending.verificationExpiresAt) < new Date()) {
      return res.status(400).json({ error: 'Verification code expired' });
    }

    const isValidCode = await bcrypt.compare(code, pending.verificationCodeHash);
    if (!isValidCode) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    await prisma.pendingRegistration.update({
      where: { id: pendingId },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        step: 2,
        updatedAt: new Date()
      }
    });

    logger.info('Pending registration email verified', { pendingId, email: pending.email });

    res.status(200).json({ message: 'Email verified successfully', verified: true });
  } catch (err) {
    logger.error('Pending email verification failed', { error: err.message, pendingId });
    res.status(500).json({ error: 'Verification failed' });
  }
});

// UPDATE PENDING REGISTRATION ONBOARDING DATA
router.patch('/pending-registration', authenticatePending, async (req, res) => {
  const { step, data } = req.body;
  const { id: pendingId } = req.pending;

  if (!step || !data) {
    return res.status(400).json({ error: 'Step and data are required' });
  }

  const allowedSteps = [2, 3, 4, 5];
  if (!allowedSteps.includes(step)) {
    return res.status(400).json({ error: 'Invalid onboarding step' });
  }

  try {
    const pending = await prisma.pendingRegistration.findUnique({ where: { id: pendingId } });
    if (!pending) {
      return res.status(404).json({ error: 'Pending registration not found' });
    }

    const updatedOnboardingData = {
      ...pending.onboardingData,
      ...data
    };

    await prisma.pendingRegistration.update({
      where: { id: pendingId },
      data: {
        onboardingData: updatedOnboardingData,
        step,
        updatedAt: new Date()
      }
    });

    logger.info('Pending registration onboarding updated', { pendingId, step });

    res.status(200).json({ message: `Step ${step} saved`, step });
  } catch (err) {
    logger.error('Failed to update pending onboarding', { error: err.message, pendingId, step });
    res.status(500).json({ error: 'Failed to save onboarding data' });
  }
});

// FINALIZE REGISTRATION AND CREATE USER + TENANT
router.post('/complete-registration', authenticatePending, async (req, res) => {
  const { id: pendingId } = req.pending;

  try {
    const pending = await prisma.pendingRegistration.findUnique({ where: { id: pendingId } });

    if (!pending) {
      return res.status(404).json({ error: 'Pending registration not found' });
    }

    if (!pending.emailVerified) {
      return res.status(400).json({ error: 'Email must be verified before completing registration' });
    }

    if (pending.step < 5) {
      return res.status(400).json({ error: 'Complete all onboarding steps before finalizing registration' });
    }

    const profileData = buildPendingProfileData(pending.onboardingData || {});

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          storeName: pending.onboardingData.storeUrl || 'Pending Store',
          industry: profileData.industry,
          onboardingStatus: 'completed'
        }
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: pending.email,
          passwordHash: pending.passwordHash,
          fullName: `${pending.firstName} ${pending.lastName}`,
          onboardingStatus: 'completed',
          emailVerified: true,
          emailVerifiedAt: pending.emailVerifiedAt || new Date()
        }
      });

      await tx.tenantProfile.create({
        data: {
          tenantId: tenant.id,
          ...profileData,
          onboardingStatus: 'completed',
          onboardingCompletedAt: new Date()
        }
      });

      await tx.pendingRegistration.delete({ where: { id: pendingId } });

      return { tenant, user };
    });

    const token = jwt.sign(
      {
        id: result.user.id,
        email: result.user.email,
        tenant_id: result.tenant.id,
        emailVerified: true
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d', algorithm: 'HS256' }
    );

    logger.info('Pending registration completed and user created', { email: pending.email, tenantId: result.tenant.id });

    await sendWelcomeEmail(pending.email, `${pending.firstName} ${pending.lastName}`);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        tenant_id: result.tenant.id,
        email_verified: true
      }
    });
  } catch (err) {
    logger.error('Complete registration failed', { error: err.message, pendingId });
    res.status(500).json({ error: 'Registration completion failed' });
  }
});

// CHECK EMAIL VERIFICATION STATUS
router.get('/verification-status', authenticate, async (req, res) => {
  const { id: user_id, tenant_id } = req.user;

  try {
    const user = await prisma.user.findUnique({ where: { id: user_id } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({
      email_verified: user.emailVerified,
      email_verified_at: user.emailVerifiedAt
    });
  } catch (err) {
    logger.error('Failed to check verification status', { error: err.message, user_id });
    res.status(500).json({ error: 'Failed to check verification status' });
  }
});

// GET ONBOARDING STATUS
router.get('/onboarding/status', authenticate, async (req, res) => {
  const { tenant_id } = req.user;

  try {
    const profile = await prisma.tenantProfile.findUnique({
      where: { tenantId: tenant_id }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.status(200).json({ onboarding: profile });
  } catch (err) {
    logger.error('Failed to get onboarding status', { error: err.message, tenant_id });
    res.status(500).json({ error: 'Failed to retrieve onboarding status' });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      logger.warn('Login attempt failed – invalid credentials', { email });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, tenant_id: user.tenantId, emailVerified: user.emailVerified },
      process.env.JWT_SECRET,
      { expiresIn: '7d', algorithm: 'HS256' }
    );

    logger.info('Login successful', { userId: user.id, tenant_id: user.tenantId });

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        tenant_id: user.tenantId,
        onboarding_status: user.onboardingStatus,
        email_verified: user.emailVerified
      }
    });
  } catch (err) {
    logger.error('Login error', { error: err.message, email });
    res.status(500).json({ error: 'Login failed – please try again' });
  }
});

// GET CURRENT USER
router.get('/me', authenticate, async (req, res) => {
  const { id, email, tenant_id } = req.user;

  try {
    const user = await prisma.user.findFirst({
      where: { id, tenantId: tenant_id },
      include: { tenant: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.fullName,
        onboarding_status: user.onboardingStatus,
        onboarding_completed_at: user.onboardingCompletedAt,
        email_verified: user.emailVerified,
        email_verified_at: user.emailVerifiedAt,
        store_name: user.tenant?.storeName,
        industry: user.tenant?.industry
      }
    });
  } catch (err) {
    logger.error('Failed to get user', { error: err.message, userId: id });
    res.status(500).json({ error: 'Failed to retrieve user data' });
  }
});

// ====================== FORGOT PASSWORD ======================

const forgotPasswordLimiter = require('express-rate-limit')({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many reset attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const sanitizedEmail = String(email).trim().toLowerCase();

  if (!sanitizedEmail.includes('@')) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    const user = await prisma.user.findFirst({
      where: { email: { equals: sanitizedEmail, mode: 'insensitive' } }
    });

    if (!user) {
      // Security: don't reveal if email exists
      return res.status(200).json({ message: 'If that email exists, a reset code has been sent' });
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Delete existing tokens
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id }
    });

    // Create new token
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        code: codeHash,
        expiresAt,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      }
    });

    await sendPasswordResetEmail(sanitizedEmail, code, user.full_name || 'there');

    logger.info('Password reset code sent', { email: sanitizedEmail, userId: user.id });

    res.status(200).json({ message: 'If that email exists, a reset code has been sent', token });
  } catch (err) {
    logger.error('Forgot password error', { error: err.message, email: sanitizedEmail });
    res.status(200).json({ message: 'If that email exists, a reset code has been sent' });
  }
});

const verifyResetLimiter = require('express-rate-limit')({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/verify-reset-code', verifyResetLimiter, async (req, res) => {
  const { token, code } = req.body;

  if (!token || !code) {
    return res.status(400).json({ error: 'Token and code are required' });
  }

  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid code format' });
  }

  try {
    const reset = await prisma.passwordResetToken.findFirst({
      where: {
        token,
        usedAt: null
      }
    });

    if (!reset) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    if (new Date(reset.expiresAt) < new Date()) {
      await prisma.passwordResetToken.delete({ where: { id: reset.id } });
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }

    const codeValid = await bcrypt.compare(code, reset.code);

    if (!codeValid) {
      logger.warn('Invalid reset code attempt', { userId: reset.userId, token });
      return res.status(400).json({ error: 'Invalid code' });
    }

    res.status(200).json({ message: 'Code verified. You may now set a new password.', userId: reset.userId });
  } catch (err) {
    logger.error('Verify reset code error', { error: err.message });
    res.status(500).json({ error: 'Verification failed' });
  }
});

const resetPasswordLimiter = require('express-rate-limit')({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many reset attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/reset-password', resetPasswordLimiter, async (req, res) => {
  const { token, code, newPassword, confirmPassword } = req.body;

  if (!token || !code || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const reset = await prisma.passwordResetToken.findFirst({
      where: {
        token,
        usedAt: null
      }
    });

    if (!reset) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const codeValid = await bcrypt.compare(code, reset.code);
    if (!codeValid) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    if (new Date(reset.expiresAt) < new Date()) {
      await prisma.passwordResetToken.delete({ where: { id: reset.id } });
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }

    // Get old password for history
    const oldUser = await prisma.user.findUnique({ where: { id: reset.userId } });

    await prisma.$transaction([
      // Save to password history
      oldUser ? prisma.passwordHistory.create({
        data: {
          userId: reset.userId,
          passwordHash: oldUser.passwordHash
        }
      }) : Promise.resolve(),
      // Update password
      prisma.user.update({
        where: { id: reset.userId },
        data: {
          passwordHash: await bcrypt.hash(newPassword, 12),
          updatedAt: new Date()
        }
      }),
      // Mark token as used
      prisma.passwordResetToken.update({
        where: { id: reset.id },
        data: { usedAt: new Date() }
      }),
      // Delete other tokens
      prisma.passwordResetToken.deleteMany({
        where: { userId: reset.userId }
      }),
      // Delete sessions
      prisma.userSession.deleteMany({
        where: { userId: reset.userId }
      })
    ]);

    logger.info('Password reset successful', { userId: reset.userId });

    res.status(200).json({ message: 'Password reset successful. Please log in with your new password.' });
  } catch (err) {
    logger.error('Reset password error', { error: err.message });
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;