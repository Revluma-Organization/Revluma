const express = require('express');
const router = express.Router();
const authController = require('../controller/authController');
const {registerLimiter, loginLimiter } = require ("../middlewares/rateLimiters");
const { validateRegister, validateLogin } = require('../middlewares/validateAuth');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Protected Auth Route Entries

// /auth/me — canonical profile endpoint (frontend uses this)
router.get('/me', authenticateToken, authController.getProfile);
// /auth/getProfile — legacy alias (keep for backwards compatibility)
router.get('/getProfile', authenticateToken, authController.getProfile);
// New endpoint (frontend uses this)
router.get("/me",authenticateToken,authController.getProfile);
router.post('/register', validateRegister, registerLimiter, authController.register);
router.post("/verifyemail", authController.verifyEmail);
router.post("/resendverification", authController.resendVerification);
router.post('/login', validateLogin,loginLimiter,  authController.login);
router.post('/logout', authenticateToken, authController.logout);
router.post('/refresh', authController.refresh);

module.exports = router;