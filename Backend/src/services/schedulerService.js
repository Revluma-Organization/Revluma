/**
 * Revluma Scheduler Service
 *
 * Responsibilities:
 * - Business State rebuild
 * - Recommendation outcome evaluation
 * - Morning briefings at 05:00 UTC
 * - Node-side alert queue processing
 *
 * Python communication MUST go through mlService.js.
 *
 * Reliability:
 * - Prevents overlapping runs
 * - Uses Redis distributed locks when Redis is available
 * - Supports start/stop lifecycle
 * - Does not crash the application when a scheduled task fails
 */

const crypto = require('crypto');

const logger = require('../utils/logger');
const { prisma } = require('../configs/database');
const { getRedisClient, isRedisReady } = require('../configs/redis');

const {
    rebuildBusinessState,
    evaluateRecommendationOutcomes,
    generateMorningBriefings,
    orchestrate,
    runIntelligenceAutomation,
} = require('./mlService');
const { syncShopifyStore } = require('./shopifySync');
const { storeSyncEligibility } = require('./shopifySyncRecovery');
const { ABANDONMENT_INACTIVITY_MS } = require('./checkoutInactivity');
const { runFeatureJobs } = require('./featureWorkerService');
const { recoverStuckDeliveries } = require('./webhookDeliveryRecovery');
const { runRecoveryActions } = require('./recoveryActionService');
const { runDailyChurnScoring } = require('./churnWorkerService');
const { runTrainingObservationFinalization } = require('./trainingObservationService');
const {
    BUSINESS_STATE_JOB,
    acquireDbLock,
    classifyRebuildOutcome,
    releaseDbLock,
    recordJobSkip,
    resolvePassOutcome,
} = require('./schedulerLocks');
const { intSetting } = require('../utils/intSetting');
const {
    evaluateOrganizationFindings,
} = require('./intelligenceFindingsAggregator');
const {
    persistVerifiedFindings,
} = require('./intelligenceFindingsRepository');

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const BUSINESS_STATE_INTERVAL_MS = intSetting('BUSINESS_STATE_INTERVAL_MS', '60000', 5000);

const RECOMMENDATION_OUTCOMES_INTERVAL_MS = intSetting('RECOMMENDATION_OUTCOMES_INTERVAL_MS', '60000', 5000);

const ALERT_QUEUE_INTERVAL_MS = intSetting('ALERT_QUEUE_INTERVAL_MS', '60000', 5000);

const MORNING_BRIEFINGS_INTERVAL_MS = intSetting('MORNING_BRIEFINGS_INTERVAL_MS', '60000', 5000);

const STORE_SYNC_INTERVAL_MS = intSetting('STORE_SYNC_INTERVAL_MS', String(15 * 60 * 1000), 5000);

const WEBHOOK_DELIVERY_RECOVERY_INTERVAL_MS = intSetting('WEBHOOK_DELIVERY_RECOVERY_INTERVAL_MS', String(5 * 60 * 1000), 60000);

const WEBHOOK_DELIVERY_STALE_SECONDS = intSetting('WEBHOOK_DELIVERY_STALE_SECONDS', '900', 300);

const FEATURE_JOB_INTERVAL_MS = intSetting('FEATURE_JOB_INTERVAL_MS', '15000', 5000);

const RECOVERY_ACTION_INTERVAL_MS = intSetting('RECOVERY_ACTION_INTERVAL_MS', '30000', 5000);

const CHURN_SCORING_INTERVAL_MS = intSetting('CHURN_SCORING_INTERVAL_MS', String(60 * 60 * 1000), 5000);

const INTELLIGENCE_AUTOMATION_INTERVAL_MS = intSetting('INTELLIGENCE_AUTOMATION_INTERVAL_MS', String(5 * 60 * 1000), 5000);

const LOCK_TTL_SECONDS = intSetting('SCHEDULER_LOCK_TTL_SECONDS', '300', 30);

const BUSINESS_STATE_LOCK_TTL_SECONDS = intSetting('BUSINESS_STATE_LOCK_TTL_SECONDS', '600', 60);

// Findings are evaluated over 7-day windows, so this pass does not need the
// minute-level cadence of the Business State rebuild. It is scheduled at all
// because previously the only way to evaluate findings was a merchant pressing
// refresh, which meant qualifying conditions were never detected on their own.
const INTELLIGENCE_FINDINGS_INTERVAL_MS = intSetting(
    'INTELLIGENCE_FINDINGS_INTERVAL_MS',
    String(60 * 60 * 1000),
    60000
);

const FINDINGS_LOCK_TTL_SECONDS = intSetting(
    'INTELLIGENCE_FINDINGS_LOCK_TTL_SECONDS',
    '900',
    60
);

/*
 * Startup passes are staggered rather than fired simultaneously.
 *
 * All ten jobs used to start on the same tick via `void run...()`. Several of
 * them call Python, and every Python request opens its own SQLAlchemy session,
 * so a boot or a restart produced an immediate burst of concurrent sessions
 * against a pool whose ceiling is 12. Spreading the starts costs a few seconds
 * of warm-up and removes the spike. Completion is deliberately NOT awaited:
 * serialising the passes would make startup take as long as the slowest job,
 * which was measured at 40s for a single Business State organization.
 */
const SCHEDULER_STARTUP_STAGGER_MS = intSetting(
    'SCHEDULER_STARTUP_STAGGER_MS',
    '1500',
    0
);

// Bounds a single pass so evaluation time stays predictable as tenants grow.
const FINDINGS_ORG_BATCH_SIZE = Math.min(
    intSetting('INTELLIGENCE_FINDINGS_ORG_BATCH_SIZE', 50, 1),
    500
);

const ALERT_QUEUE_BATCH_SIZE = Math.min(
    intSetting('ALERT_QUEUE_BATCH_SIZE', 25, 1),
    100
);

// -----------------------------------------------------------------------------
// Scheduler state
// -----------------------------------------------------------------------------

let businessStateTimer = null;
let recommendationOutcomesTimer = null;
let alertQueueTimer = null;
let morningBriefingsTimer = null;
let storeSyncTimer = null;
let featureJobTimer = null;
let recoveryActionTimer = null;
let churnScoringTimer = null;
let intelligenceAutomationTimer = null;
let trainingObservationTimer = null;
let webhookDeliveryRecoveryTimer;
let intelligenceFindingsTimer = null;
let startupPassTimers = [];

let businessStateRunning = false;
let recommendationOutcomesRunning = false;
let alertQueueRunning = false;
let morningBriefingsRunning = false;
let storeSyncRunning = false;
let featureJobRunning = false;
let recoveryActionRunning = false;
let churnScoringRunning = false;
let intelligenceAutomationRunning = false;
let trainingObservationRunning = false;
let intelligenceFindingsRunning = false;

let started = false;

// Prevents the same process from repeatedly triggering the daily briefing.
let lastMorningBriefingDate = null;

// -----------------------------------------------------------------------------
// Redis distributed lock
// -----------------------------------------------------------------------------

const RELEASE_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
else
    return 0
end
`;

/**
 * Acquire a distributed Redis lock.
 *
 * Returns:
 * - token when lock was acquired
 * - null when another worker owns the lock
 * - null when Redis is unavailable
 */
async function acquireLock(lockName, options = {}) {
    const {
        requireDistributed = false,
        ttlSeconds = LOCK_TTL_SECONDS,
    } = options;

    if (!isRedisReady()) {
        if (requireDistributed) {
            logger.warn('scheduler_distributed_lock_unavailable', {
                lock: lockName,
                reason: 'redis_not_ready',
            });
            return null;
        }
        logger.info('scheduler_local_lock_used', {
            lock: lockName,
            reason: 'redis_not_ready',
        });
        return { local: true, key: lockName, token: null };
    }

    const redis = getRedisClient();

    if (!redis) {
        if (requireDistributed) return null;
        return { local: true, key: lockName, token: null };
    }

    const token = crypto.randomUUID();
    const key = `revluma:scheduler:${lockName}`;

    try {
        const result = await redis.set(
            key,
            token,
            'EX',
            ttlSeconds,
            'NX'
        );

        if (result !== 'OK') {
            return null;
        }

        return {
            key,
            token,
        };
    } catch (error) {
        logger.error('scheduler_lock_acquire_failed', {
            lock: lockName,
            error_type: error.code || error.name || 'lock_error',
        });

        return null;
    }
}

/**
 * Release a lock only if this scheduler instance owns it.
 */
async function releaseLock(lock) {
    if (!lock || lock.local || !isRedisReady()) {
        return;
    }

    const redis = getRedisClient();

    if (!redis) {
        return;
    }

    try {
        await redis.eval(
            RELEASE_LOCK_SCRIPT,
            1,
            lock.key,
            lock.token
        );
    } catch (error) {
        logger.error('scheduler_lock_release_failed', {
            lock: lock.key,
            error_type: error.code || error.name || 'lock_error',
        });
    }
}

// -----------------------------------------------------------------------------
// Business State
// -----------------------------------------------------------------------------

async function runBusinessStateRebuild() {
    if (businessStateRunning) {
        logger.warn('scheduler_business_state_overlap_skipped');
        return;
    }

    // Business-state rebuilds are expensive and must never fall back to
    // per-process locks: a rolling deploy can run more than one instance.
    //
    // The claim lives in Postgres, not Redis. Redis readiness is lost
    // permanently after a transient failure — ioredis stops retrying after five
    // attempts and nothing reconnects — and because this was the only job
    // demanding a distributed lock, one blip silently stopped *every* rebuild
    // until the next process restart, while the rest of the scheduler carried on
    // with local locks. That made a Node-side lock outage look like a Python
    // outage for 16+ hours.
    //
    // Postgres is already a hard dependency and is the system of record for the
    // snapshots being rebuilt, so it is the correct coordinator. The claim is
    // also visible in automation_job_state, so "did this job run?" is answerable
    // from the database without application logs.
    let lock = null;

    try {
        lock = await acquireDbLock(prisma, BUSINESS_STATE_JOB, {
            ttlSeconds: BUSINESS_STATE_LOCK_TTL_SECONDS,
        });
    } catch (error) {
        const errorType = error.code || error.name || 'lock_error';

        // This is the case that used to be invisible: the job cannot run, and
        // nothing downstream would ever notice.
        logger.error('scheduler_business_state_lock_error', { error_type: errorType });
        await recordJobSkip(prisma, BUSINESS_STATE_JOB, 'lock_error', { error_type: errorType });
        return;
    }

    if (!lock) {
        // Another instance holds a live claim. Normal during a rolling deploy,
        // and self-healing because the claim expires after its TTL.
        logger.debug?.('scheduler_business_state_lock_not_acquired');
        return;
    }

    businessStateRunning = true;

    const startedAt = Date.now();
    let succeeded = 0;
    let failed = 0;
    let processed = 0;
    let skipped = 0;

    // The failure reason used to be logged and thrown away, so the heartbeat
    // could say "failed: 1" without saying why. Bounded so a pass over many
    // organizations cannot grow this without limit.
    const failureReasons = [];
    const recordFailureReason = (organizationId, reason) => {
        if (failureReasons.length < 10) {
            failureReasons.push(`${organizationId}:${reason}`);
        }
    };

    try {
        logger.info('scheduler_business_state_started');

        const now = new Date();

        // The production baseline table is not populated. The canonical
        // schedule is the current snapshot's valid_until, written atomically
        // with each successful Business State build.
        let dueStates = await prisma.business_states.findMany({
            where: {
                is_current: true,
                OR: [
                    { valid_until: { lte: now } },
                    { valid_until: null },
                ],
            },
            select: {
                organization_id: true,
                valid_until: true,
            },
            orderBy: [
                { valid_until: 'asc' },
            ],
            take: 1,
        });

        let organizations = dueStates.map((state) => ({
            id: state.organization_id,
        }));

        // New organizations have no current snapshot yet; initialize one
        // without scanning/rebuilding every organization on every minute tick.
        if (organizations.length === 0) {
            organizations = await prisma.organizations.findMany({
                where: {
                    business_states: {
                        none: { is_current: true },
                    },
                },
                select: { id: true },
                orderBy: { created_at: 'asc' },
                take: 1,
            });
        }

        if (organizations.length === 0) {
            logger.info('scheduler_business_state_no_due_organizations');
            return;
        }

        processed = organizations.length;

        for (const organization of organizations) {
            const correlationId =
                `scheduler-business-state-${organization.id}-${Date.now()}`;

            try {
                const result = await rebuildBusinessState({
                    organizationId: organization.id,
                    correlationId,
                });

                /*
                 * One tested helper decides failed / skipped / rebuilt, so a
                 * duplicate build that Python answers with HTTP 200 can never be
                 * counted as a snapshot that was written.
                 */
                const outcome = classifyRebuildOutcome(result);

                if (outcome.outcome === 'failed') {
                    failed++;
                    recordFailureReason(organization.id, outcome.reason);

                    logger.warn('scheduler_business_state_org_failed', {
                        organization_id: organization.id,
                        code: outcome.reason,
                        correlation_id: correlationId,
                    });

                    continue;
                }

                if (outcome.outcome === 'skipped') {
                    skipped++;

                    logger.warn('scheduler_business_state_org_skipped', {
                        organization_id: organization.id,
                        reason: outcome.reason,
                        correlation_id: correlationId,
                    });

                    continue;
                }

                succeeded++;
            } catch (error) {
                failed++;

                const errorType =
                    error.code || error.name || 'processing_error';
                recordFailureReason(organization.id, errorType);

                logger.error('scheduler_business_state_org_exception', {
                    organization_id: organization.id,
                    error_type: errorType,
                    correlation_id: correlationId,
                });
            }
        }

        logger.info('scheduler_business_state_completed', {
            organizations: processed,
            succeeded,
            skipped,
            failed,
            latency_ms: Date.now() - startedAt,
        });
    } catch (error) {
        logger.error('scheduler_business_state_failed', {
            error_type: error.code || error.name || 'processing_error',
            latency_ms: Date.now() - startedAt,
        });
    } finally {
        businessStateRunning = false;

        // Release only our own claim, and leave the run's outcome behind so the
        // heartbeat shows what the last pass actually did.
        // A pass that only skipped work is not a success: no snapshot was
        // written, so the heartbeat must not read as though one was.
        const passOutcome = resolvePassOutcome({
            succeeded,
            skipped,
            failed,
            failureReasons,
        });

        await releaseDbLock(prisma, lock, {
            status: passOutcome.status,
            error: passOutcome.error,
            result: {
                job: BUSINESS_STATE_JOB,
                organizations: processed,
                succeeded,
                skipped,
                failed,
                latency_ms: Date.now() - startedAt,
                finished_at: new Date().toISOString(),
            },
        });
    }
}

// -----------------------------------------------------------------------------
// Recommendation Outcomes
// -----------------------------------------------------------------------------

async function runRecommendationOutcomeEvaluation() {
    if (recommendationOutcomesRunning) {
        logger.warn('scheduler_recommendation_outcomes_overlap_skipped');
        return;
    }

    const lock = await acquireLock('recommendation-outcomes');

    if (!lock) {
        logger.debug?.(
            'scheduler_recommendation_outcomes_lock_not_acquired'
        );
        return;
    }

    recommendationOutcomesRunning = true;

    const startedAt = Date.now();

    try {
        logger.info('scheduler_recommendation_outcomes_started');

        const result = await evaluateRecommendationOutcomes({
            limit: 100,
            correlationId:
                `scheduler-recommendation-outcomes-${Date.now()}`,
        });

        if (!result.success) {
            logger.warn('scheduler_recommendation_outcomes_failed', {
                code: result.error?.code,
                latency_ms: Date.now() - startedAt,
            });

            return;
        }

        logger.info('scheduler_recommendation_outcomes_completed', {
            latency_ms: Date.now() - startedAt,
        });
    } catch (error) {
        logger.error('scheduler_recommendation_outcomes_exception', {
            error_type: error.code || error.name || 'processing_error',
        });
    } finally {
        recommendationOutcomesRunning = false;
        await releaseLock(lock);
    }
}

// -----------------------------------------------------------------------------
// Morning Briefings
// -----------------------------------------------------------------------------

function isMorningBriefingTime() {
    const now = new Date();

    return (
        now.getUTCHours() === 5 &&
        now.getUTCMinutes() === 0
    );
}

async function runMorningBriefings() {
    if (!isMorningBriefingTime()) {
        return;
    }

    const today = new Date().toISOString().slice(0, 10);

    if (lastMorningBriefingDate === today) {
        return;
    }

    if (morningBriefingsRunning) {
        logger.warn('scheduler_morning_briefings_overlap_skipped');
        return;
    }

    const lock = await acquireLock(
        `morning-briefings-${today}`
    );

    if (!lock) {
        return;
    }

    morningBriefingsRunning = true;

    const startedAt = Date.now();

    try {
        logger.info('scheduler_morning_briefings_started', {
            date_utc: today,
        });

        const result = await generateMorningBriefings({
            correlationId:
                `scheduler-morning-briefings-${today}`,
        });

        if (!result.success) {
            logger.warn('scheduler_morning_briefings_failed', {
                code: result.error?.code,
                latency_ms: Date.now() - startedAt,
            });

            return;
        }

        lastMorningBriefingDate = today;

        logger.info('scheduler_morning_briefings_completed', {
            date_utc: today,
            latency_ms: Date.now() - startedAt,
        });
    } catch (error) {
        logger.error('scheduler_morning_briefings_exception', {
            error_type: error.code || error.name || 'processing_error',
        });
    } finally {
        morningBriefingsRunning = false;
        await releaseLock(lock);
    }
}

// -----------------------------------------------------------------------------
// Alert Queue
// -----------------------------------------------------------------------------

async function runAlertQueue() {
    if (alertQueueRunning) {
        logger.warn('scheduler_alert_queue_overlap_skipped');
        return;
    }

    const lock = await acquireLock('alert-queue');

    if (!lock) {
        logger.debug?.('scheduler_alert_queue_lock_not_acquired');
        return;
    }

    alertQueueRunning = true;

    const startedAt = Date.now();

    try {
        logger.info('scheduler_alert_queue_started');

        await prisma.alert_queue.updateMany({
            where: {
                status: 'processing',
                updated_at: { lt: new Date(Date.now() - 10 * 60 * 1000) },
            },
            data: { status: 'pending', updated_at: new Date() },
        });

        const alerts = await prisma.alert_queue.findMany({
            where: {
                status: 'pending',
                available_at: {
                    lte: new Date(),
                },
            },
            orderBy: [
                {
                    severity: 'desc',
                },
                {
                    available_at: 'asc',
                },
                {
                    created_at: 'asc',
                },
            ],
            take: ALERT_QUEUE_BATCH_SIZE,
        });

        if (alerts.length === 0) {
            logger.debug?.('scheduler_alert_queue_empty');

            return;
        }

        let delivered = 0;
        let failed = 0;

        for (const alert of alerts) {
            const claim = await prisma.alert_queue.updateMany({
                where: { id: alert.id, status: 'pending' },
                data: {
                    status: 'processing',
                    attempt_count: { increment: 1 },
                    updated_at: new Date(),
                },
            });
            if (claim.count !== 1) continue;
            try {
                const members = await prisma.organization_members.findMany({
                    where: { organization_id: alert.organization_id, status: 'active' },
                    select: { user_id: true },
                });
                if (members.length === 0) throw new Error('alert_has_no_recipients');
                /*
                 * Alerts that need AI-generated output should go through
                 * mlService.orchestrate().
                 *
                 * We intentionally do not assume every alert requires AI.
                 * The alert payload should explicitly indicate that.
                 */
                const requiresAi =
                    alert.payload &&
                    typeof alert.payload === 'object' &&
                    alert.payload.requires_ai === true;

                if (requiresAi) {
                    const result = await orchestrate({
                        organizationId: alert.organization_id,
                        userId: members[0].user_id,
                        message: alert.message,
                        triggerType: 'alert',
                        triggerPriority:
                            alert.severity || 'normal',
                        contextPayload: {
                            alert_id: alert.id,
                            alert_type: alert.alert_type,
                            action_url: alert.action_url,
                            payload: alert.payload,
                        },
                        correlationId:
                            `scheduler-alert-${alert.id}`,
                    });

                    if (!result.success) {
                        throw new Error(
                            result.error?.code ||
                            'alert_orchestration_failed'
                        );
                    }
                }

                await prisma.notifications.createMany({
                    data: members.map((member) => ({
                        user_id: member.user_id,
                        type: alert.alert_type,
                        message: alert.message,
                        action_url: alert.action_url,
                    })),
                });

                await prisma.alert_queue.update({
                    where: {
                        id: alert.id,
                    },
                    data: {
                        status: 'delivered',
                        delivered_at: new Date(),
                        updated_at: new Date(),
                        last_error: null,
                    },
                });

                delivered++;
            } catch (error) {
                failed++;

                const nextAttemptCount = alert.attempt_count + 1;

                await prisma.alert_queue.update({
                    where: {
                        id: alert.id,
                    },
                    data: {
                        status:
                            nextAttemptCount >= 5
                                ? 'failed'
                                : 'pending',
                        failed_at:
                            nextAttemptCount >= 5
                                ? new Date()
                                : null,
                        last_error: String(error.code || error.name || 'processing_error').slice(0, 500),
                        updated_at: new Date(),
                    },
                });

                logger.error('scheduler_alert_processing_failed', {
                    alert_id: alert.id,
                    organization_id: alert.organization_id,
                    attempt_count: nextAttemptCount,
                    error_type: error.code || error.name || 'processing_error',
                });
            }
        }

        logger.info('scheduler_alert_queue_completed', {
            processed: alerts.length,
            delivered,
            failed,
            latency_ms: Date.now() - startedAt,
        });
    } catch (error) {
        logger.error('scheduler_alert_queue_failed', {
            error_type: error.code || error.name || 'processing_error',
            latency_ms: Date.now() - startedAt,
        });
    } finally {
        alertQueueRunning = false;
        await releaseLock(lock);
    }
}

async function runFeatureQueue() {
    if (featureJobRunning) return;
    const lock = await acquireLock('feature-jobs');
    if (!lock) return;
    featureJobRunning = true;
    try {
        const result = await runFeatureJobs({ limit: 25 });
        logger.info('scheduler_feature_jobs_completed', result);
    } catch (error) {
        logger.error('scheduler_feature_jobs_failed', { error_type: error.code || error.name || 'worker_error' });
    } finally {
        featureJobRunning = false;
        await releaseLock(lock);
    }
}

async function runRecoveryQueue() {
    if (recoveryActionRunning) return;
    const lock = await acquireLock('recovery-actions');
    if (!lock) return;
    recoveryActionRunning = true;
    try {
        const result = await runRecoveryActions({ limit: 25 });
        logger.info('scheduler_recovery_actions_completed', result);
    } catch (error) {
        logger.error('scheduler_recovery_actions_failed', { error_type: error.code || error.name || 'worker_error' });
    } finally {
        recoveryActionRunning = false;
        await releaseLock(lock);
    }
}

const CHURN_SCORING_JOB = 'daily-churn';
const CHURN_SCORING_LOCK_TTL_SECONDS = intSetting(
    'CHURN_SCORING_LOCK_TTL_SECONDS',
    '900',
    60
);

/**
 * Hourly churn scoring pass.
 *
 * Coordination uses the Postgres job lock (not the Redis lock): the pass and
 * its outcome are written to `automation_job_state`, so "did churn run, and
 * did it fail?" is answerable from the database without application logs.
 * This is how the eleven-customer failure storm of 2026-11 stayed invisible
 * for days — the Redis lock left no persistent trace, and per-customer
 * warnings were only in Render logs. A pass with failures now lands as
 * `failed`/`partial` with a structured last_result, exactly like the
 * business-state rebuild.
 */
async function runChurnQueue() {
    if (churnScoringRunning) return;

    let lock = null;
    try {
        lock = await acquireDbLock(prisma, CHURN_SCORING_JOB, {
            ttlSeconds: CHURN_SCORING_LOCK_TTL_SECONDS,
        });
    } catch (error) {
        const errorType = error.code || error.name || 'lock_error';
        logger.error('scheduler_churn_scoring_lock_failed', { error_type: errorType });
        await recordJobSkip(prisma, CHURN_SCORING_JOB, 'lock_error', { error_type: errorType });
        return;
    }
    if (!lock) return;

    churnScoringRunning = true;
    const startedAt = Date.now();
    try {
        const result = await runDailyChurnScoring({ limit: 100 });
        logger.info('scheduler_churn_scoring_completed', result);
        // processed -> succeeded so deriveJobStatus can distinguish a mixed
        // pass (partial) from a total outage (failed).
        await releaseDbLock(prisma, lock, {
            result: {
                job: CHURN_SCORING_JOB,
                succeeded: result?.processed ?? 0,
                failed: result?.failed ?? 0,
                failure_reasons: result?.failure_reasons ?? {},
                latency_ms: Date.now() - startedAt,
                finished_at: new Date().toISOString(),
            },
        });
    } catch (error) {
        const errorType = error.code || error.name || 'worker_error';
        logger.error('scheduler_churn_scoring_failed', { error_type: errorType });
        await releaseDbLock(prisma, lock, {
            status: 'failed',
            error: `churn_error: ${errorType}`,
            result: {
                job: CHURN_SCORING_JOB,
                latency_ms: Date.now() - startedAt,
                finished_at: new Date().toISOString(),
            },
        });
    } finally {
        churnScoringRunning = false;
    }
}

async function runAutomationQueue() {
    if (intelligenceAutomationRunning) return;
    const lock = await acquireLock('intelligence-automation');
    if (!lock) return;
    intelligenceAutomationRunning = true;
    try {
        const result = await runIntelligenceAutomation({
            correlationId: `scheduler-automation-${Date.now()}`,
        });
        if (!result.success) {
            logger.warn('scheduler_intelligence_automation_failed', {
                error_type: result.error?.code || 'worker_error',
            });
        } else {
            logger.info('scheduler_intelligence_automation_accepted', {
                status: result.data?.status || 'accepted',
            });
        }
    } catch (error) {
        logger.error('scheduler_intelligence_automation_failed', {
            error_type: error.code || error.name || 'worker_error',
        });
    } finally {
        intelligenceAutomationRunning = false;
        await releaseLock(lock);
    }
}

const INTELLIGENCE_FINDINGS_JOB = 'intelligence-findings';

/**
 * Evaluate and persist intelligence findings for every tenant that has a store.
 *
 * Findings were previously evaluated only when a merchant called the refresh
 * endpoint, so a qualifying condition could exist for weeks and never be
 * recorded — intelligence_findings had never held a row in production. The
 * detection rules and their evidence gates are deliberately untouched: this
 * supplies only the missing automated caller.
 *
 * Writes stay controlled because persistVerifiedFindings skips any candidate
 * whose evidence is not verified, rechecks store ownership per row, and upserts
 * on organization_id_dedupe_key — so repeated passes update a finding instead
 * of duplicating it.
 */
async function runIntelligenceFindingsRefresh() {
    if (intelligenceFindingsRunning) {
        return;
    }

    let lock = null;
    const startedAt = Date.now();

    try {
        lock = await acquireDbLock(prisma, INTELLIGENCE_FINDINGS_JOB, {
            ttlSeconds: FINDINGS_LOCK_TTL_SECONDS,
        });
    } catch (error) {
        const errorType = error?.code || error?.name || 'unknown';

        // A lock failure must be visible. The Business State rebuild was
        // silently skipped for 16 hours because this case only logged at debug.
        logger.error('scheduler_findings_lock_error', { error_type: errorType });
        await recordJobSkip(prisma, INTELLIGENCE_FINDINGS_JOB, 'lock_error', {
            error_type: errorType,
        });
        return;
    }

    if (!lock) {
        // Another instance holds this pass. Expected in a multi-instance deploy.
        return;
    }

    intelligenceFindingsRunning = true;

    let organizationsEvaluated = 0;
    let findingsPersisted = 0;
    let organizationFailures = 0;

    try {
        // Only tenants that actually have a store can produce findings. distinct
        // keeps this to one bounded query rather than loading every store row.
        const organizations = await prisma.stores.findMany({
            select: { organization_id: true },
            distinct: ['organization_id'],
            orderBy: { organization_id: 'asc' },
            take: FINDINGS_ORG_BATCH_SIZE,
        });

        for (const row of organizations) {
            const organizationId = row?.organization_id;
            if (!organizationId) continue;

            // One tenant failing must not stop the remaining tenants, and must
            // not leak another tenant's data into this evaluation.
            try {
                const evaluated = await evaluateOrganizationFindings(
                    prisma,
                    organizationId
                );
                const saved = await persistVerifiedFindings(
                    prisma,
                    organizationId,
                    evaluated.findings
                );

                organizationsEvaluated += 1;
                findingsPersisted += Number.isInteger(saved) ? saved : 0;
            } catch (error) {
                organizationFailures += 1;
                logger.error('scheduler_findings_organization_failed', {
                    organization_id: organizationId,
                    error_type: error?.code || error?.name || 'unknown',
                });
            }
        }

        logger.info('scheduler_intelligence_findings_completed', {
            organizations_evaluated: organizationsEvaluated,
            findings_persisted: findingsPersisted,
            organization_failures: organizationFailures,
            latency_ms: Date.now() - startedAt,
        });
    } catch (error) {
        logger.error('scheduler_intelligence_findings_failed', {
            error_type: error?.code || error?.name || 'unknown',
        });
    } finally {
        intelligenceFindingsRunning = false;

        await releaseDbLock(prisma, lock, {
            result: {
                job: INTELLIGENCE_FINDINGS_JOB,
                organizations_evaluated: organizationsEvaluated,
                findings_persisted: findingsPersisted,
                organization_failures: organizationFailures,
                latency_ms: Date.now() - startedAt,
                finished_at: new Date().toISOString(),
            },
        });
    }
}

async function runTrainingObservationQueue() {
    if (trainingObservationRunning) return;
    const lock = await acquireLock('training-observations');
    if (!lock) return;
    trainingObservationRunning = true;
    try {
        const result = await runTrainingObservationFinalization({ limit: 100 });
        logger.info('scheduler_training_observations_completed', result);
    } catch (error) {
        logger.error('scheduler_training_observations_failed', {
            error_type: error.code || error.name || 'worker_error',
        });
    } finally {
        trainingObservationRunning = false;
        await releaseLock(lock);
    }
}

async function promoteInactiveCheckouts() {
    // Promote only genuinely inactive, unrecovered checkouts. Do not send messages.
    const cutoff = new Date(Date.now() - ABANDONMENT_INACTIVITY_MS);
    const result = await prisma.abandoned_carts.updateMany({
        where: {
            status: 'pending',
            recovered_at: null,
            updated_at: { lte: cutoff },
            stores: { platform: 'shopify', status: { in: ['active', 'connected', 'syncing'] } },
        },
        data: { status: 'abandoned' },
    });
    logger.info('scheduler_inactive_checkouts_promoted', { count: result.count });
    return result.count;
}

async function runStoreSync() {
    if (storeSyncRunning) return;
    const lock = await acquireLock('store-sync');
    if (!lock) return;
    storeSyncRunning = true;
    const startedAt = Date.now();

    try {
        await promoteInactiveCheckouts();
        const stores = await prisma.stores.findMany({
            where: storeSyncEligibility(Date.now(), STORE_SYNC_INTERVAL_MS),
            orderBy: { last_synced_at: 'asc' },
            take: 10,
        });
        let succeeded = 0;
        for (const store of stores) {
            try {
                if (store.status === 'syncing') {
                    logger.warn('scheduler_stale_shopify_sync_retry', { store_id: store.id, previous_updated_at: store.updated_at });
                }
                const result = await syncShopifyStore(store, { reconcileWebhooks: false });
                if (!result.success) {
                    logger.warn('scheduler_store_sync_skipped', { store_id: store.id, reason: result.alreadyRunning ? 'already_running' : 'not_completed' });
                    continue;
                }
                succeeded++;
            } catch (error) {
                logger.warn('scheduler_store_sync_failed', {
                    store_id: store.id,
                    error_type: error.code || 'sync_error',
                });
            }
        }
        logger.info('scheduler_store_sync_completed', {
            stores: stores.length,
            succeeded,
            latency_ms: Date.now() - startedAt,
        });
    } catch (error) {
        logger.error('scheduler_store_sync_failed', { error_type: error.code || 'scheduler_error' });
    } finally {
        storeSyncRunning = false;
        await releaseLock(lock);
    }
}

async function runWebhookDeliveryRecovery() {
    const lock = await acquireLock('webhook-delivery-recovery');
    if (!lock) return;
    try {
        const result = await recoverStuckDeliveries({ olderThanSeconds: WEBHOOK_DELIVERY_STALE_SECONDS });
        if (result.recovered) {
            logger.warn('scheduler_webhook_delivery_recovery_completed', result);
        }
        return result;
    } catch (error) {
        logger.error('scheduler_webhook_delivery_recovery_failed', {
            error_type: error?.code || error?.name || 'recovery_error',
        });
    } finally {
        await releaseLock(lock);
    }
}

// -----------------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------------

function startScheduler() {
    if (started) {
        logger.warn('scheduler_already_started');
        return;
    }

    started = true;

    logger.info('scheduler_started', {
        business_state_interval_ms:
            BUSINESS_STATE_INTERVAL_MS,

        recommendation_outcomes_interval_ms:
            RECOMMENDATION_OUTCOMES_INTERVAL_MS,

        alert_queue_interval_ms:
            ALERT_QUEUE_INTERVAL_MS,

        morning_briefings_check_interval_ms:
            MORNING_BRIEFINGS_INTERVAL_MS,

        intelligence_findings_interval_ms:
            INTELLIGENCE_FINDINGS_INTERVAL_MS,
    });

    /*
     * Run the minute-based jobs immediately so the application does not wait
     * one full minute after startup — but staggered, so a restart does not
     * open a burst of concurrent Python sessions against a 12-connection pool.
     *
     * Order matters: the jobs that produce intelligence other jobs read come
     * first, and the hourly findings pass comes last because nothing depends
     * on it during warm-up.
     */
    const startupPasses = [
        ['business-state', runBusinessStateRebuild],
        ['recommendation-outcomes', runRecommendationOutcomeEvaluation],
        ['alert-queue', runAlertQueue],
        ['store-sync', runStoreSync],
        ['feature-queue', runFeatureQueue],
        ['recovery-queue', runRecoveryQueue],
        ['churn-queue', runChurnQueue],
        ['intelligence-automation', runAutomationQueue],
        ['training-observations', runTrainingObservationQueue],
        ['intelligence-findings', runIntelligenceFindingsRefresh],
        ['webhook-delivery-recovery', runWebhookDeliveryRecovery],
    ];

    startupPasses.forEach(([jobName, runPass], index) => {
        const delay = index * SCHEDULER_STARTUP_STAGGER_MS;

        const timer = setTimeout(() => {
            startupPassTimers = startupPassTimers.filter(
                (candidate) => candidate !== timer
            );

            // A startup pass must never reject unhandled: an uncaught rejection
            // during warm-up would take the process down before it served traffic.
            Promise.resolve()
                .then(runPass)
                .catch((error) => {
                    logger.error('scheduler_startup_pass_failed', {
                        job: jobName,
                        error_type: error?.code || error?.name || 'startup_error',
                    });
                });
        }, delay);

        // Never hold the event loop open for warm-up alone.
        timer.unref?.();
        startupPassTimers.push(timer);
    });

    logger.info('scheduler_startup_passes_scheduled', {
        passes: startupPasses.length,
        stagger_ms: SCHEDULER_STARTUP_STAGGER_MS,
        warmup_window_ms:
            Math.max(0, startupPasses.length - 1) * SCHEDULER_STARTUP_STAGGER_MS,
    });

    businessStateTimer = setInterval(
        runBusinessStateRebuild,
        BUSINESS_STATE_INTERVAL_MS
    );

    recommendationOutcomesTimer = setInterval(
        runRecommendationOutcomeEvaluation,
        RECOMMENDATION_OUTCOMES_INTERVAL_MS
    );

    alertQueueTimer = setInterval(
        runAlertQueue,
        ALERT_QUEUE_INTERVAL_MS
    );

    storeSyncTimer = setInterval(
        runStoreSync,
        STORE_SYNC_INTERVAL_MS
    );

    featureJobTimer = setInterval(runFeatureQueue, FEATURE_JOB_INTERVAL_MS);
    recoveryActionTimer = setInterval(runRecoveryQueue, RECOVERY_ACTION_INTERVAL_MS);
    churnScoringTimer = setInterval(runChurnQueue, CHURN_SCORING_INTERVAL_MS);
    intelligenceAutomationTimer = setInterval(
        runAutomationQueue,
        INTELLIGENCE_AUTOMATION_INTERVAL_MS
    );
    trainingObservationTimer = setInterval(
        runTrainingObservationQueue,
        CHURN_SCORING_INTERVAL_MS
    );

    intelligenceFindingsTimer = setInterval(
        runIntelligenceFindingsRefresh,
        INTELLIGENCE_FINDINGS_INTERVAL_MS
    );

    webhookDeliveryRecoveryTimer = setInterval(
        runWebhookDeliveryRecovery,
        WEBHOOK_DELIVERY_RECOVERY_INTERVAL_MS
    );

    /*
     * This checks every minute, but runMorningBriefings() only executes
     * when the UTC time is exactly 05:00.
     */
    morningBriefingsTimer = setInterval(
        runMorningBriefings,
        MORNING_BRIEFINGS_INTERVAL_MS
    );
}

// -----------------------------------------------------------------------------
// Stop
// -----------------------------------------------------------------------------

function stopScheduler() {
    if (!started) {
        return;
    }

    logger.info('scheduler_stopping');

    if (businessStateTimer) {
        clearInterval(businessStateTimer);
        businessStateTimer = null;
    }

    if (recommendationOutcomesTimer) {
        clearInterval(recommendationOutcomesTimer);
        recommendationOutcomesTimer = null;
    }

    if (alertQueueTimer) {
        clearInterval(alertQueueTimer);
        alertQueueTimer = null;
    }

    if (storeSyncTimer) {
        clearInterval(storeSyncTimer);
        storeSyncTimer = null;
    }

    if (morningBriefingsTimer) {
        clearInterval(morningBriefingsTimer);
        morningBriefingsTimer = null;
    }

    if (featureJobTimer) {
        clearInterval(featureJobTimer);
        featureJobTimer = null;
    }

    if (recoveryActionTimer) {
        clearInterval(recoveryActionTimer);
        recoveryActionTimer = null;
    }

    if (churnScoringTimer) {
        clearInterval(churnScoringTimer);
        churnScoringTimer = null;
    }

    if (intelligenceAutomationTimer) {
        clearInterval(intelligenceAutomationTimer);
        intelligenceAutomationTimer = null;
    }

    if (trainingObservationTimer) {
        clearInterval(trainingObservationTimer);
        trainingObservationTimer = null;
    }

    if (webhookDeliveryRecoveryTimer) {
        clearInterval(webhookDeliveryRecoveryTimer);
        webhookDeliveryRecoveryTimer = null;
    }

    if (intelligenceFindingsTimer) {
        clearInterval(intelligenceFindingsTimer);
        intelligenceFindingsTimer = null;
    }

    // Cancel any warm-up pass that has not fired yet, so a stop during start-up
    // cannot leave a job running after the scheduler reports itself stopped.
    for (const timer of startupPassTimers) {
        clearTimeout(timer);
    }
    startupPassTimers = [];

    started = false;

    logger.info('scheduler_stopped');
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
    startScheduler,
    stopScheduler,
    runAlertQueue,
    runChurnQueue,
    runFeatureQueue,
    runWebhookDeliveryRecovery,
    runRecoveryQueue,
    runAutomationQueue,
    runTrainingObservationQueue,
    runIntelligenceFindingsRefresh,
    promoteInactiveCheckouts,
};
