const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

// Import custom modules
const logger = require('./src/utils/logger');
const { checkConnection, closeConnection } = require('./src/services/prisma');
const errorHandler = require('./src/middleware/errorHandler');
const authenticate = require('./src/middleware/auth');
const { checkRedisHealth } = require('./src/queue/redis');
const { triggerIngest } = require('./src/pipeline/ingestionPipeline');

// ============================================================
// Express App Setup
// ============================================================

const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';

// ============================================================
// Security & Middleware
// ============================================================

// Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: isProduction ? undefined : false
}));

// Body parsing with size limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Cookie parser for session-based authentication
app.use(cookieParser());

// CORS - allow configured frontend origins and same-origin requests
const parseOrigins = value => (typeof value === 'string'
  ? value.split(',').map(entry => entry.trim()).filter(Boolean)
  : []);

const configuredOrigins = new Set([
  ...parseOrigins(process.env.CORS_ORIGINS),
  ...parseOrigins(process.env.ALLOWED_ORIGINS),
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL.trim()] : [])
].map(origin => origin.replace(/\/$/, '')));

if (configuredOrigins.size === 0 && isProduction) {
  configuredOrigins.add('https://revluman.vercel.app');
  configuredOrigins.add('https://www.revluman.vercel.app');
  configuredOrigins.add('https://revluma.onrender.com');
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }

    const normalized = origin.replace(/\/$/, '');
    if (configuredOrigins.has(normalized)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS origin denied: ${normalized}`), false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));
app.options('*', cors());

// HTTP logging
app.use(morgan(isProduction ? 'combined' : 'dev', {
  stream: { write: msg => logger.info(msg.trim()) }
}));

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requests per window
  message: { error: 'Too many requests - please slow down' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use(globalLimiter);

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'Frontend')));

// ============================================================
// Routes
// ============================================================

// Auth routes with rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Too many registration attempts' }
});
app.use('/api/auth', authLimiter, require('./src/routes/auth'));

// Session-based auth routes (with cookies)
app.use('/api/session', require('./src/routes/authSession'));

// Other API routes
app.use('/api/webhook', rateLimit({
  windowMs: 60 * 1000,
  max: 50
}), require('./src/routes/webhook'));

app.use('/api/trending', require('./src/routes/trending'));
app.use('/api/watchlist', require('./src/routes/watchlist'));
app.use('/api/shopify', require('./src/routes/shopify'));

// Store routes need prisma instance
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { createStoreRoutes } = require('./src/routes/stores');
app.use('/api/stores', createStoreRoutes(prisma));

// Webhook endpoints for each platform
const { createWebhookRouter } = require('./src/routes/webhooks');
app.use('/api/webhooks/shopify', createWebhookRouter('shopify', prisma));
app.use('/api/webhooks/woocommerce', createWebhookRouter('woocommerce', prisma));
app.use('/api/webhooks/bigcommerce', createWebhookRouter('bigcommerce', prisma));

// WooCommerce tracking pixel (public, no auth)
const { createTrackingPixelRouter } = require('./src/routes/tracking');
app.use('/api/tracking', createTrackingPixelRouter(prisma));
app.use('/api/newsletter', require('./src/routes/newsletter'));
app.use('/api/videos', require('./src/routes/videos'));

// API v1 routes (protected)
app.use('/api/v1/dashboard', authenticate, require('./src/routes/v1/dashboard'));
app.use('/api/v1/metrics', authenticate, require('./src/routes/v1/metrics'));
app.use('/api/v1/insights', authenticate, require('./src/routes/v1/insights'));
app.use('/api/v1/customers', authenticate, require('./src/routes/v1/customers'));
app.use('/api/v1/user', authenticate, require('./src/routes/v1/user'));
app.use('/api/v1/notifications', authenticate, require('./src/routes/v1/notifications'));

// Admin endpoint (protected)
app.post('/api/admin/ingest', authenticate, async (req, res) => {
  try {
    const result = await triggerIngest(req.body.sourceName);
    res.json({ message: result });
  } catch (err) {
    logger.error('Admin ingest failed', { error: err.message });
    res.status(500).json({ error: 'Ingest trigger failed' });
  }
});

// Root endpoint - serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'Frontend', 'index.html'));
});

// Health check endpoint
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

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Centralized error handler
app.use(errorHandler);

// ============================================================
// Server Startup
// ============================================================

async function startServer() {
  try {
    // Verify database connection
    const dbHealthy = await checkConnection();

    if (!dbHealthy) {
      logger.error('Database connection failed - cannot start server');
      if (isProduction) {
        process.exit(1); // Fail fast in production
      }
    }

    // Check Redis (non-blocking)
    let redisHealthy = false;
    try {
      redisHealthy = await checkRedisHealth();
    } catch (err) {
      logger.warn('Redis check failed:', err.message);
    }

    // Start listening
    const server = app.listen(PORT, () => {
      logger.info(`Server started on port ${PORT}`, {
        environment: process.env.NODE_ENV,
        database: dbHealthy ? 'connected' : 'disconnected',
        redis: redisHealthy ? 'connected' : 'disconnected'
      });
    });

    // Graceful shutdown handlers
    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal} - starting graceful shutdown`);

      server.close(async () => {
        logger.info('HTTP server closed');

        try {
          await closeConnection();
          logger.info('Database connection closed');
        } catch (err) {
          logger.error('Error closing database connection:', err.message);
        }

        process.exit(0);
      });

      // Force exit after 10 seconds
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

// ============================================================
// Process Error Handlers
// ============================================================

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection:', { reason: String(reason) });
  process.exit(1);
});

// Start the server
startServer();