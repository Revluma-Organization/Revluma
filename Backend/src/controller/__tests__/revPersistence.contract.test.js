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
  const prisma = {
    $executeRaw: async (segments, ...values) => {
      statements.push({
        sql: segments.reduce((sql, part, index) => sql + part + (index < values.length ? ` $${index + 1} ` : ''), ''),
        values,
      });
    },
  };
  const context = {
    prisma,
    uuidv4: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
  });
  const messageId = await insertMessage({
    organizationId, conversationId, userId, sequenceNumber: 2, correlationId,
    content: responseContent, investigation: responseContent.investigation,
    agentsUsed: ['revenue_observations'], latencyMs: 37,
  });
  assert.equal(messageId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(statements.length, 1);
  const [{ sql, values }] = statements;
  assert.match(sql, /INSERT INTO conversation_messages/);
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

  const streamStart = source.indexOf('exports.chatStream = async');
  const streamEnd = source.indexOf('// ── GET /api/v1/rev/tools', streamStart);
  const streamHandler = source.slice(streamStart, streamEnd);
  assert.match(streamHandler, /if \(streamed\.success\)[\s\S]*?_insertRevMessage\(/,
    'successful streamed answers must be persisted before the final SSE frame is emitted');
});
