'use strict';

/**
 * Postgres-authoritative coordination: leases and one-time claims.
 *
 * Why this exists
 * ---------------
 * Every correctness-critical lock in the platform used to live in Redis:
 * the per-store Shopify sync lock, every scheduler job lock, the OAuth replay
 * guard and the reconnect session lock. Redis was therefore a single point of
 * failure that failed *silently*: when the provider kept the connection open
 * but rejected commands (quota or memory exhaustion), `isRedisReady()` stayed
 * true, every `SET NX` threw, the callers caught it and returned — and store
 * synchronization, the stall reaper, webhook-delivery recovery and the alert,
 * feature and recovery queues all stopped without leaving a trace. Merchants
 * could not even connect a store, because the OAuth replay guard failed closed.
 *
 * Postgres is already a hard dependency and the system of record for the work
 * being coordinated, so it is the correct authority. Redis remains an
 * optimisation for rate limiting only (which already degrades to memory).
 *
 * Semantics
 * ---------
 * - acquireLease: one atomic INSERT; on conflict, one conditional UPDATE that
 *   only takes over a lease whose `expires_at` has passed. Under READ
 *   COMMITTED, Postgres re-evaluates the UPDATE predicate against the latest
 *   row version, so two racers can never both take over the same expired
 *   lease. A crashed holder therefore expires instead of wedging work forever.
 * - renewLease / releaseLease are conditional on the owner token, so an
 *   instance can never extend or release a lease another instance now holds.
 * - claimOnce is a lease that is never released: the row's existence until
 *   `expires_at` is the "already consumed" fact (OAuth replay protection).
 * - Any database error propagates. Callers decide whether to fail closed
 *   (OAuth) or skip-and-record (scheduler). Nothing here fails open.
 */

const crypto = require('crypto');

const MAX_KEY_LENGTH = 200;
const MAX_PURPOSE_LENGTH = 48;

function defaultDb() {
  return require('../configs/database').prisma; // lazy: importable without engines
}

function assertKey(key) {
  if (typeof key !== 'string' || !key.trim() || key.length > MAX_KEY_LENGTH) {
    throw new TypeError(`coordination key must be a non-empty string of at most ${MAX_KEY_LENGTH} characters`);
  }
}

function assertTtl(ttlSeconds) {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new TypeError('coordination ttlSeconds must be a positive integer');
  }
}

function safePurpose(purpose) {
  return String(purpose || 'lease').slice(0, MAX_PURPOSE_LENGTH);
}

function safeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  try {
    return JSON.parse(JSON.stringify(metadata));
  } catch {
    return {};
  }
}

/**
 * Acquire a lease. Returns the lease handle or null when another live holder
 * owns it. Database errors propagate to the caller.
 *
 * @returns {Promise<{key: string, owner: string, purpose: string, acquiredAt: Date, expiresAt: Date}|null>}
 */
async function acquireLease(key, { ttlSeconds, purpose = 'lease', metadata = {}, db = defaultDb(), now = new Date() } = {}) {
  assertKey(key);
  assertTtl(ttlSeconds);
  const owner = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const data = {
    owner,
    purpose: safePurpose(purpose),
    acquired_at: now,
    heartbeat_at: now,
    expires_at: expiresAt,
    metadata: safeMetadata(metadata),
  };
  const handle = { key, owner, purpose: data.purpose, acquiredAt: now, expiresAt };

  try {
    await db.coordination_leases.create({ data: { lease_key: key, ...data } });
    return handle;
  } catch (error) {
    // P2002 = the lease row already exists. Anything else is a real failure.
    if (error?.code !== 'P2002') throw error;
  }

  // Take over only an expired lease. The predicate is re-checked by Postgres
  // on the latest row version, so concurrent takeovers cannot both succeed.
  const takeover = await db.coordination_leases.updateMany({
    where: { lease_key: key, expires_at: { lt: now } },
    data,
  });
  return takeover.count === 1 ? handle : null;
}

/** Extend a lease this instance still owns. Returns true when renewed. */
async function renewLease(lease, { ttlSeconds, db = defaultDb(), now = new Date() } = {}) {
  if (!lease?.key || !lease?.owner) return false;
  assertTtl(ttlSeconds);
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const renewed = await db.coordination_leases.updateMany({
    where: { lease_key: lease.key, owner: lease.owner },
    data: { heartbeat_at: now, expires_at: expiresAt },
  });
  if (renewed.count === 1) {
    lease.expiresAt = expiresAt;
    return true;
  }
  return false;
}

/** Release a lease this instance still owns. Returns true when released. */
async function releaseLease(lease, { db = defaultDb() } = {}) {
  if (!lease?.key || !lease?.owner) return false;
  const released = await db.coordination_leases.deleteMany({
    where: { lease_key: lease.key, owner: lease.owner },
  });
  return released.count === 1;
}

/**
 * Record a one-time fact (e.g. "this OAuth state was consumed") for ttlSeconds.
 * Returns true the first time, false for every later claim within the window.
 */
async function claimOnce(key, { ttlSeconds, purpose = 'claim', metadata = {}, db = defaultDb(), now = new Date() } = {}) {
  const lease = await acquireLease(key, { ttlSeconds, purpose, metadata, db, now });
  return Boolean(lease);
}

/** Whether a live (unexpired) lease exists for key. */
async function isLeaseHeld(key, { db = defaultDb(), now = new Date() } = {}) {
  assertKey(key);
  const row = await db.coordination_leases.findUnique({ where: { lease_key: key } });
  return Boolean(row && new Date(row.expires_at).getTime() > now.getTime());
}

/** Delete expired leases and claims. Returns the number removed. */
async function purgeExpired({ db = defaultDb(), now = new Date(), graceSeconds = 60 } = {}) {
  const cutoff = new Date(now.getTime() - graceSeconds * 1000);
  const removed = await db.coordination_leases.deleteMany({ where: { expires_at: { lt: cutoff } } });
  return removed.count;
}

/**
 * Keep a lease alive while long-running work executes. Returns a stop()
 * function. A failed renewal is reported through onLost so the caller can
 * record it; the work itself is fenced by its own job-id CAS, not by this.
 */
function startHeartbeat(lease, { ttlSeconds, intervalMs, db = defaultDb(), onLost = () => {} } = {}) {
  assertTtl(ttlSeconds);
  const every = Number.isInteger(intervalMs) && intervalMs > 0
    ? intervalMs
    : Math.max(1000, Math.floor((ttlSeconds * 1000) / 3));
  let stopped = false;
  const timer = setInterval(async () => {
    if (stopped) return;
    try {
      const renewed = await renewLease(lease, { ttlSeconds, db });
      if (!renewed) onLost({ reason: 'lease_taken_over' });
    } catch (error) {
      onLost({ reason: 'renewal_failed', error_type: error?.code || error?.name || 'renewal_error' });
    }
  }, every);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

module.exports = {
  acquireLease,
  renewLease,
  releaseLease,
  claimOnce,
  isLeaseHeld,
  purgeExpired,
  startHeartbeat,
};
