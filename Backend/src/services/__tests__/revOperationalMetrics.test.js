'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const metrics = require('../revOperationalMetrics');

test('Rev metrics expose bounded counters and average/percentile latency', () => {
  metrics.resetForTests();
  metrics.record('rev_requests_total', 1, {
    outcome: 'success', tenant_id: 'not-a-valid-label-value',
    correlation_id: '11111111-1111-4111-8111-111111111111',
    execution_id: '22222222-2222-4222-8222-222222222222',
  });
  metrics.record('rev_general_questions_total', 1, { outcome: 'success' });
  metrics.record('rev_persistence_failures_total', 1, { stage: 'response_write' });
  [10, 20, 30, 40, 100].forEach((value) => metrics.observe('rev_request', value));
  const report = metrics.snapshot();
  assert.equal(report.contract_version, 'rev-metrics-v1');
  assert.equal(report.latency_ms.rev_request.average_ms, 40);
  assert.equal(report.latency_ms.rev_request.p50_ms, 30);
  assert.equal(report.latency_ms.rev_request.p95_ms, 100);
  assert.equal(report.latency_ms.rev_request.p99_ms, 100);
  assert.equal(report.counters.some((item) => item.name === 'rev_requests_total' && item.labels.outcome === 'success'), true);
  assert.equal(JSON.stringify(report).includes('tenant_id'), false);
  assert.equal(JSON.stringify(report).includes('conversation_id'), false);
  assert.equal(JSON.stringify(report).includes('correlation_id'), false);
  assert.equal(JSON.stringify(report).includes('execution_id'), false);
});

test('metrics ignore unknown instruments and keep sample memory bounded', () => {
  metrics.resetForTests();
  metrics.record('merchant_prompt', 1, { message: 'sensitive merchant text' });
  for (let i = 0; i < 3000; i += 1) metrics.observe('rev_request', i);
  const report = metrics.snapshot();
  assert.deepEqual(report.counters, []);
  assert.equal(report.latency_ms.rev_request.count, 2048);
  assert.equal(JSON.stringify(report).includes('sensitive merchant text'), false);
});
