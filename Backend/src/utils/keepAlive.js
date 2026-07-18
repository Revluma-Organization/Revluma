// Render Free Tier Keep-Alive Service
// Pings backend every 10 minutes to prevent auto-sleep
// This keeps your Revluma backend running 24/7

const axios = require('axios');
require('dotenv').config();
const logger = require('./logger');

const BACKEND_URL = process.env.BACKEND_URL || 'https://revluma-backend.onrender.com';
const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes in milliseconds

// Keep-alive function
const keepAliveBackend = async () => {
  try {
    const response = await axios.get(`${BACKEND_URL}/health`, {
      timeout: 5000,
    });

    logger.debug('keepalive_ok', { status: response.status });
    return true;
  } catch (error) {
    logger.warn('keepalive_failed', { message: error.message });

    // Retry logic - try again in 1 minute if failed
    setTimeout(keepAliveBackend, 60 * 1000);
    return false;
  }
};

// Start the keep-alive service
const startKeepAlive = () => {
  logger.info('keepalive_started', { url: BACKEND_URL, interval: '10m' });

  // Initial ping immediately
  keepAliveBackend();

  // Then ping every 10 minutes
  setInterval(keepAliveBackend, PING_INTERVAL);
};

// Export for use in other files
module.exports = { startKeepAlive, keepAliveBackend };

// Start if run directly
if (require.main === module) {
  startKeepAlive();
}
