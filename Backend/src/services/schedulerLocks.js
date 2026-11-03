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
/**
 * Counter keys that mean "this unit failed" and "this unit succeeded".
 *
 * Different jobs report different shapes, so the derivation reads whichever
 * counters are present rather than requiring one canonical result schema.
 */
const FAILURE_COUNT_KEYS = Object.freeze(['failed', 'organization_failures']);
const SUCCESS_COUNT_KEYS = Object.freeze(['succeeded', 'organizations_evaluated']);

function sumCounts(result, keys) {
    let total = 0;
    let seen = false;

    for (const key of keys) {
        const value = result[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            total += value;
            seen = true;
        }
    }

    return { total, seen };
}

/**
 * Derive a job status from the run's own outcome counters.
 *
 * This exists because a failed run was being recorded as `status = 'idle'` with
 * an empty `last_error`. Production showed a Business State pass that processed
 * one organization and failed it — `{"failed": 1, "succeeded": 0}` — stored as
 * idle with no error, which is indistinguishable from a healthy job that simply
 * had nothing to do. An HTTP 200 from Python and a released lock both looked
 * like success.
 *
 * The rule is deliberately conservative: a pass with nothing due is
 * `completed`, not `failed`, because "no work was required" is not an error.
 *
 * @returns {'completed'|'partial'|'failed'|'idle'}
 */
function deriveJobStatus(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return 'idle';
    }

    const failures = sumCounts(result, FAILURE_COUNT_KEYS);
    const successes = sumCounts(result, SUCCESS_COUNT_KEYS);

    if (!failures.seen && !successes.seen) {
        // No recognised counters. Anything the caller recorded is still an
        // outcome, so treat a populated result as a completed pass.
        return Object.keys(result).length > 0 ? 'completed' : 'idle';
    }

    if (failures.total > 0 && successes.total === 0) {
        return 'failed';
    }

    if (failures.total > 0) {
        return 'partial';
    }

    return 'completed';
}

async function releaseDbLock(prisma, lock, options = {}) {
    const { error = null, result = null } = options;

    if (!lock || !lock.token) {
        return false;
    }

    // An explicit status always wins; otherwise derive it from the outcome so a
    // failed pass can never be stored as though it were idle or successful.
    const status = typeof options.status === 'string' && options.status.trim()
        ? options.status
        : deriveJobStatus(result);

    // A failure with no stated reason is how this stayed invisible before, so
    // fall back to the counters rather than storing an empty last_error.
    let lastError = error;
    if (lastError === null && status !== 'completed' && status !== 'idle') {
        const failures = sumCounts(result || {}, FAILURE_COUNT_KEYS);
        const successes = sumCounts(result || {}, SUCCESS_COUNT_KEYS);
        lastError = `job_${status}: failed=${failures.total} succeeded=${successes.total}`;
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
            last_error = ${lastError}
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

/*
 * Classify the outcome of a single Python Business State rebuild call.
 *
 * Python answers HTTP 200 both when it writes a new snapshot and when it skips
 * a duplicate build and hands back the previous snapshot. Counting that skip as
 * a success is how a stuck lock came to look like a healthy scheduler, so the
 * distinction is made here, in one tested place, instead of inline in the loop.
 *
 * An absent `rebuilt` field means an older Python build is answering. The call
 * succeeded and there is no evidence of a skip, so it counts as a rebuild
 * rather than being silently discarded during a rolling deploy.
 *
 * @param {{success?: boolean, data?: {rebuilt?: boolean, skip_reason?: string}|null, error?: {code?: string}|null}|null|undefined} result
 * @returns {{outcome: 'failed'|'skipped'|'rebuilt', reason: string}}
 */
function classifyRebuildOutcome(result) {
    if (!result || result.success === false) {
        return { outcome: 'failed', reason: result?.error?.code || 'unknown' };
    }

    const data = result.data;

    if (data && data.rebuilt === false) {
        return { outcome: 'skipped', reason: data.skip_reason || 'duplicate_build' };
    }

    return { outcome: 'rebuilt', reason: '' };
}

/*
 * Decide the status and error a whole Business State pass should be recorded
 * with.
 *
 * A pass that only skipped work wrote no snapshot, so it must not read as a
 * success in the heartbeat. A pass with failures carries the failure reasons
 * and lets `deriveJobStatus` choose between `failed` and `partial` from the
 * counters it is given.
 *
 * @param {{succeeded: number, skipped: number, failed: number, failureReasons?: string[]}} counts
 * @returns {{status: string|undefined, error: string|null}}
 */
function resolvePassOutcome({ succeeded = 0, skipped = 0, failed = 0, failureReasons = [] } = {}) {
    const reasons = Array.isArray(failureReasons) ? failureReasons : [];

    if (reasons.length > 0) {
        // Bound the stored reason so a large tenant count cannot produce an
        // unbounded column value.
        return { status: undefined, error: reasons.join('; ').slice(0, 500) };
    }

    if (failed === 0 && succeeded === 0 && skipped > 0) {
        return {
            status: 'skipped',
            error: `no snapshots written; ${skipped} skipped as duplicate builds`,
        };
    }

    return { status: undefined, error: null };
}

module.exports = {
    BUSINESS_STATE_JOB,
    acquireDbLock,
    classifyRebuildOutcome,
    deriveJobStatus,
    resolvePassOutcome,
    releaseDbLock,
    recordJobSkip,
    readJobState,
    ensureJobRow,
};
