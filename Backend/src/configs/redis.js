/**
 * Redis connection for shared rate-limit counters and distributed locks.
 *
 * Configuration:
 *   REDIS_URL — full Redis URL (e.g. redis://default:pass@host:6379/0)
 *   REDIS_HOST, REDIS_PORT, REDIS_PASSWORD — individual env vars (used if REDIS_URL not set)
 *
 * Behavior:
 *   - If Redis is configured and reachable, rate limiters use it as a shared store.
 *   - If Redis is not configured or connection fails, falls back to in-memory (single-instance).
 *   - Redis connection errors are logged but never crash the server.
 *
 * Recovery:
 *   A transient Redis outage must not permanently disable Redis-backed
 *   behaviour. The previous `retryStrategy` returned null after five attempts,
 *   which tells ioredis to stop reconnecting for the life of the process, and
 *   `connectRedis()` never retried an initial failure. A brief blip during a
 *   deploy therefore left `isRedisReady()` false until the next restart — which
 *   silently stopped the Business State rebuild for 16+ hours, because that job
 *   required a distributed lock. Retries are now unbounded with capped backoff,
 *   a watchdog re-establishes a dead client, and prolonged unavailability is
 *   logged at error level rather than warned once and forgotten.
 */

const Redis = require('ioredis');
const logger = require('../utils/logger');

const REDIS_MAX_BACKOFF_MS = 30000;
const REDIS_WATCHDOG_INTERVAL_MS = 15000;
// Escalate to an error log once Redis has been unreachable this many watchdog
// passes (~5 minutes), so a persistent outage cannot hide behind one warning.
const REDIS_ESCALATE_AFTER_PASSES = 20;

let redisClient = null;
let redisReady = false;
let redisConfigured = false;
let watchdogTimer = null;
let watchdogPasses = 0;

function createRedisClient() {
  const url = process.env.REDIS_URL;
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT;
  const password = process.env.REDIS_PASSWORD;

  const opts = {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      // Always return a delay. Returning null stops reconnection permanently,
      // which is what turned a transient blip into a multi-hour outage.
      const backoff = Math.min(times * 500, REDIS_MAX_BACKOFF_MS);

      if (times === 1 || times === 5 || times % 40 === 0) {
        logger.warn('redis_retrying', { attempts: times, next_attempt_ms: backoff });
      }

      return backoff;
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
      port: parseInt(port || '6379', 10),
      password: password || undefined,
      ...opts,
    });
  }
  return null;
}

/**
 * Attach listeners before connecting.
 *
 * ioredis emits 'error' on a failed connection. Previously the handlers were
 * attached only *after* `connect()` resolved, so an initial connection failure
 * emitted 'error' with no listener — an unhandled 'error' event, which Node
 * treats as fatal. Handlers are attached first so a failed boot degrades to the
 * in-memory fallback instead of taking the process down.
 */
function attachHandlers(client) {
  client.on('error', (err) => {
    redisReady = false;
    logger.warn('redis_error', { error_type: err.code || err.name || 'redis_error' });
  });

  client.on('ready', () => {
    if (!redisReady) {
      logger.info('redis_ready');
    }
    redisReady = true;
    watchdogPasses = 0;
  });

  client.on('close', () => {
    redisReady = false;
    logger.warn('redis_disconnected');
  });

  client.on('end', () => {
    redisReady = false;
    logger.warn('redis_connection_ended');
  });
}

function getRedisClient() {
  return redisClient;
}

function isRedisReady() {
  return Boolean(redisReady && redisClient && redisClient.status === 'ready');
}

/** Whether Redis was configured at all, independent of current reachability. */
function isRedisConfigured() {
  return redisConfigured;
}

/**
 * Re-establish a client that has stopped reconnecting.
 *
 * Guarded on connection status so the watchdog never calls `connect()` on a
 * client that is already connecting or already ready.
 */
async function attemptReconnect() {
  if (!redisClient || isRedisReady()) {
    return;
  }

  const status = redisClient.status;

  if (status !== 'end' && status !== 'close' && status !== 'wait') {
    return;
  }

  try {
    await redisClient.connect();
  } catch {
    // retryStrategy owns the backoff; the next watchdog pass tries again.
  }
}

function startWatchdog() {
  if (watchdogTimer || !redisConfigured) {
    return;
  }

  watchdogTimer = setInterval(async () => {
    if (isRedisReady()) {
      watchdogPasses = 0;
      return;
    }

    watchdogPasses += 1;

    if (watchdogPasses === REDIS_ESCALATE_AFTER_PASSES) {
      // Anything that depends on Redis has been silently degraded for minutes.
      logger.error('redis_unavailable_persistent', {
        passes: watchdogPasses,
        note: 'rate limiting is per-instance and distributed locks are unavailable',
      });
    }

    await attemptReconnect();
  }, REDIS_WATCHDOG_INTERVAL_MS);

  // Never hold the process open just to babysit Redis.
  watchdogTimer.unref?.();
}

async function connectRedis() {
  redisClient = createRedisClient();
  redisConfigured = Boolean(redisClient);

  if (!redisClient) {
    logger.info('redis_not_configured', { note: 'Using in-memory rate limiter store' });
    return;
  }

  attachHandlers(redisClient);

  try {
    await redisClient.connect();
    redisReady = true;
    logger.info('redis_connected', {
      host: redisClient.options.host || 'from_url',
      port: redisClient.options.port,
    });
  } catch (err) {
    redisReady = false;
    // Error, not warning: Redis-backed rate limiting and any distributed lock
    // are degraded from this moment, and that must be visible.
    logger.error('redis_connection_failed', {
      error_type: err.code || err.name || 'connection_error',
      note: 'Falling back to in-memory rate limiter; watchdog will keep retrying',
    });
    // Don't crash — fail open to in-memory store
  }

  startWatchdog();
}

async function disconnectRedis() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }

  if (!redisClient) {
    redisReady = false;
    redisConfigured = false;
    return;
  }

  try {
    await redisClient.quit();
  } catch {
    // A client that cannot quit cleanly is being discarded anyway.
  } finally {
    redisReady = false;
    redisClient = null;
    redisConfigured = false;
    watchdogPasses = 0;
  }
}

module.exports = {
  connectRedis,
  disconnectRedis,
  getRedisClient,
  isRedisReady,
  isRedisConfigured,
};
