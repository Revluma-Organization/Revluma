'use strict';

// Conversational intelligence upgrade §16/§18: the full turn lifecycle —
// Python SSE frames -> Node streaming gateway -> persistence mapper -> the
// browser `final` frame — must carry understanding metadata, response mode
// and tool-execution information intact, and a conversational turn must
// never emit investigation progress frames the frontend could render as a
// timeline. Uses the real `streamInvestigation` (stubbed fetch) and the real
// shipped `_boundedResultForPersistence` source, so a regression in either
// layer fails here.

process.env.PYTHON_SERVICE_URL = 'http://python.test';
process.env.ML_INTERNAL_KEY = 'test-internal-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { streamInvestigation } = require('../mlService');

const frames = (...list) => list.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');

function sseResponse(body) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode(body)); controller.close(); },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

// Real persistence mapper from the shipped controller source (same sandbox
// pattern as revPersistence.contract.test.js).
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'controller', 'revController.js'), 'utf8');
const constMatch = source.match(/const MAX_PERSISTED_EVIDENCE_ITEMS = (\d+);/);
assert.ok(constMatch, 'MAX_PERSISTED_EVIDENCE_ITEMS constant must exist');
const start = source.indexOf('function _boundedResultForPersistence');
const end = source.indexOf('async function _insertRevMessage');
assert.ok(start > 0 && end > start, 'persistence mapper must exist in revController');
const context = { MAX_PERSISTED_EVIDENCE_ITEMS: Number(constMatch[1]), exports: {} };
vm.createContext(context);
const bounded = vm.runInContext(`${source.slice(start, end)}; _boundedResultForPersistence;`, context);

const period = { start: '2026-10-28T00:00:00Z', end: '2026-11-04T00:00:00Z' };

const conversationalFinal = {
  contract_version: 'rev-investigation-v1',
  success: true,
  read_only: true,
  response_type: 'chat',
  text: 'Doing well, thank you for asking! Anything on your mind about the store?',
  response: null,
  investigation: {
    id: 'inv-conv-1', question: 'How are you doing?', intent: 'social',
    label: 'Social', status: 'complete', period, segment: null,
    steps: [], follow_ups: [], tools_used: [], context_used: {},
  },
  evidence: { items: [], limitations: [] },
  facts: [], hypotheses: [], unknowns: [], recommendations: [],
  response_mode: 'conversational',
  mode_reason: 'the answer uses no store investigation',
  understanding: { intent: 'social', gate: 'conversational', source: 'fast_path', confidence: 1.0 },
};

const investigationFinal = {
  contract_version: 'rev-investigation-v1',
  success: true,
  read_only: true,
  response_type: 'analysis',
  text: 'Recorded order value fell 12.0% against the prior period.',
  investigation: {
    id: 'inv-1', question: 'How is revenue this week?', intent: 'revenue',
    label: 'Revenue', status: 'complete', period,
    steps: [{ id: 's1', tool: 'revenue_observations', label: 'Revenue', status: 'completed' }],
    follow_ups: [], tools_used: ['revenue_observations'], context_used: {},
  },
  evidence: {
    items: [{
      id: 'ev-1', metric: 'recorded_order_value', label: 'Recorded order value',
      value: '1571.90', unit: 'currency', currency: 'USD', status: 'available',
      period, source: 'orders', definition: 'Sum of recorded non-cancelled order totals.',
    }],
  },
  facts: [{ text: 'Recorded order value USD 1571.90', evidence_ids: ['ev-1'] }],
  recommendations: [{ label: 'Review checkout', why: 'x', measure: 'y', executed: false }],
  response_mode: 'investigation',
  mode_reason: 'the answer combines several store checks',
  understanding: { intent: 'revenue', gate: 'tools', source: 'fast_path', confidence: 1.0 },
};

const args = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  conversationId: '33333333-3333-4333-8333-333333333333',
  correlationId: 'corr-lifecycle',
  contextPayload: {},
};

test('a conversational turn streams no investigation progress and keeps its contract metadata end to end', async () => {
  const events = [];
  global.fetch = async () => sseResponse(frames(
    ['meta', { conversation_id: args.conversationId }],
    ['final', conversationalFinal],
  ));

  const result = await streamInvestigation({
    ...args, message: 'How are you doing?',
    onEvent: (event, payload) => events.push([event, payload]),
  });

  assert.equal(result.success, true);
  // §11: no plan/step/evidence frames exist for conversation — the frontend
  // timeline has nothing to render and cannot fabricate progress.
  assert.deepEqual(events.filter(([event]) => ['plan', 'step', 'evidence'].includes(event)), []);

  // Persistence: mode + understanding survive the bounded mapper.
  const content = bounded(result.data);
  assert.equal(content.response_mode, 'conversational');
  assert.equal(content.mode_reason, 'the answer uses no store investigation');
  assert.deepEqual(content.understanding, conversationalFinal.understanding);
  assert.equal(content.response_type, 'chat');
  // Tool-execution truth: a conversational turn persisted zero tools/steps.
  assert.deepEqual(content.investigation.tools_used, []);
  assert.deepEqual(content.investigation.steps, []);

  // Browser frame: the controller composes `final` as { success, ids, ...content }.
  const browserFrame = {
    success: true, conversation_id: args.conversationId, message_id: 'msg-1',
    read_only: true, ...content,
  };
  assert.equal(browserFrame.response_mode, 'conversational');
  assert.deepEqual(browserFrame.understanding, conversationalFinal.understanding);
});

test('an investigation turn forwards real progress frames and preserves gate + tool metadata', async () => {
  const events = [];
  global.fetch = async () => sseResponse(frames(
    ['meta', { conversation_id: args.conversationId }],
    ['accepted', { investigation_id: 'inv-1' }],
    ['plan', { intent: 'revenue', label: 'Revenue', steps: investigationFinal.investigation.steps.map(s => ({ ...s, status: 'pending' })), period }],
    ['step', { ...investigationFinal.investigation.steps[0] }],
    ['evidence', investigationFinal.evidence],
    ['final', investigationFinal],
  ));

  const result = await streamInvestigation({
    ...args, message: 'How is revenue this week?',
    onEvent: (event, payload) => events.push([event, payload]),
  });

  assert.equal(result.success, true);
  assert.deepEqual(
    events.filter(([event]) => ['plan', 'step', 'evidence'].includes(event)).map(([event]) => event),
    ['plan', 'step', 'evidence'],
  );

  const content = bounded(result.data);
  assert.equal(content.response_mode, 'investigation');
  assert.deepEqual(content.understanding, investigationFinal.understanding);
  assert.deepEqual(content.investigation.tools_used, ['revenue_observations']);
  assert.equal(content.investigation.steps.length, 1);
  // The controller derives agentsUsed from the same tool list.
  assert.deepEqual(result.data.investigation?.tools_used || [], ['revenue_observations']);
});
