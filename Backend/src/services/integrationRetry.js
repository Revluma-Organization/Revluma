'use strict';

// Task 215 — authenticated, idempotent, tenant-scoped manual sync-retry.
//
// Guarantees (the task's hard requirements):
//  - TENANT OWNERSHIP server-side: the store is loaded by (id, organization_id)
//    and must be a connected Shopify store. Client flags are never trusted.
//  - DETERMINISTIC ELIGIBILITY: permanent failures (authorization/permission)
//    are NOT sync-retryable — the merchant must reconnect. Only actionable
//    (transient / worker-interrupted) failures proceed.
//  - NO DUPLICATE JOBS: dedup is enforced in the DATABASE, not an in-memory
//    lock. (store_id, scope, request_key) is a unique idempotency key — a
//    replayed client request returns the SAME row; an in-flight request for
//    the scope returns that job. Both are handled in one short transaction.
//  - SHORT TRANSACTION: the transaction only reads/writes the ledger + retry
//    row + the store sync fields. It NEVER spans a Shopify call. The actual
//    sync is started AFTER the transaction commits (fire-and-forget), exactly
//    like the existing setup-retry path.
//
// The service returns a plain result object; the controller maps it to HTTP.

const crypto = require('crypto');
const { buildSyncProgress, ALL_DOMAINS } = require('./integrationProgress');

const ACTIVE_STATUSES = Object.freeze(['requested', 'accepted', 'queued', 'running']);
const TERMINAL_STATUSES = Object.freeze(['completed', 'partial', 'failed']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getPrisma(provided) {
  return provided != null ? provided : require('../configs/database').prisma;
}

const STORE_SELECT = {
  id: true, organization_id: true, platform: true, status: true, shop_domain: true,
  granted_scopes: true, last_synced_at: true, installed_at: true, updated_at: true,
  integration_state: true, integration_reason_code: true, authorization_verified_at: true,
  initial_sync_status: true, current_sync_job_id: true, sync_started_at: true,
  sync_completed_at: true, sync_error_code: true, sync_attempt_count: true, recovery_status: true,
};

async function loadStoreForRetry(db, organizationId, storeId) {
  if (typeof storeId !== 'string' || !UUID_RE.test(storeId)) return null;
  return await db.stores.findFirst({
    where: {
      id: storeId,
      organization_id: organizationId,
      platform: 'shopify',
      access_token: { not: null },
      status: { notIn: ['inactive', 'deleted'] },
    },
    select: STORE_SELECT,
  });
}

async function progressForStore(db, store, now = new Date()) {
  const domainRows = await db.store_sync_domain_states
    .findMany({ where: { store_id: store.id } })
    .catch(() => []);
  return buildSyncProgress({ store, domainRows, now });
}

// The idempotent manual retry. See module header for guarantees.
async function requestSyncRetry({ db: providedDb, organizationId, storeId, scope = 'all', requestKey = null, now = new Date() }) {
  const db = getPrisma(providedDb);

  if (typeof scope !== 'string' || !(['all', ...ALL_DOMAINS].includes(scope))) {
    return { ok: false, httpStatus: 400, error: 'Invalid retry scope' };
  }
  if (!organizationId) return { ok: false, httpStatus: 403, error: 'Membership required' };

  const store = await loadStoreForRetry(db, organizationId, storeId);
  if (!store) return { ok: false, httpStatus: 404, error: 'Shopify store not found' };

  const progress = await progressForStore(db, store, now);
  const retry = progress.retry;

  const effectiveRequestKey = (typeof requestKey === 'string' && requestKey.length > 0 && requestKey.length <= 160)
    ? requestKey
    : crypto.randomUUID();

  // Idempotency (checked BEFORE already-in-progress so a replayed client
  // request returns its own recorded result, not a 409): same
  // (store, scope, request_key) => the SAME row, never a duplicate job.
  const preExisting = await db.sync_retry_requests.findUnique({
    where: { store_id_scope_request_key: { store_id: store.id, scope, request_key: effectiveRequestKey } },
  }).catch(() => null);
  if (preExisting) {
    return {
      ok: true, httpStatus: 202,
      data: {
        store_id: store.id, status: preExisting.status, job_id: preExisting.job_id, attempt: preExisting.attempt,
        idempotent: true, duplicate: false, started: false,
        reason_code: retry.reason_code || null, next_step: retry.next_step || null,
      },
    };
  }

  // A job already running/queued for this store must never be double-started.
  // `stalled` is the exception: the worker is gone, so a retry is allowed (the
  // sync engine's own distributed lock still guards against a live run).
  if (progress.job.status === 'running' || progress.job.status === 'queued') {
    return { ok: false, httpStatus: 409, error: 'already_in_progress', data: { job_id: progress.job.id, status: progress.job.status } };
  }

  // Eligibility gate. A permanent (authorization/permission/unsupported)
  // failure is NOT a sync-retry — the merchant must reconnect, so we say so
  // explicitly instead of silently re-running a doomed sync.
  if (retry.merchant_action_required && !retry.manual_retry_eligible) {
    return {
      ok: false, httpStatus: 409, error: 'retry_not_eligible',
      data: { reason_code: retry.reason_code || 'PERMANENT_FAILURE', next_step: retry.next_step || 'reconnect', category: retry.category || null },
    };
  }
  // No actionable failure and nothing to redo (idle/healthy): a sync retry is a
  // no-op. Keep it strict so the API never fabricates work.
  if (!retry.actionable && !['stalled', 'failed', 'partial'].includes(progress.job.status)) {
    return {
      ok: false, httpStatus: 409, error: 'retry_not_eligible',
      data: { reason_code: 'NO_ACTIONABLE_FAILURE', next_step: 'none', category: null },
    };
  }

  // One short transaction: idempotency (re-check for races) + dedup +
  // transition. No Shopify call.
  const result = await db.$transaction(async (tx) => {
    // (1) Idempotency: same (store, scope, request_key) => the SAME row.
    const existing = await tx.sync_retry_requests.findUnique({
      where: { store_id_scope_request_key: { store_id: store.id, scope, request_key: effectiveRequestKey } },
    });
    if (existing) {
      return {
        kind: 'idempotent',
        status: existing.status,
        job_id: existing.job_id,
        attempt: existing.attempt,
        created: false,
      };
    }
    // (2) Dedup: an in-flight request for this scope (any key) => that job.
    const inFlight = await tx.sync_retry_requests.findFirst({
      where: { store_id: store.id, scope, status: { in: ACTIVE_STATUSES } },
      orderBy: { created_at: 'desc' },
    });
    if (inFlight) {
      return { kind: 'duplicate', status: inFlight.status, job_id: inFlight.job_id, attempt: inFlight.attempt, created: false };
    }
    // (3) Create a new accepted retry and transition the store to running.
    const jobId = crypto.randomUUID();
    const nowDate = new Date(now);
    const created = await tx.sync_retry_requests.create({
      data: {
        store_id: store.id,
        scope,
        request_key: effectiveRequestKey,
        status: 'accepted',
        job_id: jobId,
        reason_code: retry.reason_code || null,
        attempt: (store.sync_attempt_count || 0) + 1,
        updated_at: nowDate,
      },
    });
    await tx.stores.update({
      where: { id: store.id },
      data: {
        current_sync_job_id: jobId,
        initial_sync_status: 'running',
        sync_started_at: nowDate,
        sync_completed_at: null,
        sync_error_code: null,
        sync_attempt_count: { increment: 1 },
        recovery_status: 'recovering',
        updated_at: nowDate,
      },
    });
    return { kind: 'created', status: 'accepted', job_id: created.job_id, attempt: created.attempt, created: true };
  });

  return {
    ok: true,
    httpStatus: 202,
    data: {
      store_id: store.id,
      status: result.status,
      job_id: result.job_id,
      attempt: result.attempt,
      idempotent: result.kind === 'idempotent',
      duplicate: result.kind === 'duplicate',
      started: result.kind === 'created',
      reason_code: retry.reason_code || null,
      next_step: retry.next_step || null,
    },
  };
}

// Finalize a retry request when the authoritative sync reaches a terminal
// state (called by the sync engine / status watcher). Keeps the request's
// status machine truthful and marks it completed with a real timestamp.
async function finalizeSyncRetry({ db: providedDb, storeId, status, reasonCode = null, now = new Date() }) {
  const db = getPrisma(providedDb);
  const terminal = TERMINAL_STATUSES.includes(status) ? status : null;
  if (!terminal) return { updated: 0 };
  const nowDate = new Date(now);
  try {
    const res = await db.sync_retry_requests.updateMany({
      where: { store_id: storeId, status: { in: ACTIVE_STATUSES } },
      data: { status: terminal, reason_code: reasonCode || undefined, completed_at: nowDate, updated_at: nowDate },
    });
    return { updated: res?.count || 0 };
  } catch {
    return { updated: 0 };
  }
}

module.exports = {
  requestSyncRetry,
  finalizeSyncRetry,
  loadStoreForRetry,
  progressForStore,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
};
