const dotenv = require('dotenv');
dotenv.config();

const logger = require('./src/utils/logger');

process.on('uncaughtException', (err) => {
    logger.error('uncaught_exception', { message: err.message, stack: err.stack });
    process.exit(1);
});

const app = require('./src/app');
const { connectDB } = require('./src/configs/database');
const { connectRedis } = require('./src/configs/redis');
const { startKeepAlive } = require('./src/utils/keepAlive');

connectDB();
connectRedis(); // Non-blocking — falls back to in-memory if unavailable

// Start keep-alive service to prevent Render free tier sleep
startKeepAlive();

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
    logger.info(`server_started`, { port: PORT, backend: process.env.BACKEND_URL || 'not_configured' });
});

// Graceful shutdown
function gracefulShutdown(signal) {
    logger.info(`shutdown_signal_received`, { signal });
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
    logger.error('unhandled_rejection', { message: err.message || String(err), stack: err.stack });
    gracefulShutdown('unhandledRejection');
});
