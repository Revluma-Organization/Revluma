/**
 * Redis connection for shared rate-limit counters across instances.
 *
 * Configuration:
 *   REDIS_URL — full Redis URL (e.g. redis://default:pass@host:6379/0)
 *   REDIS_HOST, REDIS_PORT, REDIS_PASSWORD — individual env vars (used if REDIS_URL not set)
 *
 * Behavior:
 *   - If Redis is configured and reachable, rate limiters use it as a shared store.
 *   - If Redis is not configured or connection fails, falls back to in-memory (single-instance).
 *   - Redis connection errors are logged but never crash the server.
 */

const Redis = require('ioredis');
const logger = require('../utils/logger');

let redisClient = null;
let redisReady = false;

function createRedisClient() {
  const url = process.env.REDIS_URL;
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT;
  const password = process.env.REDIS_PASSWORD;

  const opts = {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) {
        logger.warn('redis_retry_limit_reached', { attempts: times });
        return null; // stop retrying
      }
      return Math.min(times * 200, 3000); // backoff up to 3s
    },
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 5000,
  };

  if (url) {
    return new Redis(url, opts);
  }
  if (host) {
    return new Redis({
      host,
      port: parseInt(port || '6379'),
      password: password || undefined,
      ...opts,
    });
  }
  return null;
}

function getRedisClient() {
  return redisClient;
}

function isRedisReady() {
  return redisReady && redisClient && redisClient.status === 'ready';
}

async function connectRedis() {
  redisClient = createRedisClient();
  if (!redisClient) {
    logger.info('redis_not_configured', { note: 'Using in-memory rate limiter store' });
    return;
  }

  try {
    await redisClient.connect();
    redisReady = true;
    logger.info('redis_connected', {
      host: redisClient.options.host || 'from_url',
      port: redisClient.options.port,
    });

    redisClient.on('error', (err) => {
      redisReady = false;
      logger.warn('redis_error', { message: err.message });
    });

    redisClient.on('ready', () => {
      redisReady = true;
      logger.info('redis_ready');
    });

    redisClient.on('close', () => {
      redisReady = false;
      logger.warn('redis_disconnected');
    });
  } catch (err) {
    redisReady = false;
    logger.warn('redis_connection_failed', {
      message: err.message,
      note: 'Falling back to in-memory rate limiter',
    });
    // Don't crash — fail open to in-memory store
  }
}

module.exports = { connectRedis, getRedisClient, isRedisReady };
