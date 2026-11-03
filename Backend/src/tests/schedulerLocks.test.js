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
  classifyRebuildOutcome,
  deriveJobStatus,
  recordJobSkip,
  resolvePassOutcome,
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
  // A pass that succeeded is recorded as completed, not left at the release
  // default. Storing 'idle' here was what made a failed pass indistinguishable
  // from a healthy job that had nothing to do.
  assert.equal(row.status, 'completed');
  assert.equal(row.last_error, null, 'a clean pass records no error');
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

const FINDINGS_JOB = 'intelligence-findings';

test('a failed pass is recorded as failed, with a reason, never as idle', async () => {
  const db = fakePrisma();
  const lock = await acquireDbLock(db, JOB, { ttlSeconds: 600 });

  await releaseDbLock(db, lock, {
    result: { job: JOB, organizations: 1, succeeded: 0, failed: 1 },
  });

  const row = db.row(JOB);
  // This is the exact production shape that was stored as status 'idle' with an
  // empty last_error: one organization processed, one failed.
  assert.equal(row.status, 'failed');
  assert.ok(row.last_error, 'a failure must carry a reason');
  assert.match(row.last_error, /failed=1/);
  assert.match(row.last_error, /succeeded=0/);
  assert.equal(row.last_result.failed, 1);
  assert.equal(row.last_result.lock_token, undefined);
});

test('a mixed pass is recorded as partial rather than completed', async () => {
  const db = fakePrisma();
  const lock = await acquireDbLock(db, JOB, { ttlSeconds: 600 });

  await releaseDbLock(db, lock, {
    result: { organizations: 4, succeeded: 3, failed: 1 },
  });

  const row = db.row(JOB);
  assert.equal(row.status, 'partial');
  assert.ok(row.last_error);
});

test('a pass with nothing due is completed, not failed', async () => {
  const db = fakePrisma();
  const lock = await acquireDbLock(db, JOB, { ttlSeconds: 600 });

  await releaseDbLock(db, lock, {
    result: { organizations: 0, succeeded: 0, failed: 0 },
  });

  const row = db.row(JOB);
  assert.equal(row.status, 'completed', '"no work required" is not an error');
  assert.equal(row.last_error, null);
});

test('an explicit status overrides the derived one', async () => {
  const db = fakePrisma();
  const lock = await acquireDbLock(db, JOB, { ttlSeconds: 600 });

  await releaseDbLock(db, lock, {
    status: 'skipped',
    error: 'no snapshots written; 1 skipped as duplicate builds',
    result: { organizations: 1, succeeded: 0, skipped: 1, failed: 0 },
  });

  const row = db.row(JOB);
  assert.equal(row.status, 'skipped');
  assert.match(row.last_error, /duplicate builds/);
});

test('organization_failures counts as a failure for the findings job', async () => {
  const db = fakePrisma();
  const lock = await acquireDbLock(db, FINDINGS_JOB, { ttlSeconds: 600 });

  await releaseDbLock(db, lock, {
    result: {
      organizations_evaluated: 0,
      findings_persisted: 0,
      organization_failures: 3,
    },
  });

  const row = db.row(FINDINGS_JOB);
  assert.equal(row.status, 'failed');
  assert.match(row.last_error, /failed=3/);
});

test('a findings pass that evaluated tenants but found nothing is a success', async () => {
  const db = fakePrisma();
  const lock = await acquireDbLock(db, FINDINGS_JOB, { ttlSeconds: 600 });

  await releaseDbLock(db, lock, {
    result: {
      organizations_evaluated: 5,
      findings_persisted: 0,
      organization_failures: 0,
    },
  });

  // No qualifying findings is a correct outcome, not a failure.
  assert.equal(db.row(FINDINGS_JOB).status, 'completed');
});

test('releasing with no outcome at all stays idle', async () => {
  const db = fakePrisma();
  const lock = await acquireDbLock(db, JOB, { ttlSeconds: 600 });

  await releaseDbLock(db, lock);

  assert.equal(db.row(JOB).status, 'idle');
  assert.equal(db.row(JOB).last_error, null);
});

test('deriveJobStatus classifies outcomes without touching the database', () => {
  assert.equal(deriveJobStatus(null), 'idle');
  assert.equal(deriveJobStatus({}), 'idle');
  assert.equal(deriveJobStatus({ succeeded: 0, failed: 0 }), 'completed');
  assert.equal(deriveJobStatus({ succeeded: 2, failed: 0 }), 'completed');
  assert.equal(deriveJobStatus({ succeeded: 0, failed: 2 }), 'failed');
  assert.equal(deriveJobStatus({ succeeded: 2, failed: 1 }), 'partial');
  assert.equal(
    deriveJobStatus({ organizations_evaluated: 5, organization_failures: 0 }),
    'completed'
  );
  assert.equal(
    deriveJobStatus({ organizations_evaluated: 0, organization_failures: 2 }),
    'failed'
  );
  // A result with no recognised counters is still an outcome.
  assert.equal(deriveJobStatus({ note: 'nothing to do' }), 'completed');
  // Non-finite counters must not be trusted.
  assert.equal(deriveJobStatus({ succeeded: NaN, failed: NaN }), 'completed');
});

test('classifyRebuildOutcome treats a duplicate build as skipped, not rebuilt', () => {
  // Python answers HTTP 200 for a skipped duplicate build and hands back the
  // previous snapshot. That is the false-success path.
  assert.deepEqual(
    classifyRebuildOutcome({
      success: true,
      data: { rebuilt: false, skip_reason: 'duplicate_skipped' },
    }),
    { outcome: 'skipped', reason: 'duplicate_skipped' }
  );

  // A skip without a reason still must not be counted as a rebuild.
  assert.deepEqual(
    classifyRebuildOutcome({ success: true, data: { rebuilt: false } }),
    { outcome: 'skipped', reason: 'duplicate_build' }
  );
});

test('classifyRebuildOutcome accepts a real rebuild', () => {
  assert.deepEqual(
    classifyRebuildOutcome({ success: true, data: { rebuilt: true } }),
    { outcome: 'rebuilt', reason: '' }
  );
});

test('classifyRebuildOutcome reports failures with their code', () => {
  assert.deepEqual(
    classifyRebuildOutcome({ success: false, error: { code: 'pool_timeout' } }),
    { outcome: 'failed', reason: 'pool_timeout' }
  );
  assert.deepEqual(classifyRebuildOutcome({ success: false }), {
    outcome: 'failed',
    reason: 'unknown',
  });
  assert.deepEqual(classifyRebuildOutcome(null), {
    outcome: 'failed',
    reason: 'unknown',
  });
  assert.deepEqual(classifyRebuildOutcome(undefined), {
    outcome: 'failed',
    reason: 'unknown',
  });
});

test('classifyRebuildOutcome is backwards compatible during a rolling deploy', () => {
  // An older Python build answers without the `rebuilt` field. The call
  // succeeded and there is no evidence of a skip, so it must still count.
  for (const result of [
    { success: true },
    { success: true, data: null },
    { success: true, data: {} },
    { success: true, data: { state_id: 'x' } },
  ]) {
    assert.deepEqual(
      classifyRebuildOutcome(result),
      { outcome: 'rebuilt', reason: '' },
      JSON.stringify(result)
    );
  }
});

test('resolvePassOutcome records a skip-only pass as skipped with a reason', () => {
  const outcome = resolvePassOutcome({ succeeded: 0, skipped: 3, failed: 0 });

  assert.equal(outcome.status, 'skipped');
  assert.match(outcome.error, /no snapshots written/);
  assert.match(outcome.error, /3 skipped/);
});

test('resolvePassOutcome leaves a successful pass to be derived', () => {
  for (const counts of [
    { succeeded: 1, skipped: 0, failed: 0 },
    { succeeded: 5, skipped: 2, failed: 0 },
    // Nothing was due: not an error, and deriveJobStatus calls it completed.
    { succeeded: 0, skipped: 0, failed: 0 },
  ]) {
    const outcome = resolvePassOutcome(counts);
    assert.equal(outcome.status, undefined, JSON.stringify(counts));
    assert.equal(outcome.error, null, JSON.stringify(counts));
  }
});

test('resolvePassOutcome always carries failure reasons', () => {
  const outcome = resolvePassOutcome({
    succeeded: 0,
    skipped: 0,
    failed: 2,
    failureReasons: ['org-a:pool_timeout', 'org-b:redis_unavailable'],
  });

  // status stays undefined so deriveJobStatus chooses failed vs partial.
  assert.equal(outcome.status, undefined);
  assert.equal(outcome.error, 'org-a:pool_timeout; org-b:redis_unavailable');
});

test('resolvePassOutcome prefers real reasons over a skip summary', () => {
  const outcome = resolvePassOutcome({
    succeeded: 0,
    skipped: 2,
    failed: 1,
    failureReasons: ['org-a:timeout'],
  });

  assert.equal(outcome.status, undefined);
  assert.equal(outcome.error, 'org-a:timeout');
});

test('resolvePassOutcome bounds the stored error', () => {
  const many = Array.from({ length: 200 }, (_v, i) => `organization-${i}:pool_timeout`);
  const outcome = resolvePassOutcome({ succeeded: 0, skipped: 0, failed: 200, failureReasons: many });

  assert.ok(outcome.error.length <= 500, `expected <=500 got ${outcome.error.length}`);
});

test('resolvePassOutcome tolerates missing and malformed input', () => {
  assert.deepEqual(resolvePassOutcome(), { status: undefined, error: null });
  assert.deepEqual(resolvePassOutcome({}), { status: undefined, error: null });
  // A non-array failureReasons must not throw inside the finally block, which
  // would leave the lock claimed until TTL expiry.
  assert.deepEqual(
    resolvePassOutcome({ succeeded: 0, skipped: 0, failed: 1, failureReasons: null }),
    { status: undefined, error: null }
  );
});

test('a skip-only pass reaches the database as status skipped', async () => {
  const db = fakePrisma();
  const lock = await acquireDbLock(db, JOB, { ttlSeconds: 600 });
  const counts = { succeeded: 0, skipped: 2, failed: 0 };
  const passOutcome = resolvePassOutcome(counts);

  await releaseDbLock(db, lock, {
    status: passOutcome.status,
    error: passOutcome.error,
    result: { job: JOB, organizations: 2, ...counts },
  });

  const row = db.row(JOB);
  assert.equal(row.status, 'skipped');
  assert.match(row.last_error, /2 skipped/);
  assert.equal(row.last_result.succeeded, 0);
});
