'use strict';

/**
 * Sync supervisor: keeps every connected store's data current without any
 * merchant action, and never silently abandons one.
 *
 * Responsibilities
 * ----------------
 * - Select stores that are due: never synced, older than the sync interval,
 *   or interrupted mid-run — excluding stores whose authorization is broken
 *   (those need the merchant, not a retry) and stores inside a backoff window.
 * - Record every outcome durably on the store row: consecutive failures,
 *   failure class and the next attempt time. Success resets the counters.
 * - Classify failures: authorization problems are not retried on a timer
 *   (they surface as a merchant action); throttling and provider outages back
 *   off exponentially with jitter; unknown and persistence failures back off
 *   too and are escalated to engineering.
 * - Dead-letter: after DEAD_LETTER_THRESHOLD consecutive failures an operation
 *   gets an `operation_dead_letters` record and an engineering alert. It keeps
 *   retrying at the capped cadence, and the next verified success resolves the
 *   record automatically. Dead-lettering is escalation, never abandonment.
 *
 * Every pass returns counters (considered/succeeded/failed/skipped with
 * reasons) that the scheduler writes to `automation_job_state`, so "did store
 * sync run, and why not" is answerable from the database, not just logs.
 */

const logger = require('../utils/logger');
const { raiseAlert, resolveAlert } = require('../utils/engineeringAlert');
const { storeSyncEligibility } = require('./shopifySyncRecovery');

const BACKOFF_BASE_MS = 2 * 60 * 1000;
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;
const BACKOFF_JITTER = 0.2;
const DEAD_LETTER_THRESHOLD = 5;

// Integration states in which a sync cannot succeed until the merchant acts.
const AUTH_BLOCKED_STATES = Object.freeze([
  'disconnected', 'authorization_required', 'authorization_expired', 'authorization_revoked',
]);

// A store whose token works but lacks a required scope is recorded as
// `needs_attention` + PERMISSIONS_MISSING. Shopify answers every sync with 403
// until the merchant reconnects and grants the scope (that reconnect moves the
// store back to `connected`), so it waits like the states above. Other
// `needs_attention` reasons (webhook registration, a failed sync) can clear on
// their own and keep retrying.
const PERMISSIONS_BLOCKED = Object.freeze({ integration_state: 'needs_attention', integration_reason_code: 'PERMISSIONS_MISSING' });

function waitingOnMerchantFilter() {
  return { OR: [{ integration_state: { in: [...AUTH_BLOCKED_STATES] } }, { ...PERMISSIONS_BLOCKED }] };
}

const FAILURE = Object.freeze({
  AUTH: 'auth',
  RATE_LIMITED: 'rate_limited',
  TRANSIENT: 'transient',
  PERSISTENCE: 'persistence',
  COORDINATION: 'coordination',
  UNKNOWN: 'unknown',
});

function defaultDb() {
  return require('../configs/database').prisma;
}

function errorCode(error) {
  return String(error?.code || error?.name || 'sync_error').slice(0, 120);
}

/** Classify a store-level sync failure into a retry policy class. */
function classifyStoreFailure(error) {
  const code = errorCode(error).toUpperCase();
  if (code === 'SHOPIFY_SYNC_COORDINATION_UNAVAILABLE') return FAILURE.COORDINATION;
  const { classifyShopifyError } = require('./integrationLifecycle');
  const reason = classifyShopifyError(error);
  if (['AUTHORIZATION_REQUIRED', 'AUTHORIZATION_EXPIRED', 'PERMISSIONS_MISSING'].includes(reason)) return FAILURE.AUTH;
  if (reason === 'PROVIDER_THROTTLED') return FAILURE.RATE_LIMITED;
  if (reason === 'PROVIDER_UNAVAILABLE') return FAILURE.TRANSIENT;
  if (reason === 'BACKEND_FAILURE') return FAILURE.PERSISTENCE;
  const { classifyFailure, FAILURE_CLASS } = require('./syncStateContract');
  const contractClass = classifyFailure(error?.code, error?.message);
  if (contractClass === FAILURE_CLASS.RATE_LIMITED) return FAILURE.RATE_LIMITED;
  if (contractClass === FAILURE_CLASS.TRANSIENT) return FAILURE.TRANSIENT;
  if (contractClass === FAILURE_CLASS.PERSISTENCE) return FAILURE.PERSISTENCE;
  return FAILURE.UNKNOWN;
}

/**
 * Exponential backoff with symmetric jitter, capped. `attempt` is 1-based
 * (the number of consecutive failures so far). A provider Retry-After wins
 * when it is longer than the computed delay.
 */
function backoffMs(attempt, { random = Math.random, retryAfterMs = null, baseMs = BACKOFF_BASE_MS, capMs = BACKOFF_CAP_MS } = {}) {
  const n = Math.max(1, Math.trunc(Number(attempt) || 1));
  const raw = Math.min(capMs, baseMs * 2 ** (n - 1));
  const jitter = 1 + (Math.min(1, Math.max(0, random())) * 2 - 1) * BACKOFF_JITTER;
  const delay = Math.min(capMs, Math.round(raw * jitter));
  const hinted = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.min(capMs, retryAfterMs) : 0;
  return Math.max(delay, hinted);
}

function retryAfterFrom(error) {
  const header = error?.retryAfter ?? error?.response?.headers?.['retry-after'];
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

// ---------------------------------------------------------------------------
// Dead letters
// ---------------------------------------------------------------------------

function openKey(kind, subjectKey) {
  return `${kind}:${subjectKey}`.slice(0, 260);
}

async function openDeadLetter(db, { kind, subjectKey, storeId = null, failureClass, errorCode: code = null, attempts, nextRetryAt = null, detail = {} }, now = new Date()) {
  const key = openKey(kind, subjectKey);
  const existing = await db.operation_dead_letters.findUnique({ where: { open_key: key } });
  if (existing) {
    await db.operation_dead_letters.update({
      where: { open_key: key },
      data: {
        failure_class: failureClass, error_code: code, attempts,
        last_failed_at: now, next_retry_at: nextRetryAt, updated_at: now,
      },
    });
  } else {
    try {
      await db.operation_dead_letters.create({
        data: {
          kind, subject_key: String(subjectKey).slice(0, 200), store_id: storeId, status: 'open',
          open_key: key, failure_class: failureClass, error_code: code, attempts,
          first_failed_at: now, last_failed_at: now, next_retry_at: nextRetryAt, detail,
        },
      });
    } catch (error) {
      if (error?.code !== 'P2002') throw error; // concurrent open: the other writer's row stands
    }
  }
  raiseAlert('operation_dead_lettered', {
    severity: failureClass === FAILURE.PERSISTENCE || failureClass === FAILURE.COORDINATION ? 'critical' : 'error',
    subject: key, kind, store_id: storeId, failure_class: failureClass, error_code: code, attempts,
    next_retry_at: nextRetryAt,
  });
  return key;
}

async function resolveDeadLetter(db, kind, subjectKey, resolution = 'recovered', now = new Date()) {
  const key = openKey(kind, subjectKey);
  const result = await db.operation_dead_letters.updateMany({
    where: { open_key: key, status: 'open' },
    data: { status: 'resolved', open_key: null, resolved_at: now, resolution, updated_at: now },
  });
  if (result.count > 0) {
    resolveAlert('operation_dead_lettered', { subject: key, resolution });
    logger.info('operation_dead_letter_resolved', { kind, subject: key, resolution });
  }
  return result.count > 0;
}

// ---------------------------------------------------------------------------
// Store outcomes
// ---------------------------------------------------------------------------

/**
 * Persist a sync outcome on the store row. Best-effort by design for the
 * caller (the sync result stands regardless), but every failure to persist is
 * logged and alerted rather than swallowed.
 */
async function recordSyncOutcome(store, { ok, error = null, now = new Date(), random = Math.random, db = defaultDb() } = {}) {
  try {
    if (ok) {
      await db.stores.updateMany({
        where: { id: store.id },
        data: { sync_consecutive_failures: 0, sync_next_attempt_at: null, sync_last_failure_class: null },
      });
      await resolveDeadLetter(db, 'store_sync', store.id, 'recovered', now);
      return { recorded: true, failures: 0, nextAttemptAt: null };
    }
    const current = await db.stores.findUnique({
      where: { id: store.id }, select: { sync_consecutive_failures: true },
    });
    const failures = (Number(current?.sync_consecutive_failures) || 0) + 1;
    const failureClass = classifyStoreFailure(error);
    // Authorization failures wait for the merchant: the integration state
    // already excludes the store from selection and drives the reconnect
    // prompt. Retrying them on a timer would only hammer Shopify with a dead
    // token.
    const nextAttemptAt = failureClass === FAILURE.AUTH
      ? null
      : new Date(now.getTime() + backoffMs(failures, { random, retryAfterMs: retryAfterFrom(error) }));
    await db.stores.updateMany({
      where: { id: store.id },
      data: { sync_consecutive_failures: failures, sync_next_attempt_at: nextAttemptAt, sync_last_failure_class: failureClass },
    });
    logger.warn('store_sync_retry_scheduled', {
      store_id: store.id, failure_class: failureClass, error_type: errorCode(error),
      consecutive_failures: failures, next_attempt_at: nextAttemptAt ? nextAttemptAt.toISOString() : null,
    });
    if (failureClass !== FAILURE.AUTH && failures >= DEAD_LETTER_THRESHOLD) {
      await openDeadLetter(db, {
        kind: 'store_sync', subjectKey: store.id, storeId: store.id, failureClass,
        errorCode: errorCode(error), attempts: failures, nextRetryAt: nextAttemptAt,
        detail: { stage: error?.setupStage || error?.sync_stage || null },
      }, now);
    }
    return { recorded: true, failures, failureClass, nextAttemptAt };
  } catch (persistError) {
    logger.error('store_sync_outcome_unrecorded', {
      store_id: store.id, error_type: persistError?.code || persistError?.name || 'outcome_error',
    });
    raiseAlert('store_sync_outcome_unrecorded', {
      severity: 'critical', subject: store.id, error_type: persistError?.code || persistError?.name,
    });
    return { recorded: false };
  }
}

// ---------------------------------------------------------------------------
// Selection + pass
// ---------------------------------------------------------------------------

function dueStoreFilter(now, intervalMs) {
  return {
    AND: [
      storeSyncEligibility(now, intervalMs),
      { access_token: { not: null } },
      { integration_state: { notIn: [...AUTH_BLOCKED_STATES] } },
      { NOT: { ...PERMISSIONS_BLOCKED } },
      { OR: [{ sync_next_attempt_at: null }, { sync_next_attempt_at: { lte: new Date(now) } }] },
    ],
  };
}

/**
 * Run one supervised pass. `syncFn(store)` is the sync engine; it owns the
 * per-store lease and records its own outcome. The supervisor only selects,
 * isolates failures per store and reports counters.
 */
async function runStoreSyncPass({ db = defaultDb(), syncFn, now = Date.now(), intervalMs, limit = 10 } = {}) {
  if (typeof syncFn !== 'function') throw new TypeError('runStoreSyncPass requires syncFn');
  const stores = await db.stores.findMany({
    where: dueStoreFilter(now, intervalMs),
    orderBy: [{ last_synced_at: { sort: 'asc', nulls: 'first' } }],
    take: limit,
  });
  const counters = { considered: stores.length, succeeded: 0, failed: 0, skipped: 0, skip_reasons: {}, failure_classes: {} };
  const skip = reason => {
    counters.skipped += 1;
    counters.skip_reasons[reason] = (counters.skip_reasons[reason] || 0) + 1;
  };
  for (const store of stores) {
    try {
      if (store.status === 'syncing') {
        logger.warn('scheduler_interrupted_sync_resumed', { store_id: store.id, previous_updated_at: store.updated_at });
      }
      const result = await syncFn(store);
      if (result?.success) counters.succeeded += 1;
      else if (result?.alreadyRunning) skip('already_running');
      else if (result?.stale) skip('superseded_by_newer_run');
      else skip('not_completed');
    } catch (error) {
      counters.failed += 1;
      const failureClass = classifyStoreFailure(error);
      counters.failure_classes[failureClass] = (counters.failure_classes[failureClass] || 0) + 1;
    }
  }
  // Stores that are due but deliberately waiting are reported too, so a
  // quiet pass is distinguishable from one that had nothing to do.
  try {
    counters.waiting_backoff = await db.stores.count({
      where: { AND: [storeSyncEligibility(now, intervalMs), { sync_next_attempt_at: { gt: new Date(now) } }] },
    });
    counters.waiting_authorization = await db.stores.count({
      where: { AND: [storeSyncEligibility(now, intervalMs), waitingOnMerchantFilter()] },
    });
  } catch {
    counters.waiting_backoff = null;
    counters.waiting_authorization = null;
  }
  return counters;
}

module.exports = {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  DEAD_LETTER_THRESHOLD,
  AUTH_BLOCKED_STATES,
  PERMISSIONS_BLOCKED,
  FAILURE,
  classifyStoreFailure,
  backoffMs,
  openDeadLetter,
  resolveDeadLetter,
  recordSyncOutcome,
  dueStoreFilter,
  runStoreSyncPass,
};
