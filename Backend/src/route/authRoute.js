const express = require('express');
const router = express.Router();

const authController = require('../controller/authController');
const { registerLimiter, loginLimiter } = require("../middlewares/rateLimiters");
const { validateRegister, validateLogin } = require('../middlewares/validateAuth');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Temporary test route
router.get("/test", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Auth router is working",
  });
});

// Authentication routes
router.post('/register', validateRegister, registerLimiter, authController.register);
router.post('/verifyemail', authController.verifyEmail);
router.post('/resendverification', authController.resendVerification);
router.post('/login', validateLogin, loginLimiter, authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authenticateToken, authController.logout);

// Protected profile routes
router.get('/me', authenticateToken, authController.getProfile);
router.get('/getProfile', authenticateToken, authController.getProfile);

module.exports = router;