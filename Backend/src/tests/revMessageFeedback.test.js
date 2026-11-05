'use strict';
// Answer-feedback endpoint (ChatGPT-UI adoption) at the Rev API boundary, with
// the database mocked. Same discipline as revTenantIsolation.test.js: these run
// without Prisma Client, locally and in CI. Only the database module is
// replaced; the controller, the membership resolver and the SQL it composes
// are the real ones.

const test = require('node:test');
const assert = require('node:assert/strict');

const ORG_A   = '11111111-1111-4111-8111-111111111111';
const ORG_B   = '22222222-2222-4222-8222-222222222222';
const USER_A  = '33333333-3333-4333-8333-333333333333';
const CONV_A  = '44444444-4444-4444-8444-444444444444';
const REV_MSG = '66666666-6666-4666-8666-666666666666';
const USER_MSG = '77777777-7777-4777-8777-777777777777';
const ORG_B_MSG = '88888888-8888-4888-8888-888888888888';

const state = {
  memberships: [],
  conversations: new Map(),
  messages: new Map(),
  feedback: new Map(),
  queries: [],
  executes: [],
};

const prismaMock = {
  organization_members: {
    findMany: async () => state.memberships,
  },
  organizations: {
    findUnique: async () => ({ id: ORG_A, company_name: 'Merchant A' }),
  },
  $queryRaw: async (strings, ...values) => {
    const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
    state.queries.push({ sql, values });
    if (sql.includes('FROM conversations') && sql.includes('WHERE id =')) {
      const row = state.conversations.get(values[0]);
      return row ? [row] : [];
    }
    if (sql.includes('FROM conversation_messages') && sql.includes('WHERE id =')) {
      const row = state.messages.get(values[0]);
      return row ? [row] : [];
    }
    if (sql.includes('FROM conversation_messages')) {
      // Thread load: mirror the controller's LEFT JOIN by attaching the
      // requesting user's stored rating to each returned row.
      return [{
        id: REV_MSG, role: 'rev', content: { text: 'answer' }, sequence_number: 2,
        created_at: new Date('2026-11-05T12:00:00Z'),
        feedback_rating: state.feedback.get(REV_MSG) ?? null,
      }];
    }
    return [];
  },
  $executeRaw: async (strings, ...values) => {
    const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
    state.executes.push({ sql, values });
    if (sql.includes('INSERT INTO conversation_message_feedback')) {
      // values order: organization_id, message_id, user_id, rating
      state.feedback.set(values[1], values[3]);
      return 1;
    }
    if (sql.includes('DELETE FROM conversation_message_feedback')) {
      state.feedback.delete(values[0]);
      return 1;
    }
    return 0;
  },
};

// Install the fake database before the controller (or anything it imports) loads.
const databasePath = require.resolve('../configs/database');
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: { prisma: prismaMock, default: prismaMock },
};

const controller = require('../controller/revController');

function mockRequest({ user = { id: USER_A, tenantId: ORG_A }, params = {}, query = {}, body = {} } = {}) {
  return { user, params, query, body };
}

function mockResponse() {
  const response = {
    statusCode: null,
    payload: null,
    status(code) { response.statusCode = code; return response; },
    json(payload) { response.payload = payload; return response; },
    setHeader() {},
    write() {},
    end() {},
  };
  return response;
}

function captureNext() {
  const result = { error: undefined, called: false };
  result.next = (error) => { result.called = true; result.error = error; };
  return result;
}

function seed() {
  state.memberships = [{ id: 'm1', organization_id: ORG_A, role: 'owner', status: 'active' }];
  state.conversations = new Map([
    [CONV_A, { id: CONV_A, organization_id: ORG_A, user_id: USER_A, title: 'A', status: 'active' }],
  ]);
  state.messages = new Map([
    [REV_MSG, { id: REV_MSG, organization_id: ORG_A, role: 'rev' }],
    [USER_MSG, { id: USER_MSG, organization_id: ORG_A, role: 'user' }],
    [ORG_B_MSG, { id: ORG_B_MSG, organization_id: ORG_B, role: 'rev' }],
  ]);
  state.feedback = new Map();
  state.queries = [];
  state.executes = [];
}

test('records thumbs up as an idempotent upsert scoped to the authenticated org', async () => {
  seed();
  const res = mockResponse();
  const next = captureNext();

  await controller.submitMessageFeedback(
    mockRequest({ body: { message_id: REV_MSG, rating: 'up' } }), res, next.next);

  assert.equal(next.called, false);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { success: true, data: { message_id: REV_MSG, rating: 'up' } });
  const insert = state.executes.find(e => e.sql.includes('INSERT INTO conversation_message_feedback'));
  assert.ok(insert, 'an upsert must run');
  assert.match(insert.sql, /ON CONFLICT \(message_id, user_id\)/);
  assert.deepEqual(insert.values, [ORG_A, REV_MSG, USER_A, 'up']);
  assert.equal(state.feedback.get(REV_MSG), 'up');
});

test('switching to thumbs down overwrites the stored rating', async () => {
  seed();
  state.feedback.set(REV_MSG, 'up');
  const res = mockResponse();

  await controller.submitMessageFeedback(
    mockRequest({ body: { message_id: REV_MSG, rating: 'down' } }), res, captureNext().next);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.rating, 'down');
  assert.equal(state.feedback.get(REV_MSG), 'down');
});

test('rating null deletes the row — the table only holds an explicit current choice', async () => {
  seed();
  state.feedback.set(REV_MSG, 'up');
  const res = mockResponse();

  await controller.submitMessageFeedback(
    mockRequest({ body: { message_id: REV_MSG, rating: null } }), res, captureNext().next);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { success: true, data: { message_id: REV_MSG, rating: null } });
  assert.ok(state.executes.some(e => e.sql.includes('DELETE FROM conversation_message_feedback')));
  assert.equal(state.feedback.has(REV_MSG), false);
});

test('a merchant cannot rate another tenant message', async () => {
  seed();
  const res = mockResponse();
  const next = captureNext();

  await controller.submitMessageFeedback(
    mockRequest({ body: { message_id: ORG_B_MSG, rating: 'up' } }), res, next.next);

  assert.equal(next.called, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.error.code, 'FORBIDDEN');
  // Nothing may be written for a cross-tenant attempt.
  assert.equal(state.executes.length, 0);
});

test('user messages are not rateable', async () => {
  seed();
  const res = mockResponse();

  await controller.submitMessageFeedback(
    mockRequest({ body: { message_id: USER_MSG, rating: 'up' } }), res, captureNext().next);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error.code, 'NOT_RATEABLE');
  assert.equal(state.executes.length, 0);
});

test('an unknown message is a 404, not a silent success', async () => {
  seed();
  const res = mockResponse();

  await controller.submitMessageFeedback(
    mockRequest({ body: { message_id: '99999999-9999-4999-8999-999999999999', rating: 'up' } }),
    res, captureNext().next);

  assert.equal(res.statusCode, 404);
  assert.equal(res.payload.error.code, 'MESSAGE_NOT_FOUND');
});

test('invalid input is rejected before any database access', async () => {
  seed();
  for (const body of [
    { message_id: 'not-a-uuid', rating: 'up' },
    { message_id: REV_MSG, rating: 'great' },
    { message_id: REV_MSG },
    { rating: 'up' },
    { message_id: `${REV_MSG}; DROP TABLE conversation_message_feedback`, rating: 'up' },
  ]) {
    const res = mockResponse();
    const next = captureNext();
    await controller.submitMessageFeedback(mockRequest({ body }), res, next.next);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(res.payload.error.code, 'VALIDATION_ERROR', JSON.stringify(body));
    assert.equal(next.called, false);
  }
  assert.equal(state.queries.some(q => q.sql.includes('FROM conversation_messages')), false);
  assert.equal(state.executes.length, 0);
});

test('membership is still authoritative for feedback writes', async () => {
  seed();
  state.memberships = [];
  const res = mockResponse();
  const next = captureNext();

  await controller.submitMessageFeedback(
    mockRequest({ body: { message_id: REV_MSG, rating: 'up' } }), res, next.next);

  assert.equal(next.called, true);
  assert.equal(next.error.statusCode, 403);
  assert.equal(state.executes.length, 0);
});

test('the thread query carries the requesting merchant own rating back to the client', async () => {
  seed();
  state.feedback.set(REV_MSG, 'up');
  const res = mockResponse();
  const next = captureNext();

  await controller.getConversation(mockRequest({ params: { id: CONV_A } }), res, next.next);

  assert.equal(next.called, false);
  assert.equal(res.statusCode, 200);
  const threadQuery = state.queries.find(q => q.sql.includes('FROM conversation_messages') && q.sql.includes('LEFT JOIN'));
  assert.ok(threadQuery, 'thread load must LEFT JOIN the feedback table');
  assert.match(threadQuery.sql, /fb\.rating AS feedback_rating/);
  assert.equal(res.payload.data.messages[0].feedback_rating, 'up');
});
