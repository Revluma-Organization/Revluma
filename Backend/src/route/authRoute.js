const express = require('express');
const router = express.Router();

const authController = require('../controller/authController');
const { registerLimiter, loginLimiter, refreshLimiter, resendLimiter } = require('../middlewares/rateLimiters');
const { validateRegister, validateLogin } = require('../middlewares/validateAuth');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { optionalAuthenticate } = require('../middlewares/optionalAuth');

// Public routes
router.post('/register', validateRegister, registerLimiter, authController.register);
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification', resendLimiter, authController.resendVerification);
router.post('/login', validateLogin, loginLimiter, authController.login);
router.post('/refresh', refreshLimiter, authController.refresh);

// Logout must succeed even with an expired access token (revokes via refresh token / cookie).
router.post('/logout', optionalAuthenticate, authController.logout);

// Protected routes
router.post('/logout-all', authenticateToken, authController.logoutAll);
router.get('/me', authenticateToken, authController.getProfile);
router.get('/getProfile', authenticateToken, authController.getProfile); // legacy alias

module.exports = router;
