'use strict';

// Task 215 — authoritative sync-progress + retry-eligibility contract.
//
// This is a NEW versioned contract (`rev-sync-progress-v1`) built from the
// persisted execution ledger (stores + store_sync_domain_states) — it never
// fabricates progress. It is the single source of truth the frontend consumes;
// the browser must not increment, assume, or estimate state locally.
//
// Truthfulness rules (the whole point of this task):
//  - A numeric percentage is emitted ONLY when a stable, same-unit denominator
//    is known for every required resource (pagination complete / succeeded),
//    the ratio is <= 100, and the job is not premature. Otherwise percent is
//    null and the UI shows an HONEST indeterminate bar with the real stage.
//  - 100% is emitted ONLY after every required unit is done, paginated,
//    persisted, and the authoritative job is completed.
//  - A "stalled" verdict requires a REAL worker heartbeat that is older than a
//    fixed threshold. With no heartbeat we never claim stalling — we report a
//    null heartbeat and let the caller show "running, no recent progress".
//  - Failure retry-eligibility is deterministic by classification: transient
//    provider/throttle/backend and worker interruption are eligible with
//    bounded exponential backoff; authorization, permission, unsupported and
//    malformed are NOT auto-retryable (merchant action / reconnect).
//
// This module is pure (no DB, no network) so it is fully unit-testable and is
// pinned by `__tests__/task215SyncProgress.test.js`. The API boundary
// (`storeController.getSyncProgress`) fail-closes on any contract violation.

const { diagnosticFor, classifyShopifyError } = require('./integrationLifecycle');

const PROGRESS_CONTRACT_VERSION = 'rev-sync-progress-v1';

// Required initial resources (mirrors integrationDiagnostics REQUIRED_INITIAL_
// RESOURCES). Optional gaps remain visible but never block completion.
const REQUIRED_DOMAINS = Object.freeze(['products', 'orders', 'abandoned_checkouts']);
const OPTIONAL_DOMAINS = Object.freeze(['customers', 'variants', 'inventory', 'locations', 'fulfillments', 'refunds']);
const ALL_DOMAINS = Object.freeze([...REQUIRED_DOMAINS, ...OPTIONAL_DOMAINS]);

// A running job with no real progress for this long is "stalled". This is a
// genuine worker-heartbeat threshold (not a UI timer). 2h matches the canonical
// state's running-stall window (REV-DEC-0021).
const STALL_THRESHOLD_SECONDS = 7200;

// Bounded exponential backoff for auto-retry eligibility: base 60s, doubling,
// capped at 1h, for at most MAX_AUTO_ATTEMPTS automatic attempts. After that a
// manual retry (or reconnect) is required — no unbounded retry storm.
const BACKOFF_BASE_SECONDS = 60;
const BACKOFF_CAP_SECONDS = 3600;
const MAX_AUTO_ATTEMPTS = 5;

const JOB_STATUSES = Object.freeze([
  'idle', 'queued', 'running', 'stalled', 'completed', 'partial', 'failed', 'unavailable',
]);

// Failure categories. `auto_retry` true => transient (bounded backoff); false =>
// permanent (merchant action / reconnect), never auto-retried.
const FAILURE_CATEGORIES = Object.freeze({
  transient_provider: { auto_retry: true, merchant_action_required: false, next_step: 'wait_and_retry' },
  transient_throttle: { auto_retry: true, merchant_action_required: false, next_step: 'wait_and_retry' },
  transient_backend: { auto_retry: true, merchant_action_required: false, next_step: 'wait_and_retry' },
  worker_interrupted: { auto_retry: true, merchant_action_required: false, next_step: 'retry' },
  authorization: { auto_retry: false, merchant_action_required: true, next_step: 'reconnect' },
  permission: { auto_retry: false, merchant_action_required: true, next_step: 'reconnect' },
  unsupported: { auto_retry: false, merchant_action_required: false, next_step: 'none' },
  unknown: { auto_retry: true, merchant_action_required: false, next_step: 'retry' },
});

function isRequiredDomain(domain) { return REQUIRED_DOMAINS.includes(domain); }

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function ts(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const t = date.getTime();
  return Number.isFinite(t) ? t : null;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

  // Map a raw failure (error code / reason code) to a deterministic category.
// Reuses the existing classifyShopifyError so the classification stays
// consistent with the rest of the integration lifecycle.
function failureCategory(errorCode, reasonCode) {
  const code = String(errorCode || '');
  const reason = String(reasonCode || '');
  // A domain that was never run has no failure; the caller handles it.
  if (/^AUTHORIZATION_(REQUIRED|EXPIRED|REVOKED)$/.test(reason)) return 'authorization';
  if (reason === 'PERMISSIONS_MISSING') return 'permission';
  if (reason === 'PROVIDER_THROTTLED') return 'transient_throttle';
  if (reason === 'PROVIDER_UNAVAILABLE') return 'transient_provider';
  if (reason === 'BACKEND_FAILURE') return 'transient_backend';
  if (/UNSUPPORTED|NOT_SUPPORTED/.test(code)) return 'unsupported';
  if (/NOT_GRANTED|ACCESS_DENIED|PERMISSION|SCOPE/.test(code)) return 'permission';
  if (/429|THROTTLED|RATE_LIMIT/.test(code)) return 'transient_throttle';
  // Our own backend errors are P-prefixed (P503, P500, ...). Check this BEFORE
  // the generic classifyShopifyError fallback, because a backend code that also
  // contains "UNAVAILABLE"/"HTTP_ERROR" would otherwise be misread as a Shopify
  // provider outage.
  if (/^P\d/.test(code) || /^P[A-Z]/.test(code)) return 'transient_backend';
  const classified = classifyShopifyError({ code });
  const byClassified = {
    AUTHORIZATION_REQUIRED: 'authorization',
    AUTHORIZATION_EXPIRED: 'authorization',
    AUTHORIZATION_REVOKED: 'authorization',
    PERMISSIONS_MISSING: 'permission',
    PROVIDER_THROTTLED: 'transient_throttle',
    PROVIDER_UNAVAILABLE: 'transient_provider',
    BACKEND_FAILURE: 'transient_backend',
  }[classified];
  if (byClassified) return byClassified;
  return 'unknown';
}

// Bounded exponential backoff: next time a transient failure becomes eligible
// for another automatic attempt. Returns null for permanent failures.
function backoffSeconds(retryCount) {
  const attempt = Math.max(1, Number(retryCount) || 1);
  // Exponential (60s, 120s, 240s, ...) bounded by a hard value cap so it is
  // always finite and never a retry storm.
  const seconds = BACKOFF_BASE_SECONDS * 2 ** (attempt - 1);
  return Math.min(Number.isFinite(seconds) ? seconds : BACKOFF_CAP_SECONDS, BACKOFF_CAP_SECONDS);
}

function autoRetryExhausted(retryCount) {
  return (Number(retryCount) || 0) >= MAX_AUTO_ATTEMPTS;
}

// Per-domain progress + retry-eligibility projection from a ledger row.
function projectDomain(domain, row, nowMs) {
  const required = isRequiredDomain(domain);
  const status = row?.status || 'never_run';
  const discovered = Number(row?.records_discovered) || 0;
  const persisted = (Number(row?.records_inserted) || 0) + (Number(row?.records_updated) || 0);
  const pagesCompleted = Number.isFinite(Number(row?.pages_completed)) ? Number(row.pages_completed) : null;
  const paginationComplete = row?.pagination_complete === true;
  const errorCode = row?.error_code || null;

  // Work units are records. A stable denominator exists only once pagination
  // is complete (or the single-shot domain has succeeded). Until then the
  // total is UNKNOWN — we never invent a denominator to compute a percentage.
  const totalKnown = paginationComplete || status === 'ok';
  const totalUnits = totalKnown ? discovered : null;
  const completedUnits = persisted;
  const failedUnits = ['failed', 'degraded'].includes(status) ? Math.max(0, discovered - persisted) : 0;
  const remainingUnits = totalKnown ? Math.max(0, totalUnits - completedUnits) : null;

  // A succeeded domain is 100% (it is genuinely done). A still-running domain
  // with an unknown total is null (honest indeterminate). A running domain
  // whose pagination already completed computes a real ratio but is capped at
  // 99 — it is not "ok" yet, so a 100% would be premature.
  let percent = null;
  if (status === 'ok') {
    percent = 100;
  } else if (totalKnown && totalUnits > 0) {
    percent = Math.min(99, clampPercent((completedUnits / totalUnits) * 100));
  }

  const category = ['failed', 'degraded'].includes(status) ? failureCategory(errorCode, null) : null;
  const failure = category
    ? domainFailure(domain, {
      category,
      errorCode,
      retryCount: Number(row?.retry_count) || 0,
      lastAttemptedAt: ts(row?.last_attempted_at),
      nowMs,
    })
    : null;

  return {
    domain,
    required,
    status,
    work: {
      total_units: totalUnits,
      completed_units: completedUnits,
      failed_units: failedUnits,
      remaining_units: remainingUnits,
      total_known: totalKnown,
    },
    records: {
      discovered,
      persisted,
      pages_completed: pagesCompleted,
      pagination_complete: paginationComplete,
    },
    checkpoint_available: Boolean(row?.checkpoint && Object.keys(row.checkpoint).length),
    error_code: ['failed', 'degraded'].includes(status) ? errorCode : null,
    percent,
    failure,
  };
}

// The per-failure retry-eligibility block. Deterministic and bounded.
function domainFailure(domain, { category, errorCode, retryCount, lastAttemptedAt, nowMs }) {
  const definition = FAILURE_CATEGORIES[category] || FAILURE_CATEGORIES.unknown;
  const exhausted = autoRetryExhausted(retryCount);
  const retryEligible = definition.auto_retry && !exhausted;
  let nextEligibleAt = null;
  if (definition.auto_retry && lastAttemptedAt != null) {
    nextEligibleAt = new Date(lastAttemptedAt + backoffSeconds(retryCount) * 1000).toISOString();
  }
  // A transient failure that is still inside its backoff window is not yet
  // eligible; once the window has elapsed (or it is permanent-and-merchant) it
  // is actionable. `now`-relative so it is deterministic for a given now.
  const windowElapsed = nextEligibleAt == null || (nowMs != null && new Date(nextEligibleAt).getTime() <= nowMs);
  const diagnostic = diagnosticFor(category === 'unknown' ? 'UNKNOWN' : (
    {
      transient_provider: 'PROVIDER_UNAVAILABLE',
      transient_throttle: 'PROVIDER_THROTTLED',
      transient_backend: 'BACKEND_FAILURE',
      worker_interrupted: 'UNKNOWN',
      authorization: 'AUTHORIZATION_REQUIRED',
      permission: 'PERMISSIONS_MISSING',
      unsupported: 'UNKNOWN',
    }[category] || 'UNKNOWN'), { lastOccurrence: null });
  return {
    category,
    reason_code: diagnostic.reason_code,
    auto_retry_eligible: retryEligible,
    manual_retry_eligible: definition.auto_retry || category === 'worker_interrupted',
    backoff_exhausted: exhausted,
    attempt: retryCount,
    max_auto_attempts: MAX_AUTO_ATTEMPTS,
    next_eligible_at: retryEligible ? nextEligibleAt : null,
    retry_window_elapsed: retryEligible ? windowElapsed : null,
    merchant_action_required: definition.merchant_action_required,
    next_step: definition.next_step,
    error_code: errorCode,
  };
}

// The authoritative store-level job status. Never derived from booleans in the
// browser; always from the persisted ledger + store sync fields.
function jobStatus(store, domains, nowMs) {
  const syncStatus = store?.initial_sync_status || 'not_started';
  const required = domains.filter(d => d.required);
  const anyRunning = domains.some(d => d.status === 'running');
  const requiredOk = required.filter(d => d.status === 'ok');
  const requiredFailed = required.filter(d => ['failed', 'degraded'].includes(d.status));
  const allRequiredComplete = required.length > 0 && required.every(d => d.status === 'ok' && d.records.pagination_complete);
  // A limitation is any domain that terminally failed or is partial (degraded),
  // whether required or optional. When every REQUIRED resource is complete but
  // an optional one terminally failed, the store completed WITH LIMITATIONS —
  // never a bare "completed" (which the UI renders as a clean 100%). This keeps
  // the progress contract consistent with the canonical store status
  // (initial_completed_with_limitations) so we never overstate success (Task 229
  // §1/§5).
  const hasTerminalLimitation = domains.some(d => ['failed', 'degraded'].includes(d.status));

  if (syncStatus === 'running' || anyRunning) {
    // Running: is it stalled? Only via a REAL heartbeat older than threshold.
    const heartbeat = jobHeartbeat(store, domains, nowMs);
    if (heartbeat != null && nowMs != null && (nowMs - heartbeat) > STALL_THRESHOLD_SECONDS * 1000) {
      return { status: 'stalled', reason: 'no_worker_progress_beyond_threshold' };
    }
    return { status: 'running', reason: 'in_progress' };
  }
  if (syncStatus === 'queued') return { status: 'queued', reason: 'accepted_not_started' };
  if (allRequiredComplete && (syncStatus === 'completed' || requiredOk.length === required.length)) {
    // All required units done + persisted, but a domain terminally failed/partial:
    // the honest terminal is "partial" (completed with limitations), not a clean
    // "completed"/100%.
    if (hasTerminalLimitation) {
      return { status: 'partial', reason: 'required_complete_with_limitations' };
    }
    return { status: 'completed', reason: 'all_required_units_done_and_persisted' };
  }
  if (requiredFailed.length > 0 && requiredOk.length > 0) return { status: 'partial', reason: 'some_required_resources_failed' };
  if (requiredFailed.length > 0) return { status: 'failed', reason: 'required_resource_failed' };
  if (syncStatus === 'failed') return { status: 'failed', reason: 'recorded_failure' };
  if (syncStatus === 'completed') return { status: 'completed', reason: 'authoritative_completed' };
  if (domains.some(d => d.status !== 'never_run')) return { status: 'idle', reason: 'ledger_present_not_running' };
  return { status: 'idle', reason: 'not_started' };
}

// The REAL last-progress / worker heartbeat: the most recent persisted
// attempt timestamp across running domains, falling back to the sync start
// time (a genuine sync timestamp) while the job is running. `updated_at` is
// deliberately NOT used — it is written by unrelated store changes and is not a
// worker heartbeat. Returns null when no real heartbeat exists; we never invent
// one, and without one we can never claim "stalled".
function jobHeartbeat(store, domains, nowMs) {
  let latest = null;
  for (const d of domains) {
    if (d.status === 'running') {
      const t = d._lastAttemptedMs;
      if (t != null && (latest == null || t > latest)) latest = t;
    }
  }
  if (latest == null) {
    const startedAt = ts(store?.sync_started_at);
    if (startedAt != null && (store?.initial_sync_status === 'running' || store?.status === 'syncing')) {
      latest = startedAt;
    }
  }
  return latest;
}

// Aggregate the overall progress block. Percent is emitted only when every
// required resource has a stable, same-unit denominator (total_known) so the
// ratio is defensible; otherwise null (honest indeterminate).
function overallProgress(store, domains, job, nowMs) {
  const required = domains.filter(d => d.required);
  const totalsKnown = required.length > 0 && required.every(d => d.work.total_known);
  const totalUnits = totalsKnown ? required.reduce((sum, d) => sum + (d.work.total_units || 0), 0) : null;
  const completedUnits = required.reduce((sum, d) => sum + (d.work.completed_units || 0), 0);
  const failedUnits = required.reduce((sum, d) => sum + (d.work.failed_units || 0), 0);
  const measurable = totalsKnown && totalUnits != null && totalUnits > 0;

  let percent = null;
  if (job.status === 'completed') {
    // 100% only after authoritative completion.
    percent = 100;
  } else if (measurable) {
    percent = clampPercent((completedUnits / totalUnits) * 100);
    if (percent >= 100 && job.status !== 'completed') percent = 99; // never premature 100%
  }

  const stage = activeStage(domains) || primaryStage(store, domains);
  const recordsRetrieved = required.reduce((sum, d) => sum + (d.records.discovered || 0), 0);
  const recordsPersisted = required.reduce((sum, d) => sum + (d.records.persisted || 0), 0);

  return {
    stage,
    work: {
      total_units: totalUnits,
      completed_units: completedUnits,
      failed_units: failedUnits,
      remaining_units: measurable ? Math.max(0, totalUnits - completedUnits) : null,
      total_known: totalsKnown,
    },
    records: { retrieved: recordsRetrieved, persisted: recordsPersisted },
    measurable,
    estimated: false, // we never estimate; percent is real-or-null
    percent,
  };
}

function activeStage(domains) {
  const running = domains.filter(d => d.status === 'running');
  if (running.length === 0) return null;
  // Deterministic ordering: required domains first, in contract order.
  const ordered = [...running].sort((a, b) =>
    (isRequiredDomain(b.domain) ? 1 : 0) - (isRequiredDomain(a.domain) ? 1 : 0) ||
    ALL_DOMAINS.indexOf(a.domain) - ALL_DOMAINS.indexOf(b.domain));
  return `${ordered[0].domain}_sync`;
}

function primaryStage(store, domains) {
  const syncStatus = store?.initial_sync_status || 'not_started';
  const map = {
    not_started: 'not_started',
    queued: 'queued',
    running: activeStage(domains) || 'synchronizing',
    completed: 'completed',
    failed: 'failed',
    partial: 'partial',
  };
  return map[syncStatus] || 'unknown';
}

// Build the full contract from a store record + domain ledger rows.
// `now` (Date) is injectable for deterministic tests; defaults to real now.
function buildSyncProgress({ store, domainRows = [], now = new Date() }) {
  const nowMs = now.getTime();
  const byDomain = new Map(domainRows.map(row => [row.domain, row]));
  const domains = ALL_DOMAINS.map(domain => {
    const row = byDomain.get(domain) || null;
    const projected = projectDomain(domain, row, nowMs);
    // Carry the raw last-attempted timestamp for heartbeat computation only
    // (stripped from the emitted contract).
    projected._lastAttemptedMs = ts(row?.last_attempted_at);
    return projected;
  });

  const job = jobStatus(store, domains, nowMs);
  const heartbeatMs = jobHeartbeat(store, domains, nowMs);
  const overall = overallProgress(store, domains, job, nowMs);

  // Top-level retry summary: the most severe actionable failure among required
  // resources, else none. This is what the "Retry" action operates on.
  const retry = summarizeRetry(store, domains, job, nowMs);

  const strip = domains.map(d => {
    const { _lastAttemptedMs, ...rest } = d;
    return rest;
  });

  return {
    contract_version: PROGRESS_CONTRACT_VERSION,
    store: { id: store?.id || null, shop_domain: store?.shop_domain || null },
    job: {
      id: store?.current_sync_job_id || null,
      status: job.status,
      reason: job.reason,
      started_at: iso(store?.sync_started_at),
      updated_at: iso(store?.updated_at),
      completed_at: iso(store?.sync_completed_at),
      heartbeat_at: iso(heartbeatMs),
      stalled: job.status === 'stalled',
      stall_threshold_seconds: STALL_THRESHOLD_SECONDS,
    },
    overall,
    domains: strip,
    retry,
  };
}

function summarizeRetry(store, domains, job, nowMs) {
  const required = domains.filter(d => d.required && d.failure);
  // Prefer a required failure that is manually retry-eligible and whose window
  // has elapsed; otherwise the first required failure (any); else none.
  const eligible = required.filter(d => d.failure.manual_retry_eligible && (d.failure.retry_window_elapsed === true || d.failure.category === 'worker_interrupted'));
  const chosen = eligible[0] || required[0] || null;
  if (!chosen) {
    const anyRunning = domains.some(d => d.status === 'running');
    const queued = job.status === 'queued';
    if (anyRunning || queued) return { actionable: false, status: job.status, next_step: 'wait', reason_code: null };
    if (job.status === 'completed') return { actionable: false, status: 'completed', next_step: 'none', reason_code: null };
    return { actionable: false, status: job.status, next_step: 'none', reason_code: null };
  }
  const failure = chosen.failure;
  return {
    // `actionable` = the caller/merchant can DO something (manual retry or a
    // required reconnect). `retry_eligible` = the AUTO-retry is currently
    // eligible (transient AND not yet backoff-exhausted); it is false once the
    // auto budget is used up even though a manual retry may still be possible.
    actionable: failure.manual_retry_eligible || failure.merchant_action_required,
    scope: chosen.domain,
    category: failure.category,
    reason_code: failure.reason_code,
    retry_eligible: failure.auto_retry_eligible,
    manual_retry_eligible: failure.manual_retry_eligible,
    merchant_action_required: failure.merchant_action_required,
    next_step: failure.next_step,
    next_eligible_at: failure.next_eligible_at,
    attempt: failure.attempt,
    max_auto_attempts: failure.max_auto_attempts,
    backoff_exhausted: failure.backoff_exhausted,
  };
}

// Validate the contract shape (API boundary fail-closed). Returns a list of
// problems; empty list means the contract is well-formed.
function validateSyncProgress(contract) {
  const problems = [];
  if (!contract || typeof contract !== 'object') return ['contract_missing'];
  if (contract.contract_version !== PROGRESS_CONTRACT_VERSION) problems.push('bad_contract_version');
  if (!JOB_STATUSES.includes(contract?.job?.status)) problems.push('bad_job_status');
  if (!Array.isArray(contract?.domains) || contract.domains.length !== ALL_DOMAINS.length) problems.push('bad_domains_count');
  if (typeof contract?.overall?.measurable !== 'boolean') problems.push('bad_measurable');
  if (contract?.overall?.percent != null) {
    const p = contract.overall.percent;
    if (!Number.isFinite(p) || p < 0 || p > 100) problems.push('percent_out_of_range');
    if (contract.overall.percent === 100 && contract.job.status !== 'completed') problems.push('premature_100_percent');
    if (contract.overall.percent != null && contract.overall.measurable === false) problems.push('percent_without_stable_denominator');
  }
  for (const d of contract.domains || []) {
    if (d.percent != null) {
      const p = d.percent;
      if (!Number.isFinite(p) || p < 0 || p > 100) problems.push(`percent_out_of_range:${d.domain}`);
      if (d.percent === 100 && d.status !== 'ok') problems.push(`premature_100_percent:${d.domain}`);
    }
    if (d.work.total_known === false && d.work.total_units != null) problems.push(`total_units_without_known_total:${d.domain}`);
    // No secrets may ever appear in the contract.
  }
  const blob = JSON.stringify(contract);
  if (/shpat_|access_token|password|secret/i.test(blob)) problems.push('secret_leak');
  return problems;
}

module.exports = {
  PROGRESS_CONTRACT_VERSION,
  REQUIRED_DOMAINS,
  OPTIONAL_DOMAINS,
  ALL_DOMAINS,
  JOB_STATUSES,
  FAILURE_CATEGORIES,
  STALL_THRESHOLD_SECONDS,
  BACKOFF_BASE_SECONDS,
  BACKOFF_CAP_SECONDS,
  MAX_AUTO_ATTEMPTS,
  isRequiredDomain,
  failureCategory,
  backoffSeconds,
  autoRetryExhausted,
  buildSyncProgress,
  validateSyncProgress,
};
