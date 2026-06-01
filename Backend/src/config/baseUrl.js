/**
 * Centralized Base URL Configuration
 * Controls affiliate link generation, redirects, email templates, etc.
 * Reads from environment variables set in Render Dashboard
 */

const getBaseUrl = () => {
  // Production uses NEXT_PUBLIC_BASE_URL from Render
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL;

  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_BASE_URL or BASE_URL must be configured in Render Dashboard');
  }

  return baseUrl.replace(/\/$/, '');
};

const BASE_URL = getBaseUrl();

module.exports = {
  BASE_URL,
  getBaseUrl,
  getAffiliateLink: (affiliateUsername, uniqueId) => {
    return `${BASE_URL}/r/${affiliateUsername}-${uniqueId}`;
  },
  getAffiliateAliasLink: (affiliateUsername, uniqueId) => {
    return `${BASE_URL}/affiliate/${affiliateUsername}-${uniqueId}`;
  },
  getWaitlistUrl: () => {
    return `${BASE_URL}/waitlist`;
  },
  getDashboardUrl: () => {
    return `${BASE_URL}/dashboard`;
  },
  getVerificationLink: (token) => {
    return `${BASE_URL}/verify?token=${token}`;
  },
  getPasswordResetLink: (token) => {
    return `${BASE_URL}/reset-password?token=${token}`;
  }
};
