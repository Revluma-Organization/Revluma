const express = require('express');
const router = express.Router();

const authController = require('../controller/authController');
const { registerLimiter, loginLimiter, refreshLimiter, resendLimiter } = require('../middlewares/rateLimiters');
const { validateRegister, validateLogin } = require('../middlewares/validateAuth');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Public routes
router.post('/register', validateRegister, registerLimiter, authController.register);
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification', resendLimiter, authController.resendVerification);
router.post('/login', validateLogin, loginLimiter, authController.login);
router.post('/refresh', refreshLimiter, authController.refresh);

// Protected routes
router.post('/logout', authenticateToken, authController.logout);
router.post('/logout-all', authenticateToken, authController.logoutAll);
router.get('/me', authenticateToken, authController.getProfile);
router.get('/getProfile', authenticateToken, authController.getProfile); // legacy alias

module.exports = router;