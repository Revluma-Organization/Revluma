'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const DB_PATH = require.resolve('../configs/database');
require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: { prisma: {} } };
const capabilities = require('../services/merchantCapabilityService');
const { SCOPES_QUERY, COLLECTIONS_QUERY } = require('../services/shopifyProductAction');
const { extensionManifest } = require('../services/sidekickToolRegistry');
const { REGISTRY } = require('../services/resourceRegistry');

const ORG = '11111111-1111-4111-8111-111111111111';
const STORE = '22222222-2222-4222-8222-222222222222';
const db = { stores: { findFirst: async ({ where }) => where.id === STORE && where.organization_id === ORG ? { id: STORE, organization_id: ORG, platform: 'shopify', shop_domain: 'merchant.myshopify.com', access_token: 'encrypted', status: 'connected', last_synced_at: null } : null } };
const graphql = async (_store, query) => {
  if (query === SCOPES_QUERY) return { currentAppInstallation: { accessScopes: [{ handle: 'read_products' }] } };
  if (query === COLLECTIONS_QUERY) return { collections: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } };
  throw new Error('unexpected query');
};

test('merchant coverage uses live scopes and reports action gates without claiming all data', async () => {
  const report = await capabilities.getMerchantCoverage(STORE, ORG, { db, graphql, ledger: { snapshot: async () => [] }, env: { COMMERCE_ACTIONS_ENABLED: 'true' } });
  assert.deepEqual(report.scopes.live_installation_scopes, ['read_products']);
  assert.equal(report.actions.supported[0].preview_available, true);
  assert.equal(report.actions.supported[0].execution_available, false);
  assert.equal(report.sidekick.deployable, false);
  assert.match(report.disclaimer, /not all-store-data coverage/);
  const products = report.resources.find(row => row.id === 'products');
  const collections = report.resources.find(row => row.id === 'collections');
  assert.equal(products.missing_scopes.length, 0);
  assert.equal(collections.status, 'IMPLEMENTED_UNVERIFIED');
  assert.equal(report.certification.implemented > 0, true);
});

test('coverage and collections enforce organization ownership', async () => {
  await assert.rejects(capabilities.getMerchantCoverage(STORE, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { db, graphql, ledger: { snapshot: async () => [] } }), error => error.code === 'SHOPIFY_STORE_NOT_FOUND');
  await assert.rejects(capabilities.getCollections(STORE, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {}, { db, graphql }), error => error.code === 'SHOPIFY_STORE_NOT_FOUND');
});

test('collections validates pagination and checks live read scope', async () => {
  const result = await capabilities.getCollections(STORE, ORG, { first: '25', after: 'cursor' }, { db, graphql });
  assert.equal(result.coverage.persisted, false);
  assert.equal(result.coverage.source, 'shopify_live');
  await assert.rejects(capabilities.getCollections(STORE, ORG, { first: '0' }, { db, graphql }), error => error.code === 'INVALID_COLLECTION_PAGE_SIZE');
  await assert.rejects(capabilities.getCollections(STORE, ORG, { first: '101' }, { db, graphql }), error => error.code === 'INVALID_COLLECTION_PAGE_SIZE');
  const noScope = async () => ({ currentAppInstallation: { accessScopes: [] } });
  await assert.rejects(capabilities.getCollections(STORE, ORG, {}, { db, graphql: noScope }), error => error.code === 'REQUIRED_SCOPE_NOT_GRANTED');
});

test('Sidekick registry is an honest nondeployable extension foundation', () => {
  const manifest = extensionManifest();
  assert.equal(manifest.deployable, false);
  assert.equal(manifest.authentication.sidekick_token_exchange, 'not_implemented');
  assert.equal(manifest.action_intents.every(intent => intent.deployable === false), true);
  assert.equal(manifest.data_tools.some(tool => tool.name === 'revluma_list_collections'), true);
  assert.ok(manifest.blocked_prerequisites.includes('managed_installation'));
  const collections = REGISTRY.find(row => row.id === 'collections');
  assert.equal(collections.verification, 'live_read');
  assert.ok(collections.notes.includes('PRODUCTION_VERIFIED'));
});
