const express = require('express');
const router = express.Router();
const authController = require('../controller/authController');
const {registerLimiter, loginLimiter } = require ("../middlewares/rateLimiters"),
const { validateRegister, validateLogin } = require('../middlewares/validateAuth');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Protected Auth Route Entries

// Simple protected profile endpoint using the new middleware layer
router.get('/getProfile', authenticateToken, authController.getProfile);
router.post('/register', validateRegister, registerLimiter, authController.register);
router.post('/login', validateLogin,loginLimiter,  authController.login);
router.post('/logout', authenticateToken, authController.logout);

module.exports = router;