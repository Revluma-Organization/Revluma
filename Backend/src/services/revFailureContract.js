'use strict';

const crypto = require('crypto');

const FAILURE_CONTRACT_VERSION = 'rev-failure-v1';
const TIMEOUT_POLICY_MS = Object.freeze({
  contextRetrieval: 5000,
  pythonConnection: 5000,
  pythonResponse: 45000,
  overallInvestigation: 105000,
  browserStream: 130000,
});
const CATEGORIES = new Set([
  'timeout', 'cancelled', 'rate_limited', 'provider_unavailable', 'connection_failed',
  'invalid_request', 'malformed_output', 'schema_validation_failed', 'authorization_failed',
  'permission_denied', 'unsupported_capability', 'evidence_retrieval_failed',
  'specialist_failed', 'partial_success', 'internal_error',
]);
const RETRYABLE = new Set(['timeout', 'rate_limited', 'provider_unavailable', 'connection_failed']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeId(value) {
  return typeof value === 'string' && UUID.test(value) ? value : crypto.randomUUID();
}

function safeFailure(category, stage, options = {}) {
  if (!CATEGORIES.has(category)) category = 'internal_error';
  return {
    contract_version: FAILURE_CONTRACT_VERSION,
    category,
    stage: String(stage || 'unknown').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 80),
    retryable: RETRYABLE.has(category),
    retry_count: Math.max(0, Math.min(Number(options.retryCount) || 0, 1)),
    partial_results_preserved: options.partial === true,
    fallback_used: options.fallback === true,
    correlation_id: safeId(options.correlationId),
    execution_id: safeId(options.executionId),
    occurred_at: new Date().toISOString(),
  };
}

function normalizePythonFailure(value, fallback, correlationId, executionId) {
  if (!value || typeof value !== 'object' || value.contract_version !== FAILURE_CONTRACT_VERSION) return fallback;
  const category = CATEGORIES.has(value.category) ? value.category : fallback.category;
  return {
    ...fallback,
    category,
    stage: typeof value.stage === 'string' ? value.stage.slice(0, 80) : fallback.stage,
    retryable: RETRYABLE.has(category),
    retry_count: Math.max(0, Math.min(Number(value.retry_count) || 0, 1)),
    partial_results_preserved: value.partial_results_preserved === true,
    fallback_used: value.fallback_used === true,
    correlation_id: safeId(correlationId),
    execution_id: safeId(executionId),
  };
}

function withTimeout(promise, timeoutMs, stage, correlationId) {
  let timer;
  const bounded = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Operation timed out');
      error.code = 'REV_TIMEOUT';
      error.failure = safeFailure('timeout', stage, { correlationId });
      reject(error);
    }, Math.max(1, timeoutMs));
  });
  return Promise.race([Promise.resolve(promise), bounded]).finally(() => clearTimeout(timer));
}

module.exports = {
  FAILURE_CONTRACT_VERSION, TIMEOUT_POLICY_MS, CATEGORIES, RETRYABLE,
  safeId, safeFailure, normalizePythonFailure, withTimeout,
};
