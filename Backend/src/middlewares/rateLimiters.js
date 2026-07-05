const rateLimit = require("express-rate-limit");

// Registration
const registerLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many registration attempts. Please try again in 30 minutes.",
  },
});

// Login
const loginLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many login attempts. Please try again in 30 minutes.",
  },
});

module.exports = {registerLimiter,loginLimiter };