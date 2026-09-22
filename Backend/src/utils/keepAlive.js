// Render Free Tier Keep-Alive Service
// Pings both Node backend and Python intelligence service every 10 minutes
// Prevents Render free tier auto-sleep on both services

const axios = require('axios');
require('dotenv').config();
const logger = require('./logger');

const BACKEND_URL    = process.env.BACKEND_URL    || 'https://revluma-backend.onrender.com';
const PYTHON_URL     = process.env.PYTHON_SERVICE_URL;
const PING_INTERVAL  = 10 * 60 * 1000; // 10 minutes
let intervalHandle = null;
const retryHandles = new Set();

const ping = async (url, name) => {
  try {
    const response = await axios.get(`${url}/health`, { timeout: 8000 });
    logger.debug('keepalive_ok', { service: name, status: response.status });
    return true;
  } catch (error) {
    logger.warn('keepalive_failed', {
      service: name,
      error_type: error.code || error.name || 'request_error',
    });
    // Retry in 1 minute on failure
    const handle = setTimeout(() => {
      retryHandles.delete(handle);
      void ping(url, name);
    }, 60 * 1000);
    retryHandles.add(handle);
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
  if (intervalHandle) return;
  logger.info('keepalive_started', {
    backend: BACKEND_URL,
    python:  PYTHON_URL || 'not configured',
    interval: '10m',
  });

  // Initial ping immediately
  pingAll();

  // Then every 10 minutes
  intervalHandle = setInterval(pingAll, PING_INTERVAL);
};

const stopKeepAlive = () => {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  for (const handle of retryHandles) clearTimeout(handle);
  retryHandles.clear();
};

module.exports = { startKeepAlive, stopKeepAlive, keepAliveBackend: pingAll };

if (require.main === module) {
  startKeepAlive();
}
