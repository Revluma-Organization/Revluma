const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_QUESTION_LENGTH, REQUEST_CONVERSATION_NAMESPACE, validateSubmission,
  findAcceptedSubmission, acceptSubmission, replayBody,
} = require('../revSubmission');
const { v4: uuidv4, v5: uuidv5 } = require('uuid');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';
const REQ = '44444444-4444-4444-8444-444444444444';
const accepted = (overrides = {}) => ({
  conversation_id: CONV, user_content: { text: 'Revenue?' }, rev_id: 'rev-1',
  rev_content: { text: 'Orders fell.', response_type: 'analysis', read_only: true },
  has_error: false, error_code: null, error_message: null, ...overrides,
});

function rejects(body, code) {
  assert.throws(() => validateSubmission(body), error => error.code === code);
}

function transactionCapable(prisma) {
  prisma.$transaction = callback => callback(prisma);
  return prisma;
}

test('shared question bound remains 2000 characters', () => {
  assert.equal(MAX_QUESTION_LENGTH, 2000);
});

for (const [name, value, code] of [
  ['missing body', undefined, 'VALIDATION_ERROR'],
  ['missing message', {}, 'VALIDATION_ERROR'],
  ['null message', { message: null }, 'VALIDATION_ERROR'],
  ['numeric message', { message: 42 }, 'VALIDATION_ERROR'],
  ['array message', { message: ['Revenue?'] }, 'VALIDATION_ERROR'],
  ['object message', { message: { text: 'Revenue?' } }, 'VALIDATION_ERROR'],
  ['empty message', { message: '' }, 'VALIDATION_ERROR'],
  ['spaces only', { message: '   ' }, 'VALIDATION_ERROR'],
  ['tabs only', { message: '\t\t' }, 'VALIDATION_ERROR'],
  ['newlines only', { message: '\n\r\n' }, 'VALIDATION_ERROR'],
  ['NUL only', { message: '\0\0' }, 'VALIDATION_ERROR'],
  ['oversize ASCII', { message: 'a'.repeat(2001) }, 'MESSAGE_TOO_LONG'],
  ['oversize Unicode', { message: '₦'.repeat(2001) }, 'MESSAGE_TOO_LONG'],
  ['oversize after trim', { message: ` ${'a'.repeat(2001)} ` }, 'MESSAGE_TOO_LONG'],
  ['execute true', { message: 'Change prices', execute: true }, 'READ_ONLY'],
  ['invalid request id', { message: 'Revenue?', request_id: 'request-1' }, 'INVALID_REQUEST_ID'],
  ['empty request id', { message: 'Revenue?', request_id: '' }, 'INVALID_REQUEST_ID'],
  ['SQL-shaped request id', { message: 'Revenue?', request_id: "'; DROP TABLE users;--" }, 'INVALID_REQUEST_ID'],
  ['request id object', { message: 'Revenue?', request_id: {} }, 'INVALID_REQUEST_ID'],
  ['cross-version request id', { message: 'Revenue?', request_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }, 'INVALID_REQUEST_ID'],
]) test(`rejects ${name} before persistence`, () => rejects(value, code));

for (const [name, body, expected] of [
  ['one character', { message: 'x' }, 'x'],
  ['exact bound', { message: 'a'.repeat(2000) }, 'a'.repeat(2000)],
  ['surrounding whitespace', { message: '  Revenue?  ' }, 'Revenue?'],
  ['Unicode currency', { message: 'Why did ₦ revenue fall?' }, 'Why did ₦ revenue fall?'],
  ['multiline', { message: 'Compare revenue\nwith orders' }, 'Compare revenue\nwith orders'],
  ['NUL inside question', { message: 'Rev\0enue?' }, 'Revenue?'],
  ['execute false', { message: 'Revenue?', execute: false }, 'Revenue?'],
  ['execute string is not executable', { message: 'Revenue?', execute: 'true' }, 'Revenue?'],
  ['normalises uppercase request UUID', { message: 'Revenue?', request_id: REQ.toUpperCase() }, 'Revenue?'],
  ['does not alter percent signs', { message: 'Revenue fell 12.50%' }, 'Revenue fell 12.50%'],
]) test(`accepts valid ${name}`, () => {
  const result = validateSubmission(body);
  assert.equal(result.message, expected);
  assert.match(result.requestId, /^[0-9a-f-]{36}$/);
  if (body.request_id) assert.equal(result.requestId, REQ);
});

test('generates a fresh UUID for legacy clients without request_id', () => {
  const first = validateSubmission({ message: 'Revenue?' });
  const second = validateSubmission({ message: 'Revenue?' });
  assert.notEqual(first.requestId, second.requestId);
});

test('accepted lookup is tenant and request scoped and joins only the same Rev turn', async () => {
  let captured;
  const prisma = { $queryRaw: (strings, ...values) => { captured = { sql: strings.join('?'), values }; return [accepted()]; } };
  const row = await findAcceptedSubmission(prisma, ORG, REQ);
  assert.equal(row.conversation_id, CONV);
  assert.equal(captured.values[0], ORG);
  assert.equal(captured.values[1], REQ);
  assert.match(captured.sql, /r\.correlation_id = u\.correlation_id/);
  assert.match(captured.sql, /u\.organization_id = \?::uuid/);
});

test('first new-conversation acceptance creates deterministic conversation and one user row', async () => {
  const calls = [];
  const prisma = {
    $queryRaw: () => [],
    $executeRaw: (strings, ...values) => { calls.push({ sql: strings.join('?'), values }); return 1; },
  };
  const result = await acceptSubmission({ prisma: transactionCapable(prisma), organizationId: ORG, userId: USER, message: 'Revenue?', requestId: REQ });
  assert.equal(result.duplicate, false);
  assert.equal(result.conversationId, uuidv5(REQ, REQUEST_CONVERSATION_NAMESPACE));
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(calls[1].sql, /ON CONFLICT \(organization_id, conversation_id, role, correlation_id\) DO NOTHING/);
  assert.equal(calls[1].values.includes(REQ), true);
});

test('failed first-message insertion rolls back newly created conversation atomically', async () => {
  const committed = [];
  let transactionCalls = 0;
  const prisma = {
    $queryRaw: () => [],
    $transaction: async callback => {
      transactionCalls += 1;
      const staged = [];
      const tx = {
        $queryRaw: prisma.$queryRaw,
        $executeRaw: async strings => {
          const sql = strings.join('?');
          if (sql.includes('INSERT INTO conversation_messages')) throw new Error('message insert failed');
          staged.push(sql);
          return 1;
        },
      };
      try {
        const result = await callback(tx);
        committed.push(...staged);
        return result;
      } catch (error) {
        staged.length = 0;
        throw error;
      }
    },
  };

  await assert.rejects(acceptSubmission({ prisma, organizationId: ORG, userId: USER, message: 'Revenue?', requestId: REQ }), /message insert failed/);
  assert.equal(transactionCalls, 1);
  assert.deepEqual(committed, [], 'the new conversation write must not commit without its accepted user message');
});

test('existing-conversation acceptance verifies ownership before inserting', async () => {
  const calls = [];
  const prisma = {
    $queryRaw: (strings) => { const sql = strings.join('?'); calls.push(sql); return sql.includes('FROM conversations') ? [{ organization_id: ORG }] : []; },
    $executeRaw: () => 1,
  };
  const result = await acceptSubmission({ prisma: transactionCapable(prisma), organizationId: ORG, userId: USER, message: 'Revenue?', requestId: REQ, requestedConversationId: CONV });
  assert.equal(result.conversationId, CONV);
  assert.match(calls[1], /SELECT organization_id FROM conversations/);
});

for (const [name, row, code, status] of [
  ['unknown conversation', null, 'CONVERSATION_NOT_FOUND', 404],
  ['foreign conversation', { organization_id: USER }, 'FORBIDDEN', 403],
]) test(`rejects ${name}`, async () => {
  const prisma = { $queryRaw: (strings) => strings.join('?').includes('FROM conversations') ? (row ? [row] : []) : [], $executeRaw: () => { throw new Error('must not persist'); } };
  await assert.rejects(acceptSubmission({ prisma: transactionCapable(prisma), organizationId: ORG, userId: USER, message: 'Revenue?', requestId: REQ, requestedConversationId: CONV }), error => error.code === code && error.statusCode === status);
});

for (const [name, row, requested] of [
  ['different question', accepted({ user_content: { text: 'Orders?' } }), null],
  ['different JSON question', accepted({ user_content: JSON.stringify({ text: 'Orders?' }) }), null],
  ['different conversation', accepted(), uuidv4()],
]) test(`rejects request-id reuse with ${name}`, async () => {
  const prisma = { $queryRaw: () => [row], $executeRaw: () => { throw new Error('must not persist'); } };
  await assert.rejects(acceptSubmission({ prisma, organizationId: ORG, userId: USER, message: 'Revenue?', requestId: REQ, requestedConversationId: requested }), error => error.code === 'REQUEST_ID_REUSED' && error.statusCode === 409);
});

test('replays the original accepted question without model invocation', async () => {
  const prisma = { $queryRaw: () => [accepted({ user_content: JSON.stringify({ text: 'Revenue?' }) })], $executeRaw: () => { throw new Error('must not persist'); } };
  const result = await acceptSubmission({ prisma, organizationId: ORG, userId: USER, message: 'Revenue?', requestId: REQ });
  assert.equal(result.duplicate, true);
  assert.equal(replayBody(result.accepted, REQ).completed, true);
});

test('concurrent insert loser replays winner and does not start another investigation', async () => {
  let inserts = 0;
  let acceptedLookups = 0;
  const prisma = {
    $queryRaw: (strings) => { const sql = strings.join('?'); if (sql.includes('SELECT organization_id FROM conversations')) return [{ organization_id: ORG }]; acceptedLookups += 1; return acceptedLookups === 1 ? [] : [accepted()]; },
    $executeRaw: () => { inserts += 1; return 0; },
  };
  const result = await acceptSubmission({ prisma: transactionCapable(prisma), organizationId: ORG, userId: USER, message: 'Revenue?', requestId: REQ, requestedConversationId: CONV });
  assert.equal(result.duplicate, true);
  assert.equal(inserts, 1);
});

test('in-progress replay exposes accepted but not completed', () => {
  const result = replayBody(accepted({ rev_id: null, rev_content: null, has_error: false }), REQ);
  assert.equal(result.completed, false);
  assert.equal(result.failed, false);
  assert.equal(result.conversationId, CONV);
});

for (const [name, row, failed, code] of [
  ['success', accepted(), false, null],
  ['model failure', accepted({ has_error: true, error_code: 'INTELLIGENCE_UNAVAILABLE', error_message: 'Try again.' }), true, 'INTELLIGENCE_UNAVAILABLE'],
  ['merchant cancellation', accepted({ has_error: true, error_code: 'CANCELLED', error_message: 'Stopped.' }), true, 'CANCELLED'],
  ['legacy error with no code', accepted({ has_error: true }), true, null],
]) test(`replay preserves ${name} outcome`, () => {
  const result = replayBody(row, REQ);
  assert.equal(result.failed, failed);
  assert.equal(result.errorCode, code);
});
