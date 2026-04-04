const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const logger = require('./src/utils/logger');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const authenticate = require('./src/middleware/auth');
const { triggerIngest } = require('./src/pipeline/ingestionPipeline');
const { checkRedisHealth } = require('./src/queue/redis');
const db = require('./src/config/db');

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';

// ====================== SECURITY & MIDDLEWARE ======================
app.use(helmet({
  contentSecurityPolicy: isProduction ? undefined : false // relax in dev
}));
app.use(express.json({ limit: '1mb' })); // prevent large payloads
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// CORS – restrict to frontend in production
app.use(cors({
  origin: isProduction ? ['https://revluma.vercel.app', 'https://revluma.onrender.com'] : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Logging
app.use(morgan(isProduction ? 'combined' : 'dev', {
  stream: { write: msg => logger.info(msg.trim()) }
}));

// Global rate limit (light – override per-route if needed)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300, // 300 req/15min
  message: { error: 'Too many requests – please slow down' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use(globalLimiter);
app.use(express.static(path.join(__dirname, '..', 'Frontend')));

// ====================== ROUTES ======================
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }), require('./src/routes/auth'));
app.use('/api/webhook', rateLimit({ windowMs: 60 * 1000, max: 50 }), require('./src/routes/webhook'));
app.use('/api/trending', require('./src/routes/trending'));
app.use('/api/watchlist', require('./src/routes/watchlist'));
app.use('/api/shopify', require('./src/routes/shopify'));
app.use('/api/newsletter', require('./src/routes/newsletter'));

// Admin ingest (protect with auth + role later)
app.post('/api/admin/ingest', authenticate, async (req, res) => {
  try {
    const result = await require('./src/pipeline/ingestionPipeline').triggerIngest(req.body.sourceName);
    res.json({ message: result });
  } catch (err) {
    logger.error('Admin ingest failed', { error: err.message });
    res.status(500).json({ error: 'Ingest trigger failed' });
  }
});

// Landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'Frontend', 'index.html'));
});

// Health check (detailed)
app.get('/health', async (req, res) => {
  try {
    await db.checkConnection(); // from db.js
    const redisHealthy = await checkRedisHealth();
    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      redis: redisHealthy ? 'connected' : 'error',
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error('Health check failed', { error: err.message });
    res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler (last)
const errorHandler = require('./src/middleware/errorHandler');
app.use(errorHandler);

// ====================== STARTUP ======================
(async () => {
  try {
    // Health checks (non-fatal in dev)
    const dbHealthy = await db.checkConnection();
    const redisHealthy = await checkRedisHealth();

    // Auto-run schema setup on startup (idempotent - uses IF NOT EXISTS)
    if (dbHealthy) {
      try {
        const fs = require('fs');
        const path = require('path');
        const schemas = [
          'schema-base.sql',
          'schema-recovery.sql',
          'schema-onboarding.sql',
          'schema-email-verification.sql',
          'schema-password-reset.sql',
          'schema-newsletter.sql',
          'schema-splendor.sql'
        ];
        
        logger.info('Checking/setting up database schemas...');
        const client = await db.pool.connect();
        
        for (const schema of schemas) {
          try {
            const content = fs.readFileSync(path.join(__dirname, schema), 'utf8');
            await client.query(content);
            logger.info(`Schema ${schema} applied`);
          } catch (schemaErr) {
            logger.warn(`Schema ${schema}: ${schemaErr.message}`);
          }
        }
        
        client.release();
        logger.info('Database schemas ready');
      } catch (setupErr) {
        logger.warn('Schema setup warning:', setupErr.message);
      }
    }

    if (!isProduction && (!dbHealthy || !redisHealthy)) {
      logger.warn('Startup health check has warnings — continuing in dev mode', {
        db: dbHealthy ? 'healthy' : 'unavailable',
        redis: redisHealthy ? 'healthy' : 'unavailable'
      });
    } else if (isProduction && (!dbHealthy || !redisHealthy)) {
      logger.warn('Startup health check has warnings — continuing in production (limited mode)', {
        db: dbHealthy ? 'healthy' : 'unavailable',
        redis: redisHealthy ? 'healthy' : 'unavailable'
      });
    }

    logger.info(`Revluma Backend starting`, {
      port: PORT,
      env: process.env.NODE_ENV,
      db: dbHealthy ? 'healthy' : 'unavailable',
      redis: redisHealthy ? 'healthy' : 'unavailable'
    });

    // Listen
    const server = app.listen(PORT, () => {
      logger.info(`Server running at http://localhost:${PORT} (env: ${process.env.NODE_ENV})`);
      logger.info("AI-powered cart recovery and product intelligence built to grow your eCommerce business automatically");
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`Received ${signal} – shutting down gracefully`);
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });

      // Force exit after 10s
      setTimeout(() => {
        logger.error('Graceful shutdown timeout – forcing exit');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error('Startup failed', { error: err.message, stack: err.stack });
    process.exit(1);
  }
})();
