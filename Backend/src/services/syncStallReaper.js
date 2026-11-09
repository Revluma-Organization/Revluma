'use strict';

// ============================================================================
// syncStallReaper.js  (Task 229 §3 — reliable execution / recovery)
//
// Fixes the production "stuck in running" defect: a per-resource row left in
// `running` (a hung GraphQL call, a crashed worker, an un-rewritten state) used
// to wedge its store in `initial_sync_status='running'` / `recovery_status=
// 'recovering'` forever — the read path could *derive* "stalled", but nothing
// ever *acted* on it, and the store's `syncing` status + fresh `updated_at`
// kept it out of the normal sync eligibility, so it self-perpetuated.
//
// This module is the actor. It:
//   1. Reaps a `running`/`starting` domain whose `last_attempted_at` is stale
//      (no worker progress beyond the stall window) into a terminal `failed`
//      state classified as transient, preserving the record counts and
//      checkpoint so it becomes safely retryable (bounded).
//   2. Re-derives the store's canonical sync status from the (now updated)
//      resource ledger via syncStateContract.deriveStoreSyncStatus, and persists
//      it when it reaches a terminal state — so the store leaves "running" and
//      lands on initial_completed / initial_completed_with_limitations / failed.
//   3. Closes the recovery lifecycle (recovering -> completed/required) and
//      clears the stale job id, so the "job already running" guard cannot
//      re-wedge the store.
//
// Safety:
//   - Only stores that are currently IN-FLIGHT (queued/starting/running) are
//     reconciled; already-terminal stores are never regressed.
//   - A `running` domain with a FRESH heartbeat (recent last_attempted_at) is
//     left alone — we never reap a genuinely-working worker.
//   - Tenant isolation: every write is scoped to a single store id.
//   - The store.status is only ever promoted 'syncing' -> 'active', never
//     demoted.
// ============================================================================

const C = require('./syncStateContract');
const { snapshot, recordFailure } = require('./syncDomainState');
const { REQUIRED_INITIAL_RESOURCES } = require('./integrationDiagnostics');

// Matches the canonical running-stall window (REV-DEC-0021).
const DEFAULT_STALE_MS = 2 * 60 * 60 * 1000;

const REQUIRED_SET = new Set(REQUIRED_INITIAL_RESOURCES);

function toMs(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

// --- PURE: which rows are stale-running and should be reaped? ---------------
function staleRunningDomains(rows, { now, staleMs = DEFAULT_STALE_MS } = {}) {
  const nowMs = now == null ? Date.now() : toMs(now);
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  for (const row of list) {
    if (!row) continue;
    const st = C.toCanonicalStatus(row.status, { scope: 'resource' });
    if (st !== C.RESOURCE_STATUS.RUNNING && st !== C.RESOURCE_STATUS.STARTING) continue;
    // A running domain with no recorded attempt time has been "running" since
    // it was written — treat its last_checked_at as the heartbeat, and if that
    // is also missing, it is stale by definition.
    const heartbeat = toMs(row.last_attempted_at) ?? toMs(row.last_checked_at);
    const stale = heartbeat == null || (nowMs - heartbeat) >= staleMs;
    if (stale) out.push(row);
  }
  return out;
}

// Reap one stale-running domain: transition it to a transient, retryable
// terminal failure, preserving discovered/persisted counts + pagination so the
// recovery driver can retry it (bounded) or a future sync can complete it.
async function reapStaleDomain(db, storeId, row, { now } = {}) {
  const error = {
    code: 'SYNC_STALE_TIMEOUT',
    name: 'SYNC_STALE_TIMEOUT',
    message: `Sync domain ${row.domain} made no progress beyond the stall window`,
  };
  const report = {
    discovered: row.records_discovered,
    inserted: row.records_inserted,
    updated: row.records_updated,
    pagesCompleted: row.pages_completed,
    paginationComplete: Boolean(row.pagination_complete),
  };
  return recordFailure(storeId, row.domain, error, report, db);
}

function inFlightWhere() {
  return {
    platform: 'shopify',
    initial_sync_status: { in: [C.SYNC_STATUS.QUEUED, C.SYNC_STATUS.STARTING, C.SYNC_STATUS.RUNNING] },
    status: { in: ['active', 'syncing', 'error'] },
  };
}

async function findInFlightStores(db, { limit = 20 } = {}) {
  return db.stores.findMany({
    where: inFlightWhere(),
    orderBy: { updated_at: 'asc' },
    take: Math.max(1, Math.trunc(limit) || 20),
  });
}

// Reconcile ONE store: reap stale-running domains, then drive to a terminal
// state if the ledger now supports one. Returns an audit-friendly result.
async function reconcileStore(db, store, rows, { now, staleMs = DEFAULT_STALE_MS } = {}) {
  const nowMs = now == null ? Date.now() : toMs(now);
  const result = {
    store_id: store.id,
    previous_status: C.toCanonicalStatus(store.initial_sync_status, { scope: 'sync' }),
    reaped: [],
    derived_status: null,
    changed: false,
  };

  // (1) Reap stale-running domains.
  const toReap = staleRunningDomains(rows, { now: nowMs, staleMs });
  for (const row of toReap) {
    const ok = await reapStaleDomain(db, store.id, row, { now: nowMs });
    if (ok) result.reaped.push(row.domain);
  }

  // (2) Re-read the ledger so the derivation sees the reaped statuses.
  const freshRows = toReap.length ? await snapshot(store.id, db) : rows;
  const withRequired = (freshRows || []).map(r => ({ ...r, required: REQUIRED_SET.has(r.domain) }));
  const derived = C.deriveStoreSyncStatus(withRequired, store.initial_sync_status, { stalledRunning: false });
  result.derived_status = derived.status;

  // (3) Persist a terminal state if (and only if) the ledger now supports one
  //     and it differs from what is stored. Never regress a terminal store.
  const isTerminal = C.SYNC_TERMINAL.includes(derived.status);
  const current = result.previous_status;
  if (isTerminal && derived.status !== current) {
    const hasAuth = (derived.limitations || []).some(l => l.coverage === C.COVERAGE.UNAUTHORIZED);
    const data = {
      initial_sync_status: derived.status,
      sync_completed_at: new Date(nowMs),
      current_sync_job_id: null,
      recovery_status: derived.status === C.SYNC_STATUS.FAILED ? (hasAuth ? 'required' : 'completed') : 'completed',
      sync_error_code: derived.status === C.SYNC_STATUS.FAILED ? 'INITIAL_SYNC_FAILED' : null,
    };
    // Promote a stuck 'syncing' store back to 'active'; never demote.
    if (store.status === 'syncing') data.status = 'active';
    await db.stores.update({ where: { id: store.id }, data });
    result.changed = true;
    result.limitations = derived.limitations || [];
  }
  return result;
}

// Scheduler entry: reconcile a bounded batch of in-flight stores.
async function runReaper(db, { now, staleMs = DEFAULT_STALE_MS, limit = 20 } = {}) {
  const stores = await findInFlightStores(db, { limit });
  const results = [];
  let reapedTotal = 0;
  let terminalized = 0;
  for (const store of stores) {
    try {
      const rows = await snapshot(store.id, db);
      const res = await reconcileStore(db, store, rows, { now, staleMs });
      results.push(res);
      reapedTotal += res.reaped.length;
      if (res.changed) terminalized++;
    } catch (error) {
      results.push({ store_id: store.id, error: error?.code || error?.name || 'reaper_error' });
    }
  }
  return {
    considered: stores.length,
    reaped_domains: reapedTotal,
    terminalized_stores: terminalized,
    results,
  };
}

module.exports = {
  DEFAULT_STALE_MS,
  REQUIRED_SET,
  staleRunningDomains,
  reapStaleDomain,
  inFlightWhere,
  findInFlightStores,
  reconcileStore,
  runReaper,
};
