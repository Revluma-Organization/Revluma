/**
 * Affiliate Utility Functions
 * Referral code generation, metrics calculation
 */

const crypto = require('crypto');

/**
 * Generate unique referral code
 * Format: username-uniqueid (5 char hex)
 */
function generateReferralCode(username) {
  const uniqueId = crypto.randomBytes(3).toString('hex').substring(0, 5).toLowerCase();
  return `${username}-${uniqueId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/**
 * Calculate conversion rate
 */
function calculateConversionRate(conversions, clicks) {
  if (clicks === 0) return 0;
  return ((conversions / clicks) * 100).toFixed(2);
}

/**
 * Calculate earnings based on referral status and commission rate
 */
function calculateEarnings(referralStatus, baseAmount, commissionRate) {
  const multipliers = {
    'WAITLIST_JOINED': 0,
    'ACCOUNT_CREATED': 0.25,
    'TRIAL_STARTED': 0.5,
    'ACTIVE_SUBSCRIBER': 1.0,
    'CANCELLED': 0
  };

  const multiplier = multipliers[referralStatus] || 0;
  return (baseAmount * multiplier * commissionRate).toFixed(2);
}

/**
 * Validate referral code format
 */
function isValidReferralCodeFormat(code) {
  return /^[a-z0-9]+-[a-z0-9]+$/.test(code);
}

module.exports = {
  generateReferralCode,
  calculateConversionRate,
  calculateEarnings,
  isValidReferralCodeFormat
};
