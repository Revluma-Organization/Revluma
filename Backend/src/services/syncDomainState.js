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

const DOMAINS = Object.freeze([
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
]);

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

async function beginAttempt(storeId, domain, db = defaultDb()) {
  assertDomain(domain);
  const now = new Date();
  try {
    await db.store_sync_domain_states.upsert({
      where: { store_id_domain: { store_id: storeId, domain } },
      update: {
        status: 'running',
        last_attempted_at: now,
        updated_at: now,
      },
      create: {
        store_id: storeId,
        domain,
        status: 'running',
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
  try {
    await db.store_sync_domain_states.upsert({
      where: { store_id_domain: { store_id: storeId, domain } },
      update: {
        status: 'ok',
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
      select: { error_since: true },
    });
    await db.store_sync_domain_states.upsert({
      where: { store_id_domain: { store_id: storeId, domain } },
      update: {
        status: 'degraded',
        error_code: code,
        error_details: message,
        error_since: existing?.error_since || now,
        retry_count: { increment: 1 },
        last_checked_at: now,
        updated_at: now,
        pages_completed: intOrNull(report.pagesCompleted),
      },
      create: {
        store_id: storeId,
        domain,
        status: 'degraded',
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
      select: { error_since: true },
    });
    await db.store_sync_domain_states.upsert({
      where: { store_id_domain: { store_id: storeId, domain } },
      update: {
        status: 'failed',
        error_code: code,
        error_details: safeMessage(error),
        error_since: existing?.error_since || now,
        retry_count: { increment: 1 },
        last_checked_at: now,
        updated_at: now,
        pages_completed: intOrNull(report.pagesCompleted ?? error?.pages_completed),
        records_discovered: numOr(report.discovered ?? error?.products_upserted),
      },
      create: {
        store_id: storeId,
        domain,
        status: 'failed',
        error_code: code,
        error_details: safeMessage(error),
        error_since: now,
        retry_count: 1,
        last_attempted_at: now,
        last_checked_at: now,
        pages_completed: intOrNull(report.pagesCompleted ?? error?.pages_completed),
        records_discovered: numOr(report.discovered ?? error?.products_upserted),
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
    const now = Date.now();
    return rows.map(row => ({
      ...row,
      freshness_seconds: row.last_succeeded_at
        ? Math.max(0, Math.floor((now - new Date(row.last_succeeded_at).getTime()) / 1000))
        : null,
    }));
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
