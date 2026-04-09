require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

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

// CORS - restrict origins in production
app.use(cors({
  origin: isProduction 
    ? ['https://revluma.vercel.app', 'https://revluma.onrender.com'] 
    : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

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
app.use('/api/auth', rateLimit({ 
  windowMs: 15 * 60 * 1000, 
  max: 20 
}), require('./src/routes/auth'));

// Other API routes
app.use('/api/webhook', rateLimit({ 
  windowMs: 60 * 1000, 
  max: 50 
}), require('./src/routes/webhook'));

app.use('/api/trending', require('./src/routes/trending'));
app.use('/api/watchlist', require('./src/routes/watchlist'));
app.use('/api/shopify', require('./src/routes/shopify'));
app.use('/api/newsletter', require('./src/routes/newsletter'));
app.use('/api/videos', require('./src/routes/videos'));

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