'use strict';
// Tenant isolation at the Rev Intelligence API boundary, with the database mocked.
//
// These run without Prisma Client, so they execute both locally and in CI. The
// only thing replaced is the database module: the controller, the membership
// resolver and the SQL it composes are the real ones.

const test = require('node:test');
const assert = require('node:assert/strict');

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '33333333-3333-4333-8333-333333333333';
const CONV_A = '44444444-4444-4444-8444-444444444444';
const CONV_B = '55555555-5555-4555-8555-555555555555';

const state = { memberships: [], conversations: new Map(), queries: [] };

const prismaMock = {
  organization_members: {
    findMany: async () => state.memberships,
  },
  organizations: {
    findUnique: async () => ({ id: ORG_A, company_name: 'Merchant A' }),
  },
  $queryRaw: async (strings, ...values) => {
    state.queries.push({ sql: Array.isArray(strings) ? strings.join('?') : String(strings), values });
    const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
    if (sql.includes('FROM conversations') && sql.includes('WHERE id =')) {
      const row = state.conversations.get(values[0]);
      return row ? [row] : [];
    }
    if (sql.includes('FROM conversation_messages')) {
      return [{ id: 'm1', role: 'user', content: 'hello', sequence_number: 1 }];
    }
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

function captureNext() {
  const result = { error: undefined, called: false };
  result.next = (error) => { result.called = true; result.error = error; };
  return result;
}

function seedMerchantA() {
  state.memberships = [{ id: 'm1', organization_id: ORG_A, role: 'owner', status: 'active' }];
  state.conversations = new Map([
    [CONV_A, { id: CONV_A, organization_id: ORG_A, user_id: USER_A, title: 'A', status: 'active' }],
    [CONV_B, { id: CONV_B, organization_id: ORG_B, user_id: 'someone-else', title: 'B', status: 'active' }],
  ]);
  state.queries = [];
}

test('a merchant cannot read another tenant conversation', async () => {
  seedMerchantA();
  const res = mockResponse();
  const next = captureNext();

  await controller.getConversation(mockRequest({ params: { id: CONV_B } }), res, next.next);

  assert.equal(res.statusCode, null, 'no response body may be written for a cross-tenant request');
  assert.equal(next.called, true);
  assert.equal(next.error.statusCode, 403);
  assert.match(next.error.message, /not authorised/i);
  // The message query must never have run for another tenant's conversation.
  assert.equal(state.queries.some((query) => query.sql.includes('FROM conversation_messages')), false);
});

test('a merchant can read their own conversation and the message query is org-scoped', async () => {
  seedMerchantA();
  const res = mockResponse();
  const next = captureNext();

  await controller.getConversation(mockRequest({ params: { id: CONV_A } }), res, next.next);

  assert.equal(next.called, false);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.data.conversation.id, CONV_A);
  const messageQuery = state.queries.find((query) => query.sql.includes('FROM conversation_messages'));
  assert.ok(messageQuery, 'messages query should run');
  assert.match(messageQuery.sql, /cv\.organization_id/);
  assert.ok(messageQuery.values.includes(ORG_A));
});

test('a user without an active membership is rejected before any conversation lookup', async () => {
  seedMerchantA();
  state.memberships = [];
  const res = mockResponse();
  const next = captureNext();

  await controller.getConversation(mockRequest({ params: { id: CONV_A } }), res, next.next);

  assert.equal(next.called, true);
  assert.equal(next.error.statusCode, 403);
  assert.equal(state.queries.some((query) => query.sql.includes('FROM conversations')), false);
});

test('selecting an organisation the user does not belong to is rejected', async () => {
  seedMerchantA();
  const res = mockResponse();
  const next = captureNext();

  await controller.getConversation(
    mockRequest({ user: { id: USER_A, tenantId: ORG_B }, params: { id: CONV_B } }),
    res,
    next.next,
  );

  assert.equal(next.called, true);
  assert.equal(next.error.statusCode, 403);
  assert.equal(state.queries.length, 0);
});

test('the conversation list is always filtered by the authenticated organisation', async () => {
  seedMerchantA();
  const res = mockResponse();
  const next = captureNext();

  await controller.getConversations(mockRequest({ query: {} }), res, next.next);

  const listQuery = state.queries.find((query) => query.sql.includes('FROM conversations'));
  assert.ok(listQuery);
  assert.match(listQuery.sql, /organization_id/);
  assert.ok(listQuery.values.includes(ORG_A));
  assert.equal(listQuery.values.includes(ORG_B), false);
});

test('renaming another tenant conversation is denied', async () => {
  seedMerchantA();
  const res = mockResponse();
  const next = captureNext();

  await controller.renameConversation(
    mockRequest({ params: { id: CONV_B }, body: { title: 'hijacked' } }),
    res,
    next.next,
  );

  assert.equal(next.called, true);
  assert.equal(next.error.statusCode, 403);
});

test('deleting another tenant conversation is denied', async () => {
  seedMerchantA();
  const res = mockResponse();
  const next = captureNext();

  await controller.deleteConversation(mockRequest({ params: { id: CONV_B } }), res, next.next);

  assert.equal(next.called, true);
  assert.equal(next.error.statusCode, 403);
});

test('the read-only boundary rejects execute before touching the database', async () => {
  seedMerchantA();
  const res = mockResponse();
  const next = captureNext();

  await controller.chat(
    mockRequest({ body: { message: 'change my prices', execute: true } }),
    res,
    next.next,
  );

  assert.equal(next.called, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.error.code, 'READ_ONLY');
  assert.equal(state.queries.length, 0);
});
