const express = require('express');
const router = express.Router();

const authController = require('../controller/authController');
const {
  registerLimiter,
  loginLimiter,
  refreshLimiter,
  resendLimiter,
  passwordResetLimiter,
} = require('../middlewares/rateLimiter');
const { validateRegister, validateLogin, validateForgotPassword, validateVerifyForgotPasswordOtp, validateResetPassword, validateChangePassword } = require('../middlewares/validateAuth');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { optionalAuthenticate } = require('../middlewares/optionalAuth');

// Public routes
router.post('/register', validateRegister, registerLimiter, authController.register);
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification', resendLimiter, authController.resendVerification);
router.post('/login', validateLogin, loginLimiter, authController.login);
router.post('/refresh', refreshLimiter, authController.refresh);

// Password reset flow (public, unauthenticated)
router.post('/forgot-password', validateForgotPassword, passwordResetLimiter, authController.forgotPassword);
router.post('/forgot-password/verify', validateVerifyForgotPasswordOtp, passwordResetLimiter, authController.verifyForgotPasswordOtp);
router.post('/forgot-password/reset', validateResetPassword, passwordResetLimiter, authController.resetPassword);

// Logout must succeed even with an expired access token (revokes via refresh token / cookie).
router.post('/logout', optionalAuthenticate, authController.logout);

// Protected routes
router.post('/logout-all', authenticateToken, authController.logoutAll);
router.post('/change-password', authenticateToken, validateChangePassword, passwordResetLimiter, authController.changePassword);
router.get('/me', authenticateToken, authController.getProfile);
router.get('/getProfile', authenticateToken, authController.getProfile); // legacy alias
router.patch("/profile", authenticateToken, authController.updateProfile);

// Two-Factor Authentication
router.post('/2fa/setup', authenticateToken, authController.setupTwoFactor);
router.post('/2fa/verify', authenticateToken, authController.verifyTwoFactor);
router.post('/2fa/disable', authenticateToken, authController.disableTwoFactor);


module.exports = router;
