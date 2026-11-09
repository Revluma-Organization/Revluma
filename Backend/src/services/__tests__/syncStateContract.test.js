'use strict';

// Exhaustive tests for the canonical sync state contract (Task 229 §2/§4).
// These cover the "initial sync lifecycle" and "coverage/freshness/capability"
// scenario buckets. Pure logic — no DB.

const test = require('node:test');
const assert = require('node:assert/strict');

const C = require('../syncStateContract');

// --- lifecycle enum is closed, typed, versioned ---------------------------
test('contract exposes a version and closed canonical sets', () => {
  assert.equal(typeof C.CONTRACT_VERSION, 'string');
  assert.ok(C.CONTRACT_VERSION.length > 0);
  // §2 resource lifecycle states all present.
  for (const s of ['authorization_completed', 'queued', 'starting', 'running',
    'resource_completed', 'resource_partial', 'failed', 'retrying',
    'initial_completed', 'initial_completed_with_limitations', 'blocked_by_auth_or_unsupported']) {
    assert.ok(C.STATUS_VALUES.includes(s), `missing canonical status: ${s}`);
  }
  // §4 coverage states all present.
  for (const s of ['complete', 'partial', 'insufficient_history', 'unsupported',
    'unauthorized', 'retrieval_failure', 'persistence_failure', 'unknown', 'verified_zero']) {
    assert.ok(C.COVERAGE_VALUES.includes(s), `missing coverage state: ${s}`);
  }
});

test('assertStatus rejects unknown values and accepts canonical ones', () => {
  assert.equal(C.assertStatus('resource_completed').ok, true);
  assert.equal(C.assertStatus('bogus').ok, false);
  assert.equal(C.assertStatus('').ok, false);
  assert.equal(C.assertStatus(null).ok, false);
  // scope-aware
  assert.equal(C.assertStatus('initial_completed', { scope: 'sync' }).ok, true);
  assert.equal(C.assertStatus('initial_completed', { scope: 'resource' }).ok, false);
});

// --- legacy -> canonical compatibility shim --------------------------------
test('toCanonicalStatus maps legacy resource values to canonical', () => {
  const m = v => C.toCanonicalStatus(v, { scope: 'resource' });
  assert.equal(m('ok'), 'resource_completed');
  assert.equal(m('degraded'), 'resource_partial');
  assert.equal(m('never_run'), 'never_run');
  assert.equal(m('running'), 'running');
  assert.equal(m('failed'), 'failed');
  // canonical passthrough
  assert.equal(m('resource_completed'), 'resource_completed');
  assert.equal(m('resource_partial'), 'resource_partial');
  // unknown -> safe default, never invented
  assert.equal(m('something-else'), 'never_run');
});

test('toCanonicalStatus maps legacy store values to canonical', () => {
  const m = v => C.toCanonicalStatus(v, { scope: 'sync' });
  assert.equal(m('not_started'), 'not_started');
  assert.equal(m('completed'), 'initial_completed');
  assert.equal(m('partial'), 'initial_completed_with_limitations');
  assert.equal(m('running'), 'running');
  assert.equal(m('failed'), 'failed');
  assert.equal(m('queued'), 'queued');
  assert.equal(m('initial_completed'), 'initial_completed');
  assert.equal(m('initial_completed_with_limitations'), 'initial_completed_with_limitations');
  assert.equal(m('weird'), 'not_started');
});

// --- freshness: never invented ---------------------------------------------
test('deriveFreshness is never/fresh/stale based only on real timestamps', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  assert.equal(C.deriveFreshness(null, { now }), 'never');
  assert.equal(C.deriveFreshness({}, { now }), 'never');
  assert.equal(C.deriveFreshness({ last_succeeded_at: null }, { now }), 'never');
  assert.equal(
    C.deriveFreshness({ last_succeeded_at: new Date('2026-11-09T12:00:00Z') }, { now }),
    'fresh',
  );
  assert.equal(
    C.deriveFreshness({ last_succeeded_at: new Date('2026-11-01T00:00:00Z') }, { now }),
    'stale',
  );
  // boundary: exactly the threshold is fresh
  assert.equal(
    C.deriveFreshness(
      { last_succeeded_at: new Date('2026-11-09T00:00:00Z') },
      { now, thresholdMs: 24 * 60 * 60 * 1000 },
    ),
    'fresh',
  );
  // future timestamp (clock skew) is treated as fresh, not negative-broken
  assert.equal(
    C.deriveFreshness({ last_succeeded_at: new Date('2026-11-11T00:00:00Z') }, { now }),
    'fresh',
  );
});

test('freshnessSeconds returns null with no success, else non-negative integer', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  assert.equal(C.freshnessSeconds({}, now), null);
  assert.equal(C.freshnessSeconds({ last_succeeded_at: new Date('2026-11-10T00:00:00Z') }, now), 0);
  assert.equal(C.freshnessSeconds({ last_succeeded_at: new Date('2026-11-09T00:00:00Z') }, now), 86400);
  // future -> clamped to 0, never negative
  assert.equal(C.freshnessSeconds({ last_succeeded_at: new Date('2026-11-11T00:00:00Z') }, now), 0);
});

// --- failure classification ------------------------------------------------
test('classifyFailure buckets auth/unsupported/transient/rate/persistence/unknown', () => {
  assert.equal(C.classifyFailure('SHOPIFY_READ_ORDERS_NOT_GRANTED'), 'auth');
  assert.equal(C.classifyFailure('TOKEN_EXPIRED'), 'auth');
  assert.equal(C.classifyFailure('403 FORBIDDEN'), 'auth');
  assert.equal(C.classifyFailure('429 TOO MANY REQUESTS'), 'rate_limited');
  assert.equal(C.classifyFailure('RATE_LIMIT'), 'rate_limited');
  assert.equal(C.classifyFailure('QUERY_NOT_SUPPORTED'), 'unsupported');
  assert.equal(C.classifyFailure('UNKNOWN_FIELD'), 'unsupported');
  assert.equal(C.classifyFailure('TIMEOUT'), 'transient');
  assert.equal(C.classifyFailure('ECONNRESET'), 'transient');
  assert.equal(C.classifyFailure('503 UNAVAILABLE'), 'transient');
  assert.equal(C.classifyFailure('PRISMA_P1001 FOREIGN'), 'persistence');
  assert.equal(C.classifyFailure(''), 'unknown');
  assert.equal(C.classifyFailure(null, null), 'unknown');
  assert.equal(C.classifyFailure('MysteryBlorp'), 'unknown');
});

test('classifyFailure honors details when code is absent', () => {
  assert.equal(C.classifyFailure(null, 'Shopify access token has expired'), 'auth');
  assert.equal(C.classifyFailure(null, 'request timed out after 30s'), 'transient');
});

// --- retry eligibility -----------------------------------------------------
test('retryEligible: transient/rate/unknown under cap are retryable', () => {
  assert.equal(C.retryEligible({ status: 'failed', error_code: 'TIMEOUT', retry_count: 0 }), true);
  assert.equal(C.retryEligible({ status: 'failed', error_code: '429', retry_count: 2 }), true);
  assert.equal(C.retryEligible({ status: 'failed', error_code: 'MYSTERY', retry_count: 1 }), true);
  assert.equal(C.retryEligible({ status: 'retrying', retry_count: 1 }), true);
});

test('retryEligible: auth/unsupported/persistence are NOT safe to auto-retry', () => {
  assert.equal(C.retryEligible({ status: 'failed', error_code: 'SHOPIFY_READ_ORDERS_NOT_GRANTED' }), false);
  assert.equal(C.retryEligible({ status: 'failed', error_code: 'QUERY_NOT_SUPPORTED' }), false);
  assert.equal(C.retryEligible({ status: 'failed', error_code: 'PRISMA_P1001' }), false);
});

test('retryEligible: bounded by MAX_SAFE_RETRIES', () => {
  assert.equal(C.retryEligible({ status: 'failed', error_code: 'TIMEOUT', retry_count: C.MAX_SAFE_RETRIES }), false);
  assert.equal(C.retryEligible({ status: 'failed', error_code: 'TIMEOUT', retry_count: C.MAX_SAFE_RETRIES - 1 }), true);
});

test('retryEligible: completed / blocked / never-run are not retry-now states', () => {
  assert.equal(C.retryEligible({ status: 'resource_completed' }), false);
  assert.equal(C.retryEligible({ status: 'never_run' }), false);
  assert.equal(C.retryEligible({ status: 'blocked_by_auth_or_unsupported', capability_state: 'unsupported' }), false);
});

// --- coverage certification ------------------------------------------------
const dom = (over = {}) => ({
  domain: 'orders', required: true,
  status: 'resource_completed',
  records_discovered: 10, records_inserted: 10, records_updated: 0, records_deleted: 0,
  pagination_complete: true, error_code: null, error_details: null,
  last_attempted_at: new Date('2026-11-09T00:00:00Z'),
  last_succeeded_at: new Date('2026-11-09T00:00:00Z'),
  retry_count: 0, ...over,
});

test('coverage: complete only when succeeded + paginated + has records', () => {
  assert.equal(C.deriveCoverageState(dom()), 'complete');
  assert.equal(C.deriveCoverageState(dom({ status: 'ok' })), 'complete'); // legacy shim
});

test('coverage: empty response is verified_zero, NEVER complete (empty != complete)', () => {
  assert.equal(C.deriveCoverageState(dom({ records_discovered: 0, records_inserted: 0 })), 'verified_zero');
});

test('coverage: completed but pagination not complete -> partial', () => {
  assert.equal(C.deriveCoverageState(dom({ pagination_complete: false })), 'partial');
});

test('coverage: resource_partial -> partial (verified_zero if nothing seen)', () => {
  assert.equal(C.deriveCoverageState(dom({ status: 'resource_partial', records_discovered: 5 })), 'partial');
  assert.equal(C.deriveCoverageState(dom({ status: 'resource_partial', records_discovered: 0 })), 'verified_zero');
});

test('coverage: auth-blocked -> unauthorized; unsupported-blocked -> unsupported', () => {
  assert.equal(C.deriveCoverageState(dom({ status: 'blocked_by_auth_or_unsupported', capability_state: 'missing_scope' })), 'unauthorized');
  assert.equal(C.deriveCoverageState(dom({ status: 'blocked_by_auth_or_unsupported', capability_state: 'revoked' })), 'unauthorized');
  assert.equal(C.deriveCoverageState(dom({ status: 'blocked_by_auth_or_unsupported', capability_state: 'unsupported' })), 'unsupported');
  assert.equal(C.deriveCoverageState(dom({ status: 'failed', error_code: 'SHOPIFY_READ_ORDERS_NOT_GRANTED' })), 'unauthorized');
  assert.equal(C.deriveCoverageState(dom({ status: 'failed', error_code: 'QUERY_NOT_SUPPORTED' })), 'unsupported');
});

test('coverage: failed -> retrieval_failure, but partial if data already seen; persistence if persist failed', () => {
  // fresh failure, no prior success -> retrieval_failure
  assert.equal(C.deriveCoverageState(dom({ status: 'failed', error_code: 'TIMEOUT', last_succeeded_at: null, last_attempted_at: new Date('2026-11-09T00:00:00Z') })), 'retrieval_failure');
  // had a prior success with data, then failed -> partial
  assert.equal(C.deriveCoverageState(dom({ status: 'failed', error_code: 'TIMEOUT' })), 'partial');
  // persistence failure is its own coverage state
  assert.equal(C.deriveCoverageState(dom({ status: 'failed', error_code: 'PRISMA_P1001' })), 'persistence_failure');
});

test('coverage: running with no data yet is unknown (never invent progress)', () => {
  assert.equal(C.deriveCoverageState(dom({ status: 'running', last_succeeded_at: null })), 'unknown');
});

test('coverage: running with prior data is partial', () => {
  assert.equal(C.deriveCoverageState(dom({ status: 'running', records_discovered: 4 })), 'partial');
});

test('coverage: never_run / no attempt -> unknown', () => {
  assert.equal(C.deriveCoverageState(dom({ status: 'never_run', last_attempted_at: null, last_succeeded_at: null })), 'unknown');
  assert.equal(C.deriveCoverageState(null), 'unknown');
});

// --- projectResourceWork: percent math never invents a denominator --------
test('projectResourceWork: total_known only when paginated or completed', () => {
  const complete = C.projectResourceWork(dom());
  assert.equal(complete.total_known, true);
  assert.equal(complete.total_units, 10);
  assert.equal(complete.completed_units, 10);
  assert.equal(complete.failed_units, 0);
  const runningUnknown = C.projectResourceWork(dom({ status: 'running', pagination_complete: false }));
  assert.equal(runningUnknown.total_known, false);
  assert.equal(runningUnknown.total_units, null); // no invented denominator
});

// ===========================================================================
// store-level terminal-state derivation — the "stuck in running" repair logic
// ===========================================================================

const r = (domain, over = {}) => ({ domain, required: true, ...over });

test('store: nothing started -> not_started (or preserved scheduled state)', () => {
  const rows = [r('orders', { status: 'never_run' }), r('products', { status: 'never_run' })];
  assert.equal(C.deriveStoreSyncStatus(rows, 'not_started').status, 'not_started');
  assert.equal(C.deriveStoreSyncStatus(rows, 'queued').status, 'queued');
  assert.equal(C.deriveStoreSyncStatus(rows, 'running').status, 'running'); // scheduled, not yet run
});

test('store: all required complete -> initial_completed', () => {
  const rows = [r('orders', { status: 'resource_completed', pagination_complete: true }),
    r('products', { status: 'resource_completed', pagination_complete: true })];
  assert.equal(C.deriveStoreSyncStatus(rows, 'running').status, 'initial_completed');
});

test('store: all required complete but an OPTIONAL resource failed -> initial_completed_with_limitations', () => {
  const rows = [r('orders', { status: 'resource_completed', pagination_complete: true, required: true }),
    { domain: 'analytics.reports', required: false, status: 'failed', error_code: 'QUERY_NOT_SUPPORTED' }];
  const res = C.deriveStoreSyncStatus(rows, 'running');
  assert.equal(res.status, 'initial_completed_with_limitations');
  assert.ok(res.limitations.some(l => l.domain === 'analytics.reports'));
});

test('store: REQUIRED resource terminally failed but others completed -> initial_completed_with_limitations (NOT stuck running)', () => {
  const rows = [
    r('orders', { status: 'resource_completed', pagination_complete: true }),
    r('shop.policies', { status: 'failed', error_code: 'QUERY_NOT_SUPPORTED', last_attempted_at: new Date() }),
  ];
  const res = C.deriveStoreSyncStatus(rows, 'running');
  // The critical defect fix: not stuck in running; a defensible terminal state.
  assert.notEqual(res.status, 'running');
  assert.equal(res.status, 'initial_completed_with_limitations');
  assert.ok(res.limitations.some(l => l.domain === 'shop.policies' && l.coverage === 'unsupported'));
});

test('store: ALL required failed, nothing completed -> failed', () => {
  const rows = [
    r('orders', { status: 'failed', error_code: 'TIMEOUT', last_succeeded_at: null }),
    r('products', { status: 'failed', error_code: 'TIMEOUT', last_succeeded_at: null }),
  ];
  assert.equal(C.deriveStoreSyncStatus(rows, 'running').status, 'failed');
});

test('store: a resource genuinely in progress -> running (unless caller proves stalled)', () => {
  const rows = [r('shipping', { status: 'running', last_attempted_at: new Date() }),
    r('orders', { status: 'resource_completed', pagination_complete: true })];
  assert.equal(C.deriveStoreSyncStatus(rows, 'running').status, 'running');
  // With real stalled evidence supplied by the caller (heartbeat), still not a
  // fabricated terminal outcome — but flagged for recovery.
  const stalled = C.deriveStoreSyncStatus(rows, 'running', { stalledRunning: true });
  assert.equal(stalled.status, 'running');
  assert.match(stalled.reason, /stalled/);
});

test('store: a stale running domain is NOT silently terminal — reaper re-drives it', () => {
  // This encodes the production defect: a domain left in `running` must not
  // wedge the store forever. The derivation reports running + limitation and
  // the P3 reaper transitions the domain to failed/retrying so the store can
  // then reach a terminal state.
  const rows = [
    r('shipping', { status: 'running', last_attempted_at: new Date('2026-11-09T10:51:00Z') }),
    r('orders', { status: 'resource_completed', pagination_complete: true }),
  ];
  const res = C.deriveStoreSyncStatus(rows, 'running');
  assert.equal(res.status, 'running'); // not yet terminal — the reaper must act
  assert.ok(res.limitations.length >= 1);
});

test('store: unsupported-blocked required resource is a LIMITATION, not a completion blocker', () => {
  const rows = [
    r('orders', { status: 'resource_completed', pagination_complete: true }),
    r('analytics.reports', { status: 'blocked_by_auth_or_unsupported', capability_state: 'unsupported' }),
  ];
  const res = C.deriveStoreSyncStatus(rows, 'running');
  assert.equal(res.status, 'initial_completed_with_limitations');
});

test('store: auth-blocked required resource (no other completion) -> failed with unauthorized limitation', () => {
  const rows = [r('orders', { status: 'blocked_by_auth_or_unsupported', capability_state: 'missing_scope' })];
  const res = C.deriveStoreSyncStatus(rows, 'running');
  assert.equal(res.status, 'failed');
  assert.ok(res.limitations.some(l => l.coverage === 'unauthorized'));
});

test('store: legacy ok/degraded statuses still derive correctly (shim)', () => {
  const rows = [
    r('orders', { status: 'ok', pagination_complete: true }),
    r('analytics.reports', { status: 'degraded', error_code: 'QUERY_NOT_SUPPORTED', records_discovered: 3 }),
  ];
  const res = C.deriveStoreSyncStatus(rows, 'running');
  assert.equal(res.status, 'initial_completed_with_limitations');
});
