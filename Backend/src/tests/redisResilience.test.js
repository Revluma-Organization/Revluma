'use strict';

/**
 * Regressions for Redis connection resilience.
 *
 * The defect: `retryStrategy` returned null after five attempts, which tells
 * ioredis to stop reconnecting for the life of the process, and `connectRedis()`
 * never retried an initial failure. A transient Redis blip during a deploy
 * therefore left `isRedisReady()` false until the next restart. Because the
 * Business State rebuild was the only job demanding a distributed lock, that
 * silently stopped every rebuild for 16+ hours.
 *
 * A second latent defect is also pinned here: event handlers were attached only
 * *after* `connect()` resolved, so an initial connection failure emitted 'error'
 * with no listener — an unhandled 'error' event, which Node treats as fatal.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

/** A minimal ioredis stand-in that records the options it was built with. */
const created = [];

class FakeRedis {
  constructor(target, opts) {
    this.options = typeof target === 'string' ? { host: 'from_url' } : { ...target };
    this.opts = opts;
    this.status = 'wait';
    this.listeners = {};
    // Controlled by each test.
    this.connectBehaviour = FakeRedis.connectBehaviour;
    created.push(this);
  }

  on(event, handler) {
    (this.listeners[event] ||= []).push(handler);
    return this;
  }

  listenerCount(event) {
    return (this.listeners[event] || []).length;
  }

  emit(event, ...args) {
    for (const handler of this.listeners[event] || []) handler(...args);
  }

  async connect() {
    this.status = 'connecting';
    const behaviour = this.connectBehaviour;
    if (behaviour === 'reject') {
      // Emit 'error' the way ioredis does on a failed connection.
      this.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
      this.status = 'end';
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    }
    this.status = 'ready';
    this.emit('ready');
    return undefined;
  }

  async quit() {
    this.status = 'end';
    return undefined;
  }
}

FakeRedis.connectBehaviour = 'resolve';

// Inject the stub before the module under test resolves ioredis.
const ioredisPath = require.resolve('ioredis');
require.cache[ioredisPath] = {
  id: ioredisPath,
  filename: ioredisPath,
  loaded: true,
  exports: FakeRedis,
};

const redisConfig = require('../configs/redis');

test.beforeEach(async () => {
  created.length = 0;
  FakeRedis.connectBehaviour = 'resolve';
  process.env.REDIS_URL = 'redis://localhost:6379/0';
  await redisConfig.disconnectRedis();
});

test.after(async () => {
  delete process.env.REDIS_URL;
  await redisConfig.disconnectRedis();
});

test('retryStrategy never gives up, at any attempt count', async () => {
  await redisConfig.connectRedis();

  const { retryStrategy } = created[0].opts;
  assert.equal(typeof retryStrategy, 'function');

  // The old implementation returned null once `times > 5`, permanently
  // disabling reconnection. Every attempt must now yield a delay.
  for (const attempt of [1, 2, 5, 6, 7, 20, 100, 10000]) {
    const delay = retryStrategy(attempt);
    assert.equal(typeof delay, 'number', `attempt ${attempt} must schedule a retry`);
    assert.ok(delay > 0, `attempt ${attempt} must have a positive delay`);
  }
});

test('retry backoff grows but is capped', async () => {
  await redisConfig.connectRedis();

  const { retryStrategy } = created[0].opts;

  assert.ok(retryStrategy(2) > retryStrategy(1), 'backoff must increase');
  assert.equal(retryStrategy(1000), 30000, 'backoff must be capped');
  assert.equal(retryStrategy(100000), 30000);
});

test('a reachable Redis reports ready', async () => {
  await redisConfig.connectRedis();

  assert.equal(redisConfig.isRedisReady(), true);
  assert.equal(redisConfig.isRedisConfigured(), true);
  assert.ok(redisConfig.getRedisClient());
});

test('an initial connection failure degrades instead of throwing', async () => {
  FakeRedis.connectBehaviour = 'reject';

  // Must not reject: a Redis outage may not take the API server down.
  await redisConfig.connectRedis();

  assert.equal(redisConfig.isRedisReady(), false);
  assert.equal(redisConfig.isRedisConfigured(), true, 'configured but unreachable');
});

test('error listeners are attached before connecting, so a failed boot cannot crash', async () => {
  FakeRedis.connectBehaviour = 'reject';

  await redisConfig.connectRedis();

  // The 'error' event fired during connect() must already have had a listener.
  // With none, Node treats an emitted 'error' as fatal.
  const client = created[0];
  assert.ok(client.listenerCount('error') >= 1, 'error handler must be attached');
  assert.ok(client.listenerCount('close') >= 1);
  assert.ok(client.listenerCount('ready') >= 1);
});

test('a lost connection clears readiness', async () => {
  await redisConfig.connectRedis();
  assert.equal(redisConfig.isRedisReady(), true);

  const client = created[0];
  client.status = 'end';
  client.emit('close');

  assert.equal(redisConfig.isRedisReady(), false);
});

test('readiness recovers when the client becomes ready again', async () => {
  await redisConfig.connectRedis();
  const client = created[0];

  client.status = 'end';
  client.emit('close');
  assert.equal(redisConfig.isRedisReady(), false);

  // The watchdog's job: a client that comes back must be trusted again.
  client.status = 'ready';
  client.emit('ready');

  assert.equal(redisConfig.isRedisReady(), true);
});

test('Redis absence is reported as not configured, not as ready', async () => {
  delete process.env.REDIS_URL;
  delete process.env.REDIS_HOST;

  await redisConfig.connectRedis();

  assert.equal(redisConfig.isRedisReady(), false);
  assert.equal(redisConfig.isRedisConfigured(), false);
  assert.equal(redisConfig.getRedisClient(), null);
});

test('disconnect clears state so a later connect starts clean', async () => {
  await redisConfig.connectRedis();
  assert.equal(redisConfig.isRedisReady(), true);

  await redisConfig.disconnectRedis();

  assert.equal(redisConfig.isRedisReady(), false);
  assert.equal(redisConfig.getRedisClient(), null);
  assert.equal(redisConfig.isRedisConfigured(), false);
});

test('disconnect is safe when Redis was never configured', async () => {
  delete process.env.REDIS_URL;
  await redisConfig.connectRedis();

  await assert.doesNotReject(() => redisConfig.disconnectRedis());
  await assert.doesNotReject(() => redisConfig.disconnectRedis());
});
