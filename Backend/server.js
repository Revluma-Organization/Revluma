const dotenv = require('dotenv');
dotenv.config();

const logger = require('./src/utils/logger');
const { connectDB, disconnectDB } = require('./src/configs/database');
const { connectRedis, disconnectRedis } = require('./src/configs/redis');
const { startKeepAlive, stopKeepAlive } = require('./src/utils/keepAlive');
const { startScheduler, stopScheduler } = require('./src/services/schedulerService');

const PORT = process.env.PORT || 8080;
let server = null;
let shuttingDown = false;

async function startServer() {
  await connectDB();
  await connectRedis();
  // Rate-limit stores are selected while the app is loaded, so initialize Redis
  // first to ensure production instances use the shared store when configured.
  const app = require('./src/app');
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(PORT, () => resolve(listener));
    listener.once('error', reject);
  });
  startScheduler();
  startKeepAlive();
  logger.info('server_started', {
    port: PORT,
    backend: process.env.BACKEND_URL || 'not_configured',
  });
  return server;
}

async function gracefulShutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown_signal_received', { signal });
  const forcedExit = setTimeout(() => {
    logger.error('shutdown_timeout_forced');
    process.exit(1);
  }, 10000);
  forcedExit.unref();
  stopScheduler();
  stopKeepAlive();
  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      logger.info('server_closed');
    }
    await Promise.allSettled([disconnectRedis(), disconnectDB()]);
    clearTimeout(forcedExit);
    process.exit(exitCode);
  } catch (error) {
    logger.error('shutdown_failed', { error_type: error.code || error.name || 'shutdown_error' });
    process.exit(1);
  }
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', { error_type: error.code || error.name || 'uncaught_error' });
  void gracefulShutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (error) => {
  logger.error('unhandled_rejection', { error_type: error?.code || error?.name || 'unhandled_rejection' });
  void gracefulShutdown('unhandledRejection', 1);
});

if (require.main === module) {
  startServer().catch((error) => {
    logger.error('server_start_failed', { error_type: error.code || error.name || 'startup_error' });
    process.exit(1);
  });
}

module.exports = { gracefulShutdown, startServer };
