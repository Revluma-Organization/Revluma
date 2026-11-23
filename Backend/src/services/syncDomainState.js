'use strict';

// Per-domain sync execution ledger.
//
// The global stores.last_synced_at cannot express which domains succeeded,
// which failed, how many records were seen, or whether a paginated domain
// finished. This module persists one row per (store, domain) so the data
// completeness model and operators can answer those questions without
// reading service logs.
//
// Guarantees:
// - Ledger failures never throw into the sync pipeline. A ledger write that
//   fails is logged and the sync proceeds; a sync must never be torn down
//   because telemetry was unavailable.
// - Nothing here fabricates coverage. A domain counts as succeeded only
//   when recordSuccess is called, and certification callers must additionally
//   check pagination_complete for paginated domains.
// - Checkpoints are opaque caller-owned JSON merged atomically per write.

const { authorizedResourceIds } = require('./authorizedResourceCatalog');
const C = require('./syncStateContract');

const DOMAINS = Object.freeze([...new Set([
  ...authorizedResourceIds(),
  'products',
  'variants',
  'inventory',
  'locations',
  'markets',
  'orders',
  'transactions',
  'refunds',
  'fulfillments',
  'customers',
  'customer_journeys',
  'abandoned_checkouts',
  'store_domains',
  'webhooks',
  'pixel_events',
])]);

function defaultDb() {
  return require('../configs/database').prisma; // lazy: keeps this module importable without engines
}

function assertDomain(domain) {
  if (!DOMAINS.includes(domain)) {
    throw new Error(`Unknown sync domain: ${domain}`);
  }
}

function safeMessage(error) {
  if (!error) return null;
  const msg = error.shopifyErrors?.[0]?.message || error.message || String(error);
  return String(msg).slice(0, 500);
}

// Compute the canonical contract columns for a write. The persisted `status`
// stays the engine value; these columns carry the typed, versioned lifecycle +
// coverage certification. The read path re-derives from the persisted row, so
// these are a consistent denormalized snapshot for direct inspection, never the
// sole source of truth.
function contractColumns(canonical, { code, details, discovered, inserted, updated, paginationComplete, succeededAt, retryCount, capabilityState, failureClass } = {}) {
  const terminalFailure = canonical === C.RESOURCE_STATUS.FAILED || canonical === C.RESOURCE_STATUS.RESOURCE_PARTIAL;
  // A blocked row carries an explicit class (auth vs unsupported) decided by
  // the permission registry, never a guess from the error text.
  const failure_class = failureClass
    || (terminalFailure ? C.classifyFailure(code, details) : C.FAILURE_CLASS.NONE);
  // Capability is known whenever the caller evaluated live scopes: a domain
  // that just synced is authorized; a blocked domain says why. Otherwise the
  // honest value remains unknown.
  const capability_state = C.CAPABILITY_VALUES.includes(capabilityState)
    ? capabilityState
    : (canonical === C.RESOURCE_STATUS.RESOURCE_COMPLETED ? C.CAPABILITY.AUTHORIZED : C.CAPABILITY.UNKNOWN);
  const pseudoRow = {
    status: canonical,
    records_discovered: numOr(discovered),
    records_inserted: numOr(inserted),
    records_updated: numOr(updated),
    pagination_complete: Boolean(paginationComplete),
    error_code: code || null,
    error_details: details || null,
    failure_class,
    last_succeeded_at: succeededAt || null,
    last_attempted_at: new Date(),
    capability_state,
    retry_count: retryCount == null ? 0 : retryCount,
  };
  return {
    canonical_status: canonical,
    coverage_state: C.deriveCoverageState(pseudoRow),
    failure_class,
    capability_state,
    retry_eligible: C.retryEligible(pseudoRow),
    schema_version: C.CONTRACT_VERSION,
    coverage_limitations: null,
  };
}

async function beginAttempt(storeId, domain, db = defaultDb()) {
  assertDomain(domain);
  const now = new Date();
  const cc = contractColumns(C.RESOURCE_STATUS.RUNNING, { discovered: 0, inserted: 0, updated: 0, paginationComplete: false });
  try {
    await db.store_sync_domain_states.upsert({
      where: { store_id_domain: { store_id: storeId, domain } },
      update: {
        status: 'running',
        ...cc,
        records_discovered: 0,
        records_inserted: 0,
        records_updated: 0,
        records_deleted: 0,
        pages_completed: 0,
        pagination_complete: false,
        last_attempted_at: now,
        updated_at: now,
      },
      create: {
        store_id: storeId,
        domain,
        status: 'running',
        ...cc,
        last_attempted_at: now,
        last_checked_at: now,
      },
    });
    return true;
  } catch (error) {
    loggerWarn(storeId, domain, error, 'begin_attempt');
    return false;
  }
}

// Reap only the exact resource observation that was inspected. A completed or
// restarted attempt must not be overwritten by a stale reaper scan. This is a
// metadata CAS, not a lease or fencing token for the worker's business writes.
async function recordStaleFailure(storeId, row, now = new Date(), db = defaultDb()) {
  assertDomain(row.domain);
  const code = 'SYNC_STALE_TIMEOUT';
  const details = `Sync domain ${row.domain} made no progress beyond the stall window`;
  const cc = contractColumns(C.RESOURCE_STATUS.FAILED, {
    code, details, discovered: row.records_discovered, inserted: row.records_inserted,
    updated: row.records_updated, paginationComplete: false,
    succeededAt: row.last_succeeded_at, retryCount: (Number(row.retry_count) || 0) + 1,
  });
  const result = await db.store_sync_domain_states.updateMany({
    where: {
      store_id: storeId, domain: row.domain, status: row.status,
      last_attempted_at: row.last_attempted_at ?? null,
      last_checked_at: row.last_checked_at ?? null,
      updated_at: row.updated_at ?? null,
    },
    data: {
      status: 'failed', ...cc, error_code: code, error_details: details,
      error_since: row.error_since || now, retry_count: { increment: 1 },
      last_checked_at: now, updated_at: now, pagination_complete: false,
    },
  });
  return result.count === 1;
}

async function recordSuccess(storeId, domain, report = {}, db = defaultDb()) {
  assertDomain(domain);
  const now = new Date();
  const cc = contractColumns(C.RESOURCE_STATUS.RESOURCE_COMPLETED, {
    discovered: report.discovered, inserted: report.inserted, updated: report.updated,
    paginationComplete: report.paginationComplete, succeededAt: now,
  });
  try {
    await db.store_sync_domain_states.upsert({
      where: { store_id_domain: { store_id: storeId, domain } },
      update: {
        status: 'ok',
        ...cc,
        records_discovered: numOr(report.discovered),
        records_inserted: numOr(report.inserted),
        records_updated: numOr(report.updated),
        records_deleted: numOr(report.deleted),
        pages_completed: intOrNull(report.pagesCompleted),
        pagination_complete: Boolean(report.paginationComplete),
        error_code: null,
        error_details: null,
        retry_count: 0,
        error_since: null,
        last_succeeded_at: now,
        last_checked_at: now,
        updated_at: now,
      },
      create: {
        store_id: storeId,
        domain,
        status: 'ok',
        ...cc,
        records_discovered: numOr(report.discovered),
        records_inserted: numOr(report.inserted),
        records_updated: numOr(report.updated),
        records_deleted: numOr(report.deleted),
        pages_completed: intOrNull(report.pagesCompleted),
        pagination_complete: Boolean(report.paginationComplete),
        last_succeeded_at: now,
        last_attempted_at: now,
        last_checked_at: now,
      },
    });
    return true;
  } catch (error) {
    loggerWarn(storeId, domain, error, 'record_success');
    return false;
  }
}

async function recordDegraded(storeId, domain, errorOrCode, report = {}, db = defaultDb()) {
  assertDomain(domain);
  const now = new Date();
  const code = typeof errorOrCode === 'string'
    ? errorOrCode.slice(0, 120)
    : (errorOrCode?.code || errorOrCode?.name || 'degraded').slice(0, 120);
  const message = typeof errorOrCode === 'string' ? null : safeMessage(errorOrCode);
  try {
    const existing = await db.store_sync_domain_states.findUnique({
      where: { store_id_domain: { store_id: storeId, domain } },
      select: { error_since: true, last_succeeded_at: true, retry_count: true },
    });
    const cc = contractColumns(C.RESOURCE_STATUS.RESOURCE_PARTIAL, {
      code, details: message,
      discovered: report.discovered, inserted: report.inserted, updated: report.updated,
      paginationComplete: report.paginationComplete,
      succeededAt: existing?.last_succeeded_at,
      retryCount: (Number(existing?.retry_count) || 0) + 1,
    });
    await db.store_sync_domain_states.upsert({
      where: { store_id_domain: { store_id: storeId, domain } },
      update: {
        status: 'degraded',
        ...cc,
        error_code: code,
        error_details: message,
        error_since: existing?.error_since || now,
        retry_count: { increment: 1 },
        last_checked_at: now,
        updated_at: now,
        pages_completed: intOrNull(report.pagesCompleted),
        pagination_complete: false,
        records_discovered: numOr(report.discovered),
        records_inserted: numOr(report.inserted),
        records_updated: numOr(report.updated),
        records_deleted: numOr(report.deleted),
      },
      create: {
        store_id: storeId,
        domain,
        status: 'degraded',
        ...cc,
        error_code: code,
        error_details: message,
        error_since: now,
        retry_count: 1,
        last_attempted_at: now,
        last_checked_at: now,
        pages_completed: intOrNull(report.pagesCompleted),
      },
    });
    return true;
  } catch (error) {
    loggerWarn(storeId, domain, error, 'record_degraded');
    return false;
  }
}

async function recordFailure(storeId, domain, error, report = {}, db = defaultDb()) {
  assertDomain(domain);
  const now = new Date();
  const code = String(error?.code || error?.name || 'sync_error').slice(0, 120);
  try {
    const existing = await db.store_sync_domain_states.findUnique({
      where: { store_id_domain: { store_id: storeId, domain } },
      select: { error_since: true, last_succeeded_at: true, retry_count: true },
    });
    const cc = contractColumns(C.RESOURCE_STATUS.FAILED, {
      code, details: safeMessage(error),
      discovered: report.discovered ?? error?.discovered ?? error?.products_upserted,
      inserted: report.inserted, updated: report.updated,
      paginationComplete: report.pagesCompleted ?? error?.pages_completed,
      succeededAt: existing?.last_succeeded_at,
      retryCount: (Number(existing?.retry_count) || 0) + 1,
    });
    await db.store_sync_domain_states.upsert({
      where: { store_id_domain: { store_id: storeId, domain } },
      update: {
        status: 'failed',
        ...cc,
        error_code: code,
        error_details: safeMessage(error),
        error_since: existing?.error_since || now,
        retry_count: { increment: 1 },
        last_checked_at: now,
        updated_at: now,
        pages_completed: intOrNull(report.pagesCompleted ?? error?.pages_completed),
        pagination_complete: false,
        records_discovered: numOr(report.discovered ?? error?.discovered ?? error?.products_upserted),
        records_inserted: numOr(report.inserted),
        records_updated: numOr(report.updated),
        records_deleted: numOr(report.deleted),
      },
      create: {
        store_id: storeId,
        domain,
        status: 'failed',
        ...cc,
        error_code: code,
        error_details: safeMessage(error),
        error_since: now,
        retry_count: 1,
        last_attempted_at: now,
        last_checked_at: now,
        pages_completed: intOrNull(report.pagesCompleted ?? error?.pages_completed),
        records_discovered: numOr(report.discovered ?? error?.discovered ?? error?.products_upserted),
        records_inserted: numOr(report.inserted),
        records_updated: numOr(report.updated),
        records_deleted: numOr(report.deleted),
      },
    });
    return true;
  } catch (error_) {
    loggerWarn(storeId, domain, error_, 'record_failure');
    return false;
  }
}

// A domain that cannot be read for a known, non-transient reason: the
// installation lacks a scope the merchant can grant (auth), or Shopify does
// not expose the resource to this app / plan (unsupported). This is an
// outcome, not a failure: it is never retried on a timer, it does not count
// against completion, and it is re-evaluated on every pass against live
// scopes, so an approved reauthorization resumes it automatically.
const BLOCK_KINDS = Object.freeze({
  missing_scope: { code: 'REQUIRED_SCOPE_NOT_GRANTED', failureClass: C.FAILURE_CLASS.AUTH, capability: C.CAPABILITY.MISSING_SCOPE },
  plan_restricted: { code: 'RESOURCE_PLAN_RESTRICTED_NOT_SUPPORTED', failureClass: C.FAILURE_CLASS.UNSUPPORTED, capability: C.CAPABILITY.UNKNOWN },
  unsupported: { code: 'RESOURCE_NOT_SUPPORTED', failureClass: C.FAILURE_CLASS.UNSUPPORTED, capability: C.CAPABILITY.UNKNOWN },
});

async function recordBlocked(storeId, domain, { kind, missingScopes = [], reason = null } = {}, db = defaultDb()) {
  assertDomain(domain);
  const spec = BLOCK_KINDS[kind];
  if (!spec) throw new Error(`Unknown block kind: ${kind}`);
  const now = new Date();
  const scopes = (Array.isArray(missingScopes) ? missingScopes : []).map(String).slice(0, 12);
  const details = (kind === 'missing_scope'
    ? `Missing Shopify access scope(s): ${scopes.join(', ') || 'unknown'}`
    : (reason || 'Not exposed by Shopify for this app or plan')).slice(0, 500);
  try {
    const existing = await db.store_sync_domain_states.findUnique({
      where: { store_id_domain: { store_id: storeId, domain } },
      select: { status: true, error_code: true, error_since: true, last_succeeded_at: true },
    });
    const unchanged = existing?.status === 'blocked_by_auth_or_unsupported' && existing?.error_code === spec.code;
    const cc = contractColumns(C.RESOURCE_STATUS.BLOCKED_BY_AUTH_OR_UNSUPPORTED, {
      code: spec.code, details, succeededAt: existing?.last_succeeded_at,
      capabilityState: spec.capability, failureClass: spec.failureClass, retryCount: 0,
    });
    const data = {
      status: 'blocked_by_auth_or_unsupported',
      ...cc,
      retry_eligible: false,
      error_code: spec.code,
      error_details: details,
      // A block that persists keeps its original start so operators can see
      // how long a capability has been unavailable.
      error_since: unchanged ? (existing.error_since || now) : now,
      retry_count: 0,
      pagination_complete: false,
      last_checked_at: now,
      updated_at: now,
    };
    await db.store_sync_domain_states.upsert({
      where: { store_id_domain: { store_id: storeId, domain } },
      update: data,
      create: { store_id: storeId, domain, ...data, last_attempted_at: now },
    });
    return true;
  } catch (error) {
    loggerWarn(storeId, domain, error, 'record_blocked');
    return false;
  }
}

// Ledger rows for domains this build no longer syncs (e.g. a resource whose
// Shopify API was removed) are never re-attempted, so their last failure would
// otherwise be reported forever as if it were current. Re-label them with the
// registry's honest verdict. Rows for known domains are never touched.
async function retireUnsyncedDomains(storeId, db = defaultDb()) {
  const { capabilityForDomain } = require('./permissionRegistry');
  try {
    const rows = await db.store_sync_domain_states.findMany({
      where: { store_id: storeId, domain: { notIn: [...DOMAINS] }, NOT: { status: 'blocked_by_auth_or_unsupported' } },
      select: { domain: true, last_succeeded_at: true },
    });
    let retired = 0;
    for (const row of rows) {
      const capability = capabilityForDomain(row.domain);
      const details = (capability?.unavailableReason || 'This resource is no longer synchronized by Revluma.').slice(0, 500);
      const now = new Date();
      const cc = contractColumns(C.RESOURCE_STATUS.BLOCKED_BY_AUTH_OR_UNSUPPORTED, {
        code: 'RESOURCE_NOT_SUPPORTED', details, succeededAt: row.last_succeeded_at,
        failureClass: C.FAILURE_CLASS.UNSUPPORTED, capabilityState: C.CAPABILITY.UNKNOWN, retryCount: 0,
      });
      const result = await db.store_sync_domain_states.updateMany({
        where: { store_id: storeId, domain: row.domain, NOT: { status: 'blocked_by_auth_or_unsupported' } },
        data: {
          status: 'blocked_by_auth_or_unsupported', ...cc, retry_eligible: false,
          error_code: 'RESOURCE_NOT_SUPPORTED', error_details: details, retry_count: 0,
          pagination_complete: false, last_checked_at: now, updated_at: now,
        },
      });
      retired += result.count;
    }
    return retired;
  } catch (error) {
    loggerWarn(storeId, '*', error, 'retire_unsynced_domains');
    return 0;
  }
}

async function snapshot(storeId, db = defaultDb(), { strict = false } = {}) {
  try {
    const rows = await db.store_sync_domain_states.findMany({
      where: { store_id: storeId },
      orderBy: { domain: 'asc' },
    });
  const now = new Date();
    return rows.map(row => {
      // Authoritative re-derivation via the contract: the persisted denormalized
      // columns are a cache for direct inspection; consumers always see values
      // computed from the live row so a stale/legacy row cannot render wrong.
      const failure_class = (row.status === 'ok' || row.status === 'never_run' || row.status === 'running')
        ? (row.failure_class && row.failure_class !== 'unknown' ? row.failure_class : C.FAILURE_CLASS.NONE)
        : C.classifyFailure(row.error_code, row.error_details);
      const enriched = { ...row, failure_class };
      return {
        ...row,
        canonical_status: C.toCanonicalStatus(row.status, { scope: 'resource' }),
        coverage_state: C.deriveCoverageState(enriched),
        failure_class,
        retry_eligible: C.retryEligible(enriched),
        freshness: C.deriveFreshness(enriched, { now }),
        freshness_seconds: row.last_succeeded_at
          ? Math.max(0, Math.floor((now - new Date(row.last_succeeded_at).getTime()) / 1000))
          : null,
        schema_version: C.CONTRACT_VERSION,
      };
    });
  } catch (error) {
    loggerWarn(storeId, '*', error, 'snapshot');
    // strict: the caller (e.g. the reaper) wants to know the ledger could not be
    // read rather than receive an empty ledger that makes the store look
    // "preserved terminal" and be silently skipped. Surface the error so a
    // persistent read failure is logged per-store and never masked as a no-op.
    if (strict) throw error;
    return [];
  }
}

async function mergeCheckpoint(storeId, domain, patch, db = defaultDb()) {
  assertDomain(domain);
  const now = new Date();
  try {
    const existing = await db.store_sync_domain_states.findUnique({
      where: { store_id_domain: { store_id: storeId, domain } },
      select: { checkpoint: true },
    });
    const checkpoint = { ...(existing?.checkpoint || {}), ...patch };
    await db.store_sync_domain_states.upsert({
      where: { store_id_domain: { store_id: storeId, domain } },
      update: { checkpoint, updated_at: now, last_attempted_at: now },
      create: {
        store_id: storeId,
        domain,
        status: 'running',
        checkpoint,
        last_attempted_at: now,
        last_checked_at: now,
      },
    });
    return true;
  } catch (error) {
    loggerWarn(storeId, domain, error, 'merge_checkpoint');
    return false;
  }
}

function domainForSetupStage(stage) {
  switch (stage) {
    case 'product_sync': return 'products';
    case 'customer_sync': return 'customers';
    case 'order_sync': return 'orders';
    case 'abandoned_checkout_sync': return 'abandoned_checkouts';
    case 'webhook_reconciliation': return 'webhooks';
    default: return null;
  }
}

function numOr(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function intOrNull(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

function loggerWarn(storeId, domain, error, action) {
  try {
    require('../utils/logger').warn('sync_domain_state_unavailable', {
      store_id: storeId, domain, action,
      error_type: error?.code || error?.name || 'sync_domain_state_error',
    });
  } catch { /* telemetry must never throw */ }
}

module.exports = {
  DOMAINS,
  beginAttempt,
  recordSuccess,
  recordDegraded,
  recordFailure,
  recordStaleFailure,
  recordBlocked,
  retireUnsyncedDomains,
  snapshot,
  mergeCheckpoint,
  domainForSetupStage,
  contractColumns,
  BLOCK_KINDS,
};
