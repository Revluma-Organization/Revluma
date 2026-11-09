'use strict';

// Task 215 — authoritative sync-progress + retry-eligibility contract.
// Pins the truthfulness rules: honest indeterminate when the total is unknown,
// numeric percent only with a stable same-unit denominator, 100% only after
// authoritative completion, stall only from a REAL old heartbeat, and
// deterministic retry-eligibility by failure classification with bounded
// backoff. The contract is pure and fully covered here.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROGRESS_CONTRACT_VERSION,
  REQUIRED_DOMAINS,
  ALL_DOMAINS,
  MAX_AUTO_ATTEMPTS,
  STALL_THRESHOLD_SECONDS,
  failureCategory,
  backoffSeconds,
  autoRetryExhausted,
  buildSyncProgress,
  validateSyncProgress,
} = require('../integrationProgress');

const NOW = new Date('2026-11-08T12:00:00Z');
const NOW_MS = NOW.getTime();
const iso = (secondsAgo) => new Date(NOW_MS - secondsAgo * 1000).toISOString();

function store(overrides = {}) {
  return {
    id: 'store-1',
    shop_domain: 'test.myshopify.com',
    access_token: 'shpat_should_never_appear',
    status: 'connected',
    initial_sync_status: 'not_started',
    current_sync_job_id: 'job-1',
    sync_started_at: null,
    sync_completed_at: null,
    sync_attempt_count: 0,
    recovery_status: 'not_required',
    updated_at: null,
    ...overrides,
  };
}

function row(domain, overrides = {}) {
  return {
    store_id: 'store-1',
    domain,
    status: 'never_run',
    records_discovered: 0,
    records_inserted: 0,
    records_updated: 0,
    records_deleted: 0,
    pages_completed: null,
    pagination_complete: false,
    error_code: null,
    retry_count: 0,
    last_attempted_at: null,
    last_succeeded_at: null,
    checkpoint: {},
    ...overrides,
  };
}

function build(storeOverrides = {}, rows = []) {
  const contract = buildSyncProgress({ store: store(storeOverrides), domainRows: rows, now: NOW });
  assert.equal(validateSyncProgress(contract).length, 0, `contract invalid: ${validateSyncProgress(contract).join(',')}`);
  return contract;
}

function findDomain(contract, domain) { return contract.domains.find(d => d.domain === domain); }

test('contract version is the pinned versioned id', () => {
  const c = build();
  assert.equal(c.contract_version, PROGRESS_CONTRACT_VERSION);
  assert.equal(PROGRESS_CONTRACT_VERSION, 'rev-sync-progress-v1');
});

test('idle when nothing has run', () => {
  const c = build();
  assert.equal(c.job.status, 'idle');
  assert.equal(c.overall.percent, null);
  assert.equal(c.overall.measurable, false);
  assert.equal(c.retry.actionable, false);
});

test('running with an UNKNOWN total emits no percent (honest indeterminate) + a real stage', () => {
  const c = build(
    { initial_sync_status: 'running', status: 'syncing', sync_started_at: iso(100), updated_at: iso(10) },
    [
      row('products', { status: 'running', records_discovered: 40, records_inserted: 40, pages_completed: 2, pagination_complete: false, last_attempted_at: iso(30) }),
      row('orders', { status: 'never_run' }),
      row('abandoned_checkouts', { status: 'never_run' }),
    ]);
  assert.equal(c.job.status, 'running');
  assert.equal(c.overall.percent, null, 'unknown total => no fabricated percent');
  assert.equal(c.overall.measurable, false);
  assert.equal(c.overall.work.total_known, false);
  assert.equal(c.overall.stage, 'products_sync', 'real stage label for the indeterminate bar');
  assert.equal(c.job.heartbeat_at, iso(30), 'heartbeat is the real last-attempted time');
  assert.equal(c.job.stalled, false);
});

test('running is NOT marked stalled when the real heartbeat is recent', () => {
  const c = build(
    { initial_sync_status: 'running', status: 'syncing', sync_started_at: iso(100), updated_at: iso(5) },
    [row('products', { status: 'running', last_attempted_at: iso(5), pages_completed: 1, pagination_complete: false })]);
  assert.equal(c.job.status, 'running');
  assert.equal(c.job.stalled, false);
});

test('running with a REAL heartbeat beyond the threshold is stalled', () => {
  const c = build(
    { initial_sync_status: 'running', status: 'syncing', sync_started_at: iso(100000), updated_at: iso(100000) },
    [row('products', { status: 'running', last_attempted_at: iso(STALL_THRESHOLD_SECONDS + 60), pages_completed: 1, pagination_complete: false })]);
  assert.equal(c.job.status, 'stalled');
  assert.equal(c.job.stalled, true);
  assert.equal(c.overall.percent, null);
});

test('running with NO heartbeat is not falsely stalled and reports a null heartbeat', () => {
  // initial_sync_status running but no last_attempted_at anywhere and store not
  // "syncing" by status => no real heartbeat exists.
  const c = build(
    { initial_sync_status: 'running', status: 'connected', updated_at: iso(999999) },
    [row('products', { status: 'running', last_attempted_at: null })]);
  assert.equal(c.job.status, 'running');
  assert.equal(c.job.stalled, false, 'no heartbeat => never claim stalled');
  assert.equal(c.job.heartbeat_at, null, 'null heartbeat is reported, not invented');
});

test('completed: all required ok + pagination complete => authoritative 100%', () => {
  const c = build(
    { initial_sync_status: 'completed', sync_completed_at: iso(50), status: 'connected' },
    [
      row('products', { status: 'ok', records_discovered: 100, records_inserted: 60, records_updated: 40, pages_completed: 4, pagination_complete: true, last_succeeded_at: iso(50) }),
      row('orders', { status: 'ok', records_discovered: 10, records_inserted: 10, pages_completed: 1, pagination_complete: true, last_succeeded_at: iso(50) }),
      row('abandoned_checkouts', { status: 'ok', records_discovered: 3, records_inserted: 3, pages_completed: 1, pagination_complete: true, last_succeeded_at: iso(50) }),
    ]);
  assert.equal(c.job.status, 'completed');
  assert.equal(c.overall.percent, 100);
  assert.equal(c.overall.measurable, true);
  assert.equal(c.overall.work.total_known, true);
  for (const d of REQUIRED_DOMAINS) assert.equal(findDomain(c, d).percent, 100);
  assert.equal(c.retry.next_step, 'none');
});

test('partial: some required ok, some failed => partial, no 100%', () => {
  const c = build(
    { initial_sync_status: 'partial', status: 'connected' },
    [
      row('products', { status: 'ok', records_discovered: 100, records_inserted: 100, pagination_complete: true, pages_completed: 4, last_succeeded_at: iso(10) }),
      row('orders', { status: 'failed', records_discovered: 10, records_inserted: 0, error_code: 'SHOPIFY_RATE_LIMITED', retry_count: 1, last_attempted_at: iso(20) }),
      row('abandoned_checkouts', { status: 'never_run' }),
    ]);
  assert.equal(c.job.status, 'partial');
  // orders failed (not total_known) + abandoned_checkouts never_run (not
  // total_known) => overall not measurable => honest indeterminate, no percent.
  assert.equal(c.overall.measurable, false);
  assert.equal(c.overall.percent, null);
  assert.equal(findDomain(c, 'orders').failure.category, 'transient_throttle');
});

test('all required ok but a tracked OPTIONAL core domain failed => partial (completed WITH limitations), never a clean 100% (Task 229 P7)', () => {
  const c = build(
    { initial_sync_status: 'initial_completed_with_limitations', status: 'connected' },
    [
      row('products', { status: 'ok', records_discovered: 100, records_inserted: 100, pages_completed: 4, pagination_complete: true, last_succeeded_at: iso(50) }),
      row('orders', { status: 'ok', records_discovered: 10, records_inserted: 10, pages_completed: 1, pagination_complete: true, last_succeeded_at: iso(50) }),
      row('abandoned_checkouts', { status: 'ok', records_discovered: 3, records_inserted: 3, pages_completed: 1, pagination_complete: true, last_succeeded_at: iso(50) }),
      // A TRACKED optional core domain terminally failed -> a limitation that
      // the progress contract itself can see. It must not be papered over with
      // a bare "completed"/100% (the honest terminal is "partial").
      row('refunds', { status: 'failed', records_discovered: 0, error_code: 'SHOPIFY_GRAPHQL_ERROR', retry_count: 1, last_attempted_at: iso(60) }),
    ]);
  assert.equal(c.job.status, 'partial');
  assert.equal(c.job.reason, 'required_complete_with_limitations');
  assert.ok(c.overall.percent !== null && c.overall.percent < 100,
    `must not overstate a tracked-domain limitation as 100%, got ${c.overall.percent}`);
  // The failed tracked domain is surfaced with its own failure.
  assert.equal(findDomain(c, 'refunds').status, 'failed');
  assert.ok(findDomain(c, 'refunds').failure, 'failed tracked domain carries its failure');
  // Required domains are still each 100% (they genuinely completed).
  for (const d of REQUIRED_DOMAINS) assert.equal(findDomain(c, d).percent, 100);
});

test('measurable percent is null when any required resource has an unknown total', () => {
  const c = build(
    { initial_sync_status: 'partial', status: 'connected' },
    [
      row('products', { status: 'ok', records_discovered: 100, records_inserted: 100, pagination_complete: true, pages_completed: 4, last_succeeded_at: iso(10) }),
      row('orders', { status: 'ok', records_discovered: 10, records_inserted: 10, pagination_complete: true, pages_completed: 1, last_succeeded_at: iso(10) }),
      row('abandoned_checkouts', { status: 'never_run' }), // unknown total
    ]);
  assert.equal(c.overall.measurable, false);
  assert.equal(c.overall.percent, null);
  assert.equal(c.overall.work.total_known, false);
});

test('measurable but not complete never reaches a premature 100%', () => {
  // All required total_known, but orders only partially persisted and NOT ok.
  const c = build(
    { initial_sync_status: 'running', status: 'syncing', updated_at: iso(5) },
    [
      row('products', { status: 'ok', records_discovered: 100, records_inserted: 100, pagination_complete: true, pages_completed: 4, last_succeeded_at: iso(10) }),
      row('orders', { status: 'running', records_discovered: 100, records_inserted: 100, pages_completed: 5, pagination_complete: true, last_attempted_at: iso(5) }),
      row('abandoned_checkouts', { status: 'ok', records_discovered: 3, records_inserted: 3, pagination_complete: true, pages_completed: 1, last_succeeded_at: iso(10) }),
    ]);
  // orders is running with pagination_complete and 100/100 => its domain percent
  // is 100 (clamped) but the JOB is not completed, so overall must be < 100.
  assert.equal(c.job.status, 'running');
  assert.ok(c.overall.measurable === true);
  assert.ok(c.overall.percent < 100, `premature 100% not allowed, got ${c.overall.percent}`);
});

test('failed: a required resource failed => failed job + actionable retry (transient)', () => {
  const c = build(
    { initial_sync_status: 'failed', status: 'connected' },
    [
      row('products', { status: 'never_run' }),
      row('orders', { status: 'failed', records_discovered: 50, records_inserted: 20, error_code: 'SHOPIFY_HTTP_ERROR_503', retry_count: 1, last_attempted_at: iso(120) }),
      row('abandoned_checkouts', { status: 'never_run' }),
    ]);
  assert.equal(c.job.status, 'failed');
  const retry = c.retry;
  assert.equal(retry.actionable, true);
  assert.equal(retry.scope, 'orders');
  assert.equal(retry.category, 'transient_provider');
  assert.equal(retry.retry_eligible, true);
  assert.equal(retry.merchant_action_required, false);
  assert.equal(retry.next_step, 'wait_and_retry');
  assert.ok(retry.next_eligible_at != null, 'transient failure has a bounded next-eligible time');
});

// ---- failure classification + bounded backoff ---------------------------

test('failureCategory maps codes to deterministic categories', () => {
  assert.equal(failureCategory('SHOPIFY_HTTP_ERROR_503', null), 'transient_provider');
  assert.equal(failureCategory('SHOPIFY_RATE_LIMITED', null), 'transient_throttle');
  assert.equal(failureCategory('P503_DB_UNAVAILABLE', null), 'transient_backend');
  assert.equal(failureCategory('SHOPIFY_ACCESS_DENIED', null), 'permission');
  assert.equal(failureCategory('SHOPIFY_SCOPE_NOT_GRANTED', null), 'permission');
  assert.equal(failureCategory(null, 'AUTHORIZATION_EXPIRED'), 'authorization');
  assert.equal(failureCategory(null, 'AUTHORIZATION_REVOKED'), 'authorization');
  assert.equal(failureCategory('UNSUPPORTED_RESOURCE', null), 'unsupported');
  assert.equal(failureCategory('WEIRD_CODE', null), 'unknown');
});

test('backoffSeconds is exponential and capped', () => {
  assert.equal(backoffSeconds(1), 60);
  assert.equal(backoffSeconds(2), 120);
  assert.equal(backoffSeconds(3), 240);
  assert.equal(backoffSeconds(10), 3600, 'capped at 1h');
});

test('autoRetryExhausted flips at MAX_AUTO_ATTEMPTS', () => {
  assert.equal(autoRetryExhausted(MAX_AUTO_ATTEMPTS - 1), false);
  assert.equal(autoRetryExhausted(MAX_AUTO_ATTEMPTS), true);
});

test('permanent authorization failure is NOT auto-retryable and asks for reconnect', () => {
  const c = build(
    { initial_sync_status: 'failed', status: 'connected' },
    [
      row('products', { status: 'ok', records_discovered: 10, records_inserted: 10, pagination_complete: true, pages_completed: 1, last_succeeded_at: iso(10) }),
      row('orders', { status: 'failed', error_code: 'SHOPIFY_UNAUTHORIZED', retry_count: 1, last_attempted_at: iso(10) }),
      row('abandoned_checkouts', { status: 'never_run' }),
    ]);
  assert.equal(c.retry.category, 'authorization');
  assert.equal(c.retry.retry_eligible, false);
  assert.equal(c.retry.merchant_action_required, true);
  assert.equal(c.retry.next_step, 'reconnect');
  assert.equal(c.retry.next_eligible_at, null, 'permanent failures have no auto-retry window');
});

test('permission failure is not auto-retryable and requires reconnect', () => {
  const c = build(
    { initial_sync_status: 'failed', status: 'connected' },
    [row('orders', { status: 'failed', error_code: 'SHOPIFY_ACCESS_DENIED', retry_count: 3, last_attempted_at: iso(10) })]);
  assert.equal(c.retry.category, 'permission');
  assert.equal(c.retry.retry_eligible, false);
  assert.equal(c.retry.merchant_action_required, true);
  assert.equal(c.retry.next_step, 'reconnect');
});

test('unsupported failure is not retryable and needs no merchant action', () => {
  const c = build(
    { initial_sync_status: 'partial', status: 'connected' },
    [row('orders', { status: 'degraded', error_code: 'UNSUPPORTED_RESOURCE', retry_count: 1, last_attempted_at: iso(10) })]);
  assert.equal(c.retry.category, 'unsupported');
  assert.equal(c.retry.retry_eligible, false);
  assert.equal(c.retry.merchant_action_required, false);
  assert.equal(c.retry.next_step, 'none');
});

test('transient failure inside its backoff window is not yet actionable', () => {
  // last_attempted 30s ago, backoff for attempt 1 = 60s => window not elapsed.
  const c = build(
    { initial_sync_status: 'failed', status: 'connected' },
    [row('orders', { status: 'failed', error_code: 'SHOPIFY_HTTP_ERROR_503', retry_count: 1, last_attempted_at: iso(30) })]);
  assert.equal(c.retry.retry_eligible, true, 'still auto-retry-eligible category');
  assert.equal(c.retry.next_eligible_at, new Date(NOW_MS + 30 * 1000).toISOString(), 'next eligible 30s from now');
  const failure = findDomain(c, 'orders').failure;
  assert.equal(failure.retry_window_elapsed, false, 'window not elapsed => not yet actionable now');
});

test('transient failure with elapsed backoff window is actionable now', () => {
  const c = build(
    { initial_sync_status: 'failed', status: 'connected' },
    [row('orders', { status: 'failed', error_code: 'SHOPIFY_HTTP_ERROR_503', retry_count: 1, last_attempted_at: iso(120) })]);
  const failure = findDomain(c, 'orders').failure;
  assert.equal(failure.retry_window_elapsed, true);
  assert.equal(c.retry.actionable, true);
});

test('a transient failure whose auto-retry budget is exhausted requires manual action', () => {
  const c = build(
    { initial_sync_status: 'failed', status: 'connected' },
    [row('orders', { status: 'failed', error_code: 'SHOPIFY_HTTP_ERROR_503', retry_count: MAX_AUTO_ATTEMPTS, last_attempted_at: iso(999999) })]);
  assert.equal(c.retry.backoff_exhausted, true);
  assert.equal(c.retry.retry_eligible, false, 'auto-retry exhausted');
  assert.equal(c.retry.actionable, true, 'still manually actionable');
});

// ---- validator fail-closed ---------------------------------------------

test('validateSyncProgress rejects a premature 100%', () => {
  const c = build();
  c.overall.percent = 100; c.job.status = 'running'; c.overall.measurable = true;
  const problems = validateSyncProgress(c);
  assert.ok(problems.includes('premature_100_percent'));
});

test('validateSyncProgress rejects a percent without a stable denominator', () => {
  const c = build();
  c.overall.percent = 50; c.overall.measurable = false;
  assert.ok(validateSyncProgress(c).includes('percent_without_stable_denominator'));
});

test('validateSyncProgress rejects percent out of range', () => {
  const c = build();
  c.overall.percent = 150; c.overall.measurable = true; c.job.status = 'running';
  assert.ok(validateSyncProgress(c).includes('percent_out_of_range'));
});

test('validateSyncProgress rejects an unknown contract version', () => {
  const c = build();
  c.contract_version = 'wrong';
  assert.ok(validateSyncProgress(c).includes('bad_contract_version'));
});

test('the contract never leaks the access token', () => {
  const c = build(
    { initial_sync_status: 'running', status: 'syncing', updated_at: iso(5) },
    [row('products', { status: 'running', last_attempted_at: iso(5) })]);
  const blob = JSON.stringify(c);
  assert.ok(!blob.includes('shpat_should_never_appear'));
  assert.ok(!/access_token/.test(blob));
});

test('every domain is always present (closed set), required and optional', () => {
  const c = build();
  assert.equal(c.domains.length, ALL_DOMAINS.length);
  for (const domain of ALL_DOMAINS) {
    const d = findDomain(c, domain);
    assert.ok(d, `missing ${domain}`);
    assert.equal(typeof d.required, 'boolean');
    assert.equal(d.required, REQUIRED_DOMAINS.includes(domain));
  }
});

test('store_status (Task 229 #3): 9 tracked domains complete + an extended domain failed -> canonical completed_with_limitations', () => {
  const rows = [
    ...REQUIRED_DOMAINS.map(d => row(d, { status: 'ok', records_discovered: 5, records_inserted: 5, pagination_complete: true, last_succeeded_at: iso(60) })),
    row('customers', { status: 'ok', records_discovered: 5, records_inserted: 5, pagination_complete: true, last_succeeded_at: iso(60) }),
    // EXTENDED domains (not in ALL_DOMAINS) failed — the live D4 case.
    row('analytics.reports', { status: 'failed', error_code: 'SHOPIFY_GRAPHQL_ERROR', last_attempted_at: iso(60) }),
    row('shop.policies', { status: 'failed', error_code: 'SHOPIFY_GRAPHQL_ERROR', last_attempted_at: iso(60) }),
  ];
  const c = build({ initial_sync_status: 'completed', status: 'active', sync_completed_at: iso(30) }, rows);
  // The 9-domain job contract is a clean "completed" (tracked set all succeeded)…
  assert.equal(c.job.status, 'completed');
  // …but the canonical store status is honest: completed WITH limitations.
  assert.equal(c.store_status.status, 'initial_completed_with_limitations');
  const limited = c.store_status.limitations.map(l => l.domain);
  assert.ok(limited.includes('analytics.reports'), 'extended limitation surfaced');
  assert.ok(limited.includes('shop.policies'), 'extended limitation surfaced');
  for (const l of c.store_status.limitations) assert.equal(l.required, false);
});

test('store_status (Task 229 #3): fully clean ledger -> initial_completed with no limitations', () => {
  const rows = REQUIRED_DOMAINS.map(d => row(d, { status: 'ok', records_discovered: 5, records_inserted: 5, pagination_complete: true, last_succeeded_at: iso(60) }));
  const c = build({ initial_sync_status: 'completed', status: 'active', sync_completed_at: iso(30) }, rows);
  assert.equal(c.store_status.status, 'initial_completed');
  assert.equal(c.store_status.limitations.length, 0);
});
