'use strict';
// C2 tuple-cursor paging at the Rev API boundary, with the database mocked.
//
// Same discipline as revTenantIsolation.test.js: only the database module is
// replaced; the controller, the cursor parser and the SQL it composes are the
// real ones. These run without Prisma Client, locally and in CI.

const test = require('node:test');
const assert = require('node:assert/strict');

const ORG_A = '11111111-1111-4111-8111-111111111111';
const USER_A = '33333333-3333-4333-8333-333333333333';
const CONV_A = '44444444-4444-4444-8444-444444444444';
const CURSOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const state = {
  memberships: [],
  conversations: new Map(),
  queries: [],
  messageRows: [],
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
    if (sql.includes('FROM conversation_messages')) return state.messageRows;
    return [];
  },
  $executeRaw: async () => 0,
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

function seed() {
  state.memberships = [{ id: 'm1', organization_id: ORG_A, role: 'owner', status: 'active' }];
  state.conversations = new Map([
    [CONV_A, { id: CONV_A, organization_id: ORG_A, user_id: USER_A, title: 'A', status: 'active' }],
  ]);
  state.queries = [];
  state.messageRows = [];
}

const row = (sequence_number, id) => ({
  id, role: 'user', content: { text: `message ${sequence_number}` }, sequence_number,
  agent_name: null, confidence_score: null, has_error: false, error_code: null,
  error_message: null, created_at: new Date('2026-11-05T12:00:00Z'), client_context: null,
  feedback_rating: null,
});

function messageQuery() {
  const found = state.queries.find((query) => query.sql.includes('FROM conversation_messages'));
  assert.ok(found, 'the message query must run');
  return found;
}

test('the first page orders deterministically and reports no older page on a short page', async () => {
  seed();
  state.messageRows = [row(1, 'id-1'), row(2, 'id-2')];
  const res = mockResponse();
  let nextError;
  await controller.getConversation(
    mockRequest({ params: { id: CONV_A }, query: {} }), res, (error) => { nextError = error; },
  );
  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 200);
  const query = messageQuery();
  assert.doesNotMatch(query.sql, /sequence_number </);
  assert.match(query.sql, /ORDER BY cm\.sequence_number DESC, cm\.id DESC/);
  assert.match(query.sql, /ORDER BY sequence_number ASC, id ASC/);
  assert.deepEqual(res.payload.data.pagination, {
    limit: 50, before: null, before_id: null, next_before: null, next_before_id: null,
  });
});

test('a full page cursors the next older page from its oldest row', async () => {
  seed();
  state.messageRows = [row(5, 'oldest'), row(6, 'newest')];
  const res = mockResponse();
  let nextError;
  await controller.getConversation(
    mockRequest({ params: { id: CONV_A }, query: { limit: '2' } }), res, (error) => { nextError = error; },
  );
  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.data.pagination, {
    limit: 2, before: null, before_id: null, next_before: 5, next_before_id: 'oldest',
  });
});

test('a legacy before cursor keeps its exact predicate and gains tie-break order', async () => {
  seed();
  state.messageRows = [row(6, 'id-6')];
  const res = mockResponse();
  let nextError;
  await controller.getConversation(
    mockRequest({ params: { id: CONV_A }, query: { before: '7' } }), res, (error) => { nextError = error; },
  );
  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 200);
  const query = messageQuery();
  assert.match(query.sql, /cm\.sequence_number < \?/);
  assert.doesNotMatch(query.sql, /\(cm\.sequence_number, cm\.id\) </);
  assert.match(query.sql, /ORDER BY cm\.sequence_number DESC, cm\.id DESC/);
  assert.equal(query.values.includes(7), true);
  assert.equal(res.payload.data.pagination.before, 7);
  assert.equal(res.payload.data.pagination.before_id, null);
});

test('before with before_id selects the tuple predicate over the total order', async () => {
  seed();
  state.messageRows = [row(6, 'id-6')];
  const res = mockResponse();
  let nextError;
  await controller.getConversation(
    mockRequest({ params: { id: CONV_A }, query: { before: '7', before_id: CURSOR_ID } }),
    res, (error) => { nextError = error; },
  );
  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 200);
  const query = messageQuery();
  assert.match(query.sql, /\(cm\.sequence_number, cm\.id\) < \(\?, \?::uuid\)/);
  assert.equal(query.values.includes(7), true);
  assert.equal(query.values.includes(CURSOR_ID), true);
  assert.match(query.sql, /cv\.organization_id/);
  assert.equal(query.values.includes(ORG_A), true);
  assert.equal(res.payload.data.pagination.before, 7);
  assert.equal(res.payload.data.pagination.before_id, CURSOR_ID);
});

test('a malformed before_id with a present before is a 400 before any message query', async () => {
  seed();
  const res = mockResponse();
  let nextCalled = false;
  await controller.getConversation(
    mockRequest({ params: { id: CONV_A }, query: { before: '7', before_id: 'not-a-uuid' } }),
    res, () => { nextCalled = true; },
  );
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error.code, 'VALIDATION_ERROR');
  assert.equal(state.queries.some((query) => query.sql.includes('FROM conversation_messages')), false);
});

test('before_id without before is ignored and serves the first page', async () => {
  seed();
  state.messageRows = [row(1, 'id-1')];
  const res = mockResponse();
  let nextError;
  await controller.getConversation(
    mockRequest({ params: { id: CONV_A }, query: { before_id: CURSOR_ID } }),
    res, (error) => { nextError = error; },
  );
  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 200);
  const query = messageQuery();
  assert.doesNotMatch(query.sql, /\(cm\.sequence_number, cm\.id\) </);
  assert.equal(res.payload.data.pagination.before, null);
  assert.equal(res.payload.data.pagination.before_id, null);
});
