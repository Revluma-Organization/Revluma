'use strict';

/**
 * Postgres-backed distributed locks and job observability.
 *
 * Why this exists
 * ---------------
 * The Business State rebuild is the only scheduler job that demanded a
 * *distributed* lock (`requireDistributed: true`), because rebuilds are
 * expensive and a rolling deploy can run more than one Node instance. That
 * requirement was satisfied only by Redis: when `isRedisReady()` was false,
 * `acquireLock()` returned null and `runBusinessStateRebuild()` returned at
 * `debug` log level without calling Python.
 *
 * Redis readiness is lost permanently after a transient failure — ioredis
 * `retryStrategy` gives up after five attempts and nothing ever reconnects — so
 * a brief blip during a deploy silently stopped every Business State rebuild
 * until the next process restart. Snapshots expired and were never renewed for
 * 16+ hours while the rest of the scheduler kept working on local locks, which
 * is why the outage looked like a Python failure and was not one.
 *
 * Postgres is already a hard dependency of this service and is the system of
 * record for the snapshots being rebuilt, so it is the correct place to
 * coordinate a single writer. Using it also gives operators a queryable
 * heartbeat: `automation_job_state` shows whether the job ran, when, and why it
 * did not, without needing access to application logs.
 *
 * Lock semantics
 * --------------
 * - Claim is a single atomic conditional UPDATE: a row is taken only if it is
 *   not running, or its `last_started_at` is older than the TTL. A crashed
 *   holder therefore expires instead of wedging the job forever.
 * - The claim token is stored inside `last_result.lock_token` and release is
 *   conditional on that token, so an instance can never release a lock that
 *   another instance has since taken over.
 * - No schema migration is required: `automation_job_state` already exists.
 */

const crypto = require('crypto');

const LOCK_TOKEN_KEY = 'lock_token';

/**
 * Job name used for the Business State rebuild lock and heartbeat.
 *
 * Exported so readiness reporting can read the same row the scheduler writes,
 * without the health endpoint having to load the scheduler module (and with it
 * Prisma and every worker service).
 */
const BUSINESS_STATE_JOB = 'business-state';

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

/**
 * Make sure a job row exists before trying to claim it.
 *
 * The claim is a conditional UPDATE, which cannot create the row it needs, so
 * the row is upserted first. Creating it as `idle` is safe: the claim below
 * still has to win the row atomically.
 */
async function ensureJobRow(prisma, jobName) {
    await prisma.automation_job_state.upsert({
        where: { job_name: jobName },
        create: { job_name: jobName, status: 'idle' },
        update: {},
    });
}

/**
 * Atomically claim a job lock.
 *
 * @returns {Promise<{jobName: string, token: string}|null>} the lock when
 *   claimed, or null when another instance holds a live claim.
 */
async function acquireDbLock(prisma, jobName, options = {}) {
    const { ttlSeconds = 300 } = options;

    if (typeof jobName !== 'string' || !jobName.trim()) {
        throw new TypeError('acquireDbLock requires a job name');
    }
    if (!isPositiveInteger(ttlSeconds)) {
        throw new TypeError('acquireDbLock requires a positive integer ttlSeconds');
    }

    const token = crypto.randomUUID();

    await ensureJobRow(prisma, jobName);

    // One statement, so two instances racing cannot both win: the row is only
    // updated when it is free or its holder has exceeded the TTL.
    const claimed = await prisma.$executeRaw`
        UPDATE automation_job_state
        SET status = 'running',
            last_started_at = now(),
            updated_at = now(),
            last_result = COALESCE(last_result, '{}'::jsonb)
                          || jsonb_build_object(${LOCK_TOKEN_KEY}, ${token}::text),
            last_error = NULL
        WHERE job_name = ${jobName}
          AND (
                status <> 'running'
                OR last_started_at IS NULL
                OR last_started_at < now() - (${ttlSeconds}::int * interval '1 second')
              )
    `;

    if (claimed !== 1) {
        return null;
    }

    return { jobName, token };
}

/**
 * Release a lock, but only if this instance still owns it.
 *
 * A holder whose TTL expired may have been superseded; releasing unconditionally
 * would then hand the job to two instances at once. Matching on the claim token
 * makes that impossible.
 *
 * @returns {Promise<boolean>} true when this instance released the lock.
 */
async function releaseDbLock(prisma, lock, options = {}) {
    const { status = 'idle', error = null, result = null } = options;

    if (!lock || !lock.token) {
        return false;
    }

    // Serialised separately so the outcome is stored as structured JSON and the
    // claim token is removed in the same atomic statement.
    let resultJson = '{}';
    if (result !== null && result !== undefined) {
        try {
            resultJson = JSON.stringify(result);
        } catch {
            resultJson = '{}';
        }
    }

    const released = await prisma.$executeRaw`
        UPDATE automation_job_state
        SET status = ${status},
            last_completed_at = now(),
            updated_at = now(),
            last_result = (COALESCE(last_result, '{}'::jsonb) - ${LOCK_TOKEN_KEY})
                          || ${resultJson}::jsonb,
            last_error = ${error}
        WHERE job_name = ${lock.jobName}
          AND last_result->>${LOCK_TOKEN_KEY} = ${lock.token}
    `;

    return released === 1;
}

/**
 * Record why a job pass produced nothing.
 *
 * A skipped job used to be invisible: it logged at `debug` and returned. This
 * writes the reason where operators — and automated checks — can see it, so a
 * job that silently stops cannot stay silent.
 */
async function recordJobSkip(prisma, jobName, reason, detail = null) {
    if (typeof jobName !== 'string' || !jobName.trim()) {
        return false;
    }

    try {
        await ensureJobRow(prisma, jobName);
        await prisma.automation_job_state.update({
            where: { job_name: jobName },
            data: {
                status: 'blocked',
                last_error: String(reason).slice(0, 500),
                last_result: detail ?? undefined,
                updated_at: new Date(),
            },
        });
        return true;
    } catch {
        // Observability must never break the job it observes.
        return false;
    }
}

/**
 * Read the current state of a job, for health endpoints and diagnostics.
 */
async function readJobState(prisma, jobName) {
    return prisma.automation_job_state.findUnique({
        where: { job_name: jobName },
    });
}

module.exports = {
    BUSINESS_STATE_JOB,
    acquireDbLock,
    releaseDbLock,
    recordJobSkip,
    readJobState,
    ensureJobRow,
};
