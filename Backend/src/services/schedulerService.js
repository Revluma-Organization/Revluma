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
} = require('./mlService');
const { syncShopifyStore } = require('./shopifySync');

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const BUSINESS_STATE_INTERVAL_MS = parseInt(
    process.env.BUSINESS_STATE_INTERVAL_MS || '60000',
    10
);

const RECOMMENDATION_OUTCOMES_INTERVAL_MS = parseInt(
    process.env.RECOMMENDATION_OUTCOMES_INTERVAL_MS || '60000',
    10
);

const ALERT_QUEUE_INTERVAL_MS = parseInt(
    process.env.ALERT_QUEUE_INTERVAL_MS || '60000',
    10
);

const MORNING_BRIEFINGS_INTERVAL_MS = parseInt(
    process.env.MORNING_BRIEFINGS_INTERVAL_MS || '60000',
    10
);

const STORE_SYNC_INTERVAL_MS = parseInt(
    process.env.STORE_SYNC_INTERVAL_MS || String(15 * 60 * 1000),
    10
);

const LOCK_TTL_SECONDS = parseInt(
    process.env.SCHEDULER_LOCK_TTL_SECONDS || '300',
    10
);

const ALERT_QUEUE_BATCH_SIZE = Math.min(
    Math.max(
        parseInt(process.env.ALERT_QUEUE_BATCH_SIZE || '25', 10),
        1
    ),
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

let businessStateRunning = false;
let recommendationOutcomesRunning = false;
let alertQueueRunning = false;
let morningBriefingsRunning = false;
let storeSyncRunning = false;

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
async function acquireLock(lockName) {
    if (!isRedisReady()) {
        logger.warn('scheduler_lock_unavailable', {
            lock: lockName,
            reason: 'redis_not_ready',
        });

        return null;
    }

    const redis = getRedisClient();

    if (!redis) {
        logger.warn('scheduler_lock_unavailable', {
            lock: lockName,
            reason: 'redis_client_missing',
        });

        return null;
    }

    const token = crypto.randomUUID();
    const key = `revluma:scheduler:${lockName}`;

    try {
        const result = await redis.set(
            key,
            token,
            'EX',
            LOCK_TTL_SECONDS,
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
            message: error.message,
        });

        return null;
    }
}

/**
 * Release a lock only if this scheduler instance owns it.
 */
async function releaseLock(lock) {
    if (!lock || !isRedisReady()) {
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
            message: error.message,
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

    const lock = await acquireLock('business-state');

    if (!lock) {
        logger.debug?.('scheduler_business_state_lock_not_acquired');
        return;
    }

    businessStateRunning = true;

    const startedAt = Date.now();

    try {
        logger.info('scheduler_business_state_started');

        const organizations = await prisma.organizations.findMany({
            select: {
                id: true,
            },
        });

        let succeeded = 0;
        let failed = 0;

        for (const organization of organizations) {
            const correlationId =
                `scheduler-business-state-${organization.id}-${Date.now()}`;

            try {
                const result = await rebuildBusinessState({
                    organizationId: organization.id,
                    correlationId,
                });

                if (!result.success) {
                    failed++;

                    logger.warn('scheduler_business_state_org_failed', {
                        organization_id: organization.id,
                        code: result.error?.code,
                    });

                    continue;
                }

                succeeded++;
            } catch (error) {
                failed++;

                logger.error('scheduler_business_state_org_exception', {
                    organization_id: organization.id,
                    message: error.message,
                });
            }
        }

        logger.info('scheduler_business_state_completed', {
            organizations: organizations.length,
            succeeded,
            failed,
            latency_ms: Date.now() - startedAt,
        });
    } catch (error) {
        logger.error('scheduler_business_state_failed', {
            message: error.message,
            latency_ms: Date.now() - startedAt,
        });
    } finally {
        businessStateRunning = false;
        await releaseLock(lock);
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
            message: error.message,
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
            message: error.message,
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
            try {
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

                const nextAttemptCount =
                    alert.attempt_count + 1;

                await prisma.alert_queue.update({
                    where: {
                        id: alert.id,
                    },
                    data: {
                        status:
                            nextAttemptCount >= 5
                                ? 'failed'
                                : 'pending',
                        attempt_count: nextAttemptCount,
                        failed_at:
                            nextAttemptCount >= 5
                                ? new Date()
                                : null,
                        last_error: error.message.slice(0, 500),
                        updated_at: new Date(),
                    },
                });

                logger.error('scheduler_alert_processing_failed', {
                    alert_id: alert.id,
                    organization_id: alert.organization_id,
                    attempt_count: nextAttemptCount,
                    message: error.message,
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
            message: error.message,
            latency_ms: Date.now() - startedAt,
        });
    } finally {
        alertQueueRunning = false;
        await releaseLock(lock);
    }
}

async function runStoreSync() {
    if (storeSyncRunning) return;
    const lock = await acquireLock('store-sync');
    if (!lock) return;
    storeSyncRunning = true;
    const startedAt = Date.now();

    try {
        const cutoff = new Date(Date.now() - STORE_SYNC_INTERVAL_MS);
        const stores = await prisma.stores.findMany({
            where: {
                platform: 'shopify',
                status: { in: ['active', 'error'] },
                OR: [{ last_synced_at: null }, { last_synced_at: { lte: cutoff } }],
            },
            take: 10,
        });
        let succeeded = 0;
        for (const store of stores) {
            try {
                await syncShopifyStore(store);
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
    });

    /*
     * Run the minute-based jobs immediately so the application does not
     * wait one full minute after startup.
     */
    void runBusinessStateRebuild();
    void runRecommendationOutcomeEvaluation();
    void runAlertQueue();
    void runStoreSync();

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

    started = false;

    logger.info('scheduler_stopped');
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
    startScheduler,
    stopScheduler,
};