const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { prisma } = require('../services/prisma');
const logger = require('../utils/logger');
const authenticate = require('../middleware/auth');
const { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/messaging');
const router = express.Router();

const VERIFICATION_CODE_EXPIRY_MINUTES = 15;

// REGISTER - Step 1: Basic account creation
router.post('/register', async (req, res) => {
  const { email, password, full_name } = req.body;

  // Basic validation
  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'All fields required: email, password, full_name' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create tenant and user in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create tenant
      const tenant = await tx.tenant.create({
        data: {
          storeName: 'Pending',
          industry: 'general',
          onboardingStatus: 'started'
        }
      });

      // Create user
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash,
          fullName: full_name,
          onboardingStatus: 'started',
          emailVerified: false
        }
      });

      // Create tenant profile with defaults
      await tx.tenantProfile.create({
        data: {
          tenantId: tenant.id,
          onboardingStatus: 'started',
          preferredChannel: 'whatsapp',
          touch1Delay: 15,
          touch2Delay: 90,
          discountThreshold: 0.1
        }
      });

      return { tenant, user };
    });

    // Generate JWT
    const token = jwt.sign(
      { id: result.user.id, email: result.user.email, tenant_id: result.tenant.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d', algorithm: 'HS256' }
    );

    logger.info('New user registered', { tenant_id: result.tenant.id, email });

    res.status(201).json({
      message: 'Account created successfully! Welcome to Revluma',
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        tenant_id: result.tenant.id,
        email_verified: false
      }
    });

  } catch (err) {
    logger.error('Registration failed', { error: err.message, email });

    let status = 500;
    let message = 'Registration failed';

    if (err.code === 'P2002') { // Prisma unique constraint
      status = 409;
      message = 'Email already in use';
    } else if (err.message.includes('connection') || err.message.includes('database')) {
      status = 503;
      message = 'Database temporarily unavailable';
    }

    res.status(status).json({ error: message });
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
router.post('/verify-email', authenticate, async (req, res) => {
  const { code } = req.body;
  const { id: user_id, tenant_id } = req.user;

  if (!code) {
    return res.status(400).json({ error: 'Verification code is required' });
  }

  try {
    const validCode = await prisma.emailVerificationCode.findFirst({
      where: {
        userId: user_id,
        code,
        used: false,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!validCode) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    await prisma.$transaction([
      prisma.emailVerificationCode.update({
        where: { id: validCode.id },
        data: { used: true }
      }),
      prisma.user.update({
        where: { id: user_id },
        data: { 
          emailVerified: true, 
          emailVerifiedAt: new Date() 
        }
      })
    ]);

    const user = await prisma.user.findUnique({ where: { id: user_id } });
    if (user) {
      await sendWelcomeEmail(user.email, user.full_name);
    }

    logger.info('Email verified successfully', { user_id });

    res.status(200).json({ message: 'Email verified successfully', verified: true });
  } catch (err) {
    logger.error('Email verification failed', { error: err.message, user_id });
    res.status(500).json({ error: 'Verification failed' });
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

// UPDATE ONBOARDING - Steps 2-5
router.patch('/onboarding', authenticate, async (req, res) => {
  const { step, data } = req.body;
  const { tenant_id, id: user_id } = req.user;

  if (!step || !data) {
    return res.status(400).json({ error: 'Step and data are required' });
  }

  try {
    const updateData = {};
    let onboardingStatus = '';

    switch (step) {
      case 2:
        updateData.platform = data.platform;
        updateData.storeUrl = data.store_url;
        updateData.monthlyTraffic = data.monthly_traffic;
        onboardingStatus = 'step2';
        break;
      case 3:
        updateData.goals = data.goals;
        onboardingStatus = 'step3';
        break;
      case 4:
        updateData.monthlyRevenue = data.monthly_revenue;
        onboardingStatus = 'step4';
        break;
      case 5:
        updateData.preferredRecoveryChannel = data.preferred_recovery_channel;
        updateData.preferredChannel = data.preferred_recovery_channel;
        updateData.onboardingCompletedAt = new Date();
        onboardingStatus = 'completed';
        break;
      default:
        return res.status(400).json({ error: 'Invalid step' });
    }

    updateData.onboardingStatus = onboardingStatus;

    await prisma.$transaction([
      prisma.tenantProfile.update({
        where: { tenantId: tenant_id },
        data: updateData
      }),
      prisma.user.update({
        where: { id: user_id },
        data: { onboardingStatus }
      }),
      prisma.tenant.update({
        where: { id: tenant_id },
        data: { onboardingStatus }
      })
    ]);

    logger.info('Onboarding step completed', { tenant_id, user_id, step });

    res.status(200).json({
      message: `Step ${step} completed successfully`,
      step,
      onboarding_status: step === 5 ? 'completed' : `step${step}`
    });
  } catch (err) {
    logger.error('Onboarding update failed', { error: err.message, tenant_id, step });
    res.status(500).json({ error: 'Failed to update onboarding data' });
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
      { id: user.id, email: user.email, tenant_id: user.tenantId },
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