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
function contractColumns(canonical, { code, details, discovered, inserted, updated, paginationComplete, succeededAt, retryCount } = {}) {
  const terminalFailure = canonical === C.RESOURCE_STATUS.FAILED || canonical === C.RESOURCE_STATUS.RESOURCE_PARTIAL;
  const failure_class = terminalFailure ? C.classifyFailure(code, details) : C.FAILURE_CLASS.NONE;
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
    capability_state: 'unknown',
    retry_count: retryCount == null ? 0 : retryCount,
  };
  return {
    canonical_status: canonical,
    coverage_state: C.deriveCoverageState(pseudoRow),
    failure_class,
    capability_state: 'unknown',
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

async function snapshot(storeId, db = defaultDb()) {
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
  snapshot,
  mergeCheckpoint,
  domainForSetupStage,
};
