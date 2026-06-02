const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const logger = require('./src/utils/logger');
const { checkConnection, closeConnection } = require('./src/services/prisma');
const errorHandler = require('./src/middleware/errorHandler');
const { authenticate } = require('./src/middleware/sessionAuth');
const { checkRedisHealth } = require('./src/queue/redis');
const { triggerIngest } = require('./src/pipeline/ingestionPipeline');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';

// ============================================================
// Security & Middleware
// ============================================================

app.use(helmet({
  contentSecurityPolicy: isProduction ? undefined : false
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// CORS — single options object
const parseOrigins = value =>
  typeof value === 'string'
    ? value.split(',').map(entry => entry.trim()).filter(Boolean)
    : [];

function normalizeOriginUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let origin = raw.trim().replace(/\/$/, '').replace(/\\n/g, '').replace(/^["']|["']$/g, '');
  if (!origin) return null;
  if (!/^https?:\/\//i.test(origin)) {
    origin = `https://${origin}`;
  }
  return origin;
}

const configuredOrigins = new Set(
  [
    ...parseOrigins(process.env.CORS_ORIGINS),
    ...parseOrigins(process.env.ALLOWED_ORIGINS),
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.BASE_URL,
    process.env.FRONTEND_URL,
    'https://revluma.vercel.app',
    'https://www.revluma.vercel.app',
    'https://revluma.onrender.com',
    'http://localhost:5173',
    'http://localhost:5000'
  ]
    .map(normalizeOriginUrl)
    .filter(Boolean)
);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const normalized = normalizeOriginUrl(origin);
    if (normalized && configuredOrigins.has(normalized)) return callback(null, true);
    logger.warn('CORS origin denied', { origin: normalized, allowed: [...configuredOrigins] });
    return callback(new Error(`CORS origin denied: ${normalized}`), false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-CSRF-Token',
    'X-Request-ID',
    'X-Correlation-ID',
    'X-Affiliate-Portal',
    'x-affiliate-portal'
  ],
  exposedHeaders: ['X-Correlation-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  credentials: true,
  optionsSuccessStatus: 204,
  preflightContinue: false
};

app.use(cors(corsOptions));

app.use(morgan(isProduction ? 'combined' : 'dev', {
  stream: { write: msg => logger.info(msg.trim()) }
}));

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests - please slow down' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use(globalLimiter);

// ============================================================
// Auth Routes
// ============================================================

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Too many registration attempts' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/auth', authLimiter, require('./src/routes/auth'));

const sessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { error: 'Too many session requests - please slow down' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/session', sessionLimiter, require('./src/routes/authSession'));

// ============================================================
// Affiliate onboarding (RAPP)
// ============================================================
const affiliateAuthLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many affiliate registration attempts' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/affiliate-auth', affiliateAuthLimiter, require('./src/routes/affiliateAuth'));

app.use('/api/webhook', rateLimit({ windowMs: 60 * 1000, max: 50 }), require('./src/routes/webhook'));
app.use('/api/trending', require('./src/routes/trending'));

app.use('/api/watchlist', require('./src/routes/watchlist'));
app.use('/api/shopify', require('./src/routes/shopify'));
app.use('/api/newsletter', require('./src/routes/newsletter'));
app.use('/api/videos', require('./src/routes/videos'));

// Store routes
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { createStoreRoutes } = require('./src/routes/stores');
app.use('/api/stores', createStoreRoutes(prisma));

// Webhook endpoints per platform
const { createWebhookRouter } = require('./src/routes/webhooks');
app.use('/api/webhooks/shopify', createWebhookRouter('shopify', prisma));
app.use('/api/webhooks/woocommerce', createWebhookRouter('woocommerce', prisma));
app.use('/api/webhooks/bigcommerce', createWebhookRouter('bigcommerce', prisma));

// Tracking pixel (public, no auth)
const { createTrackingPixelRouter } = require('./src/routes/tracking');
app.use('/api/tracking', createTrackingPixelRouter(prisma));

// ============================================================
// Public API routes (no authentication required)
// ============================================================

// Public referral redirect route
// Format: /r/splendor-48us
app.use('/r', require('./src/routes/v1/referral-redirect'));

// Waitlist API (public)
app.use('/api/waitlist', require('./src/routes/v1/waitlist'));

// ============================================================
// Protected API routes — all use the unified session authenticate
// ============================================================

app.use('/api/v1/dashboard', authenticate, require('./src/routes/v1/dashboard'));
app.use('/api/v1/metrics', authenticate, require('./src/routes/v1/metrics'));
app.use('/api/v1/insights', authenticate, require('./src/routes/v1/insights'));
app.use('/api/v1/customers', authenticate, require('./src/routes/v1/customers'));
app.use('/api/v1/user', authenticate, require('./src/routes/v1/user'));
app.use('/api/v1/notifications', authenticate, require('./src/routes/v1/notifications'));

// Affiliate routes (authenticated)
app.use('/api/affiliate', authenticate, require('./src/routes/v1/affiliate'));

// ============================================================
// AFFILIATE PORTAL SPA — MUST be BEFORE /affiliate/:code tracking
// ============================================================

// Affiliate portal SPA fallback — serve index.html for all /affiliate/* routes
// This also covers /affiliate/login, /affiliate/signup, etc.
const affiliateSpaPath = path.join(__dirname, 'Frontend', 'Affiliate', 'index.html');

app.use(/^\/affiliate\//, (req, res, next) => {
  if (req.path.startsWith('/affiliate/api/')) {
    return next();
  }
  res.sendFile(affiliateSpaPath);
});

app.get('/affiliate', (req, res) => {
  res.sendFile(affiliateSpaPath);
});

// Waitlist page
app.get('/waitlist', (req, res) => {
  res.sendFile(affiliateSpaPath);
});

// ============================================================
// Partner referral redirect (backward compatibility)
// These are AFTER the SPA routes so they don't intercept SPA paths
// ============================================================

app.get('/partner/:code', (req, res, next) => {
  const { code } = req.params;
  const reservedRoutes = ['login', 'signup', 'verify-email', 'access-token', 'pending-review', 'rejected', 'dashboard', 'settings', 'admin', 'api'];
  if (reservedRoutes.includes(code)) {
    return next();
  }
  require('./src/routes/v1/affiliate-tracking')(req, res, next);
});

app.get('/affiliate/:code', (req, res, next) => {
  const { code } = req.params;
  const reservedRoutes = ['login', 'signup', 'verify-email', 'access-token', 'pending-review', 'rejected', 'dashboard', 'settings', 'admin', 'api'];
  if (reservedRoutes.includes(code)) {
    return next();
  }
  require('./src/routes/v1/affiliate-tracking')(req, res, next);
});

// ============================================================
// Static frontend (after all dynamic routes)
// ============================================================

app.use(express.static(path.join(__dirname, '..', 'Frontend')));

// Admin endpoints
app.use('/api/affiliate/admin', authenticate, require('./src/routes/v1/affiliateAdmin'));

app.post('/api/admin/ingest', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const result = await triggerIngest(req.body.sourceName);
    res.json({ message: result });
  } catch (err) {
    logger.error('Admin ingest failed', { error: err.message });
    res.status(500).json({ error: 'Ingest trigger failed' });
  }
});

// Root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'Frontend', 'index.html'));
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const dbHealthy = await checkConnection();
    const redisHealthy = await checkRedisHealth();
    res.json({
      status: dbHealthy && redisHealthy ? 'healthy' : 'degraded',
      uptime: process.uptime(),
      database: dbHealthy ? 'connected' : 'disconnected',
      redis: redisHealthy ? 'connected' : 'disconnected',
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error('Health check failed', { error: err.message });
    res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// Dashboard SPA fallback
app.get(/^\/dashboard/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'Frontend', 'Dashboard', 'index.html'));
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use(errorHandler);

// ============================================================
// Server Startup
// ============================================================

async function startServer() {
  try {
    const dbHealthy = await checkConnection();
    if (!dbHealthy) {
      logger.error('Database connection failed - cannot start server');
      if (isProduction) process.exit(1);
    }

    let redisHealthy = false;
    try {
      redisHealthy = await checkRedisHealth();
    } catch (err) {
      logger.warn('Redis check failed', { error: err.message });
    }

    const server = app.listen(PORT, () => {
      logger.info('Server started', {
        port: PORT,
        environment: process.env.NODE_ENV,
        database: dbHealthy ? 'connected' : 'disconnected',
        redis: redisHealthy ? 'connected' : 'disconnected'
      });
    });

    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal} - starting graceful shutdown`);
      server.close(async () => {
        logger.info('HTTP server closed');
        try {
          await closeConnection();
          logger.info('Database connection closed');
        } catch (err) {
          logger.error('Error closing database connection', { error: err.message });
        }
        process.exit(0);
      });
      setTimeout(() => {
        logger.error('Graceful shutdown timeout - forcing exit');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (err) {
    logger.error('Server startup failed', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
  process.exit(1);
});

startServer();
