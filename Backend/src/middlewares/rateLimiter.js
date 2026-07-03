const rateLimit = require('express-rate-limit');

const waitlistJoinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                    // 5 submissions per IP per window
  standardHeaders: true,     // return RateLimit-* headers
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many submissions from this IP. Please try again later.',
  },
});

module.exports = { waitlistJoinLimiter };