// Render Free Tier Keep-Alive Service
// Pings both Node backend and Python intelligence service every 10 minutes
// Prevents Render free tier auto-sleep on both services

const axios = require('axios');
require('dotenv').config();
const logger = require('./logger');

const BACKEND_URL    = process.env.BACKEND_URL    || 'https://revluma-backend.onrender.com';
const PYTHON_URL     = process.env.PYTHON_SERVICE_URL;
const PING_INTERVAL  = 10 * 60 * 1000; // 10 minutes

const ping = async (url, name) => {
  try {
    const response = await axios.get(`${url}/health`, { timeout: 8000 });
    logger.debug('keepalive_ok', { service: name, status: response.status });
    return true;
  } catch (error) {
    logger.warn('keepalive_failed', { service: name, message: error.message });
    // Retry in 1 minute on failure
    setTimeout(() => ping(url, name), 60 * 1000);
    return false;
  }
};

const pingAll = () => {
  ping(BACKEND_URL, 'node-backend');
  if (PYTHON_URL) {
    ping(PYTHON_URL, 'python-intelligence');
  }
};

const startKeepAlive = () => {
  logger.info('keepalive_started', {
    backend: BACKEND_URL,
    python:  PYTHON_URL || 'not configured',
    interval: '10m',
  });

  // Initial ping immediately
  pingAll();

  // Then every 10 minutes
  setInterval(pingAll, PING_INTERVAL);
};

module.exports = { startKeepAlive, keepAliveBackend: pingAll };

if (require.main === module) {
  startKeepAlive();
}