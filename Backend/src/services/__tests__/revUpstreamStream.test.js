'use strict';

// Node → Python streaming gateway contract.
//
// These tests stub global fetch, so they exercise the real `streamInvestigation`
// implementation (SSE parsing, cancellation mapping, response validation)
// without a Python service or a database.

process.env.PYTHON_SERVICE_URL = 'http://python.test';
process.env.ML_INTERNAL_KEY = 'test-internal-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { streamInvestigation, ML_ERRORS } = require('../mlService');
const { createEvidence } = require('../revEvidenceContract');

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const evidence = createEvidence({
  organization_id: '11111111-1111-4111-8111-111111111111', store_id: '44444444-4444-4444-8444-444444444444',
  store_ids: ['44444444-4444-4444-8444-444444444444'], store_scope: 'store',
  evidence_type: 'calculation', domain: 'orders', classification: 'deterministic_calculation',
  metric: 'recorded_order_value', label: 'Recorded order value', value: '1571.90', unit: 'currency', currency: 'USD', status: 'available',
  definition: 'Sum of recorded non-cancelled order totals.',
  period: { start: '2026-10-01T00:00:00Z', end: '2026-10-08T00:00:00Z', timezone: 'UTC', semantics: '[start, end)' },
  source: { system: 'shopify', resource: 'orders', references: [{ source_id: 'order-1', resource: 'orders', sync_run_id: 'run-1' }] },
  retrieved_at: '2026-10-08T00:00:00Z', computed_at: '2026-10-08T00:00:00Z',
  coverage: { status: 'complete', complete: true, period_status: 'covered', source: 'orders', note: 'Complete.' },
  freshness: { state: 'fresh', as_of: '2026-10-08T00:00:00Z', age_seconds: 0, policy: '3600s', note: 'Fresh.' },
  provenance: { retrieval: 'calculation', transformation: 'Sum totals.', calculation_version: 'v2', lineage: ['order-1'], reproducible: true },
  measurement: { amount: '1571.90', currency: 'USD', interpretation: 'gross', tax: 'included', shipping: 'included', discounts: 'included', refunds: 'excluded', cancellations: 'excluded', numerator: null, denominator: null, formula: 'sum(total_price_set)' },
  confidence: { level: 'high', score: 0.95, basis: 'Complete.' }, limitations: [],
});

const finalPayload = {
  success: true,
  read_only: true,
  response_type: 'analysis',
  text: 'Recorded order value fell 12.0%.',
  investigation_outcome: {
    contract_version: 'rev-investigation-outcome-v1', outcome: 'success',
    tenant: { organization_id: '11111111-1111-4111-8111-111111111111', store_ids: [] },
    required_domains: [], available_domains: [], unavailable_domains: [],
    answerability: { can_answer: [], cannot_establish: [] }, retry: { eligible: false },
    history: {}, coverage: {}, diagnostic_reference: 'REV-0123456789ABCDEF',
  },
  investigation: {
    id: 'inv-1',
    intent: 'revenue',
    status: 'complete',
    period: { start: '2026-10-01T00:00:00Z', end: '2026-10-08T00:00:00Z' },
  },
  evidence: { schema_version: 'rev-evidence-v2', items: [evidence] },
  facts: [{ text: 'Recorded order value USD 1571.90', evidence_ids: [evidence.id] }],
  recommendations: [{ label: 'Review checkout', why: 'x', measure: 'y', executed: false, action_state: 'recommended', execution_status: 'not_requested', merchant_confirmation: 'not_confirmed', independent_verification: 'unverified' }],
};

function sseResponse(chunks, status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

const args = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  message: 'What happened to revenue last week?',
  conversationId: '33333333-3333-4333-8333-333333333333',
  correlationId: 'corr-1',
  contextPayload: { currency: 'USD' },
};

test('forwards plan/step/evidence frames and returns the validated final payload', async () => {
  const events = [];
  let request;
  global.fetch = async (url, init) => {
    request = { url, init };
    return sseResponse([
      frame('accepted', { investigation_id: 'inv-1' }),
      frame('plan', { intent: 'revenue', steps: [{ id: 's1', tool: 'orders_summary', label: 'Orders', status: 'pending' }] }),
      frame('step', { id: 's1', tool: 'orders_summary', label: 'Orders', status: 'completed' }),
      frame('final', finalPayload),
    ]);
  };

  const result = await streamInvestigation({
    ...args, onEvent: (event, payload) => events.push([event, payload]),
  });

  assert.equal(result.success, true);
  assert.equal(result.data.evidence.items[0].id, evidence.id);
  assert.deepEqual(events.map(([event]) => event), ['accepted', 'plan', 'step']);
  assert.equal(events[1][1].steps[0].tool, 'orders_summary');

  // Contract: authenticated, correlated, versioned, read-only request.
  assert.equal(request.url, 'http://python.test/rev/stream');
  assert.equal(request.init.headers['X-Internal-Key'], 'test-internal-key');
  assert.equal(request.init.headers['X-Correlation-ID'], 'corr-1');
  assert.equal(request.init.headers.Accept, 'text/event-stream');
  const body = JSON.parse(request.init.body);
  assert.equal(body.contract_version, '1.0');
  assert.equal(body.organization_id, args.organizationId);
  assert.equal(body.conversation_id, args.conversationId);
  assert.equal(body.message, args.message);
  assert.equal(body.execute, undefined);
});

test('a Python error frame surfaces its code and never a fabricated answer', async () => {
  global.fetch = async () => sseResponse([
    frame('plan', { intent: 'revenue', steps: [] }),
    frame('error', { code: 'CURRENCY_UNVERIFIED', message: 'Currency could not be verified.' }),
  ]);
  const result = await streamInvestigation({ ...args });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'CURRENCY_UNVERIFIED');
  assert.equal(result.data, undefined);
});

test('an invalid final payload is rejected rather than passed through', async () => {
  const broken = { ...finalPayload, read_only: false };
  global.fetch = async () => sseResponse([frame('final', broken)]);
  const result = await streamInvestigation({ ...args });
  assert.equal(result.success, false);
  assert.equal(result.error.code, ML_ERRORS.INVALID_RESPONSE);
});

test('a final payload that invents an executed action is rejected', async () => {
  const broken = {
    ...finalPayload,
    recommendations: [{ label: 'Change price', executed: true }],
  };
  global.fetch = async () => sseResponse([frame('final', broken)]);
  const result = await streamInvestigation({ ...args });
  assert.equal(result.success, false);
  assert.equal(result.error.code, ML_ERRORS.INVALID_RESPONSE);
});

test('authentication failures and upstream outages are classified, not exposed', async () => {
  global.fetch = async () => new Response('nope', { status: 401 });
  let result = await streamInvestigation({ ...args });
  assert.equal(result.error.code, ML_ERRORS.AUTH_FAILED);

  global.fetch = async () => new Response('boom', { status: 500 });
  result = await streamInvestigation({ ...args });
  assert.equal(result.error.code, ML_ERRORS.UNAVAILABLE);

  global.fetch = async () => { throw new TypeError('connect ECONNREFUSED'); };
  result = await streamInvestigation({ ...args });
  assert.equal(result.error.code, ML_ERRORS.UNAVAILABLE);
});

test('a merchant cancellation is reported as CANCELLED and stops the upstream read', async () => {
  const controller = new AbortController();
  const encoder = new TextEncoder();
  global.fetch = async (_url, init) => {
    const body = new ReadableStream({
      start(streamController) {
        streamController.enqueue(encoder.encode(frame('plan', { intent: 'revenue', steps: [] })));
        init.signal.addEventListener('abort', () => {
          try { streamController.error(new DOMException('Aborted', 'AbortError')); } catch { /* noop */ }
        });
      },
    });
    return new Response(body, { status: 200 });
  };

  const promise = streamInvestigation({ ...args, signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort();

  const result = await promise;
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'CANCELLED');
});

test('an unconfigured deployment fails closed without calling Python', async () => {
  const modulePath = require.resolve('../mlService');
  const saved = {
    url: process.env.PYTHON_SERVICE_URL,
    key: process.env.ML_INTERNAL_KEY,
  };
  let called = false;
  global.fetch = async () => { called = true; throw new Error('should not run'); };
  process.env.PYTHON_SERVICE_URL = '';
  process.env.ML_INTERNAL_KEY = '';
  delete require.cache[modulePath];
  try {
    const fresh = require('../mlService');
    const result = await fresh.streamInvestigation({ ...args });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'INTELLIGENCE_NOT_CONFIGURED');
    assert.equal(called, false);
  } finally {
    process.env.PYTHON_SERVICE_URL = saved.url;
    process.env.ML_INTERNAL_KEY = saved.key;
    delete require.cache[modulePath];
    require('../mlService');
  }
});
