const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

// GREET-001 / MODE-PERSIST-001: the streamed+persisted Rev payload must carry
// response_mode and mode_reason, and must bound evidence lists. The controller
// cannot be required directly (heavy boot-time deps), so the real shipped
// source of the persistence mapper is evaluated in a sandbox — the test fails
// if the function is renamed or the fields are dropped again.
const source = fs.readFileSync(path.join(__dirname, '..', 'revController.js'), 'utf8');
const constMatch = source.match(/const MAX_PERSISTED_EVIDENCE_ITEMS = (\d+);/);
assert.ok(constMatch, 'MAX_PERSISTED_EVIDENCE_ITEMS constant must exist');
const start = source.indexOf('function _boundedResultForPersistence');
const end = source.indexOf('async function _insertRevMessage');
assert.ok(start > 0 && end > start, 'persistence mapper must exist in revController');
const fnSource = source.slice(start, end);
const context = { MAX_PERSISTED_EVIDENCE_ITEMS: Number(constMatch[1]), exports: {} };
vm.createContext(context);
const bounded = vm.runInContext(`${fnSource}; _boundedResultForPersistence;`, context);
const executionFields = vm.runInContext('_executionPersistenceFields;', context);

// A conversational turn keeps its mode all the way to the browser and the DB.
const conversational = bounded({
  response_type: 'chat',
  response_mode: 'conversational',
  mode_reason: 'the question needs no store investigation',
  text: 'Hey Chief, good to see you.',
  investigation: { steps: [], tools_used: [] },
  evidence: { items: [], limitations: [] },
});
assert.equal(conversational.response_mode, 'conversational');
assert.equal(conversational.mode_reason, 'the question needs no store investigation');
assert.equal(conversational.text, 'Hey Chief, good to see you.');

// Understanding/gate metadata travels with the payload (contract §16).
const withUnderstanding = bounded({
  response_mode: 'conversational',
  understanding: { intent: 'greeting', gate: 'conversational', source: 'fast_path' },
});
assert.deepEqual(withUnderstanding.understanding, {
  intent: 'greeting', gate: 'conversational', source: 'fast_path',
});
assert.equal(bounded({ text: 'x' }).understanding, null);

// A verified answer keeps its mode too.
const verified = bounded({ response_mode: 'quick_verification', text: 'Yes — connected.' });
assert.equal(verified.response_mode, 'quick_verification');

// Missing mode degrades to null, never to a guessed string.
assert.equal(bounded({ text: 'x' }).response_mode, null);

// Evidence lists stay bounded on their way into the database.
const many = Array.from({ length: 200 }, (_, i) => ({ id: `ev-${i}` }));
const capped = bounded({ evidence: { items: many, comparison_items: many } });
assert.ok(capped.evidence.items.length <= 60);
assert.ok(capped.evidence.comparison_items.length <= 60);

console.log('revPersistence contract test passed');

test('streamed assistant turn is persisted with tenant, trace and replayable response metadata', async () => {
  const insertStart = source.indexOf('async function _insertRevMessage');
  const insertEnd = source.indexOf('async function _persistFindingContext', insertStart);
  assert.ok(insertStart > 0 && insertEnd > insertStart, 'message persistence function must exist');
  const insertSource = source.slice(insertStart, insertEnd);
  const statements = [];
  const record = (segments, values) => statements.push({
    sql: segments.reduce((sql, part, index) => sql + part + (index < values.length ? ` $${index + 1} ` : ''), ''),
    values,
  });
  const tx = {
    $queryRaw: async (segments, ...values) => { record(segments, values); return []; },
    $executeRaw: async (segments, ...values) => { record(segments, values); return 1; },
  };
  const prisma = {
    $transaction: async (callback) => callback(tx),
  };
  const context = {
    prisma,
    revSequence: require('../../services/revSequence'),
    uuidv4: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    _executionPersistenceFields: executionFields,
    exports: {},
  };
  vm.createContext(context);
  const insertMessage = vm.runInContext(`${insertSource}; _insertRevMessage;`, context);
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const conversationId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';
  const correlationId = '44444444-4444-4444-8444-444444444444';
  const executionId = '55555555-5555-4555-8555-555555555555';
  const responseContent = bounded({
    success: true,
    correlation_id: correlationId,
    execution_id: executionId,
    execution_metadata: { correlation_id: correlationId, execution_id: executionId, outcome: 'success' },
    response_type: 'analysis',
    text: 'Recorded revenue was USD 42.00.',
    investigation: { intent: 'revenue_investigation', steps: [], tools_used: ['revenue_observations'] },
    evidence: { items: [{ id: 'evidence-1' }] },
    execution_trace: { provider: 'gemini', model: 'gemini-2.5-flash',
      token_usage: { input: 1200, output: 64, total: 1264 }, agent: { model_directed: true } },
  });
  const messageId = await insertMessage({
    organizationId, conversationId, userId, correlationId,
    content: responseContent, investigation: responseContent.investigation,
    agentsUsed: ['revenue_observations'], latencyMs: 37,
  });
  assert.equal(messageId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(statements.length, 2);
  assert.match(statements[0].sql, /pg_advisory_xact_lock/);
  assert.equal(statements[0].values.includes(conversationId), true);
  const [{ sql, values }] = statements.slice(1);
  assert.match(sql, /INSERT INTO conversation_messages/);
  assert.match(sql, /COALESCE\(MAX\(sequence_number\), 0\) \+ 1/,
    'the rev row allocates its number at write time, never from a precomputed value');
  assert.match(sql, /conversation_id, organization_id, user_id, role, content/);
  assert.equal(values.includes(conversationId), true);
  assert.equal(values.includes(organizationId), true);
  assert.equal(values.includes(userId), true);
  assert.equal(values.includes(correlationId), true);
  const persistedJson = values.find((value) => typeof value === 'string' && value.includes('execution_metadata'));
  assert.ok(persistedJson, 'stored content includes execution metadata for history recovery');
  const recovered = JSON.parse(persistedJson);
  assert.equal(recovered.execution_id, executionId);
  assert.equal(recovered.correlation_id, correlationId);
  assert.equal(recovered.execution_metadata.outcome, 'success');
  assert.equal(recovered.text, 'Recorded revenue was USD 42.00.');
  assert.match(sql, /model_name, model_provider/);
  assert.match(sql, /input_tokens, output_tokens, metadata/);
  assert.equal(values.includes('gemini'), true, 'actual provider is persisted');
  assert.equal(values.includes('gemini-2.5-flash'), true, 'actual model is persisted');
  assert.equal(values.includes(1200) && values.includes(64), true, 'actual token usage is persisted');
  assert.equal(recovered.execution_trace.model, 'gemini-2.5-flash');

  const streamStart = source.indexOf('exports.chatStream = async');
  const streamEnd = source.indexOf('// ── GET /api/v1/rev/tools', streamStart);
  const streamHandler = source.slice(streamStart, streamEnd);
  assert.match(streamHandler, /if \(streamed\.success\)[\s\S]*?_insertRevMessage\(/,
    'successful streamed answers must be persisted before the final SSE frame is emitted');
});

// AGENT-PERSIST-001: the actual provider/model/tokens of each answer travel
// with the payload (sanitized) and fill the dedicated columns; no hardcoded
// placeholder misrepresents the model used.
assert.ok(!source.includes("'investigation-pipeline', 'rev-model-gateway'"),
  'hardcoded model placeholders must not be persisted');
const fields = executionFields;
const traced = bounded({
  text: 'Recorded order value is 1250.00 USD.',
  execution_trace: {
    provider: 'anthropic', model: 'claude-sonnet-4-6', duration_ms: 8123.4,
    token_usage: { input: 2400, output: 120, total: 2520, scope: 'agent_runtime_only', note: 'free text dropped' },
    estimated_cost_usd: 0.009, retries: 0, fallback_used: false, cancelled: false,
    tool_selection: ['revenue_observations', 'DROP TABLE x; --'],
    citations: ['https://example.org/a', 'javascript:alert(1)'],
    prompt: 'must never persist', merchant_text: 'must never persist',
    agent: {
      model_directed: true, stop_reason: 'model_finished', iterations: 2,
      tool_calls: [{ tool: 'revenue_observations', status: 'completed', duration_ms: 41, arguments: { secret: 1 } }],
      model_turns: [{ iteration: 1, provider: 'anthropic', model: 'claude-sonnet-4-6', input_tokens: 900,
        output_tokens: 40, raw_error: 'secret provider detail' }],
    },
  },
  agent_answer: { source: 'model_agent', cited_evidence_ids: ['ev_1'], validation: { status: 'accepted', kind: 'answer' } },
});
assert.equal(traced.execution_trace.provider, 'anthropic');
assert.equal(traced.execution_trace.model, 'claude-sonnet-4-6');
assert.equal(traced.execution_trace.token_usage.input, 2400);
assert.deepEqual(traced.execution_trace.tool_selection, ['revenue_observations']);
assert.deepEqual(traced.execution_trace.citations, ['https://example.org/a']);
assert.equal(JSON.stringify(traced).includes('must never persist'), false);
assert.equal(JSON.stringify(traced).includes('secret provider detail'), false);
assert.equal(traced.execution_trace.agent.tool_calls[0].arguments, undefined);
assert.equal(traced.agent_answer.validation.status, 'accepted');
const columns = fields(traced);
assert.equal(columns.modelProvider, 'anthropic');
assert.equal(columns.modelName, 'claude-sonnet-4-6');
assert.equal(columns.inputTokens, 2400);
assert.equal(columns.outputTokens, 120);
assert.equal(JSON.parse(columns.metadata).execution_mode, 'model_agent');
// A deterministic answer records no provider/model instead of a placeholder.
const deterministic = fields(bounded({ text: 'x', execution_trace: { provider: null, model: null } }));
assert.equal(deterministic.modelProvider, null);
assert.equal(deterministic.modelName, null);
assert.equal(JSON.parse(deterministic.metadata).execution_mode, 'deterministic');
assert.equal(fields(bounded({ text: 'x' })).metadata, null);
console.log('revPersistence agent trace contract test passed');

// TELEMETRY-PERSIST-001: structured execution telemetry and knowledge-source
// coverage survive persistence as bounded tokens/numbers only. Free text,
// prompts, queries, merchant content and unknown keys are dropped.
const withTelemetry = bounded({
  text: 'Answer.',
  execution_trace: {
    provider: 'gemini', model: 'gemini-2.5-flash',
    investigation_id: '55555555-5555-4555-8555-555555555555',
    knowledge_sources: {
      manifest: { shopify_public_docs: 'available', revluma_product_docs: 'available', bad: 'has spaces here' },
      used: ['shopify_public_docs', 'how do I <script>'],
      revluma_docs_cited: 1, private_context_used: false, coverage_notes: 0, fallback_mode: null,
      query: 'merchant query must never persist',
    },
    telemetry: {
      telemetry_version: 'rev-execution-telemetry-v1',
      identifiers: { request_id: 'req-1', correlation_id: '44444444-4444-4444-8444-444444444444',
        organization_id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' },
      duration_ms: 812.6,
      objective: { intent: 'knowledge', request_class: 'shopify_public_documentation', question: 'free text question' },
      routing: { gate: 'knowledge', sources: ['shopify_public_docs'], followup: true, web_requested: false },
      stages: [{ stage: 'routing', duration_ms: 3.2, outcome: 'success', detail: 'free text detail' }],
      model_calls: [{ purpose: 'agent_turn', provider: 'gemini', model: 'gemini-2.5-flash', duration_ms: 400,
        input_tokens: 900, output_tokens: 80, attempt: 1, fallback_used: false, outcome: 'success',
        prompt: 'must never persist' }],
      token_usage: { input: 900, output: 80, total: 980, scope: 'all_model_calls', calls_with_usage: 1,
        successful_calls: 1 },
      tools: [{ tool: 'search_shopify_docs', status: 'ok', duration_ms: 210, reused: false, arguments: { q: 'x' } }],
      knowledge_sources: [{ source: 'shopify_public_docs', status: 'ok', result_count: 3,
        retrieval_mode: 'live_domain_restricted_search', duration_ms: 210, cache_hit: false }],
      cache: { shopify_docs_search: { miss: 1, store: 1, 'bad key with spaces': 2 } },
      retries: 0, fallback_used: false, failure_category: null, cancelled: false,
      final_status: 'completed', outcome: 'success',
    },
  },
});
// Objects come from the vm realm; compare plain JSON values.
const plain = (value) => JSON.parse(JSON.stringify(value));
const telemetry = plain(withTelemetry.execution_trace.telemetry);
assert.equal(withTelemetry.execution_trace.investigation_id, '55555555-5555-4555-8555-555555555555');
assert.equal(telemetry.telemetry_version, 'rev-execution-telemetry-v1');
assert.equal(telemetry.identifiers.correlation_id, '44444444-4444-4444-8444-444444444444');
assert.equal(telemetry.identifiers.email, undefined);
assert.equal(telemetry.identifiers.organization_id, undefined, 'tenant id already lives in its own column');
assert.equal(telemetry.duration_ms, 813);
assert.deepEqual(telemetry.objective, { intent: 'knowledge', request_class: 'shopify_public_documentation' });
assert.deepEqual(telemetry.routing.sources, ['shopify_public_docs']);
assert.equal(telemetry.routing.followup, true);
assert.deepEqual(telemetry.stages, [{ stage: 'routing', duration_ms: 3.2, outcome: 'success' }]);
assert.equal(telemetry.model_calls[0].purpose, 'agent_turn');
assert.equal(telemetry.model_calls[0].input_tokens, 900);
assert.equal(telemetry.model_calls[0].prompt, undefined);
assert.equal(telemetry.token_usage.total, 980);
assert.equal(telemetry.tools[0].arguments, undefined);
assert.equal(telemetry.knowledge_sources[0].result_count, 3);
assert.deepEqual(telemetry.cache, { shopify_docs_search: { miss: 1, store: 1 } });
assert.equal(telemetry.final_status, 'completed');
assert.deepEqual(plain(withTelemetry.execution_trace.knowledge_sources.manifest),
  { shopify_public_docs: 'available', revluma_product_docs: 'available' });
assert.deepEqual(plain(withTelemetry.execution_trace.knowledge_sources.used), ['shopify_public_docs']);
const persistedTelemetry = JSON.stringify(withTelemetry);
for (const secret of ['must never persist', 'owner@example.com', 'free text', '<script>']) {
  assert.equal(persistedTelemetry.includes(secret), false, `${secret} must not persist`);
}
// Absent telemetry degrades to null rather than an invented record.
assert.equal(bounded({ text: 'x', execution_trace: { provider: null } }).execution_trace.telemetry, null);
console.log('revPersistence telemetry contract test passed');

// FAILED-TURN-PERSIST-001 (live 2026-11-19): a PROVIDER_FAILURE row persisted
// no provider, model or failure detail. Failed turns now persist bounded,
// content-free diagnostics and telemetry; provider messages never persist.
const failedTurnContent = vm.runInContext('_failedTurnContent;', context);
const failed = plain(failedTurnContent({
  code: 'PROVIDER_FAILURE',
  message: 'Rev could not complete this response because the configured AI provider rejected the request.',
  failure: { category: 'invalid_request' },
  diagnostics: {
    contract_version: 'rev-provider-failure-diagnostics-v1', provider: 'gemini', model: 'gemini-3.6-flash',
    category: 'invalid_request', http_status: 400, provider_error_type: 'INVALID_ARGUMENT', attempts: 1,
    fallback_used: false, failed_call_purpose: 'answer_composition',
    provider_message: 'Function call is missing a thought_signature (merchant secret)',
    attempt_log: [{ provider: 'gemini', model: 'gemini-3.6-flash', outcome: 'failure', category: 'invalid_request',
      http_status: 400, provider_error_type: 'INVALID_ARGUMENT', duration_ms: 812.4, raw: 'drop me' }],
  },
  telemetry: {
    telemetry_version: 'rev-execution-telemetry-v1', final_status: 'failed', failure_category: 'invalid_request',
    model_calls: [
      { purpose: 'understanding', provider: 'gemini', model: 'gemini-3.5-flash-lite', outcome: 'success',
        input_tokens: 400, output_tokens: 50, attempt: 1 },
      { purpose: 'agent_turn', provider: 'gemini', model: 'gemini-3.6-flash', outcome: 'failure',
        failure_category: 'invalid_request', http_status: 400, provider_error_type: 'INVALID_ARGUMENT',
        attempt: 1, error_message: 'merchant secret' }],
    token_usage: { input: 400, output: 50, total: 450, scope: 'all_model_calls', calls_with_usage: 1, successful_calls: 1 },
  },
}));
assert.equal(failed.response_type, 'error');
assert.equal(failed.error, true);
assert.equal(failed.failure_diagnostics.provider, 'gemini');
assert.equal(failed.failure_diagnostics.model, 'gemini-3.6-flash');
assert.equal(failed.failure_diagnostics.http_status, 400);
assert.equal(failed.failure_diagnostics.provider_error_type, 'INVALID_ARGUMENT');
assert.equal(failed.failure_diagnostics.attempt_log[0].duration_ms, 812);
assert.equal(failed.execution_trace.final_status, 'failed');
assert.equal(failed.execution_trace.failure_category, 'invalid_request');
assert.equal(failed.execution_trace.telemetry.model_calls[1].http_status, 400);
assert.equal(failed.execution_trace.telemetry.model_calls[1].provider_error_type, 'INVALID_ARGUMENT');
for (const secret of ['merchant secret', 'thought_signature', 'drop me', 'rejected the request']) {
  assert.equal(JSON.stringify(failed).includes(secret), false, `${secret} must not persist`);
}
const failedColumns = executionFields(failed);
assert.equal(failedColumns.modelProvider, 'gemini');
assert.equal(failedColumns.modelName, 'gemini-3.6-flash');
assert.equal(failedColumns.inputTokens, 400);
const failedMeta = JSON.parse(failedColumns.metadata);
assert.equal(failedMeta.execution_mode, 'failed');
assert.equal(failedMeta.model_attribution, 'failed_attempt');
assert.equal(failedMeta.failure_category, 'invalid_request');
assert.equal(failedMeta.failure_diagnostics.http_status, 400);
// Without diagnostics (e.g. an older Python build) the legacy shape is kept.
assert.deepEqual(plain(failedTurnContent({ code: 'INTELLIGENCE_UNAVAILABLE' })),
  { response_type: 'error', error: true, read_only: true });
assert.match(source, /persistenceStage = 'failed_turn_write';\s*await _insertRevMessage\(\{[\s\S]{0,200}content: _failedTurnContent\(error\)/,
  'streamed provider failures must persist diagnostics');

// MODEL-ATTRIBUTION-001: a conversational answer composed by a model records
// that model (Python attributes it from telemetry), labelled by attribution.
const composed = bounded({ text: 'Hey!', execution_trace: { provider: 'gemini', model: 'gemini-3.5-flash-lite',
  model_attribution: 'answer_composition',
  token_usage: { input: 2376, output: 122, total: 2498, scope: 'all_model_calls' } } });
const composedColumns = executionFields(composed);
assert.equal(composedColumns.modelProvider, 'gemini');
assert.equal(composedColumns.modelName, 'gemini-3.5-flash-lite');
assert.equal(composedColumns.inputTokens, 2376);
const composedMeta = JSON.parse(composedColumns.metadata);
assert.equal(composedMeta.execution_mode, 'model_assisted');
assert.equal(composedMeta.model_attribution, 'answer_composition');
assert.equal(composedMeta.token_scope, 'all_model_calls');
console.log('revPersistence failed-turn and attribution contract test passed');

// SSE-HEARTBEAT-001: a long silent model turn keeps the stream alive with
// comment frames, and the heartbeat stops when the stream ends.
test('stream writer emits keepalive comments until the stream ends', async () => {
  const writerStart = source.indexOf('const SSE_HEARTBEAT_MS');
  const writerEnd = source.indexOf('function _validateChatPayload', writerStart);
  assert.ok(writerStart > 0 && writerEnd > writerStart, 'SSE writer must exist');
  const writes = [];
  const listeners = {};
  const res = {
    writableEnded: false,
    write: (chunk) => { writes.push(chunk); return true; },
    end: () => { res.writableEnded = true; },
    on: (name, fn) => { listeners[name] = fn; },
  };
  const writerContext = { process: { env: {} }, setInterval, clearInterval, exports: {},
    formatSseFrame: (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n` };
  vm.createContext(writerContext);
  const makeWriter = vm.runInContext(`${source.slice(writerStart, writerEnd)}; _sseWriter;`, writerContext);
  const writer = makeWriter(res, { heartbeatMs: 20 });
  writer.send('meta', { ok: true });
  await new Promise((resolve) => setTimeout(resolve, 75));
  const beats = writes.filter((chunk) => chunk === ': keepalive\n\n').length;
  assert.ok(beats >= 2, `expected keepalive comments, saw ${beats}`);
  writer.end();
  const afterEnd = writes.length;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(writes.length, afterEnd, 'no heartbeat after the stream ends');
  assert.equal(typeof listeners.close, 'function', 'heartbeat stops when the client disconnects');
});
