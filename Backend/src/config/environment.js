/**
 * Centralized environment configuration
 * Single source of truth for all platform URLs and credentials
 * UPDATED: Resend removed, SendGrid standardized, RAPP vetting email added
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const requiredEnvVars = [
  'DATABASE_URL',
  'NEXT_PUBLIC_BASE_URL',
  'JWT_SECRET',
  'SESSION_SECRET',
  'REDIS_URL',
  'EMAIL_PROVIDER',
];

// Validate required environment variables
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
});

module.exports = {
  // ============================================================
  // ENVIRONMENT & DEPLOYMENT
  // ============================================================
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development',
  port: parseInt(process.env.PORT || '5000', 10),

  // ============================================================
  // BASE URL CONFIGURATION (CRITICAL)
  // ============================================================
  baseUrl: process.env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, ''),
  frontendUrl: (process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_BASE_URL).replace(/\/$/, ''),
  apiBaseUrl: process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL,

  // ============================================================
  // DATABASE
  // ============================================================
  database: {
    url: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL,
  },

  // ============================================================
  // JWT & SESSION SECURITY
  // ============================================================
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  },

  session: {
    secret: process.env.SESSION_SECRET,
    expiresIn: parseInt(process.env.SESSION_EXPIRES_IN || '86400000', 10),
    cookieMaxAge: parseInt(process.env.COOKIE_MAX_AGE || '86400000', 10),
  },

  // ============================================================
  // EMAIL CONFIGURATION (SENDGRID ONLY - RESEND REMOVED)
  // ============================================================
  email: {
    provider: process.env.EMAIL_PROVIDER || 'sendgrid', // 'sendgrid' or 'smtp'
    from: process.env.SMTP_FROM || 'noreply@revluma.app',
    sendgridApiKey: process.env.SENDGRID_API_KEY,
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      secure: process.env.SMTP_SECURE === 'true',
    },
    verificationExpiryHours: parseInt(process.env.EMAIL_VERIFICATION_EXPIRY_HOURS || '24', 10),
  },

  // ============================================================
  // REDIS (Sessions, Caching, Queues)
  // ============================================================
  redis: {
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },

  // ============================================================
  // FILE STORAGE
  // ============================================================
  storage: {
    provider: process.env.STORAGE_PROVIDER || 'supabase',
    bucket: process.env.STORAGE_BUCKET || 'revluma-uploads',
    supabase: {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    aws: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
      bucket: process.env.AWS_S3_BUCKET,
    },
  },

  // ============================================================
  // LOGGING & MONITORING
  // ============================================================
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
  },

  sentry: {
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || 'development',
  },

  // ============================================================
  // CORS CONFIGURATION
  // ============================================================
  cors: {
    origins: (process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean),
  },

  // ============================================================
  // AFFILIATE SYSTEM & RAPP
  // ============================================================
  affiliate: {
    referralLinkExpiryDays: parseInt(process.env.REFERRAL_LINK_EXPIRY_DAYS || '365', 10),
    defaultCommissionRate: parseFloat(process.env.DEFAULT_COMMISSION_RATE || '0.20'),
    referralCode: {
      length: 8,
      format: 'alphanumeric',
    },
  },

  // RAPP Vetting System
  rapp: {
    accessToken: process.env.RAPP_ACCESS_TOKEN,
    vettingEmail: process.env.RAPP_VETTING_EMAIL,
    minimumDistributionChannels: 2,
    accessTokenExpiryDays: parseInt(process.env.RAPP_ACCESS_TOKEN_EXPIRY_DAYS || '30', 10),
  },

  // ============================================================
  // RATE LIMITING
  // ============================================================
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 300,
    authWindow: 15 * 60 * 1000,
    authMax: 50,
  },

  // ============================================================
  // HELPER FUNCTIONS
  // ============================================================
  getAffiliateLink: (username, uniqueId) => {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, '');
    return `${baseUrl}/r/${username}-${uniqueId}`;
  },

  getEmailLink: (path) => {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, '');
    return `${baseUrl}${path}`;
  }
};
