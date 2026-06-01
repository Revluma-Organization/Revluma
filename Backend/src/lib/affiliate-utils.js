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
 * Determine affiliate tier and commission rate based on active referrals count
 * Rules:
 * - Tier 01 (AFFILIATE): default, < 10 active referrals => 20% commission
 * - Tier 02 (GROWTH): 10+ active referrals => 30% commission
 * - Tier 03 (ELITE): 30+ active referrals => 35% commission
 * - Tier 04 (FOUNDING_AMBASSADOR): 50+ active referrals => 40% commission
 */
function determineTierAndRate(activeReferralsCount) {
  const count = Number(activeReferralsCount || 0);
  if (count >= 50) {
    return { tier: 'FOUNDING_AMBASSADOR', commissionRate: 0.40 };
  }
  if (count >= 30) {
    return { tier: 'ELITE', commissionRate: 0.35 };
  }
  if (count >= 10) {
    return { tier: 'GROWTH', commissionRate: 0.30 };
  }
  return { tier: 'AFFILIATE', commissionRate: 0.20 };
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
  determineTierAndRate,
  isValidReferralCodeFormat
};
