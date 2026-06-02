const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function cleanEnvValue(value) {
  if (!value) return '';
  return value.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '').replace(/\/+$/, '');
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

const baseUrl = cleanEnvValue(process.env.NEXT_PUBLIC_BASE_URL) || cleanEnvValue(process.env.BASE_URL) || 'http://localhost:5000';
const frontendUrl = cleanEnvValue(process.env.FRONTEND_URL) || baseUrl;

module.exports = {
  nodeEnv: NODE_ENV,
  isProduction,
  isDevelopment: !isProduction,
  port: parseInt(process.env.PORT || '5000', 10),

  baseUrl: baseUrl.replace(/\/+$/, ''),
  frontendUrl: frontendUrl.replace(/\/+$/, ''),
  apiBaseUrl: baseUrl.replace(/\/+$/, ''),

  database: {
    url: cleanEnvValue(process.env.DATABASE_URL),
    directUrl: cleanEnvValue(process.env.DIRECT_URL),
  },

  jwt: {
    secret: cleanEnvValue(process.env.JWT_SECRET) || cleanEnvValue(process.env.SESSION_SECRET),
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  },

  session: {
    secret: cleanEnvValue(process.env.SESSION_SECRET) || cleanEnvValue(process.env.JWT_SECRET),
    expiresIn: parseInt(process.env.SESSION_EXPIRES_IN || '86400000', 10),
    cookieMaxAge: parseInt(process.env.COOKIE_MAX_AGE || '86400000', 10),
  },

  email: {
    provider: cleanEnvValue(process.env.EMAIL_PROVIDER) || 'sendgrid',
    from: cleanEnvValue(process.env.SMTP_FROM) || 'noreply@revluma.app',
    sendgridApiKey: cleanEnvValue(process.env.SENDGRID_API_KEY),
    smtp: {
      host: cleanEnvValue(process.env.SMTP_HOST),
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: cleanEnvValue(process.env.SMTP_USER),
      pass: cleanEnvValue(process.env.SMTP_PASS),
      secure: process.env.SMTP_SECURE === 'true',
    },
    verificationExpiryHours: parseInt(process.env.EMAIL_VERIFICATION_EXPIRY_HOURS || '24', 10),
  },

  redis: {
    url: cleanEnvValue(process.env.REDIS_URL),
    host: cleanEnvValue(process.env.REDIS_HOST) || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: cleanEnvValue(process.env.REDIS_PASSWORD),
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },

  storage: {
    provider: cleanEnvValue(process.env.STORAGE_PROVIDER) || 'supabase',
    bucket: cleanEnvValue(process.env.STORAGE_BUCKET) || 'revluma-uploads',
    supabase: {
      url: cleanEnvValue(process.env.SUPABASE_URL),
      key: cleanEnvValue(process.env.SUPABASE_KEY),
      serviceRoleKey: cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
    aws: {
      accessKeyId: cleanEnvValue(process.env.AWS_ACCESS_KEY_ID),
      secretAccessKey: cleanEnvValue(process.env.AWS_SECRET_ACCESS_KEY),
      region: cleanEnvValue(process.env.AWS_REGION) || 'us-east-1',
      bucket: cleanEnvValue(process.env.AWS_S3_BUCKET),
    },
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
  },

  sentry: {
    dsn: cleanEnvValue(process.env.SENTRY_DSN),
    environment: process.env.SENTRY_ENVIRONMENT || 'development',
  },

  cors: {
    origins: (cleanEnvValue(process.env.CORS_ORIGINS) || cleanEnvValue(process.env.ALLOWED_ORIGINS) || '')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean),
  },

  affiliate: {
    referralLinkExpiryDays: parseInt(process.env.REFERRAL_LINK_EXPIRY_DAYS || '365', 10),
    defaultCommissionRate: parseFloat(process.env.DEFAULT_COMMISSION_RATE || '0.20'),
    referralCode: {
      length: 8,
      format: 'alphanumeric',
    },
  },

  rapp: {
    accessToken: cleanEnvValue(process.env.RAPP_ACCESS_TOKEN),
    vettingEmail: cleanEnvValue(process.env.RAPP_VETTING_EMAIL) || 'revluma.ai@gmail.com',
    minimumDistributionChannels: 2,
    accessTokenExpiryDays: parseInt(process.env.RAPP_ACCESS_TOKEN_EXPIRY_DAYS || '30', 10),
  },

  rateLimit: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 300,
    authWindow: 15 * 60 * 1000,
    authMax: 50,
  },

  getAffiliateLink: (username, uniqueId) => {
    const bUrl = baseUrl.replace(/\/+$/, '');
    return `${bUrl}/r/${username}-${uniqueId}`;
  },

  getEmailLink: (pathStr) => {
    const bUrl = baseUrl.replace(/\/+$/, '');
    return `${bUrl}${pathStr}`;
  }
};
