const express = require('express');
const router = express.Router();

const authController = require('../controller/authController');
const { registerLimiter, loginLimiter } = require("../middlewares/rateLimiters");
const { validateRegister, validateLogin } = require('../middlewares/validateAuth');
const { authenticateToken } = require('../middlewares/authMiddleware');


// Authentication routes
router.post('/register', validateRegister, registerLimiter, authController.register);
router.post('/verify-email',  authController.verifyEmail);
router.post('/resend-verification',authenticateToken, authController.resendVerification);
router.post('/login', validateLogin, loginLimiter, authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authenticateToken, authController.logout);

// Protected profile routes
router.get('/me', authenticateToken, authController.getProfile);
router.get('/getProfile', authenticateToken, authController.getProfile);

module.exports = router;