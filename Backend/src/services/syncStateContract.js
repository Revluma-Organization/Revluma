'use strict';

// ============================================================================
// syncStateContract.js
//
// THE single, typed, versioned source of truth for the initial-synchronization
// lifecycle. Every other module (the persisted per-resource ledger, the store
// aggregate, the progress projection, the recovery/retry drivers, the command
// center, Rev evidence) derives its sync state from this file. No other module
// may invent a sync status string.
//
// Why this exists
// ---------------
// The persisted per-resource ledger (`store_sync_domain_states.status`) had
// drifted into a free-form vocabulary (`ok` / `degraded` / `never_run` /
// `running` / `failed`) with no versioning, no coverage certification, and no
// per-resource failure classification. That hid resource-level outcomes behind
// a single store-level boolean and made the "first useful finding" pipeline
// unverifiable. This contract fixes that with:
//   1. A CLOSED, TYPED lifecycle enum (Task 229 §2) split by scope
//      (resource-level vs. store/sync-level).
//   2. A versioned, per-resource COVERAGE certification (Task 229 §4).
//   3. A per-resource FAILURE CLASSIFICATION + safe-retry eligibility.
//   4. A per-resource CAPABILITY (auth/scope) state.
//   5. Freshness derivation (never invented).
//   6. A deterministic store-level terminal-state derivation, including
//      `initial_completed_with_limitations`, so a store can never be stuck in
//      "running" while resources have terminally failed.
//   7. A `toCanonical` compatibility shim so legacy persisted values keep
//      working during transition and no reader can crash on an unknown value.
//
// This module is PURE: no I/O, no Prisma, no clock unless passed. It is
// therefore exhaustively unit-testable and safe to import anywhere.
// ============================================================================

// ---------------------------------------------------------------------------
// Contract version. Bump on any change to the enums, mappings, or derivation
// rules that would make an older persisted row interpret differently.
// ---------------------------------------------------------------------------
const CONTRACT_VERSION = '2';

// ---------------------------------------------------------------------------
// Resource-level lifecycle states (stored in store_sync_domain_states.status).
// A resource moves: never_run -> queued/starting -> running ->
//   resource_completed | resource_partial | failed | retrying |
//   blocked_by_auth_or_unsupported.
// ---------------------------------------------------------------------------
const RESOURCE_STATUS = Object.freeze({
  NEVER_RUN: 'never_run',
  QUEUED: 'queued',
  STARTING: 'starting',
  RUNNING: 'running',
  RETRYING: 'retrying',
  RESOURCE_COMPLETED: 'resource_completed',
  RESOURCE_PARTIAL: 'resource_partial',
  FAILED: 'failed',
  BLOCKED_BY_AUTH_OR_UNSUPPORTED: 'blocked_by_auth_or_unsupported',
});

// ---------------------------------------------------------------------------
// Store / sync-level lifecycle states (stored in stores.initial_sync_status).
// A store moves: not_started -> authorization_completed -> queued -> starting
//   -> running -> initial_completed | initial_completed_with_limitations |
//   failed | blocked_by_auth_or_unsupported.
// ---------------------------------------------------------------------------
const SYNC_STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  AUTHORIZATION_COMPLETED: 'authorization_completed',
  QUEUED: 'queued',
  STARTING: 'starting',
  RUNNING: 'running',
  INITIAL_COMPLETED: 'initial_completed',
  INITIAL_COMPLETED_WITH_LIMITATIONS: 'initial_completed_with_limitations',
  FAILED: 'failed',
  BLOCKED_BY_AUTH_OR_UNSUPPORTED: 'blocked_by_auth_or_unsupported',
});

// The closed union. Any sync status string must be in this set to be valid.
const STATUS_VALUES = Object.freeze(
  [...new Set([...Object.values(RESOURCE_STATUS), ...Object.values(SYNC_STATUS)])],
);

// Resource-level terminal states (a resource that has reached one of these is
// done changing on its own; it only moves further on an explicit retry).
const RESOURCE_TERMINAL = Object.freeze([
  RESOURCE_STATUS.RESOURCE_COMPLETED,
  RESOURCE_STATUS.RESOURCE_PARTIAL,
  RESOURCE_STATUS.FAILED,
  RESOURCE_STATUS.BLOCKED_BY_AUTH_OR_UNSUPPORTED,
]);

// Store-level terminal states.
const SYNC_TERMINAL = Object.freeze([
  SYNC_STATUS.INITIAL_COMPLETED,
  SYNC_STATUS.INITIAL_COMPLETED_WITH_LIMITATIONS,
  SYNC_STATUS.FAILED,
  SYNC_STATUS.BLOCKED_BY_AUTH_OR_UNSUPPORTED,
]);

// ---------------------------------------------------------------------------
// COVERAGE certification (Task 229 §4). Per-resource, versioned, closed set.
// "empty response" must never be certified as "complete": a zero-count,
// pagination-complete, error-free result is `verified_zero`, not `complete`.
// ---------------------------------------------------------------------------
const COVERAGE = Object.freeze({
  COMPLETE: 'complete',
  PARTIAL: 'partial',
  INSUFFICIENT_HISTORY: 'insufficient_history',
  UNSUPPORTED: 'unsupported',
  UNAUTHORIZED: 'unauthorized',
  RETRIEVAL_FAILURE: 'retrieval_failure',
  PERSISTENCE_FAILURE: 'persistence_failure',
  UNKNOWN: 'unknown',
  VERIFIED_ZERO: 'verified_zero',
});
const COVERAGE_VALUES = Object.freeze(Object.values(COVERAGE));

// ---------------------------------------------------------------------------
// FAILURE CLASSIFICATION. Distinguishes transient vs. permanent, and whether a
// retry is safe. Drives retry eligibility and coverage certification.
// ---------------------------------------------------------------------------
const FAILURE_CLASS = Object.freeze({
  NONE: 'none',
  TRANSIENT: 'transient',
  RATE_LIMITED: 'rate_limited',
  AUTH: 'auth',
  UNSUPPORTED: 'unsupported',
  PERSISTENCE: 'persistence',
  UNKNOWN: 'unknown',
});
const FAILURE_CLASS_VALUES = Object.freeze(Object.values(FAILURE_CLASS));

// ---------------------------------------------------------------------------
// CAPABILITY (auth/scope) state for a resource.
// ---------------------------------------------------------------------------
const CAPABILITY = Object.freeze({
  UNKNOWN: 'unknown',
  AUTHORIZED: 'authorized',
  MISSING_SCOPE: 'missing_scope',
  REVOKED: 'revoked',
});
const CAPABILITY_VALUES = Object.freeze(Object.values(CAPABILITY));

// ---------------------------------------------------------------------------
// Freshness states (never invented; derived from real timestamps).
// ---------------------------------------------------------------------------
const FRESHNESS = Object.freeze({
  NEVER: 'never',          // no successful retrieval has ever happened
  FRESH: 'fresh',          // succeeded within the given window
  STALE: 'stale',          // succeeded, but older than the window
});
const FRESHNESS_VALUES = Object.freeze(Object.values(FRESHNESS));

// ===========================================================================
// Validation
// ===========================================================================

function isValidStatus(value) {
  return typeof value === 'string' && STATUS_VALUES.includes(value);
}

function isResourceStatus(value) {
  return typeof value === 'string' && Object.values(RESOURCE_STATUS).includes(value);
}

function isSyncStatus(value) {
  return typeof value === 'string' && Object.values(SYNC_STATUS).includes(value);
}

/**
 * Strict validator. Returns { ok, status?, issue? }. Never throws — callers
 * decide how to handle an invalid value (defaulting to unknown/never_run).
 */
function assertStatus(value, { scope = 'any' } = {}) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, issue: 'empty' };
  }
  if (scope === 'resource' && !isResourceStatus(value)) {
    return { ok: false, issue: `not_a_resource_status:${value}` };
  }
  if (scope === 'sync' && !isSyncStatus(value)) {
    return { ok: false, issue: `not_a_sync_status:${value}` };
  }
  if (scope === 'any' && !isValidStatus(value)) {
    return { ok: false, issue: `unknown_status:${value}` };
  }
  return { ok: true, status: value };
}

// ===========================================================================
// Compatibility shim: legacy persisted value -> canonical value.
//
// Legacy ledger values were free-form: `ok`, `degraded`, `never_run`,
// `running`, `failed`. Legacy store values were: `not_started`, `queued`,
// `running`, `completed`, `partial`, `failed`. This maps them onto the
// canonical set so both fresh canonical rows and pre-migration legacy rows
// behave identically. Canonical values pass through unchanged.
// ===========================================================================

// Resource-level legacy -> canonical.
const RESOURCE_LEGACY_MAP = Object.freeze({
  ok: RESOURCE_STATUS.RESOURCE_COMPLETED,
  degraded: RESOURCE_STATUS.RESOURCE_PARTIAL,
  success: RESOURCE_STATUS.RESOURCE_COMPLETED,
  completed: RESOURCE_STATUS.RESOURCE_COMPLETED,
  partial: RESOURCE_STATUS.RESOURCE_PARTIAL,
  // Identity for anything already canonical / shared.
  never_run: RESOURCE_STATUS.NEVER_RUN,
  queued: RESOURCE_STATUS.QUEUED,
  starting: RESOURCE_STATUS.STARTING,
  running: RESOURCE_STATUS.RUNNING,
  retrying: RESOURCE_STATUS.RETRYING,
  resource_completed: RESOURCE_STATUS.RESOURCE_COMPLETED,
  resource_partial: RESOURCE_STATUS.RESOURCE_PARTIAL,
  failed: RESOURCE_STATUS.FAILED,
  blocked_by_auth_or_unsupported: RESOURCE_STATUS.BLOCKED_BY_AUTH_OR_UNSUPPORTED,
});

// Store-level legacy -> canonical.
const SYNC_LEGACY_MAP = Object.freeze({
  not_started: SYNC_STATUS.NOT_STARTED,
  never_run: SYNC_STATUS.NOT_STARTED,
  authorization_completed: SYNC_STATUS.AUTHORIZATION_COMPLETED,
  queued: SYNC_STATUS.QUEUED,
  starting: SYNC_STATUS.STARTING,
  running: SYNC_STATUS.RUNNING,
  completed: SYNC_STATUS.INITIAL_COMPLETED,
  initial_completed: SYNC_STATUS.INITIAL_COMPLETED,
  partial: SYNC_STATUS.INITIAL_COMPLETED_WITH_LIMITATIONS,
  initial_completed_with_limitations: SYNC_STATUS.INITIAL_COMPLETED_WITH_LIMITATIONS,
  failed: SYNC_STATUS.FAILED,
  blocked_by_auth_or_unsupported: SYNC_STATUS.BLOCKED_BY_AUTH_OR_UNSUPPORTED,
});

function toCanonicalStatus(value, { scope = 'any' } = {}) {
  if (value == null) return scope === 'resource' ? RESOURCE_STATUS.NEVER_RUN : SYNC_STATUS.NOT_STARTED;
  const s = String(value).trim();
  const table = scope === 'sync' ? SYNC_LEGACY_MAP : RESOURCE_LEGACY_MAP;
  if (Object.prototype.hasOwnProperty.call(table, s)) return table[s];
  // Fall back to the union table for `scope:'any'`.
  const union = { ...RESOURCE_LEGACY_MAP, ...SYNC_LEGACY_MAP };
  if (Object.prototype.hasOwnProperty.call(union, s)) return union[s];
  // Unknown: return a safe, well-defined default rather than inventing.
  return scope === 'sync' ? SYNC_STATUS.NOT_STARTED : RESOURCE_STATUS.NEVER_RUN;
}

// ===========================================================================
// Freshness — derived ONLY from real timestamps. Never invented.
// ===========================================================================

function toMs(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Freshness of a resource from its last successful retrieval.
 * `thresholdMs` defines how recent "fresh" must be. Returns FRESHNESS.*.
 */
function deriveFreshness(row, { now, thresholdMs = 24 * 60 * 60 * 1000 } = {}) {
  const succeededAt = toMs(row?.last_succeeded_at);
  if (succeededAt == null) return FRESHNESS.NEVER;
  const nowMs = now == null ? Date.now() : toMs(now);
  if (nowMs == null) return FRESHNESS.STALE; // no clock and no proof of freshness -> be conservative
  const age = nowMs - succeededAt;
  if (age < 0) return FRESHNESS.FRESH; // clock skew: a future timestamp is effectively fresh
  return age <= thresholdMs ? FRESHNESS.FRESH : FRESHNESS.STALE;
}

function freshnessSeconds(row, now) {
  const succeededAt = toMs(row?.last_succeeded_at);
  if (succeededAt == null) return null;
  const nowMs = now == null ? Date.now() : toMs(now);
  if (nowMs == null) return null;
  return Math.max(0, Math.round((nowMs - succeededAt) / 1000));
}

// ===========================================================================
// Failure classification + safe-retry eligibility
// ===========================================================================

// Error-code prefixes/suffixes that indicate a scope/permission problem.
const SCOPE_ERROR_MARKERS = [
  'SCOPE', 'PERMISSION', 'FORBIDDEN', 'UNAUTHORIZED', 'NOT_GRANTED',
  'MISSING_PERMISSION', 'INVALID_TOKEN', 'TOKEN_EXPIRED', 'ACCESS_DENIED',
  'READ_ORDERS_NOT_GRANTED', 'SHOPIFY_READ_',
];
// Error-code markers that indicate the query/resource is not supported by the
// store's API version or plan (permanent — retrying will not help).
const UNSUPPORTED_ERROR_MARKERS = [
  'NOT_SUPPORTED', 'UNSUPPORTED', 'UNKNOWN_FIELD', 'FIELD_DOES_NOT_EXIST',
  'QUERY_NOT_SUPPORTED', 'NOT_IMPLEMENTED', 'API_VERSION',
];
// Transient / retry-safe markers.
const TRANSIENT_ERROR_MARKERS = [
  'TIMEOUT', 'TIMED_OUT', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND',
  'NETWORK', 'SOCKET', 'UNAVAILABLE', '503', '502', '504', 'OVERLOADED',
  'RATE_LIMIT', 'RATELIMIT', '429', 'THROTTLED',
];

function classifyFailure(code, details) {
  const raw = `${code || ''} ${details || ''}`;
  if (!raw.trim()) return FAILURE_CLASS.UNKNOWN;
  // Normalize to uppercase, alnum + underscores so matching is robust to spaces
  // and punctuation ("Timed Out" -> "TIMED_OUT", "PRISMA P1001" -> "PRISMA_P1001").
  const hay = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const has = (...markers) => markers.some(m => hay.includes(m));

  // Rate limits are their own class (retryable, but with a backoff/Retry-After).
  if (has('429', 'RATE_LIMIT', 'RATELIMIT', 'THROTTLED', 'TOO_MANY_REQUESTS')) return FAILURE_CLASS.RATE_LIMITED;
  // Auth/scope markers (merchant action required — not safe to auto-retry).
  if (has('SCOPE', 'PERMISSION', 'FORBIDDEN', 'UNAUTHORIZED', 'UNAUTHENTICATED', 'NOT_GRANTED',
    'MISSING_PERMISSION', 'INVALID_TOKEN', 'TOKEN_EXPIRED', 'ACCESS_DENIED', 'EXPIRED', '401', '403')) {
    return FAILURE_CLASS.AUTH;
  }
  // The query/resource is not supported by the store's API version/plan
  // (permanent — retrying will not help).
  if (has('NOT_SUPPORTED', 'UNSUPPORTED', 'UNKNOWN_FIELD', 'FIELD_DOES_NOT_EXIST',
    'QUERY_NOT_SUPPORTED', 'NOT_IMPLEMENTED', 'API_VERSION')) {
    return FAILURE_CLASS.UNSUPPORTED;
  }
  // Persistence markers (write side failed, not the Shopify read).
  if (has('PERSIST', 'DATABASE', 'PRISMA', 'MIGRATION', 'FOREIGN_KEY', 'CONSTRAINT_VIOLATION', 'DB_ERROR')) {
    return FAILURE_CLASS.PERSISTENCE;
  }
  // Transient markers (safe to retry with backoff, within the cap).
  if (has('TIMEOUT', 'TIMED_OUT', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND',
    'NETWORK_ERROR', 'SOCKET', 'UNAVAILABLE', '503', '502', '504', 'OVERLOADED', 'EAI_AGAIN')) {
    return FAILURE_CLASS.TRANSIENT;
  }
  return FAILURE_CLASS.UNKNOWN;
}

// How many times a resource may be retried before it is parked as a terminal
// failure (bounded retries — Task 229 §3/§9).
const MAX_SAFE_RETRIES = 5;

/**
 * Is a retry safe right now? A retry is safe only when:
 *  - the failure is retryable (transient / rate_limited / unknown, within cap),
 *    OR the resource is explicitly in `retrying`;
 *  - and it has not exceeded MAX_SAFE_RETRIES;
 *  - auth / unsupported / persistence failures are NOT safe to auto-retry
 *    (they need operator/merchant action or a different code path).
 */
function retryEligible(row) {
  const st = toCanonicalStatus(row?.status, { scope: 'resource' });
  const cls = row?.failure_class || classifyFailure(row?.error_code, row?.error_details);
  const retries = Number(row?.retry_count) || 0;

  if (st === RESOURCE_STATUS.RETRYING) return retries < MAX_SAFE_RETRIES;
  if (st === RESOURCE_STATUS.FAILED || st === RESOURCE_STATUS.RESOURCE_PARTIAL) {
    const retryableClass =
      cls === FAILURE_CLASS.TRANSIENT ||
      cls === FAILURE_CLASS.RATE_LIMITED ||
      cls === FAILURE_CLASS.UNKNOWN;
    return retryableClass && retries < MAX_SAFE_RETRIES;
  }
  // Terminal-success / blocked / never-run are not "retry now" states.
  return false;
}

// ===========================================================================
// Per-resource COVERAGE certification.
//
// `row` is a store_sync_domain_states row (canonical or legacy `status`).
// The result is a COVERAGE value. Empty responses are never `complete`.
// ===========================================================================

function toNonNegInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function deriveCoverageState(row, _now) {
  if (!row) return COVERAGE.UNKNOWN;
  const st = toCanonicalStatus(row.status, { scope: 'resource' });
  const discovered = toNonNegInt(row.records_discovered);
  const pagComplete = Boolean(row.pagination_complete);
  const cls = row.failure_class || classifyFailure(row.error_code, row.error_details);
  const cap = row.capability_state || CAPABILITY.UNKNOWN;
  const hasSucceededBefore = toMs(row.last_succeeded_at) != null;

  // (A) Explicit auth/capability blockage is an outcome in itself and takes
  //     precedence over "not yet attempted": a resource blocked for missing
  //     scope or a revoked token cannot be read, regardless of whether a
  //     retrieval timestamp is recorded.
  if (cap === CAPABILITY.MISSING_SCOPE || cap === CAPABILITY.REVOKED) return COVERAGE.UNAUTHORIZED;
  if (st === RESOURCE_STATUS.BLOCKED_BY_AUTH_OR_UNSUPPORTED) {
    if (cls === FAILURE_CLASS.AUTH) return COVERAGE.UNAUTHORIZED;
    // Ambiguous blockage (no scope error) is treated as unsupported — a
    // limitation the merchant cannot fix by retrying, not an auth failure.
    return COVERAGE.UNSUPPORTED;
  }
  // (B) A non-blocked failure that is classified as auth/unsupported maps the
  //     same way (e.g. a `failed` row whose error code is a scope error).
  if (cls === FAILURE_CLASS.AUTH) return COVERAGE.UNAUTHORIZED;
  if (cls === FAILURE_CLASS.UNSUPPORTED) return COVERAGE.UNSUPPORTED;

  // (C) Never attempted -> unknown (nothing to certify yet).
  if (st === RESOURCE_STATUS.NEVER_RUN) return COVERAGE.UNKNOWN;
  if (toMs(row.last_attempted_at) == null && !hasSucceededBefore) return COVERAGE.UNKNOWN;

  // (2) In progress: only certify partial if we already have real data;
  //     otherwise it is genuinely unknown (do not invent progress).
  if (st === RESOURCE_STATUS.RUNNING || st === RESOURCE_STATUS.STARTING ||
      st === RESOURCE_STATUS.QUEUED || st === RESOURCE_STATUS.RETRYING) {
    if (hasSucceededBefore && discovered > 0) return COVERAGE.PARTIAL;
    return COVERAGE.UNKNOWN;
  }

  // (3) Terminal: resource_completed.
  if (st === RESOURCE_STATUS.RESOURCE_COMPLETED) {
    if (discovered === 0 && pagComplete) return COVERAGE.VERIFIED_ZERO;
    if (!pagComplete) return COVERAGE.PARTIAL;
    return COVERAGE.COMPLETE;
  }

  // (4) Terminal: resource_partial (degraded / truncated / partial persist).
  if (st === RESOURCE_STATUS.RESOURCE_PARTIAL) {
    if (discovered === 0 && pagComplete) return COVERAGE.VERIFIED_ZERO;
    return COVERAGE.PARTIAL;
  }

  // (5) Terminal: failed.
  if (st === RESOURCE_STATUS.FAILED) {
    if (cls === FAILURE_CLASS.PERSISTENCE) return COVERAGE.PERSISTENCE_FAILURE;
    if (hasSucceededBefore && discovered > 0) return COVERAGE.PARTIAL;
    return COVERAGE.RETRIEVAL_FAILURE;
  }

  return COVERAGE.UNKNOWN;
}

// ===========================================================================
// Store-level terminal-state derivation (deterministic).
//
// This is the logic that lets a store REACH a terminal state even when some
// required resources have terminally failed (defect D2/D3). It is also the
// basis for the "stuck in running" repair in the recovery driver (P3).
//
// `domains` = array of per-resource rows (each with at least `required`,
// `status`, `pagination_complete`, and failure/record fields).
// `storeSync` = the current stores.initial_sync_status (legacy or canonical).
// ===========================================================================

function isRunningStatus(st) {
  return st === RESOURCE_STATUS.RUNNING || st === RESOURCE_STATUS.STARTING ||
    st === RESOURCE_STATUS.RETRYING;
}

function isResourceComplete(row) {
  const st = toCanonicalStatus(row?.status, { scope: 'resource' });
  if (st === RESOURCE_STATUS.RESOURCE_COMPLETED) return Boolean(row?.pagination_complete);
  // A blocked-by-unsupported resource is "done" for completion purposes: it
  // cannot be fetched and does not count against the merchant. It is a
  // LIMITATION, not a failure that blocks completion.
  if (st === RESOURCE_STATUS.BLOCKED_BY_AUTH_OR_UNSUPPORTED) {
    const cov = deriveCoverageState(row);
    return cov === COVERAGE.UNSUPPORTED; // genuinely unsupported -> limitation (complete-enough)
  }
  return false;
}

function isResourceTerminalFailure(row) {
  const st = toCanonicalStatus(row?.status, { scope: 'resource' });
  if (st === RESOURCE_STATUS.FAILED) return true;
  // A blocked-by-AUTH resource is a terminal failure of that resource
  // (needs merchant action), distinct from unsupported (a limitation).
  if (st === RESOURCE_STATUS.BLOCKED_BY_AUTH_OR_UNSUPPORTED) {
    return deriveCoverageState(row) === COVERAGE.UNAUTHORIZED;
  }
  return false;
}

/**
 * Derive the canonical store-level sync status from the resource ledger.
 * Returns { status, reason, limitations } where `limitations` is an array of
 * human-readable, evidence-backed notes about any non-complete required
 * resource (these feed `initial_completed_with_limitations`).
 *
 * Rules (in priority order):
 *  1. A resource still genuinely in progress (running/starting/retrying) and
 *     NOT stalled  -> running. (Staleness is a separate, caller-supplied fact
 *     via `stalledRunning` — see below. This function never claims stall from
 *     wall-clock alone.)
 *  2. All required resources complete  -> initial_completed (no limitations).
 *  3. All required resources complete OR unsupported-blocked, but some optional
 *     or required resources are partial/auth-blocked ->
 *     initial_completed_with_limitations (with reasons).
 *  4. A REQUIRED resource has terminally failed (retrieval/persistence/auth)
 *     while others completed -> initial_completed_with_limitations (the
 *     merchant still gets value; the limitation is surfaced) — UNLESS ALL
 *     required resources failed, then -> failed.
 *  5. No resource has ever completed and at least one terminally failed ->
 *     failed.
 *  6. Nothing started -> not_started.
 */
function deriveStoreSyncStatus(domains, storeSync, { stalledRunning = false } = {}) {
  const rows = Array.isArray(domains) ? domains : [];
  const cur = toCanonicalStatus(storeSync, { scope: 'sync' });
  const required = rows.filter(d => d && d.required);
  const all = rows;

  const runningRows = rows.filter(d => isRunningStatus(toCanonicalStatus(d.status, { scope: 'resource' })));
  const hasInProgress = runningRows.length > 0;

  const requiredComplete = required.filter(d => isResourceComplete(d));
  const requiredFailed = required.filter(d => isResourceTerminalFailure(d));
  const requiredPartial = required.filter(d => {
    const st = toCanonicalStatus(d.status, { scope: 'resource' });
    return st === RESOURCE_STATUS.RESOURCE_PARTIAL;
  });
  const requiredBlockedUnsupported = required.filter(d =>
    toCanonicalStatus(d.status, { scope: 'resource' }) === RESOURCE_STATUS.BLOCKED_BY_AUTH_OR_UNSUPPORTED &&
    deriveCoverageState(d) === COVERAGE.UNSUPPORTED,
  );

  const noneStarted = all.every(d => toCanonicalStatus(d.status, { scope: 'resource' }) === RESOURCE_STATUS.NEVER_RUN);
  if (noneStarted && rows.length > 0) {
    // Preserve an in-flight authorization/scheduling state if the store says so.
    if ([SYNC_STATUS.QUEUED, SYNC_STATUS.STARTING, SYNC_STATUS.RUNNING, SYNC_STATUS.AUTHORIZATION_COMPLETED].includes(cur)) {
      return { status: cur, reason: 'store_scheduled_resources_not_started', limitations: [] };
    }
    return { status: SYNC_STATUS.NOT_STARTED, reason: 'no_resources_started', limitations: [] };
  }

  // A store that is authorized-but-not-started (no ledger activity) keeps its
  // pre-sync state rather than being forced to not_started.
  if (cur === SYNC_STATUS.AUTHORIZATION_COMPLETED && !hasInProgress && requiredComplete.length === 0 && required.length > 0 &&
      all.every(d => toCanonicalStatus(d.status, { scope: 'resource' }) === RESOURCE_STATUS.NEVER_RUN)) {
    return { status: SYNC_STATUS.AUTHORIZATION_COMPLETED, reason: 'authorized_sync_pending', limitations: [] };
  }

  // (1) In progress. A caller may tell us the in-progress resource is actually
  //     stalled (real heartbeat evidence); we never invent staleness here.
  if (hasInProgress) {
    if (stalledRunning) {
      // Stalled in-progress: treat as needing recovery, but do NOT fabricate a
      // terminal outcome. Report running (the reaper will re-drive it).
      return { status: SYNC_STATUS.RUNNING, reason: 'in_progress_stalled_awaiting_recovery', limitations: buildLimitations(required, all) };
    }
    return { status: SYNC_STATUS.RUNNING, reason: 'resources_in_progress', limitations: buildLimitations(required, all) };
  }

  const allRequiredComplete = required.length > 0 && required.every(d => isResourceComplete(d));

  // (2) Fully complete.
  if (allRequiredComplete && requiredFailed.length === 0 && requiredPartial.length === 0) {
    const optLimitations = buildLimitations(required, all);
    if (optLimitations.length === 0) {
      return { status: SYNC_STATUS.INITIAL_COMPLETED, reason: 'all_required_complete', limitations: [] };
    }
    return { status: SYNC_STATUS.INITIAL_COMPLETED_WITH_LIMITATIONS, reason: 'complete_with_optional_limitations', limitations: optLimitations };
  }

  // (4)/(3) Required failed or partial, but at least one required completed (or
  //        unsupported-blocked) -> the merchant still has value: completed
  //        WITH LIMITATIONS.
  const completedCount = requiredComplete.length + requiredBlockedUnsupported.length;
  if (completedCount > 0 && (requiredFailed.length > 0 || requiredPartial.length > 0 || !allRequiredComplete)) {
    return {
      status: SYNC_STATUS.INITIAL_COMPLETED_WITH_LIMITATIONS,
      reason: 'required_resources_incomplete',
      limitations: buildLimitations(required, all),
    };
  }

  // (5) Nothing completed and something terminally failed -> failed.
  if (requiredFailed.length > 0 && completedCount === 0) {
    return { status: SYNC_STATUS.FAILED, reason: 'required_resources_failed_without_completion', limitations: buildLimitations(required, all) };
  }

  // Fallback: defer to the persisted store state (already canonical) so we
  // never regress a terminal state.
  if (SYNC_TERMINAL.includes(cur)) {
    return { status: cur, reason: 'persisted_terminal_preserved', limitations: buildLimitations(required, all) };
  }
  if (cur === SYNC_STATUS.RUNNING) {
    return { status: SYNC_STATUS.RUNNING, reason: 'persisted_running_no_ledger_progress', limitations: buildLimitations(required, all) };
  }
  return { status: SYNC_STATUS.NOT_STARTED, reason: 'undetermined_default', limitations: [] };
}

// A row is a "limitation" when it is not a clean, fully-paginated completion.
// This is deliberately broader than `isResourceComplete`: an unsupported-blocked
// resource counts as complete ENOUGH not to block completion, but it still
// warrants a surfaced limitation so the merchant knows it.
function isLimitationRow(row) {
  const st = toCanonicalStatus(row?.status, { scope: 'resource' });
  if (st === RESOURCE_STATUS.NEVER_RUN) return false;
  if (isRunningStatus(st)) return true; // pending / (potentially stalled) — surface it
  if (st === RESOURCE_STATUS.RESOURCE_COMPLETED) return !row?.pagination_complete;
  if (st === RESOURCE_STATUS.RESOURCE_PARTIAL || st === RESOURCE_STATUS.FAILED) return true;
  if (st === RESOURCE_STATUS.BLOCKED_BY_AUTH_OR_UNSUPPORTED) return true;
  return false;
}

function buildLimitations(required, all) {
  const out = [];
  const seen = new Set();
  const push = (row, kind) => {
    const st = toCanonicalStatus(row.status, { scope: 'resource' });
    if (!isLimitationRow(row)) return;
    const cov = deriveCoverageState(row);
    const key = `${row.domain}:${st}:${cov}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      domain: row.domain,
      required: Boolean(row.required),
      status: st,
      coverage: cov,
      kind,
      detail: limitationDetail(row, st, cov),
    });
  };
  for (const d of required) push(d, 'required');
  for (const d of all) if (!d.required) push(d, 'optional');
  return out;
}

function limitationDetail(row, st, cov) {
  const discovered = toNonNegInt(row.records_discovered);
  const code = row.error_code || null;
  if (cov === COVERAGE.UNAUTHORIZED) return `requires authentication/scope (${code || 'scope'})`;
  if (cov === COVERAGE.UNSUPPORTED) return `not supported by this store/API (${code || 'unsupported'})`;
  if (cov === COVERAGE.PERSISTENCE_FAILURE) return `persistence failed (${code || 'persistence'})`;
  if (cov === COVERAGE.RETRIEVAL_FAILURE) return `retrieval failed (${code || 'retrieval'})`;
  if (cov === COVERAGE.PARTIAL) return `partial data retrieved (${discovered} records, ${code || 'no code'})`;
  if (cov === COVERAGE.VERIFIED_ZERO) return 'verified zero records for this resource';
  return `status ${st} (coverage ${cov})`;
}

// ===========================================================================
// Per-resource "work" projection (units), reused by the progress renderer.
// Keeps the percent math in one place and never invents a denominator.
// ===========================================================================
function projectResourceWork(row) {
  const st = toCanonicalStatus(row?.status, { scope: 'resource' });
  const discovered = toNonNegInt(row?.records_discovered);
  const persisted = toNonNegInt(row?.records_inserted) + toNonNegInt(row?.records_updated);
  const totalKnown = row?.pagination_complete || st === RESOURCE_STATUS.RESOURCE_COMPLETED;
  return {
    status: st,
    total_units: totalKnown ? discovered : null,
    completed_units: persisted,
    failed_units: (st === RESOURCE_STATUS.FAILED || st === RESOURCE_STATUS.RESOURCE_PARTIAL)
      ? Math.max(0, discovered - persisted) : 0,
    total_known: Boolean(totalKnown),
  };
}

// ===========================================================================
module.exports = {
  CONTRACT_VERSION,
  RESOURCE_STATUS,
  SYNC_STATUS,
  STATUS_VALUES,
  RESOURCE_TERMINAL,
  SYNC_TERMINAL,
  COVERAGE,
  COVERAGE_VALUES,
  FAILURE_CLASS,
  FAILURE_CLASS_VALUES,
  CAPABILITY,
  CAPABILITY_VALUES,
  FRESHNESS,
  FRESHNESS_VALUES,
  MAX_SAFE_RETRIES,
  isValidStatus,
  isResourceStatus,
  isSyncStatus,
  assertStatus,
  toCanonicalStatus,
  deriveFreshness,
  freshnessSeconds,
  classifyFailure,
  retryEligible,
  deriveCoverageState,
  deriveStoreSyncStatus,
  projectResourceWork,
  isResourceComplete,
  isResourceTerminalFailure,
  isLimitationRow,
};
