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

// Dedicated, more generous limiter for the live "does this referral code
// exist" check — this gets hit as people type, so it needs a higher
// ceiling than the join limiter, but still caps scripted enumeration
// attempts (someone trying to brute-force valid codes).
const referralCheckLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,             // 20 checks/min per IP — plenty for real typing
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please slow down.',
  },
});

module.exports = { waitlistJoinLimiter, referralCheckLimiter };