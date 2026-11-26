'use strict';

/**
 * Regressions for the 2026-11 production login outage.
 *
 * Every limiter was pinned to a RedisStore at module load. When Redis accepted
 * connections but failed commands, express-rate-limit (passOnStoreError: false)
 * turned each store error into a 500, so every /api request — including
 * POST /api/v1/auth/login — answered "An unexpected server error occurred"
 * before any controller ran. All limiters also shared the `rl:` prefix, so the
 * global API limiter and the login limiter incremented the same counter.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const {
  ResilientRateLimitStore,
  createLimiter,
} = require('../middlewares/rateLimiter');
const globalHandler = require('../middlewares/globalHandler');

const WINDOW = { windowMs: 60 * 1000 };

function quietLog() {
  const entries = [];
  return {
    entries,
    warn: (event, data) => entries.push({ level: 'warn', event, data }),
    info: (event, data) => entries.push({ level: 'info', event, data }),
    error: (event, data) => entries.push({ level: 'error', event, data }),
  };
}

/** A Redis-backed store stand-in sharing one keyspace, like a real Redis. */
function fakeRedisBackend() {
  const keys = new Map();
  const behaviour = { mode: 'ok' }; // 'ok' | 'error' | 'hang'
  const calls = [];
  const create = ({ prefix }) => {
    const act = async (op, key, fn) => {
      calls.push({ op, key: `${prefix}${key}` });
      if (behaviour.mode === 'error') {
        const error = new Error('ERR max requests limit exceeded');
        error.name = 'ReplyError';
        throw error;
      }
      if (behaviour.mode === 'hang') return new Promise(() => {});
      return fn(`${prefix}${key}`);
    };
    return {
      init: async () => {},
      increment: (key) => act('increment', key, (k) => {
        const totalHits = (keys.get(k) || 0) + 1;
        keys.set(k, totalHits);
        return { totalHits, resetTime: new Date(Date.now() + 60000) };
      }),
      get: (key) => act('get', key, (k) => (keys.has(k) ? { totalHits: keys.get(k), resetTime: new Date() } : undefined)),
      decrement: (key) => act('decrement', key, (k) => { keys.set(k, Math.max(0, (keys.get(k) || 0) - 1)); }),
      resetKey: (key) => act('resetKey', key, (k) => { keys.delete(k); }),
    };
  };
  return { keys, behaviour, calls, create };
}

function storeWith(backend, overrides = {}) {
  const client = { call: async () => 'OK' };
  const store = new ResilientRateLimitStore({
    prefix: 'rl:test:',
    redisReady: () => true,
    redisClient: () => client,
    createRedisStore: backend.create,
    log: quietLog(),
    ...overrides,
  });
  store.init(WINDOW);
  return store;
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('healthy Redis serves the counters', async () => {
  const backend = fakeRedisBackend();
  const store = storeWith(backend);

  assert.equal((await store.increment('1.2.3.4')).totalHits, 1);
  assert.equal((await store.increment('1.2.3.4')).totalHits, 2);
  assert.equal(backend.keys.get('rl:test:1.2.3.4'), 2);
});

test('a Redis command failure falls back to memory instead of throwing', async () => {
  const backend = fakeRedisBackend();
  backend.behaviour.mode = 'error';
  const log = quietLog();
  const store = storeWith(backend, { log });

  // MemoryStore returns its live client record, so read the count immediately.
  const first = (await store.increment('1.2.3.4')).totalHits;
  const second = (await store.increment('1.2.3.4')).totalHits;

  assert.equal(first, 1);
  assert.equal(second, 2, 'memory keeps limiting while Redis is down');
  const degraded = log.entries.filter((entry) => entry.event === 'rate_limit_store_degraded');
  assert.equal(degraded.length, 1, 'degradation is logged once, not per request');
  assert.equal(degraded[0].data.error_type, 'ReplyError');
  assert.equal(degraded[0].data.fallback, 'memory');
});

test('the breaker skips Redis during the cooldown and recovers afterwards', async () => {
  const backend = fakeRedisBackend();
  let clock = 1_000_000;
  const log = quietLog();
  const store = storeWith(backend, { now: () => clock, cooldownMs: 30_000, log });

  backend.behaviour.mode = 'error';
  await store.increment('k');
  const callsAfterTrip = backend.calls.length;

  await store.increment('k');
  await store.increment('k');
  assert.equal(backend.calls.length, callsAfterTrip, 'no Redis calls while the breaker is open');

  backend.behaviour.mode = 'ok';
  clock += 30_001;
  const result = await store.increment('k');
  assert.equal(result.totalHits, 1, 'counted in Redis again after recovery');
  assert.equal(backend.calls.length, callsAfterTrip + 1);
  assert.ok(log.entries.some((entry) => entry.event === 'rate_limit_store_recovered'));
});

test('a hung Redis is abandoned after the command timeout', async () => {
  const backend = fakeRedisBackend();
  backend.behaviour.mode = 'hang';
  const store = storeWith(backend, { timeoutMs: 25 });

  const started = Date.now();
  const result = await store.increment('k');
  assert.equal(result.totalHits, 1);
  assert.ok(Date.now() - started < 1000, 'the request is not held hostage by Redis');
});

test('Redis not ready, or a broken client accessor, uses memory', async () => {
  const backend = fakeRedisBackend();
  const notReady = storeWith(backend, { redisReady: () => false });
  assert.equal((await notReady.increment('k')).totalHits, 1);

  const throwing = storeWith(backend, { redisReady: () => { throw new Error('boom'); } });
  assert.equal((await throwing.increment('k')).totalHits, 1);
  assert.equal(backend.calls.length, 0);
});

test('a store that cannot be constructed degrades instead of crashing', async () => {
  const store = storeWith(fakeRedisBackend(), {
    createRedisStore: () => { throw new TypeError('bad options'); },
  });
  assert.equal((await store.increment('k')).totalHits, 1);
});

test('works with the real rate-limit-redis store when Redis replies with errors', async () => {
  // Connected-but-failing Redis: the exact production shape.
  const failingClient = {
    call: async () => {
      const error = new Error('ERR max requests limit exceeded');
      error.name = 'ReplyError';
      throw error;
    },
  };
  const log = quietLog();
  const store = new ResilientRateLimitStore({
    prefix: 'rl:real:',
    redisReady: () => true,
    redisClient: () => failingClient,
    log,
  });
  store.init(WINDOW);

  assert.equal((await store.increment('k')).totalHits, 1);
  assert.equal(log.entries[0].event, 'rate_limit_store_degraded');
});

test('a prefix is required so limiters cannot share counters by accident', () => {
  assert.throws(() => new ResilientRateLimitStore({}), /unique prefix/);
});

test('incident regression: failing Redis no longer turns login into a 500', async () => {
  const backend = fakeRedisBackend();
  backend.behaviour.mode = 'error';
  const storeOptions = {
    redisReady: () => true,
    redisClient: () => ({ call: async () => 'OK' }),
    createRedisStore: backend.create,
    log: quietLog(),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/', createLimiter('api', { windowMs: 60000, max: 60, error: 'api', skip: () => false, storeOptions }));
  app.post('/api/v1/auth/login',
    createLimiter('login', { windowMs: 900000, max: 10, error: 'login', skip: () => false, storeOptions }),
    (req, res) => res.status(401).json({ success: false, error: 'Invalid credentials' }));
  app.use(globalHandler);

  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: { email: 'nobody@example.invalid', password: 'x' } }),
    });
    assert.equal(response.status, 401, 'the request reaches the controller');
    assert.deepEqual(await response.json(), { success: false, error: 'Invalid credentials' });
  });
});

test('limits still apply from memory while Redis is failing', async () => {
  const backend = fakeRedisBackend();
  backend.behaviour.mode = 'error';
  const app = express();
  app.get('/limited',
    createLimiter('probe', {
      windowMs: 60000, max: 2, error: 'Too many', skip: () => false,
      storeOptions: { redisReady: () => true, redisClient: () => ({ call: async () => 'OK' }), createRedisStore: backend.create, log: quietLog() },
    }),
    (req, res) => res.json({ ok: true }));

  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/limited`)).status, 200);
    assert.equal((await fetch(`${base}/limited`)).status, 200);
    const blocked = await fetch(`${base}/limited`);
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { success: false, error: 'Too many' });
  });
});

test('the API and login limiters no longer share one Redis counter', async () => {
  const backend = fakeRedisBackend();
  const storeOptions = {
    redisReady: () => true,
    redisClient: () => ({ call: async () => 'OK' }),
    createRedisStore: backend.create,
    log: quietLog(),
  };
  const app = express();
  app.use('/api/', createLimiter('api', { windowMs: 60000, max: 60, error: 'api', skip: () => false, storeOptions }));
  app.get('/api/v1/dashboard', (req, res) => res.json({ ok: true }));
  app.post('/api/v1/auth/login',
    createLimiter('login', { windowMs: 900000, max: 10, error: 'Too many login attempts', skip: () => false, storeOptions }),
    (req, res) => res.json({ ok: true }));

  await withServer(app, async (base) => {
    // Twelve ordinary dashboard requests must not exhaust the login budget.
    for (let i = 0; i < 12; i += 1) {
      assert.equal((await fetch(`${base}/api/v1/dashboard`)).status, 200);
    }
    assert.equal((await fetch(`${base}/api/v1/auth/login`, { method: 'POST' })).status, 200);
  });

  const namespaces = new Set([...backend.keys.keys()].map((key) => key.split(':').slice(0, 2).join(':')));
  assert.deepEqual([...namespaces].sort(), ['rl:api', 'rl:login']);
});

test('every exported limiter has its own namespace', () => {
  const source = fs.readFileSync(path.join(__dirname, '../middlewares/rateLimiter.js'), 'utf8');
  const names = [...source.matchAll(/createLimiter\('([^']+)'/g)].map((match) => match[1]);
  assert.equal(names.length, 12);
  assert.equal(new Set(names).size, names.length, `duplicate limiter names: ${names.join(', ')}`);
  assert.doesNotMatch(source, /resolveStore\(\)/, 'no limiter may bind a store once at module load');
});

test('unexpected 500s carry a request id so they can be traced in logs', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const app = express();
    app.use((req, res, next) => { req.requestId = 'req-1234abcd'; next(); });
    app.get('/boom', () => { throw new Error('secret internal detail'); });
    app.use(globalHandler);

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/boom`);
      assert.equal(response.status, 500);
      const body = await response.json();
      assert.equal(body.error, 'An unexpected server error occurred');
      assert.equal(body.request_id, 'req-1234abcd');
      assert.equal(JSON.stringify(body).includes('secret internal detail'), false);
    });
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('a disallowed CORS origin is a 403, not an unexpected server error', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const app = express();
    app.get('/x', (req, res, next) => {
      const error = new Error('CORS: origin not allowed');
      error.code = 'CORS_ORIGIN_NOT_ALLOWED';
      error.statusCode = 403;
      next(error);
    });
    app.use(globalHandler);

    await withServer(app, async (base) => {
      const response = await fetch(`${base}/x`);
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, 'This origin is not allowed to call the Revluma API.');
    });
  } finally {
    process.env.NODE_ENV = previous;
  }
});
