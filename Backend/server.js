const dotenv = require('dotenv');
dotenv.config();

const logger = require('./src/utils/logger');

process.on('uncaughtException', (err) => {
    logger.error('uncaught_exception', {
        message: err.message,
        stack: err.stack
    });
    process.exit(1);
});

const app = require('./src/app');
const { connectDB } = require('./src/configs/database');
const { connectRedis } = require('./src/configs/redis');
const { startKeepAlive } = require('./src/utils/keepAlive');

const {
    startScheduler,
    stopScheduler,
} = require('./src/services/schedulerService');

connectDB();
connectRedis(); // Non-blocking — falls back to in-memory if unavailable

// Start keep-alive service to prevent Render free tier sleep
startKeepAlive();

// Start background scheduler
startScheduler();

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
    logger.info(`server_started`, {
        port: PORT,
        backend: process.env.BACKEND_URL || 'not_configured'
    });
});


// ── Keep-alive pings ──────────────────────────────────────────────────────────
// Render free tier sleeps after 15 minutes of inactivity.
// Ping both services every 9 minutes to prevent cold starts.
// Self-ping: Node pings itself. Python-ping: Node pings Python health endpoint.

const SELF_URL   = process.env.RENDER_EXTERNAL_URL || 'https://revluma-backend.onrender.com';
const PYTHON_URL = process.env.PYTHON_SERVICE_URL  || 'https://revluma-python.onrender.com';

function keepAlive() {
  const http = require('https');

  // Ping Node backend
  http.get(`${SELF_URL}/health`, (res) => {
    logger.info('keep_alive_node', { status: res.statusCode });
  }).on('error', (err) => {
    logger.warn('keep_alive_node_error', { error: err.message });
  });

  // Ping Python service
  http.get(`${PYTHON_URL}/health`, (res) => {
    logger.info('keep_alive_python', { status: res.statusCode });
  }).on('error', (err) => {
    logger.warn('keep_alive_python_error', { error: err.message });
  });
}

// Start pinging 60 seconds after boot, then every 9 minutes
setTimeout(() => {
  keepAlive();
  setInterval(keepAlive, 9 * 60 * 1000);
}, 60 * 1000);

// Graceful shutdown
function gracefulShutdown(signal) {
    logger.info(`shutdown_signal_received`, { signal });

    // Stop background scheduler
    stopScheduler();

    server.close(() => {
        logger.info('server_closed');
        process.exit(0);
    });

    // Force exit after 10s if connections don't drain
    setTimeout(() => {
        logger.error('shutdown_timeout_forced');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
    logger.error('unhandled_rejection', {
        message: err.message || String(err),
        stack: err.stack
    });

    gracefulShutdown('unhandledRejection');
});