'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const DB_PATH = require.resolve('../configs/database');
require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: { prisma: {} } };
const service = require('../services/commerceActionService');
const { SCOPES_QUERY, PRODUCT_QUERY, UPDATE_MUTATION } = require('../services/shopifyProductAction');
const { ACTION_PRODUCT_DESCRIPTION, actionRequestHash, assertActionInput } = require('../services/commerceActionPolicy');

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STORE = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const PRODUCT = 'gid://shopify/Product/123';
const context = { organizationId: ORG, userId: USER };
const body = { action_type: ACTION_PRODUCT_DESCRIPTION, store_id: STORE, product_id: PRODUCT, description: '<p>After</p>', idempotency_key: 'preview-key-000001' };

function database() {
  const rows = [];
  const audits = [];
  const db = {
    rows, audits,
    stores: { findFirst: async ({ where }) => where.organization_id === ORG && where.id === STORE ? { id: STORE, organization_id: ORG, platform: 'shopify', shop_domain: 'merchant.myshopify.com', access_token: 'encrypted' } : null },
    audit_logs: { create: async ({ data }) => { audits.push(data); return data; } },
    commerce_action_requests: {
      findFirst: async ({ where }) => rows.find(row => row.organization_id === where.organization_id && (!where.id || row.id === where.id) && (!where.idempotency_key || row.idempotency_key === where.idempotency_key)) || null,
      findUnique: async ({ where }) => rows.find(row => row.id === where.id) || null,
      findMany: async ({ where }) => rows.filter(row => row.organization_id === where.organization_id),
      create: async ({ data }) => { const row = { id: `44444444-4444-4444-8444-${String(rows.length + 1).padStart(12, '0')}`, ...data }; rows.push(row); return row; },
      updateMany: async ({ where, data }) => {
        const row = rows.find(item => item.id === where.id && item.organization_id === where.organization_id && item.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      },
    },
    $transaction: async callback => callback(db),
  };
  return db;
}

function graphqlFor(state, options = {}) {
  const calls = [];
  const graphql = async (_store, query, variables) => {
    calls.push({ query, variables });
    if (query === SCOPES_QUERY) return { currentAppInstallation: { accessScopes: (options.scopes || ['read_products', 'write_products']).map(handle => ({ handle })) } };
    if (query === PRODUCT_QUERY) return { product: { id: PRODUCT, title: 'Test product', descriptionHtml: state.description } };
    if (query === UPDATE_MUTATION) {
      if (options.transportFailure) throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
      if (options.userError) return { productUpdate: { product: null, userErrors: [{ message: 'Denied' }] } };
      if (options.missingConfirmation) return { productUpdate: { product: null, userErrors: [] } };
      state.description = variables.input.descriptionHtml;
      return { productUpdate: { product: { id: PRODUCT, title: 'Test product', descriptionHtml: state.description }, userErrors: [] } };
    }
    throw new Error('unexpected query');
  };
  return { graphql, calls };
}

async function preview(db, graphql, overrides = {}) {
  return service.createPreview({ ...body, ...overrides }, context, { db, graphql, env: { COMMERCE_ACTIONS_ENABLED: 'true' } });
}

test('preview persists exact before/after and idempotently replays only identical requests', async () => {
  const db = database(); const state = { description: '<p>Before</p>' }; const { graphql } = graphqlFor(state);
  const first = await preview(db, graphql);
  assert.equal(first.status, 'awaiting_confirmation');
  assert.equal(first.preview.before.description, '<p>Before</p>');
  assert.equal(first.preview.after.description, '<p>After</p>');
  assert.equal(db.audits[0].action, 'commerce_action_preview_created');
  const replay = await preview(db, graphql);
  assert.equal(replay.id, first.id); assert.equal(db.rows.length, 1);
  await assert.rejects(preview(db, graphql, { description: 'different' }), error => error.code === 'IDEMPOTENCY_KEY_REUSED');
});

test('preview enforces tenant store ownership and live read_products', async () => {
  const db = database(); const state = { description: 'before' };
  await assert.rejects(service.createPreview(body, { organizationId: OTHER_ORG, userId: USER }, { db, graphql: graphqlFor(state).graphql }), error => error.code === 'SHOPIFY_STORE_NOT_FOUND');
  await assert.rejects(preview(db, graphqlFor(state, { scopes: [] }).graphql), error => error.code === 'REQUIRED_SCOPE_NOT_GRANTED');
  assert.equal(db.rows.length, 0);
});

test('confirmation fails closed when production gate or live write scope is absent', async () => {
  const db = database(); const state = { description: 'before' }; const { graphql } = graphqlFor(state);
  const action = await preview(db, graphql);
  await assert.rejects(service.confirmAction(action.id, { confirmation_hash: action.confirmation_hash }, context, { db, graphql, env: {} }), error => error.code === 'COMMERCE_ACTIONS_DISABLED');
  await assert.rejects(service.confirmAction(action.id, { confirmation_hash: action.confirmation_hash }, context, { db, graphql: graphqlFor(state, { scopes: ['read_products'] }).graphql, env: { COMMERCE_ACTIONS_ENABLED: 'true' } }), error => error.code === 'COMMERCE_ACTIONS_DISABLED');
  assert.equal(db.rows[0].status, 'awaiting_confirmation'); assert.equal(state.description, 'before');
});

test('confirmation remains disabled with the legacy enable flag and live write scope', async () => {
  const db = database(); const state = { description: 'before' }; const transport = graphqlFor(state);
  const action = await preview(db, transport.graphql); const beforeCalls = transport.calls.length;
  await assert.rejects(service.confirmAction(action.id, { confirmation_hash: action.confirmation_hash }, context, { db, graphql: transport.graphql, env: { COMMERCE_ACTIONS_ENABLED: 'true' } }), error => error.code === 'COMMERCE_ACTIONS_DISABLED');
  assert.equal(transport.calls.length, beforeCalls); assert.equal(state.description, 'before'); assert.equal(db.rows[0].status, 'awaiting_confirmation');
});

test('rollback cannot execute a mutation even for a historical executed action', async () => {
  const db = database(); const state = { description: 'before' }; const transport = graphqlFor(state);
  const action = await preview(db, transport.graphql); db.rows[0].status = 'executed'; const beforeCalls = transport.calls.length;
  await assert.rejects(service.rollbackAction(action.id, { confirmation_hash: action.confirmation_hash }, context, { db, graphql: transport.graphql, env: { COMMERCE_ACTIONS_ENABLED: 'true' } }), error => error.code === 'COMMERCE_ACTIONS_DISABLED');
  assert.equal(transport.calls.length, beforeCalls); assert.equal(state.description, 'before'); assert.equal(db.rows[0].status, 'executed');
});

test('crash recovery reconciles only stale executing rows, never an active mutation', async () => {
  const db = database(); const state = { description: 'before' }; const { graphql } = graphqlFor(state);
  const action = await preview(db, graphql);
  state.description = body.description;
  Object.assign(db.rows[0], { status: 'executing', updated_at: new Date() });
  await assert.rejects(service.reconcileAction(action.id, context, { db, graphql }), error => error.code === 'ACTION_STILL_IN_PROGRESS');
  db.rows[0].updated_at = new Date(Date.now() - 6 * 60 * 1000);
  const recovered = await service.reconcileAction(action.id, context, { db, graphql });
  assert.equal(recovered.status, 'executed');
});

test('cross-tenant action reads and confirmations are not permitted', async () => {
  const db = database(); const state = { description: 'before' }; const { graphql } = graphqlFor(state);
  const action = await preview(db, graphql);
  await assert.rejects(service.getAction(action.id, { organizationId: OTHER_ORG }, { db }), error => error.code === 'ACTION_NOT_FOUND');
  await assert.rejects(service.confirmAction(action.id, { confirmation_hash: action.confirmation_hash }, { organizationId: OTHER_ORG, userId: USER }, { db, graphql, env: { COMMERCE_ACTIONS_ENABLED: 'true' } }), error => error.code === 'ACTION_NOT_FOUND');
  assert.equal(actionRequestHash(assertActionInput(body)), action.confirmation_hash);
});
