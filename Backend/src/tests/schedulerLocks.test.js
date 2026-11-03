'use strict';

/**
 * Regressions for the Postgres-backed scheduler lock.
 *
 * The production outage this guards against: the Business State rebuild was the
 * only job requiring a *distributed* lock, and that requirement was satisfied
 * only by Redis. Redis readiness is lost permanently after a transient failure,
 * so one blip during a deploy made `acquireLock()` return null forever. The job
 * then returned at `debug` log level on every 60-second tick, never called
 * Python, and left snapshots expired for 16+ hours while the rest of the
 * scheduler carried on with local locks — which made a Node-side lock outage
 * look like a Python outage.
 *
 * These tests pin the replacement semantics: mutual exclusion, crash recovery
 * via TTL expiry, token-matched release, and a skip that is recorded rather than
 * silently swallowed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  acquireDbLock,
  releaseDbLock,
  recordJobSkip,
  readJobState,
} = require('../services/schedulerLocks');

const JOB = 'business-state';

/**
 * An in-memory stand-in for the `automation_job_state` row.
 *
 * `$executeRaw` is called as a tagged template, so the fake receives the literal
 * template strings and interpolated values — enough to apply the same atomic
 * claim and release semantics the SQL expresses, with a controllable clock so
 * TTL expiry can be tested without sleeping.
 */
function fakePrisma(startIso = '2026-11-03T00:00:00.000Z') {
  const rows = new Map();
  let clock = new Date(startIso).getTime();

  const now = () => new Date(clock);

  const api = {
    now,
    /** Advance the simulated clock. */
    advance(seconds) {
      clock += seconds * 1000;
    },
    row(jobName) {
      return rows.get(jobName) ?? null;
    },
    automation_job_state: {
      upsert: async ({ where, create }) => {
        if (!rows.has(where.job_name)) {
          rows.set(where.job_name, {
            job_name: create.job_name,
            status: create.status ?? 'idle',
            last_started_at: null,
            last_completed_at: null,
            last_result: null,
            last_error: null,
          });
        }
        return rows.get(where.job_name);
      },
      update: async ({ where, data }) => {
        const row = rows.get(where.job_name);
        assert.ok(row, 'update on a missing job row');
        Object.assign(row, data);
        return row;
      },
      findUnique: async ({ where }) => rows.get(where.job_name) ?? null,
    },
    $executeRaw: async (strings, ...values) => {
      const sql = strings.join('?');

      if (sql.includes('last_completed_at')) {
        // Release: status, tokenKey, resultJson, error, jobName, tokenKey, token
        const [status, , resultJson, error, jobName, , token] = values;
        const row = rows.get(jobName);
        if (!row) return 0;
        // Only the holder may release — this is the guard that stops an expired
        // holder from releasing a lock another instance has since claimed.
        if (row.last_result?.lock_token !== token) return 0;

        const { lock_token, ...rest } = row.last_result ?? {};
        row.status = status;
        row.last_completed_at = now();
        row.last_result = { ...rest, ...JSON.parse(resultJson) };
        row.last_error = error;
        return 1;
      }

      // Claim: tokenKey, token, jobName, ttlSeconds
      const [, token, jobName, ttlSeconds] = values;
      const row = rows.get(jobName);
      if (!row) return 0;

      const startedAt = row.last_started_at ? row.last_started_at.getTime() : null;
      const free =
        row.status !== 'running' ||
        startedAt === null ||
        startedAt < now().getTime() - ttlSeconds * 1000;

      if (!free) return 0;

      row.status = 'running';
      row.last_started_at = now();
      row.last_result = { ...(row.last_result ?? {}), lock_token: token };
      row.last_error = null;
      return 1;
    },
  };

  return api;
}

test('claims a free job and records the claim', async () => {
  const db = fakePrisma();

  const lock = await acquireDbLock(db, JOB, { ttlSeconds: 600 });

  assert.ok(lock, 'expected the first claim to succeed');
  assert.equal(lock.jobName, JOB);
  assert.match(lock.token, /^[0-9a-f-]{36}$/);

  const row = db.row(JOB);
  assert.equal(row.status, 'running');
  assert.equal(row.last_result.lock_token, lock.token);
  assert.equal(row.last_error, null);
});

test('a second instance cannot claim a live lock', async () => {
  const db = fakePrisma();

  const first = await acquireDbLock(db, JOB, { ttlSeconds: 600 });
  const second = await acquireDbLock(db, JOB, { ttlSeconds: 600 });

  assert.ok(first);
  assert.equal(second, null, 'mutual exclusion is the whole point of the lock');
  // The winner's claim must be untouched by the loser's attempt.
  assert.equal(db.row(JOB).last_result.lock_token, first.token);
});

test('a crashed holder expires so the job is never wedged forever', async () => {
  const db = fakePrisma();

  const first = await acquireDbLock(db, JOB, { ttlSeconds: 600 });
  assert.ok(first);

  // Simulate the holder dying without releasing, then the TTL elapsing.
  db.advance(601);

  const second = await acquireDbLock(db, JOB, { ttlSeconds: 600 });

  assert.ok(second, 'an expired claim must be recoverable');
  assert.notEqual(second.token, first.token);
  assert.equal(db.row(JOB).last_result.lock_token, second.token);
});

test('a claim inside the TTL is still exclusive', async () => {
  const db = fakePrisma();

  await acquireDbLock(db, JOB, { ttlSeconds: 600 });
  db.advance(599);

  assert.equal(await acquireDbLock(db, JOB, { ttlSeconds: 600 }), null);
});

test('only the holder can release the lock', async () => {
  const db = fakePrisma();

  const first = await acquireDbLock(db, JOB, { ttlSeconds: 600 });
  db.advance(601);
  const second = await acquireDbLock(db, JOB, { ttlSeconds: 600 });

  // The expired first holder comes back and tries to release.
  const staleRelease = await releaseDbLock(db, first);
  assert.equal(staleRelease, false, 'a superseded holder must not release');
  assert.equal(db.row(JOB).status, 'running', 'the live claim survives');

  const ownRelease = await releaseDbLock(db, second);
  assert.equal(ownRelease, true);
  assert.equal(db.row(JOB).status, 'idle');
});

test('release clears the claim token and records the run outcome', async () => {
  const db = fakePrisma();

  const lock = await acquireDbLock(db, JOB, { ttlSeconds: 600 });
  const released = await releaseDbLock(db, lock, {
    result: { job: JOB, organizations: 1, succeeded: 1, failed: 0 },
  });

  assert.equal(released, true);

  const row = db.row(JOB);
  assert.equal(row.status, 'idle');
  assert.equal(row.last_result.lock_token, undefined, 'token must not linger');
  assert.equal(row.last_result.succeeded, 1);
  assert.equal(row.last_result.failed, 0);
  assert.ok(row.last_completed_at instanceof Date);
});

test('release without a lock is a no-op, not a crash', async () => {
  const db = fakePrisma();

  assert.equal(await releaseDbLock(db, null), false);
  assert.equal(await releaseDbLock(db, {}), false);
});

test('a blocked job records why, so a silent stop cannot stay silent', async () => {
  const db = fakePrisma();

  const recorded = await recordJobSkip(db, JOB, 'lock_error', { error_type: 'ECONNREFUSED' });

  assert.equal(recorded, true);
  const row = await readJobState(db, JOB);
  assert.equal(row.status, 'blocked');
  assert.equal(row.last_error, 'lock_error');
  assert.equal(row.last_result.error_type, 'ECONNREFUSED');
});

test('observability never breaks the job it observes', async () => {
  const db = fakePrisma();
  db.automation_job_state.update = async () => {
    throw new Error('database unavailable');
  };

  // Must swallow, not propagate: a failed heartbeat cannot stop the scheduler.
  assert.equal(await recordJobSkip(db, JOB, 'lock_error'), false);
});

test('a long reason is truncated to fit the column', async () => {
  const db = fakePrisma();

  await recordJobSkip(db, JOB, 'x'.repeat(2000));

  assert.equal(db.row(JOB).last_error.length, 500);
});

test('invalid arguments are rejected rather than silently mis-locked', async () => {
  const db = fakePrisma();

  await assert.rejects(() => acquireDbLock(db, '', { ttlSeconds: 60 }), TypeError);
  await assert.rejects(() => acquireDbLock(db, JOB, { ttlSeconds: 0 }), TypeError);
  await assert.rejects(() => acquireDbLock(db, JOB, { ttlSeconds: 1.5 }), TypeError);
  await assert.rejects(() => acquireDbLock(db, null, { ttlSeconds: 60 }), TypeError);
});

test('two jobs do not interfere with each other', async () => {
  const db = fakePrisma();

  const a = await acquireDbLock(db, 'business-state', { ttlSeconds: 600 });
  const b = await acquireDbLock(db, 'alert-queue', { ttlSeconds: 300 });

  assert.ok(a);
  assert.ok(b, 'a claim on one job must not block another');

  assert.equal(await acquireDbLock(db, 'business-state', { ttlSeconds: 600 }), null);
  assert.equal(await releaseDbLock(db, a), true);
  assert.equal(db.row('alert-queue').status, 'running');
});
