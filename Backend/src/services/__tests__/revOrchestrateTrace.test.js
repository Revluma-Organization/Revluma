'use strict';

process.env.PYTHON_SERVICE_URL = 'http://python.test';
process.env.ML_INTERNAL_KEY = 'test-internal-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { orchestrate, investigate } = require('../mlService');

const correlationId = '11111111-1111-4111-8111-111111111111';
const executionId = '22222222-2222-4222-8222-222222222222';

function fakeAdapter(responder, capture) {
  return async (config) => {
    if (capture) capture(config);
    const response = responder(config);
    return { ...response, headers: {}, config };
  };
}

test('legacy orchestrate gateway preserves browser trace through body, headers and response metadata', async () => {
  const previousAdapter = axios.defaults.adapter;
  let request;
  axios.defaults.adapter = fakeAdapter(() => ({
    data: { success: true, response_type: 'chat',
      conversation_id: '33333333-3333-4333-8333-333333333333',
      message_id: '44444444-4444-4444-8444-444444444444' },
    status: 200, statusText: 'OK',
  }), (config) => { request = config; });
  try {
    const result = await orchestrate({
      organizationId: '55555555-5555-4555-8555-555555555555',
      userId: '66666666-6666-4666-8666-666666666666',
      message: 'Explain this image.',
      correlationId, executionId,
      imageBase64: 'aW1hZ2U=', imageMediaType: 'image/png',
    });
    const body = JSON.parse(request.data);
    assert.equal(request.headers['X-Correlation-ID'], correlationId);
    assert.equal(request.headers['X-Execution-ID'], executionId);
    assert.equal(body.correlation_id, correlationId);
    assert.equal(body.execution_id, executionId);
    assert.equal(body.context_payload.correlation_id, correlationId);
    assert.equal(body.context_payload.execution_id, executionId);
    assert.equal(result.data.correlation_id, correlationId);
    assert.equal(result.data.execution_id, executionId);
    assert.equal(result.data.execution_metadata.execution_id, executionId);
  } finally {
    axios.defaults.adapter = previousAdapter;
  }
});

test('investigation validation failure retains trace IDs through gateway and safe error contract', async () => {
  const previousAdapter = axios.defaults.adapter;
  let request;
  axios.defaults.adapter = fakeAdapter(() => ({
    data: { detail: {} }, status: 200, statusText: 'OK',
  }), (config) => { request = config; });
  try {
    const result = await investigate({
      organizationId: '55555555-5555-4555-8555-555555555555',
      userId: '66666666-6666-4666-8666-666666666666',
      message: 'What is Shopify?', correlationId, executionId,
    });
    const body = JSON.parse(request.data);
    assert.equal(request.headers['X-Correlation-ID'], correlationId);
    assert.equal(request.headers['X-Execution-ID'], executionId);
    assert.equal(body.execution_id, executionId);
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'INTELLIGENCE_INVALID_RESPONSE');
    assert.equal(result.error.failure.correlation_id, correlationId);
    assert.equal(result.error.failure.execution_id, executionId);
    assert.match(result.error.failure.stage, /response_validation/);
  } finally {
    axios.defaults.adapter = previousAdapter;
  }
});

test('unconfigured legacy gateway retains the same execution trace in its typed failure', async () => {
  const previousUrl = process.env.PYTHON_SERVICE_URL;
  const previousKey = process.env.ML_INTERNAL_KEY;
  const metrics = require('../revOperationalMetrics');
  metrics.resetForTests();
  process.env.PYTHON_SERVICE_URL = '';
  process.env.ML_INTERNAL_KEY = '';
  const servicePath = require.resolve('../mlService');
  delete require.cache[servicePath];
  const unconfiguredService = require('../mlService');
  try {
    const result = await unconfiguredService.orchestrate({
      organizationId: '55555555-5555-4555-8555-555555555555',
      userId: '66666666-6666-4666-8666-666666666666',
      message: 'Explain this image.', correlationId, executionId,
    });
    assert.equal(result.success, false);
    assert.equal(result.correlationId, correlationId);
    assert.equal(result.executionId, executionId);
    assert.equal(result.error.failure.category, 'provider_unavailable');
    assert.equal(result.error.failure.correlation_id, correlationId);
    assert.equal(result.error.failure.execution_id, executionId);
    const providerFailures = metrics.snapshot().counters.find(
      (entry) => entry.name === 'rev_provider_failures_total',
    );
    assert.equal(providerFailures.value, 1);
  } finally {
    process.env.PYTHON_SERVICE_URL = previousUrl;
    process.env.ML_INTERNAL_KEY = previousKey;
    metrics.resetForTests();
  }
});

test('legacy orchestrate maps typed provider exhaustion to a truthful retryable failure', async () => {
  const previousAdapter = axios.defaults.adapter;
  axios.defaults.adapter = fakeAdapter(() => ({
    data: { detail: {
      code: 'PROVIDER_FAILURE',
      retryable: true,
      message: 'Configured providers are temporarily unavailable.',
      failure: {
        contract_version: 'rev-failure-v1', category: 'provider_unavailable',
        stage: 'response_composition', retryable: true, retry_count: 1,
        fallback_used: true, correlation_id: correlationId, execution_id: executionId,
      },
    } },
    status: 503, statusText: 'Service Unavailable',
  }));
  try {
    const result = await orchestrate({
      organizationId: '55555555-5555-4555-8555-555555555555',
      userId: '66666666-6666-4666-8666-666666666666',
      message: 'Explain this image.', correlationId, executionId,
      imageBase64: 'aW1hZ2U=', imageMediaType: 'image/png',
    });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'PROVIDER_FAILURE');
    assert.equal(result.error.retryable, true);
    assert.equal(result.error.failure.retry_count, 1);
    assert.match(result.error.message, /try again shortly/i);
    assert.doesNotMatch(result.error.message, /private|prompt|key/i);
  } finally {
    axios.defaults.adapter = previousAdapter;
  }
});
