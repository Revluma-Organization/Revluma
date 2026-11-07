'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FAILURE_CONTRACT_VERSION, TIMEOUT_POLICY_MS, safeFailure, normalizePythonFailure, withTimeout,
} = require('../revFailureContract');

test('failure categories expose bounded safe retry and execution metadata', () => {
  for (const category of ['timeout', 'rate_limited', 'provider_unavailable', 'connection_failed']) {
    const failure = safeFailure(category, 'provider', { retryCount: 1, partial: true, fallback: true });
    assert.equal(failure.contract_version, FAILURE_CONTRACT_VERSION);
    assert.equal(failure.retryable, true);
    assert.equal(failure.retry_count, 1);
    assert.equal(failure.partial_results_preserved, true);
    assert.equal(JSON.stringify(failure).includes('secret'), false);
  }
});

test('permanent failures never advertise retries', () => {
  for (const category of ['authorization_failed', 'permission_denied', 'invalid_request',
    'schema_validation_failed', 'unsupported_capability']) {
    assert.equal(safeFailure(category, 'validation').retryable, false);
  }
});

test('unknown categories and unsafe stages fail closed without raw exception text', () => {
  const failure = safeFailure('secret database password', 'bad stage with spaces');
  assert.equal(failure.category, 'internal_error');
  assert.equal(failure.retryable, false);
  assert.equal(failure.stage, 'bad_stage_with_spaces');
  assert.equal(JSON.stringify(failure).includes('password'), false);
});

test('Python failure metadata is allowlisted and cannot downgrade a safe fallback', () => {
  const correlationId = '11111111-1111-4111-8111-111111111111';
  const executionId = '22222222-2222-4222-8222-222222222222';
  const fallback = safeFailure('timeout', 'stream', { correlationId, executionId });
  const normalized = normalizePythonFailure({
    contract_version: FAILURE_CONTRACT_VERSION, category: 'partial_success', stage: 'specialist',
    retryable: true, retry_count: 99, raw_error: 'secret', partial_results_preserved: true,
  }, fallback, correlationId, executionId);
  assert.equal(normalized.category, 'partial_success');
  assert.equal(normalized.retryable, false);
  assert.equal(normalized.retry_count, 1);
  assert.equal(normalized.correlation_id, correlationId);
  assert.equal(normalized.execution_id, executionId);
  assert.equal('raw_error' in normalized, false);
});

test('bounded operations preserve values and reject timeouts with typed diagnostics', async () => {
  assert.equal(await withTimeout(Promise.resolve(42), 50, 'context'), 42);
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, 'database_statement'),
    error => error.code === 'REV_TIMEOUT' && error.failure.category === 'timeout' &&
      error.failure.stage === 'database_statement');
});

test('shared deadline policy leaves Python room to return its own timeout before browser expiry', () => {
  assert.ok(TIMEOUT_POLICY_MS.pythonConnection < TIMEOUT_POLICY_MS.pythonResponse);
  assert.ok(TIMEOUT_POLICY_MS.overallInvestigation < TIMEOUT_POLICY_MS.browserStream);
  assert.ok(TIMEOUT_POLICY_MS.contextRetrieval <= 5000);
});
