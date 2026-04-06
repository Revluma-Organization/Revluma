const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');
const logger = require('../utils/logger');
const authenticate = require('../middleware/auth');
const { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/messaging');
const router = express.Router();

// Email verification code length
const VERIFICATION_CODE_LENGTH = 6;
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

  let client = null;
  
  try {
    // Get client from pool for transaction
    client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Check duplicate email
      const dup = await client.query('SELECT id FROM users WHERE email = $1', [email]);
      if (dup.rowCount > 0) {
        throw new Error('Email already registered');
      }

      // Create tenant with minimal data
      const tenantRes = await client.query(
        'INSERT INTO tenants (store_name, industry, onboarding_status) VALUES ($1, $2, $3) RETURNING id',
        ['Pending', 'Pending', 'started']
      );
      const tenant_id = tenantRes.rows[0].id;

      // Hash password
      const salt = await bcrypt.genSalt(12);
      const password_hash = await bcrypt.hash(password, salt);

      // Create user
      const userRes = await client.query(
        'INSERT INTO users (tenant_id, email, password_hash, full_name, onboarding_status, email_verified) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, tenant_id',
        [tenant_id, email, password_hash, full_name, 'started', false]
      );

      // Create tenant profile with defaults
      await client.query(
        `INSERT INTO tenant_profiles (
          tenant_id, 
          onboarding_status,
          preferred_channel,
          touch1_delay,
          touch2_delay,
          discount_threshold
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenant_id, 'started', 'whatsapp', 15, 90, 0.1]
      );

      await client.query('COMMIT');
      
      const result = { tenant_id, user: userRes.rows[0] };
      
      // Generate JWT
      const token = jwt.sign(
        { id: result.user.id, email: result.user.email, tenant_id: result.tenant_id },
        process.env.JWT_SECRET,
        { expiresIn: '7d', algorithm: 'HS256' }
      );

      logger.info('New user registered', { tenant_id: result.tenant_id, email });

      res.status(201).json({
        message: 'Account created successfully! Welcome to Revluma',
        token,
        user: {
          id: result.user.id,
          email: result.user.email,
          tenant_id: result.tenant_id,
          email_verified: false
        }
      });
      
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    }
    
  } catch (err) {
    logger.error('Registration failed', { error: err.message, email });

    let status = 500;
    let message = 'Registration failed';

    if (err.message.includes('already registered')) {
      status = 409;
      message = 'Email already in use';
    } else if (err.message.includes('database') || err.message.includes('relation') || err.message.includes('table')) {
      message = 'Database setup incomplete – please contact support';
    } else if (err.message.includes('connection') || err.message.includes('pool')) {
      status = 503;
      message = 'Database temporarily unavailable';
    }

    res.status(status).json({ error: message });
  } finally {
    if (client) {
      client.release();
    }
  }
});
        `INSERT INTO tenant_profiles (
          tenant_id, 
          onboarding_status,
          preferred_channel,
          touch1_delay,
          touch2_delay,
          discount_threshold
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenant_id, 'started', 'whatsapp', 15, 90, 0.1]
      );

      await client.query('COMMIT');
      
      const result = { tenant_id, user: userRes.rows[0] };
      
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    
    // Generate JWT
    const token = jwt.sign(
      { id: result.user.id, email: result.user.email, tenant_id: result.tenant_id },
      process.env.JWT_SECRET,
      { expiresIn: '7d', algorithm: 'HS256' }
    );

    logger.info('New user registered', { tenant_id: result.tenant_id, email });

    res.status(201).json({
      message: 'Account created successfully! Welcome to Revluma',
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        tenant_id: result.tenant_id,
        email_verified: false
      }
    });
  } catch (err) {
    console.error('=== REGISTRATION ERROR ===');
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    console.error('Email:', email);
    logger.error('Registration failed', { error: err.message, stack: err.stack, email });

    let status = 500;
    let message = 'Registration failed';

    if (err.message.includes('already registered')) {
      status = 409;
      message = 'Email already in use';
    } else if (err.message.includes('database') || err.message.includes('relation') || err.message.includes('table')) {
      message = 'Database setup incomplete – please contact support';
    }

    res.status(status).json({ error: message, details: err.message });
  }
});

// SEND EMAIL VERIFICATION CODE
router.post('/send-verification', authenticate, async (req, res) => {
  const { id: user_id, email, tenant_id } = req.user;

  try {
    // Generate 6-digit verification code
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000);

    logger.info('Attempting to send verification code', { user_id, email, tenant_id });

    // Store code in database - use system query to avoid tenant context issues
    const client = await db.pool.connect();
    try {
      // Check if table exists first
      const tableCheck = await client.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'email_verification_codes')`
      );
      
      if (!tableCheck.rows[0].exists) {
        logger.error('Email verification table does not exist');
        return res.status(500).json({ error: 'Email verification not configured. Please contact support.' });
      }

      // Invalidate any existing codes for this user
      await client.query(
        'UPDATE email_verification_codes SET used = TRUE WHERE user_id = $1 AND used = FALSE',
        [user_id]
      );

      // Insert new code
      await client.query(
        `INSERT INTO email_verification_codes (user_id, email, code, expires_at) 
         VALUES ($1, $2, $3, $4)`,
        [user_id, email, code, expiresAt]
      );
    } finally {
      client.release();
    }

    // Get user name for email
    const userResult = await db.query(
      'SELECT full_name FROM users WHERE id = $1',
      [user_id],
      'system'
    );
    const userName = userResult.rows[0]?.full_name || 'there';

    // Send verification email via SendGrid
    await sendVerificationEmail(email, code, userName);

    logger.info('Verification code sent', { user_id, email });

    res.status(200).json({
      message: 'Verification code sent to your email'
    });
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
    const client = await db.pool.connect();
    try {
      // Check if table exists first
      const tableCheck = await client.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'email_verification_codes')`
      );
      
      if (!tableCheck.rows[0].exists) {
        return res.status(500).json({ error: 'Email verification not configured' });
      }

      // Find valid code
      const codeResult = await client.query(
        `SELECT id, expires_at FROM email_verification_codes 
         WHERE user_id = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [user_id, code]
      );

      if (codeResult.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid or expired verification code' });
      }

      // Mark code as used
      await client.query(
        'UPDATE email_verification_codes SET used = TRUE WHERE id = $1',
        [codeResult.rows[0].id]
      );

      // Mark user email as verified
      await client.query(
        'UPDATE users SET email_verified = TRUE, email_verified_at = NOW() WHERE id = $1',
        [user_id]
      );

      return { verified: true };
    } finally {
      client.release();
    }

    // Send welcome email
    const userResult = await db.query(
      'SELECT full_name, email FROM users WHERE id = $1',
      [user_id],
      'system'
    );
    
    if (userResult.rows[0]) {
      await sendWelcomeEmail(userResult.rows[0].email, userResult.rows[0].full_name);
    }

    logger.info('Email verified successfully', { user_id });

    res.status(200).json({
      message: 'Email verified successfully',
      verified: true
    });
  } catch (err) {
    logger.error('Email verification failed', { error: err.message, user_id });
    
    let status = 500;
    let message = 'Verification failed';

    if (err.message.includes('Invalid or expired')) {
      status = 400;
      message = 'Invalid or expired verification code';
    }

    res.status(status).json({ error: message });
  }
});

// CHECK EMAIL VERIFICATION STATUS
router.get('/verification-status', authenticate, async (req, res) => {
  const { id: user_id, tenant_id } = req.user;

  try {
    const result = await db.query(
      'SELECT email_verified, email_verified_at FROM users WHERE id = $1',
      [user_id],
      tenant_id
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({
      email_verified: result.rows[0].email_verified,
      email_verified_at: result.rows[0].email_verified_at
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
    await db.withTenantContext(tenant_id, async (client) => {
      let updateQuery = '';
      let updateValues = [];
      let onboardingStatus = '';

      switch (step) {
        case 2: // Business Context
          const { platform, store_url, monthly_traffic } = data;
          updateQuery = `
            UPDATE tenant_profiles 
            SET platform = $1, store_url = $2, monthly_traffic = $3, onboarding_status = 'step2'
            WHERE tenant_id = $4
          `;
          updateValues = [platform, store_url, monthly_traffic, tenant_id];
          onboardingStatus = 'step2';
          break;

        case 3: // Goals Selection
          const { goals } = data;
          updateQuery = `
            UPDATE tenant_profiles 
            SET goals = $1, onboarding_status = 'step3'
            WHERE tenant_id = $2
          `;
          updateValues = [JSON.stringify(goals), tenant_id];
          onboardingStatus = 'step3';
          break;

        case 4: // Revenue Stage (Optional)
          const { monthly_revenue } = data;
          updateQuery = `
            UPDATE tenant_profiles 
            SET monthly_revenue = $1, onboarding_status = 'step4'
            WHERE tenant_id = $2
          `;
          updateValues = [monthly_revenue, tenant_id];
          onboardingStatus = 'step4';
          break;

        case 5: // Recovery Channel Setup
          const { preferred_recovery_channel } = data;
          updateQuery = `
            UPDATE tenant_profiles 
            SET preferred_recovery_channel = $1, 
                preferred_channel = $1,
                onboarding_status = 'completed',
                onboarding_completed_at = NOW()
            WHERE tenant_id = $2
          `;
          updateValues = [preferred_recovery_channel, tenant_id];
          onboardingStatus = 'completed';
          break;

        default:
          return res.status(400).json({ error: 'Invalid step' });
      }

      await client.query(updateQuery, updateValues);

      // Update user onboarding status
      await client.query(
        'UPDATE users SET onboarding_status = $1, onboarding_completed_at = $2 WHERE id = $3',
        [onboardingStatus, step === 5 ? new Date() : null, user_id]
      );

      // Update tenant onboarding status
      await client.query(
        'UPDATE tenants SET onboarding_status = $1 WHERE id = $2',
        [onboardingStatus, tenant_id]
      );
    });

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
    const result = await db.query(
      `SELECT 
        onboarding_status,
        platform,
        store_url,
        monthly_traffic,
        monthly_revenue,
        goals,
        preferred_recovery_channel,
        onboarding_completed_at
      FROM tenant_profiles 
      WHERE tenant_id = $1`,
      [tenant_id],
      tenant_id
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.status(200).json({
      onboarding: result.rows[0]
    });
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
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email],
      'system'
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      logger.warn('Login attempt failed – invalid credentials', { email });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, tenant_id: user.tenant_id },
      process.env.JWT_SECRET,
      { expiresIn: '7d', algorithm: 'HS256' }
    );

    logger.info('Login successful', { userId: user.id, tenant_id: user.tenant_id });

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        tenant_id: user.tenant_id,
        onboarding_status: user.onboarding_status,
        email_verified: user.email_verified
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
    const result = await db.query(
      `SELECT 
        u.id, u.email, u.full_name, u.onboarding_status, u.onboarding_completed_at, u.email_verified, u.email_verified_at,
        t.store_name, t.industry, t.onboarding_status as tenant_onboarding_status
      FROM users u
      JOIN tenants t ON u.tenant_id = t.id
      WHERE u.id = $1`,
      [id],
      tenant_id
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({
      user: result.rows[0]
    });
  } catch (err) {
    logger.error('Failed to get user', { error: err.message, userId: id });
    res.status(500).json({ error: 'Failed to retrieve user data' });
  }
});

// ====================== FORGOT PASSWORD ======================

// Rate limiting for forgot password (prevent abuse)
const forgotPasswordLimiter = require('express-rate-limit')({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5, // 5 requests per IP per 15 min
  message: { error: 'Too many reset attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// POST /api/auth/forgot-password
// Request a password reset code
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
    // Find user by email - use systemQuery for no tenant RLS
    const userResult = await systemQuery(
      'SELECT id, full_name FROM users WHERE LOWER(email) = $1',
      [sanitizedEmail]
    );

    if (userResult.rowCount === 0) {
      // Security: don't reveal if email exists
      return res.status(200).json({ 
        message: 'If that email exists, a reset code has been sent' 
      });
    }

    const user = userResult.rows[0];

    // Generate secure 6-digit code
    const code = crypto.randomInt(100000, 999999).toString();
    
    // Hash the code for storage (don't store plain)
    const codeHash = await bcrypt.hash(code, 10);
    
    // Generate a separate token for URL verification
    const token = crypto.randomBytes(32).toString('hex');
    
    // Set expiration (15 minutes)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Delete any existing reset tokens for this user
    await systemQuery(
      'DELETE FROM password_reset_tokens WHERE user_id = $1',
      [user.id]
    );

    // Insert new token
    await systemQuery(
      `INSERT INTO password_reset_tokens (user_id, token, code, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, token, codeHash, expiresAt, req.ip, req.get('user-agent')]
    );

    // Send email with code
    await sendPasswordResetEmail(sanitizedEmail, code, user.full_name || 'there');

    logger.info('Password reset code sent', { email: sanitizedEmail, userId: user.id });

    // Return token for subsequent verification (but don't reveal email)
    res.status(200).json({ 
      message: 'If that email exists, a reset code has been sent',
      token // Send token back for verification step
    });

  } catch (err) {
    logger.error('Forgot password error', { error: err.message, email: sanitizedEmail });
    res.status(200).json({ 
      message: 'If that email exists, a reset code has been sent' 
    });
  }
});

// POST /api/auth/verify-reset-code
// Verify the 6-digit code
const verifyResetLimiter = require('express-rate-limit')({
  windowMs: 5 * 60 * 1000, // 5 min
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
    // Find the token - use systemQuery
    const tokenResult = await systemQuery(
      `SELECT prt.id, prt.code, prt.expires_at, prt.user_id, u.email
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token = $1 AND prt.used_at IS NULL`,
      [token]
    );

    if (tokenResult.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const reset = tokenResult.rows[0];

    // Check expiration
    if (new Date(reset.expires_at) < new Date()) {
      await systemQuery('DELETE FROM password_reset_tokens WHERE id = $1', [reset.id]);
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }

    // Verify code
    const codeValid = await bcrypt.compare(code, reset.code);
    
    if (!codeValid) {
      logger.warn('Invalid reset code attempt', { userId: reset.user_id, token });
      return res.status(400).json({ error: 'Invalid code' });
    }

    // Code verified - proceed to password change
    res.status(200).json({ 
      message: 'Code verified. You may now set a new password.',
      userId: reset.user_id 
    });

  } catch (err) {
    logger.error('Verify reset code error', { error: err.message });
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /api/auth/reset-password
// Set new password after code verification
const resetPasswordLimiter = require('express-rate-limit')({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 password resets per hour per IP
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
    // Find the token - use systemQuery
    const tokenResult = await systemQuery(
      `SELECT prt.id, prt.user_id, prt.code, prt.expires_at
       FROM password_reset_tokens prt
       WHERE prt.token = $1 AND prt.used_at IS NULL`,
      [token]
    );

    if (tokenResult.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const reset = tokenResult.rows[0];

    // Verify code one more time
    const codeValid = await bcrypt.compare(code, reset.code);
    if (!codeValid) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    // Check expiration
    if (new Date(reset.expires_at) < new Date()) {
      await systemQuery('DELETE FROM password_reset_tokens WHERE id = $1', [reset.id]);
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    const newHash = await bcrypt.hash(newPassword, salt);

    // Check password history (prevent reuse of last 5 passwords)
    const historyCheck = await systemQuery(
      `SELECT COUNT(*) as count FROM password_history 
       WHERE user_id = $1 AND password_hash = (
         SELECT password_hash FROM users WHERE id = $1
       )`,
      [reset.user_id]
    );

    if (historyCheck.rows[0]?.count > 0) {
      return res.status(400).json({ 
        error: 'Cannot reuse your current password. Choose a different password.' 
      });
    }

    // Get old password hash for history
    const oldUser = await systemQuery(
      'SELECT password_hash FROM users WHERE id = $1',
      [reset.user_id]
    );

    // Save to password history (if exists)
    if (oldUser.rowCount > 0 && oldUser.rows[0].password_hash) {
      await systemQuery(
        'INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)',
        [reset.user_id, oldUser.rows[0].password_hash]
      );
    }

    // Update password - use systemQuery
    await systemQuery(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newHash, reset.user_id]
    );

    // Mark token as used
    await systemQuery(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1',
      [reset.id]
    );

    // Delete all other reset tokens for this user
    await systemQuery(
      'DELETE FROM password_reset_tokens WHERE user_id = $1',
      [reset.user_id]
    );

    // Invalidate all existing sessions (force re-login)
    await systemQuery(
      'DELETE FROM user_sessions WHERE user_id = $1',
      [reset.user_id]
    );

    logger.info('Password reset successful', { userId: reset.user_id });

    res.status(200).json({ 
      message: 'Password reset successful. Please log in with your new password.' 
    });

  } catch (err) {
    logger.error('Reset password error', { error: err.message });
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
